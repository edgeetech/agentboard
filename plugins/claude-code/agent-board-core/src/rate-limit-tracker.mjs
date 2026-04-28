// Ported from hatice src/rate-limiter.ts

/**
 * @typedef {Object} RateLimitInfo
 * @property {boolean} isLimited
 * @property {number|null} retryAfterMs
 * @property {Date|null} lastLimitedAt
 * @property {number} limitCount
 * @property {string} source
 */

export class RateLimitTracker {
  /** @type {Map<string, {retryAfterMs:number|null, lastLimitedAt:Date|null, limitCount:number, limitedUntil:number|null}>} */
  #entries = new Map();

  /** @param {string} source @param {number} [retryAfterMs] */
  recordLimit(source, retryAfterMs) {
    const existing = this.#entries.get(source);
    const now = Date.now();
    const limitedUntil = retryAfterMs != null ? now + retryAfterMs : null;
    this.#entries.set(source, {
      retryAfterMs: retryAfterMs ?? null,
      lastLimitedAt: new Date(),
      limitCount: (existing?.limitCount ?? 0) + 1,
      limitedUntil,
    });
  }

  /** @param {string} source */
  recordSuccess(source) {
    const existing = this.#entries.get(source);
    if (!existing) return;
    this.#entries.set(source, {
      retryAfterMs: null,
      lastLimitedAt: existing.lastLimitedAt,
      limitCount: existing.limitCount,
      limitedUntil: 0,
    });
  }

  /** @param {string} source @returns {boolean} */
  isLimited(source) {
    const entry = this.#entries.get(source);
    if (!entry) return false;
    if (entry.limitedUntil === null) return true;
    if (entry.limitedUntil <= Date.now()) return false;
    return true;
  }

  /** @param {string} source @returns {RateLimitInfo} */
  getInfo(source) {
    const entry = this.#entries.get(source);
    if (!entry) return { isLimited: false, retryAfterMs: null, lastLimitedAt: null, limitCount: 0, source };
    return {
      isLimited: this.isLimited(source),
      retryAfterMs: entry.retryAfterMs,
      lastLimitedAt: entry.lastLimitedAt,
      limitCount: entry.limitCount,
      source,
    };
  }

  /** @returns {RateLimitInfo[]} */
  getAllLimits() {
    return [...this.#entries.keys()].map(s => this.getInfo(s));
  }

  /** @param {string} source */
  reset(source) {
    this.#entries.delete(source);
  }
}
