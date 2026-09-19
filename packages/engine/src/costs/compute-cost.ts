import type { EngineCostResult, TokenRate, TokenUsage } from "./types.ts";

export function computeTokenCost(
  rate: TokenRate | null | undefined,
  usage: TokenUsage,
  pricingVersion: number,
): EngineCostResult {
  if (!rate) {
    return { costUsd: 0, pricingVersion: 0, uncosted: true };
  }

  const cost =
    (boundedTokenCount(usage.inputTokens) * rate.input +
      boundedTokenCount(usage.outputTokens) * rate.output +
      boundedTokenCount(usage.cacheCreationTokens) * rate.cacheWrite +
      boundedTokenCount(usage.cacheReadTokens) * rate.cacheRead) /
    1_000_000;

  return {
    costUsd: roundUsd(cost),
    pricingVersion,
    uncosted: false,
  };
}

function boundedTokenCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
