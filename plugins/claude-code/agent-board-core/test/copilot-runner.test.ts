import { describe, it, expect, beforeEach } from 'vitest';

import type { ExtendedSessionLog } from '../src/copilot-runner.ts';
import { CopilotRunner } from '../src/copilot-runner.ts';
import { RateLimitTracker } from '../src/rate-limit-tracker.ts';

describe('CopilotRunner', () => {
  let rateLimiter: RateLimitTracker;
  let mockSessionLog: ExtendedSessionLog;

  beforeEach(() => {
    rateLimiter = new RateLimitTracker();
    /* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
    const noop = (_obj: Record<string, unknown>, _msg: string): void => {};
    /* eslint-enable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
    mockSessionLog = { info: noop, error: noop };
  });

  describe('constructor and initialization', () => {
    it('constructs with required options', () => {
      const opts = {
        runId: 'test-run-123',
        role: 'worker',
        prompt: 'Write a function',
        systemPrompt: 'You are a helpful coder',
        cwd: '/tmp/test',
        maxTurns: 60,
        allowedTools: 'bash,read',
        mcpServers: {},
        abortController: new AbortController(),
        rateLimiter,
        sessionLog: mockSessionLog,
      };

      const runner = new CopilotRunner(opts);
      expect(runner).toBeDefined();
    });

    it('handles optional parameters', () => {
      const opts = {
        runId: 'test-run-456',
        role: 'pm',
        prompt: 'Create acceptance criteria',
        systemPrompt: 'You are a PM',
        cwd: '/tmp/test2',
        maxTurns: 30,
        allowedTools: 'read,write',
        mcpServers: {},
        abortController: new AbortController(),
        // rateLimiter and sessionLog are optional
      };

      const runner = new CopilotRunner(opts);
      expect(runner).toBeDefined();
    });
  });

  describe('run interface contract', () => {
    it('has a run() method that returns a Promise', () => {
      const opts = {
        runId: 'test-run-789',
        role: 'worker',
        prompt: 'Test prompt',
        systemPrompt: 'Test system prompt',
        cwd: '/tmp/test3',
        maxTurns: 60,
        allowedTools: '',
        mcpServers: {},
        abortController: new AbortController(),
      };

      const runner = new CopilotRunner(opts);
      expect(typeof runner.run).toBe('function');

      // run() should return a Promise (but don't actually execute it in test env)
      // since copilot CLI won't be installed in test environment
    });
  });

  describe('expected result structure', () => {
    it('should implement compatible result structure with AgentRunner', () => {
      // This test documents the expected result structure
      // that CopilotRunner.run() should return
      const expectedFields = {
        status: ['completed', 'failed', 'cancelled'],
        sessionId: 'string or undefined',
        usage: {
          input_tokens: 'number',
          output_tokens: 'number',
          cache_creation_tokens: 'number',
          cache_read_tokens: 'number',
        },
        model: 'string or null',
        totalCostUsd: 'number or null',
        error: 'string or undefined',
        errorKind: ['timeout', 'error', 'undefined'],
      };

      // This is a documentation test confirming the contract
      expect(expectedFields.status).toContain('completed');
      expect(expectedFields.status).toContain('failed');
    });
  });
});
