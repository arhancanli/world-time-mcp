// kit/http.mjs
//
// The only way a factory server reaches the network. One fetcher per server, created with the
// hosts that server is allowed to call. Every request is HTTPS, host-checked (on every redirect
// hop too), size-capped, deadline-bound, and retried only when it is a read and the upstream said
// "try again" (429, 502, 503, 504) or the connection failed. Error messages name the host and the
// status, never the upstream body, a key or a query string, so nothing sensitive reaches a model
// or a log.

export class UpstreamError extends Error {
  constructor(code, message, { status } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_REDIRECTS = 3;
const MAX_RETRY_AFTER_MS = 5_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkUrl(raw, allowHosts) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UpstreamError("bad_url", "The request URL could not be parsed.");
  }
  if (url.protocol !== "https:") throw new UpstreamError("host_not_allowed", `Only https is allowed (got ${url.protocol}).`);
  if (url.username || url.password) throw new UpstreamError("host_not_allowed", "URLs with credentials are not allowed.");
  if (!allowHosts.has(url.hostname.toLowerCase())) throw new UpstreamError("host_not_allowed", `${url.hostname} is not on this server's host allowlist.`);
  return url;
}

// Reads at most maxBytes; a larger body is refused, not silently cut.
async function readCapped(res, maxBytes, host) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new UpstreamError("upstream_too_large", `${host} returned ${declared} bytes, over the ${maxBytes}-byte limit.`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UpstreamError("upstream_too_large", `${host} returned more than the ${maxBytes}-byte limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

function retryAfterMs(res) {
  const header = res?.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

function retryDelay(res, attempt) {
  const asked = retryAfterMs(res);
  if (asked !== undefined) return Math.min(asked, MAX_RETRY_AFTER_MS);
  return Math.min(250 * 2 ** attempt + Math.floor(Math.random() * 100), MAX_RETRY_AFTER_MS);
}

/**
 * Per-upstream rate limits, so a server keeps to each API's published policy instead of collecting
 * 429s. A rule matches by host (and optionally a path test); its perSecond spaces request starts
 * for that rule, and its concurrency caps requests in flight for every rule sharing its group.
 * The first matching rule applies.
 * @typedef {{host: string, path?: RegExp, group?: string, perSecond?: number, concurrency?: number}} LimitRule
 */
export function createLimiter(rules = []) {
  const groups = new Map();
  const lastStart = new Map();
  const state = (g, max) => {
    if (!groups.has(g)) groups.set(g, { active: 0, max, queue: [] });
    return groups.get(g);
  };
  return async function acquire(url) {
    const i = rules.findIndex((r) => r.host === url.hostname && (!r.path || r.path.test(url.pathname + url.search)));
    if (i < 0) return () => {};
    const rule = rules[i];
    const g = state(rule.group ?? rule.host, rule.concurrency ?? Infinity);
    if (g.active >= g.max) await new Promise((resolve) => g.queue.push(resolve));
    g.active++;
    if (rule.perSecond) {
      const gap = 1000 / rule.perSecond;
      const next = (lastStart.get(i) ?? -Infinity) + gap;
      const now = Date.now();
      lastStart.set(i, Math.max(now, next));
      if (next > now) await sleep(next - now);
    }
    return () => {
      g.active--;
      g.queue.shift()?.();
    };
  };
}

/**
 * @param {object} o
 * @param {string[]} o.allowHosts   exact hostnames this server may call
 * @param {string}   o.userAgent    sent on every request; name the server and its repo
 * @param {number}  [o.timeoutMs]   deadline for the whole call, retries included
 * @param {number}  [o.attemptTimeoutMs] a read attempt that has not answered by then is abandoned
 *   and retried (within timeoutMs), so one stalled connection does not cost the whole deadline
 * @param {number}  [o.maxBytes]    largest body accepted
 * @param {number}  [o.retries]     extra attempts for reads
 * @param {import("./cache.mjs").TtlCache} [o.cache]  optional cache for successful GETs
 * @param {LimitRule[]} [o.limits] per-upstream rate limits (see createLimiter)
 * @param {typeof fetch} [o.fetchImpl]
 */
export function createFetcher({ allowHosts, userAgent, timeoutMs = 15_000, attemptTimeoutMs, maxBytes = 5 * 1024 * 1024, retries = 2, cache, limits, fetchImpl = fetch }) {
  if (!Array.isArray(allowHosts) || allowHosts.length === 0) throw new Error("createFetcher needs a non-empty allowHosts list");
  if (!userAgent) throw new Error("createFetcher needs a userAgent");
  const hosts = new Set(allowHosts.map((h) => h.toLowerCase()));
  const acquire = createLimiter(limits);
  // Identical reads already in flight share one upstream call: an agent checking a manifest, or
  // several tools resolving the same record, costs one request and one wait instead of many.
  const inFlight = new Map();

  /**
   * @param {string} raw
   * @param {{method?: string, headers?: object, body?: string, accept?: string, idempotent?: boolean}} [opts]
   *   idempotent: a POST that only reads (a search API) is cached, shared in flight and retried like a GET.
   */
  function request(raw, opts = {}) {
    const { method = "GET", headers = {}, accept = "application/json", body, idempotent = false } = opts;
    const isRead = method === "GET" || method === "HEAD" || idempotent;
    const plain = Object.keys(headers).every((h) => h.toLowerCase() === "content-type");
    if (!isRead || !plain) return send(raw, opts);
    const key = `${method} ${accept} ${raw}${body ? ` ${body}` : ""}`;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = send(raw, opts).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  async function send(raw, { method = "GET", headers = {}, body, accept = "application/json", idempotent = false } = {}) {
    const isRead = method === "GET" || method === "HEAD" || idempotent;
    const cacheKey = isRead && cache ? `${method} ${accept} ${raw}${body ? ` ${body}` : ""}` : undefined;
    if (cacheKey) {
      const hit = cache.get(cacheKey);
      if (hit !== undefined) return hit;
    }
    const deadline = AbortSignal.timeout(timeoutMs);
    let url = checkUrl(raw, hosts);
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        let hops = 0;
        for (;;) {
          const release = await acquire(url);
          const signal = isRead && attemptTimeoutMs && attempt < retries ? AbortSignal.any([deadline, AbortSignal.timeout(attemptTimeoutMs)]) : deadline;
          try {
            res = await fetchImpl(url, { method, headers: { "User-Agent": userAgent, Accept: accept, ...headers }, body, redirect: "manual", signal });
          } finally {
            release();
          }
          if (res.status < 300 || res.status >= 400) break;
          const location = res.headers.get("location");
          await res.body?.cancel().catch(() => {});
          if (!location || ++hops > MAX_REDIRECTS) throw new UpstreamError("upstream_redirect", `${url.hostname} redirected too many times or without a location.`);
          url = checkUrl(new URL(location, url).href, hosts);
        }
      } catch (err) {
        if (err instanceof UpstreamError) throw err;
        if (deadline.aborted) throw new UpstreamError("upstream_timeout", `${url.hostname} did not answer within ${timeoutMs} ms.`);
        if (isRead && attempt < retries) {
          await sleep(retryDelay(undefined, attempt));
          continue;
        }
        throw new UpstreamError("upstream_unreachable", `${url.hostname} could not be reached.`);
      }
      // A Retry-After longer than the cap means "not soon" (for example, a daily quota): retrying
      // early would be refused again, so the answer is returned now instead.
      const askedMs = retryAfterMs(res);
      if (RETRY_STATUSES.has(res.status) && isRead && attempt < retries && !(askedMs > MAX_RETRY_AFTER_MS)) {
        const wait = retryDelay(res, attempt);
        await res.body?.cancel().catch(() => {});
        await sleep(wait);
        if (deadline.aborted) throw new UpstreamError("upstream_timeout", `${url.hostname} did not answer within ${timeoutMs} ms.`);
        continue;
      }
      const text = await readCapped(res, maxBytes, url.hostname);
      const out = { status: res.status, ok: res.ok, url: url.href, text, headers: res.headers };
      // 404 and 410 are answers ("no such thing"), not failures, so they are cached like successes:
      // an agent that asks again about a missing package gets the answer without another round trip.
      if (cacheKey && (res.ok || res.status === 404 || res.status === 410)) cache.set(cacheKey, out);
      return out;
    }
  }

  return {
    request,
    /** GET a JSON document. Non-2xx becomes an UpstreamError unless the status is in `allowStatus`. */
    async getJson(url, { headers, allowStatus = [] } = {}) {
      const res = await request(url, { headers });
      if (!res.ok && !allowStatus.includes(res.status)) {
        throw new UpstreamError("upstream_status", `${new URL(res.url).hostname} answered with status ${res.status}.`, { status: res.status });
      }
      if (!res.ok) return { status: res.status, data: undefined };
      try {
        return { status: res.status, data: JSON.parse(res.text) };
      } catch {
        throw new UpstreamError("upstream_bad_json", `${new URL(res.url).hostname} returned a body that is not JSON (status ${res.status}).`);
      }
    },
  };
}
