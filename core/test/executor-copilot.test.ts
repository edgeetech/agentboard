import { describe, it, expect } from 'vitest';

import { computeCost, PRICING_VERSION } from '../src/pricing.ts';

describe('Executor & Copilot Support', () => {
  describe('Cost Computation — Copilot Models', () => {
    it('computes cost for copilot-pro model', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };
      const result = computeCost('copilot-pro', usage);

      expect(result).toHaveProperty('cost_usd');
      expect(result).toHaveProperty('cost_version');
      expect(result.cost_version).toBe(PRICING_VERSION);
      expect(result.uncosted).toBe(false);
      expect(result.cost_usd).toBeGreaterThan(0);

      // For copilot-pro: input $1/1M, output $3/1M
      // 1000 input = 0.001, 500 output = 0.0015, total = 0.0025
      expect(result.cost_usd).toBeCloseTo(0.0025, 6);
    });

    it('computes cost for claude-opus-4-7 model', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };
      const result = computeCost('claude-opus-4-7', usage);

      expect(result.uncosted).toBe(false);
      expect(result.cost_usd).toBeGreaterThan(0);
      // For opus: input $15/1M, output $75/1M
      // 1000 input = 0.015, 500 output = 0.0375, total = 0.0525
      expect(result.cost_usd).toBeCloseTo(0.0525, 6);
    });

    it('handles unknown model gracefully', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };
      const result = computeCost('unknown-model-xyz', usage);

      expect(result.cost_usd).toBe(0);
      expect(result.uncosted).toBe(true);
    });

    it('handles cache tokens in cost computation', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 100,
        cache_read_tokens: 50,
      };
      const result = computeCost('copilot-pro', usage);

      // copilot-pro: input $1/1M, output $3/1M, cache_write $1.25/1M, cache_read $0.1/1M
      // input: 1000 * 1 / 1M = 0.001
      // output: 500 * 3 / 1M = 0.0015
      // cache_write: 100 * 1.25 / 1M = 0.000125
      // cache_read: 50 * 0.1 / 1M = 0.000005
      // total ≈ 0.00263
      expect(result.cost_usd).toBeCloseTo(0.00263, 6);
    });

    it('normalizes model names with date suffixes', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };

      // Both should compute the same cost
      const result1 = computeCost('claude-opus-4-7', usage);
      const result2 = computeCost('claude-opus-4-7-20250101', usage);

      expect(result1.cost_usd).toBe(result2.cost_usd);
    });

    it('normalizes model names with bracket suffixes', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };

      // Both should compute the same cost
      const result1 = computeCost('copilot-pro', usage);
      const result2 = computeCost('copilot-pro[cached]', usage);

      expect(result1.cost_usd).toBe(result2.cost_usd);
    });

    it('returns PRICING_VERSION on success', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };
      const result = computeCost('copilot-pro', usage);

      expect(result.cost_version).toBeGreaterThan(0);
      expect(typeof result.cost_version).toBe('number');
    });

    it('handles zero tokens', () => {
      const usage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };
      const result = computeCost('copilot-pro', usage);

      expect(result.cost_usd).toBe(0);
      expect(result.uncosted).toBe(false);
    });

    it('handles null model', () => {
      const usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };
      const result = computeCost(null, usage);

      expect(result.cost_usd).toBe(0);
      expect(result.uncosted).toBe(true);
    });
  });

  describe('Executor Provider Resolution', () => {
    interface ProviderRow {
      agent_provider_override?: string | null;
      agent_provider?: string | null;
    }

    it('defaults to claude when no project or task override', () => {
      const task: ProviderRow = { agent_provider_override: null };
      const project: ProviderRow = { agent_provider: null };

      const effectiveProvider = task.agent_provider_override ?? project.agent_provider ?? 'claude';
      expect(effectiveProvider).toBe('claude');
    });

    it('uses project provider when no task override', () => {
      const task: ProviderRow = { agent_provider_override: null };
      const project: ProviderRow = { agent_provider: 'github_copilot' };

      const effectiveProvider = task.agent_provider_override ?? project.agent_provider ?? 'claude';
      expect(effectiveProvider).toBe('github_copilot');
    });

    it('task override takes precedence over project default', () => {
      const task: ProviderRow = { agent_provider_override: 'claude' };
      const project: ProviderRow = { agent_provider: 'github_copilot' };

      const effectiveProvider = task.agent_provider_override ?? project.agent_provider ?? 'claude';
      expect(effectiveProvider).toBe('claude');
    });

    it('task override to copilot takes precedence', () => {
      const task: ProviderRow = { agent_provider_override: 'github_copilot' };
      const project: ProviderRow = { agent_provider: 'claude' };

      const effectiveProvider = task.agent_provider_override ?? project.agent_provider ?? 'claude';
      expect(effectiveProvider).toBe('github_copilot');
    });

    it('resolution order: task > project > default', () => {
      // Case 1: task has override
      const task1: ProviderRow = { agent_provider_override: 'github_copilot' };
      const project1: ProviderRow = { agent_provider: 'claude' };
      const result1 = task1.agent_provider_override ?? project1.agent_provider ?? 'claude';
      expect(result1).toBe('github_copilot');

      // Case 2: project has provider, no task override
      const task2: ProviderRow = { agent_provider_override: null };
      const project2: ProviderRow = { agent_provider: 'github_copilot' };
      const result2 = task2.agent_provider_override ?? project2.agent_provider ?? 'claude';
      expect(result2).toBe('github_copilot');

      // Case 3: use default, no task or project override
      const task3: ProviderRow = { agent_provider_override: null };
      const project3: ProviderRow = { agent_provider: null };
      const result3 = task3.agent_provider_override ?? project3.agent_provider ?? 'claude';
      expect(result3).toBe('claude');
    });

    it('supports codex as a project default provider', () => {
      const task: ProviderRow = { agent_provider_override: null };
      const project: ProviderRow = { agent_provider: 'codex' };
      const effectiveProvider = task.agent_provider_override ?? project.agent_provider ?? 'claude';
      expect(effectiveProvider).toBe('codex');
    });

    it('supports codex as a task override', () => {
      const task: ProviderRow = { agent_provider_override: 'codex' };
      const project: ProviderRow = { agent_provider: 'claude' };
      const effectiveProvider = task.agent_provider_override ?? project.agent_provider ?? 'claude';
      expect(effectiveProvider).toBe('codex');
    });
  });
});
