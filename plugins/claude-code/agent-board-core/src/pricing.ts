// Hardcoded Anthropic & Copilot pricing (USD per 1M tokens). Bump PRICING_VERSION when edited.
// Last sourced: 2026-04-30.

export const PRICING_VERSION = 3;

interface Rate {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

const COPILOT_FALLBACK: Rate = { input: 1, output: 3, cache_write: 1.25, cache_read: 0.1 };
const CLAUDE_SONNET_RATE: Rate = { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 };
const CLAUDE_OPUS_RATE: Rate = { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 };
const CLAUDE_HAIKU_RATE: Rate = { input: 0.8, output: 4, cache_write: 1.0, cache_read: 0.08 };
const GPT_4_1_RATE: Rate = { input: 2, output: 8, cache_write: 2.5, cache_read: 0.5 };
const GPT_5_RATE: Rate = { input: 1.25, output: 10, cache_write: 1.5, cache_read: 0.125 };
const GPT_5_MINI_RATE: Rate = { input: 0.25, output: 2, cache_write: 0.3, cache_read: 0.025 };
const O3_RATE: Rate = { input: 2, output: 8, cache_write: 2.5, cache_read: 0.5 };
const GEMINI_25_PRO_RATE: Rate = { input: 1.25, output: 10, cache_write: 1.5, cache_read: 0.31 };

export const PRICING: Record<string, Rate> = {
  // Anthropic native (used by Claude SDK runner)
  'claude-opus-4-7': CLAUDE_OPUS_RATE,
  'claude-sonnet-4-6': CLAUDE_SONNET_RATE,
  'claude-haiku-4-5': CLAUDE_HAIKU_RATE,
  // Copilot agent models (model ids reported via session.model_change / assistant.usage)
  'claude-sonnet-4': CLAUDE_SONNET_RATE,
  'claude-sonnet-4.5': CLAUDE_SONNET_RATE,
  'claude-sonnet-4-5': CLAUDE_SONNET_RATE,
  'claude-opus-4': CLAUDE_OPUS_RATE,
  'claude-opus-4.1': CLAUDE_OPUS_RATE,
  'claude-opus-4-1': CLAUDE_OPUS_RATE,
  'claude-haiku-4': CLAUDE_HAIKU_RATE,
  'gpt-4.1': GPT_4_1_RATE,
  'gpt-4-1': GPT_4_1_RATE,
  'gpt-5': GPT_5_RATE,
  'gpt-5-mini': GPT_5_MINI_RATE,
  o3: O3_RATE,
  'o3-mini': GPT_5_MINI_RATE,
  'gemini-2.5-pro': GEMINI_25_PRO_RATE,
  'gemini-2-5-pro': GEMINI_25_PRO_RATE,
  // Generic copilot fallbacks
  'copilot-pro': COPILOT_FALLBACK,
  copilot: COPILOT_FALLBACK,
};

export interface UsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface CostResult {
  cost_usd: number;
  cost_version: number;
  uncosted: boolean;
}

export function computeCost(model: string | null | undefined, u: UsageTokens): CostResult {
  const key = model ? normalizeModel(model) : null;
  const price = key ? lookupPrice(key) : undefined;
  if (!price) return { cost_usd: 0, cost_version: 0, uncosted: true };
  const cost =
    (u.input_tokens * price.input +
      u.output_tokens * price.output +
      u.cache_creation_tokens * price.cache_write +
      u.cache_read_tokens * price.cache_read) /
    1_000_000;
  return { cost_usd: round6(cost), cost_version: PRICING_VERSION, uncosted: false };
}

function lookupPrice(key: string): Rate | undefined {
  const direct = PRICING[key];
  if (direct) return direct;
  // Strip trailing version qualifiers and retry (e.g. "claude-sonnet-4.5-thinking" → "claude-sonnet-4.5").
  const stripped = key.replace(/-(thinking|preview|latest|beta|exp)$/i, '');
  if (stripped !== key) {
    const strippedRate = PRICING[stripped];
    if (strippedRate) return strippedRate;
  }
  // Family-level fallback for unrecognised Copilot model strings.
  if (/^claude-opus/i.test(key)) return CLAUDE_OPUS_RATE;
  if (/^claude-sonnet/i.test(key)) return CLAUDE_SONNET_RATE;
  if (/^claude-haiku/i.test(key)) return CLAUDE_HAIKU_RATE;
  if (/^gpt-5-mini/i.test(key)) return GPT_5_MINI_RATE;
  if (/^gpt-5/i.test(key)) return GPT_5_RATE;
  if (/^gpt-4/i.test(key)) return GPT_4_1_RATE;
  if (/^o3/i.test(key)) return O3_RATE;
  if (/^gemini/i.test(key)) return GEMINI_25_PRO_RATE;
  return undefined;
}

function normalizeModel(m: string): string {
  return m.replace(/-\d{8}$/, '').replace(/\[.*\]$/u, '');
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
