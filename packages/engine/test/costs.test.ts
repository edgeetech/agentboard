import { describe, expect, it } from "vitest";

import { computeTokenCost, type TokenRate } from "../src/index.ts";

const RATE = {
  input: 1,
  output: 3,
  cacheWrite: 1.25,
  cacheRead: 0.1,
} satisfies TokenRate;

describe("computeTokenCost", () => {
  it("computes USD cost from per-million token rates", () => {
    expect(
      computeTokenCost(
        RATE,
        {
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 100,
          cacheReadTokens: 50,
        },
        3,
      ),
    ).toEqual({
      costUsd: 0.00263,
      pricingVersion: 3,
      uncosted: false,
    });
  });

  it("marks missing rates as uncosted", () => {
    expect(
      computeTokenCost(
        null,
        { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
        3,
      ),
    ).toEqual({ costUsd: 0, pricingVersion: 0, uncosted: true });
  });

  it("bounds invalid token counts before computing", () => {
    expect(
      computeTokenCost(
        RATE,
        {
          inputTokens: -100,
          outputTokens: 1.9,
          cacheCreationTokens: Number.NaN,
          cacheReadTokens: Number.POSITIVE_INFINITY,
        },
        3,
      ),
    ).toEqual({ costUsd: 0.000003, pricingVersion: 3, uncosted: false });
  });
});
