// kit/result.mjs
//
// Helpers that keep results compact and honest: lists are cut to a limit with an explicit count
// of what was left out, and text fields are clipped with a visible marker, so a model always
// knows when it is not seeing everything.

/** @returns {{items: T[], total: number, returned: number, truncated: boolean}} */
export function page(items, limit) {
  const list = Array.isArray(items) ? items : [];
  const kept = list.slice(0, Math.max(0, limit));
  return { items: kept, total: list.length, returned: kept.length, truncated: kept.length < list.length };
}

export function clip(text, maxChars) {
  if (typeof text !== "string") return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()} [clipped: ${text.length - maxChars} more characters]`;
}

/** Drops keys whose value is undefined, null, an empty string or an empty array. */
export function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}

/** Runs fn over items with at most `limit` in flight, keeping input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
