import { describe, expect, it } from "vitest";

import { computeTokenCost } from "../../engine/src/index.ts";
import {
  LEGACY_PRICING_VERSION,
  legacyPricingCatalog,
  lookupLegacyModelPrice,
} from "../src/index.ts";

describe("legacyPricingCatalog", () => {
  it("preserves legacy direct model pricing", () => {
    const rate = lookupLegacyModelPrice("copilot-pro");

    expect(computeTokenCost(rate, {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 100,
      cacheReadTokens: 50,
    }, LEGACY_PRICING_VERSION)).toEqual({
      costUsd: 0.00263,
      pricingVersion: 3,
      uncosted: false,
    });
  });

  it("normalizes dated and bracketed model ids", () => {
    expect(lookupLegacyModelPrice("claude-opus-4-7-20260430")).toEqual(
      lookupLegacyModelPrice("claude-opus-4-7"),
    );
    expect(lookupLegacyModelPrice("gpt-5[reasoning=medium]")).toEqual(
      lookupLegacyModelPrice("gpt-5"),
    );
  });

  it("keeps family-level fallbacks outside Engine", () => {
    expect(legacyPricingCatalog.findRate("claude-sonnet-4.5-thinking")).toEqual(
      lookupLegacyModelPrice("claude-sonnet-4.5"),
    );
    expect(legacyPricingCatalog.findRate("unknown-model")).toBeNull();
  });
});
