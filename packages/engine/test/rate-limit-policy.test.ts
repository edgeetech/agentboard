import { describe, expect, it } from "vitest";

import { RateLimitPolicy, type Clock } from "../src/index.ts";

class TestClock implements Clock {
  #time: number;

  constructor(time: number) {
    this.#time = time;
  }

  now(): number {
    return this.#time;
  }

  advance(ms: number): void {
    this.#time += ms;
  }
}

describe("engine rate limit policy", () => {
  it("reports unknown sources as not limited", () => {
    const policy = new RateLimitPolicy(new TestClock(1000));

    expect(policy.isLimited("api")).toBe(false);
    expect(policy.getInfo("api")).toMatchObject({
      source: "api",
      isLimited: false,
      retryAfterMs: null,
      lastLimitedAt: null,
      limitCount: 0,
      limitedUntilEpochMs: null,
    });
  });

  it("records indefinite limits when retryAfterMs is omitted", () => {
    const policy = new RateLimitPolicy(new TestClock(1000));

    policy.recordLimit({ source: "api" });

    expect(policy.isLimited("api")).toBe(true);
    expect(policy.getInfo("api")).toMatchObject({
      isLimited: true,
      retryAfterMs: null,
      limitCount: 1,
      limitedUntilEpochMs: null,
    });
  });

  it("expires retry-after limits using the injected clock", () => {
    const clock = new TestClock(1000);
    const policy = new RateLimitPolicy(clock);

    policy.recordLimit({ source: "api", retryAfterMs: 5000 });
    clock.advance(4999);
    expect(policy.isLimited("api")).toBe(true);

    clock.advance(1);
    expect(policy.isLimited("api")).toBe(false);
    expect(policy.getInfo("api").limitedUntilEpochMs).toBe(6000);
  });

  it("increments limitCount and tracks last limited time", () => {
    const clock = new TestClock(1000);
    const policy = new RateLimitPolicy(clock);

    policy.recordLimit({ source: "api", retryAfterMs: 1000 });
    clock.advance(250);
    policy.recordLimit({ source: "api", retryAfterMs: 1000 });

    const info = policy.getInfo("api");
    expect(info.limitCount).toBe(2);
    expect(info.lastLimitedAt?.getTime()).toBe(1250);
    expect(info.limitedUntilEpochMs).toBe(2250);
  });

  it("clears the active limit on success while preserving history", () => {
    const policy = new RateLimitPolicy(new TestClock(1000));

    policy.recordLimit({ source: "api", retryAfterMs: 60_000 });
    policy.recordSuccess("api");

    expect(policy.getInfo("api")).toMatchObject({
      isLimited: false,
      retryAfterMs: null,
      limitCount: 1,
      limitedUntilEpochMs: 0,
    });
  });

  it("resets tracked sources and returns all tracked limits", () => {
    const policy = new RateLimitPolicy(new TestClock(1000));

    policy.recordLimit({ source: "github", retryAfterMs: 1000 });
    policy.recordLimit({ source: "linear", retryAfterMs: 2000 });
    expect(policy.getAllLimits().map((info) => info.source)).toEqual([
      "github",
      "linear",
    ]);

    policy.reset("github");
    expect(policy.isLimited("github")).toBe(false);
    expect(policy.getInfo("github").limitCount).toBe(0);
  });
});
