export interface Clock {
  now(): number;
}

export interface RateLimitInfo {
  readonly source: string;
  readonly isLimited: boolean;
  readonly retryAfterMs: number | null;
  readonly lastLimitedAt: Date | null;
  readonly limitCount: number;
  readonly limitedUntilEpochMs: number | null;
}

interface RateLimitEntry {
  readonly retryAfterMs: number | null;
  readonly lastLimitedAt: Date | null;
  readonly limitCount: number;
  readonly limitedUntilEpochMs: number | null;
}

export interface RecordRateLimitInput {
  readonly source: string;
  readonly retryAfterMs?: number;
}

export class RateLimitPolicy {
  readonly #entries = new Map<string, RateLimitEntry>();
  readonly #clock: Clock;

  constructor(clock: Clock = { now: Date.now }) {
    this.#clock = clock;
  }

  recordLimit({ source, retryAfterMs }: RecordRateLimitInput): void {
    const existing = this.#entries.get(source);
    const now = this.#clock.now();
    const limitedUntilEpochMs =
      retryAfterMs === undefined ? null : now + retryAfterMs;

    this.#entries.set(source, {
      retryAfterMs: retryAfterMs ?? null,
      lastLimitedAt: new Date(now),
      limitCount: (existing?.limitCount ?? 0) + 1,
      limitedUntilEpochMs,
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

    return entry.limitedUntilEpochMs > this.#clock.now();
  }

  getInfo(source: string): RateLimitInfo {
    const entry = this.#entries.get(source);
    if (!entry) {
      return {
        source,
        isLimited: false,
        retryAfterMs: null,
        lastLimitedAt: null,
        limitCount: 0,
        limitedUntilEpochMs: null,
      };
    }

    return {
      source,
      isLimited: this.isLimited(source),
      retryAfterMs: entry.retryAfterMs,
      lastLimitedAt: entry.lastLimitedAt,
      limitCount: entry.limitCount,
      limitedUntilEpochMs: entry.limitedUntilEpochMs,
    };
  }

  getAllLimits(): RateLimitInfo[] {
    return [...this.#entries.keys()].map((source) => this.getInfo(source));
  }

  reset(source: string): void {
    this.#entries.delete(source);
  }
}
