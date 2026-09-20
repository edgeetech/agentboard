import { describe, expect, it } from 'vitest';

import { computeCost, PRICING, PRICING_TABLE_DATE, PRICING_VERSION } from '../src/pricing.ts';

// Model ids observed in real ~/.agentboard run rows. A silent $0 for any of
// these means the table (or its family fallbacks) regressed — which shows up as
// a cost report that quietly under-reports rather than as a visible failure.
// Pin them here so the regression is loud.
const KNOWN_MODEL_IDS = [
  'claude-sonnet-4.6',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-opus-4-7[1m]',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.6-sol',
  'claude-haiku-4.5',
  'claude-haiku-4-5',
] as const;

const USAGE = {
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
};

describe('pricing table', () => {
  it('declares the date its rates were sourced', () => {
    expect(PRICING_TABLE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(KNOWN_MODEL_IDS)('costs %s at a non-zero rate', (model) => {
    const result = computeCost(model, USAGE);
    expect(result.uncosted).toBe(false);
    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.cost_version).toBe(PRICING_VERSION);
  });

  it('reports an unknown model as uncosted rather than $0', () => {
    const result = computeCost('totally-made-up-model-9', USAGE);
    expect(result).toEqual({ cost_usd: 0, cost_version: 0, uncosted: true });
  });

  it('prices Haiku 4.5 at the published $1 / $5 per 1M', () => {
    const result = computeCost('claude-haiku-4-5', USAGE);
    expect(result.cost_usd).toBeCloseTo(6, 6);
  });

  it('keeps every table entry positively priced', () => {
    for (const [model, rate] of Object.entries(PRICING)) {
      expect(rate.input, model).toBeGreaterThan(0);
      expect(rate.output, model).toBeGreaterThan(0);
    }
  });
});
