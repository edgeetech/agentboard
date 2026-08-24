export interface RateLimitInfo {
  isLimited: boolean;
  retryAfterMs: number | null;
  lastLimitedAt: Date | null;
  limitCount: number;
  source: string;
}

interface RateLimitEntry {
  retryAfterMs: number | null;
  lastLimitedAt: Date | null;
  limitCount: number;
  limitedUntilEpochMs: number | null;
}

export class RateLimitTracker {
  readonly #entries = new Map<string, RateLimitEntry>();

  recordLimit(source: string, retryAfterMs?: number): void {
    const existing = this.#entries.get(source);
    const now = Date.now();
    this.#entries.set(source, {
      retryAfterMs: retryAfterMs ?? null,
      lastLimitedAt: new Date(now),
      limitCount: (existing?.limitCount ?? 0) + 1,
      limitedUntilEpochMs: retryAfterMs === undefined ? null : now + retryAfterMs,
    });
  }

  recordSuccess(source: string): void {
    const existing = this.#entries.get(source);
    if (!existing) return;
    this.#entries.set(source, {
      retryAfterMs: null,
      lastLimitedAt: existing.lastLimitedAt,
      limitCount: existing.limitCount,
      limitedUntilEpochMs: 0,
    });
  }

  isLimited(source: string): boolean {
    const entry = this.#entries.get(source);
    if (!entry) return false;
    if (entry.limitedUntilEpochMs === null) return true;
    return entry.limitedUntilEpochMs > Date.now();
  }

  getInfo(source: string): RateLimitInfo {
    const info = this.#entries.get(source);
    if (!info) {
      return {
        isLimited: false,
        retryAfterMs: null,
        lastLimitedAt: null,
        limitCount: 0,
        source,
      };
    }
    return {
      isLimited: this.isLimited(source),
      retryAfterMs: info.retryAfterMs,
      lastLimitedAt: info.lastLimitedAt,
      limitCount: info.limitCount,
      source,
    };
  }

  getAllLimits(): RateLimitInfo[] {
    return [...this.#entries.keys()].map((source) => this.getInfo(source));
  }

  reset(source: string): void {
    this.#entries.delete(source);
  }
}
