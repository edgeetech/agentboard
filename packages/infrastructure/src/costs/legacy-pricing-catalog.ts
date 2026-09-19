import type { PricingCatalogPort, TokenRate } from "../../../engine/src/index.ts";

export const LEGACY_PRICING_VERSION = 3;

const COPILOT_FALLBACK = {
  input: 1,
  output: 3,
  cacheWrite: 1.25,
  cacheRead: 0.1,
} satisfies TokenRate;

const CLAUDE_SONNET_RATE = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
} satisfies TokenRate;

const CLAUDE_OPUS_RATE = {
  input: 15,
  output: 75,
  cacheWrite: 18.75,
  cacheRead: 1.5,
} satisfies TokenRate;

const CLAUDE_HAIKU_RATE = {
  input: 0.8,
  output: 4,
  cacheWrite: 1,
  cacheRead: 0.08,
} satisfies TokenRate;

const GPT_4_1_RATE = {
  input: 2,
  output: 8,
  cacheWrite: 2.5,
  cacheRead: 0.5,
} satisfies TokenRate;

const GPT_5_RATE = {
  input: 1.25,
  output: 10,
  cacheWrite: 1.5,
  cacheRead: 0.125,
} satisfies TokenRate;

const GPT_5_MINI_RATE = {
  input: 0.25,
  output: 2,
  cacheWrite: 0.3,
  cacheRead: 0.025,
} satisfies TokenRate;

const O3_RATE = {
  input: 2,
  output: 8,
  cacheWrite: 2.5,
  cacheRead: 0.5,
} satisfies TokenRate;

const GEMINI_25_PRO_RATE = {
  input: 1.25,
  output: 10,
  cacheWrite: 1.5,
  cacheRead: 0.31,
} satisfies TokenRate;

export const LEGACY_MODEL_PRICING: Readonly<Record<string, TokenRate>> = {
  "claude-opus-4-7": CLAUDE_OPUS_RATE,
  "claude-sonnet-4-6": CLAUDE_SONNET_RATE,
  "claude-haiku-4-5": CLAUDE_HAIKU_RATE,
  "claude-sonnet-4": CLAUDE_SONNET_RATE,
  "claude-sonnet-4.5": CLAUDE_SONNET_RATE,
  "claude-sonnet-4-5": CLAUDE_SONNET_RATE,
  "claude-opus-4": CLAUDE_OPUS_RATE,
  "claude-opus-4.1": CLAUDE_OPUS_RATE,
  "claude-opus-4-1": CLAUDE_OPUS_RATE,
  "claude-haiku-4": CLAUDE_HAIKU_RATE,
  "gpt-4.1": GPT_4_1_RATE,
  "gpt-4-1": GPT_4_1_RATE,
  "gpt-5": GPT_5_RATE,
  "gpt-5-mini": GPT_5_MINI_RATE,
  o3: O3_RATE,
  "o3-mini": GPT_5_MINI_RATE,
  "gemini-2.5-pro": GEMINI_25_PRO_RATE,
  "gemini-2-5-pro": GEMINI_25_PRO_RATE,
  "copilot-pro": COPILOT_FALLBACK,
  copilot: COPILOT_FALLBACK,
} as const;

export const legacyPricingCatalog = {
  version: LEGACY_PRICING_VERSION,
  findRate(modelId) {
    return lookupLegacyModelPrice(modelId);
  },
} satisfies PricingCatalogPort;

export function lookupLegacyModelPrice(modelId: string | null | undefined): TokenRate | null {
  if (!modelId) return null;
  const key = normalizeModelId(modelId);
  const direct = LEGACY_MODEL_PRICING[key];
  if (direct) return direct;

  const stripped = key.replace(/-(thinking|preview|latest|beta|exp)$/i, "");
  if (stripped !== key) {
    const strippedRate = LEGACY_MODEL_PRICING[stripped];
    if (strippedRate) return strippedRate;
  }

  if (/^claude-opus/i.test(key)) return CLAUDE_OPUS_RATE;
  if (/^claude-sonnet/i.test(key)) return CLAUDE_SONNET_RATE;
  if (/^claude-haiku/i.test(key)) return CLAUDE_HAIKU_RATE;
  if (/^gpt-5-mini/i.test(key)) return GPT_5_MINI_RATE;
  if (/^gpt-5/i.test(key)) return GPT_5_RATE;
  if (/^gpt-4/i.test(key)) return GPT_4_1_RATE;
  if (/^o3/i.test(key)) return O3_RATE;
  if (/^gemini/i.test(key)) return GEMINI_25_PRO_RATE;

  return null;
}

function normalizeModelId(modelId: string): string {
  return modelId.replace(/-\d{8}$/, "").replace(/\[.*\]$/u, "");
}
