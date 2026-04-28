// In-memory rate limit tracker. Tracks 429 responses per source.
// Backoff expires automatically when retryAfterMs elapses.

export class RateLimitTracker {
  constructor() {
    this._entries = new Map(); // source → { retryAfterMs, lastLimitedAt, limitCount, limitedUntil }
  }

  recordLimit(source, retryAfterMs) {
    const existing = this._entries.get(source);
    const now = Date.now();
    const limitedUntil = retryAfterMs != null ? now + retryAfterMs : null;
    this._entries.set(source, {
      retryAfterMs: retryAfterMs ?? null,
      lastLimitedAt: new Date().toISOString(),
      limitCount: (existing?.limitCount ?? 0) + 1,
      limitedUntil,
    });
  }

  recordSuccess(source) {
    const existing = this._entries.get(source);
    if (!existing) return;
    this._entries.set(source, { ...existing, limitedUntil: 0 });
  }

  isLimited(source) {
    const entry = this._entries.get(source);
    if (!entry) return false;
    if (entry.limitedUntil === null) return true;   // no expiry = stays limited
    return entry.limitedUntil > Date.now();
  }

  getInfo(source) {
    const entry = this._entries.get(source);
    if (!entry) return { isLimited: false, retryAfterMs: null, lastLimitedAt: null, limitCount: 0, source };
    return { isLimited: this.isLimited(source), ...entry, source };
  }

  reset(source) { this._entries.delete(source); }
}
