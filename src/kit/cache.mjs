// kit/cache.mjs
//
// A small in-process cache with a time-to-live and a size bound, for upstream reads that do not
// change within minutes. Repeated agent calls then cost no upstream request and no latency.

export class TtlCache {
  constructor({ ttlMs = 5 * 60_000, maxEntries = 500, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Re-insert so iteration order is least recently used first.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value);
  }
}
