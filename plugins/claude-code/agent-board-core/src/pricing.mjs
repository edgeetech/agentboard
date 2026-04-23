// Hardcoded Anthropic pricing (USD per 1M tokens). Bump PRICING_VERSION when edited.
// Last sourced: 2026-04-23.

export const PRICING_VERSION = 1;

export const PRICING = {
  'claude-opus-4-7':    { input: 15,  output: 75, cache_write: 18.75, cache_read: 1.5 },
  'claude-sonnet-4-6':  { input:  3,  output: 15, cache_write:  3.75, cache_read: 0.3 },
  'claude-haiku-4-5':   { input:  0.8, output: 4, cache_write:  1.0,  cache_read: 0.08 },
};

export function computeCost(model, u) {
  const key = model ? normalizeModel(model) : null;
  const price = key ? PRICING[key] : undefined;
  if (!price) return { cost_usd: 0, cost_version: 0, uncosted: true };
  const cost =
    (u.input_tokens          * price.input +
     u.output_tokens         * price.output +
     u.cache_creation_tokens * price.cache_write +
     u.cache_read_tokens     * price.cache_read) / 1_000_000;
  return { cost_usd: round6(cost), cost_version: PRICING_VERSION, uncosted: false };
}

function normalizeModel(m) {
  return m.replace(/-\d{8}$/, '').replace(/\[.*\]$/, '');
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}
