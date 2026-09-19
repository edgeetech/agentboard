import { describe, expect, it } from "vitest";

import {
  computeBackoffMs,
  decideRetry,
  normalizeRetryConfig,
} from "../src/index.ts";

describe("engine retry policy", () => {
  it("computes exponential backoff from current attempt", () => {
    expect(computeBackoffMs(1)).toBe(1000);
    expect(computeBackoffMs(2)).toBe(2000);
    expect(computeBackoffMs(3)).toBe(4000);
  });

  it("caps backoff at the default max", () => {
    expect(computeBackoffMs(20)).toBe(300_000);
  });

  it("respects a custom max backoff", () => {
    expect(computeBackoffMs(5, 10_000)).toBe(10_000);
    expect(computeBackoffMs(1, 500)).toBe(500);
  });

  it("stops when max attempts has been reached", () => {
    const decision = decideRetry({ attempt: 3 });
    expect(decision.shouldRetry).toBe(false);
    if (!decision.shouldRetry)
      expect(decision.reason).toContain("max attempts");
  });

  it("respects custom max attempts", () => {
    expect(
      decideRetry({ attempt: 2, config: { maxRetryAttempts: 2 } }).shouldRetry,
    ).toBe(false);
  });

  it("returns next attempt and delay when retrying", () => {
    const decision = decideRetry({ attempt: 1 });
    expect(decision.shouldRetry).toBe(true);
    if (decision.shouldRetry) {
      expect(decision.nextAttempt).toBe(2);
      expect(decision.delayMs).toBe(1000);
    }
  });

  it("normalizes legacy snake_case retry config", () => {
    expect(
      normalizeRetryConfig({
        max_retry_attempts: 4,
        max_retry_backoff_ms: 60_000,
      }),
    ).toEqual({
      maxRetryAttempts: 4,
      maxRetryBackoffMs: 60_000,
    });
  });
});
