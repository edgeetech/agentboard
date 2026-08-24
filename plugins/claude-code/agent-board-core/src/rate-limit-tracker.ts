import { RateLimitPolicy } from '../../../../packages/engine/src/runs/rate-limit-policy.ts';

export interface RateLimitInfo {
  isLimited: boolean;
  retryAfterMs: number | null;
  lastLimitedAt: Date | null;
  limitCount: number;
  source: string;
}

export class RateLimitTracker {
  readonly #policy = new RateLimitPolicy();

  recordLimit(source: string, retryAfterMs?: number): void {
    if (retryAfterMs === undefined) {
      this.#policy.recordLimit({ source });
      return;
    }

    this.#policy.recordLimit({ source, retryAfterMs });
  }

  recordSuccess(source: string): void {
    this.#policy.recordSuccess(source);
  }

  isLimited(source: string): boolean {
    return this.#policy.isLimited(source);
  }

  getInfo(source: string): RateLimitInfo {
    const info = this.#policy.getInfo(source);

    return {
      isLimited: info.isLimited,
      retryAfterMs: info.retryAfterMs,
      lastLimitedAt: info.lastLimitedAt,
      limitCount: info.limitCount,
      source,
    };
  }

  getAllLimits(): RateLimitInfo[] {
    return this.#policy.getAllLimits().map((info) => this.getInfo(info.source));
  }

  reset(source: string): void {
    this.#policy.reset(source);
  }
}
