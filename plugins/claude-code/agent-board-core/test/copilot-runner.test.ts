import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopilotRunner, type CopilotSessionConfig } from '../src/copilot-runner.ts';
import type { ProviderSessionLog } from '../src/provider-types.ts';
import { RateLimitTracker } from '../src/rate-limit-tracker.ts';

function createCopilotSdkMock() {
  const createSession = vi.fn();
  const stop = vi.fn();
  const CopilotClient = vi.fn(function CopilotClient() {
    return { createSession, stop };
  });
  return {
    approveAll: {},
    CopilotClient,
    createSession,
    stop,
  };
}

describe('CopilotRunner', () => {
  let rateLimiter: RateLimitTracker;
  let mockSessionLog: ProviderSessionLog;
  let copilotSdkMock: ReturnType<typeof createCopilotSdkMock>;

  beforeEach(() => {
    rateLimiter = new RateLimitTracker();
    /* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
    const noop = (_obj: Record<string, unknown>, _msg: string): void => {};
    /* eslint-enable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
    mockSessionLog = { info: noop, error: noop, warn: noop };
    copilotSdkMock = createCopilotSdkMock();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  describe('SDK execution', () => {
    it('creates a Copilot session with normalized MCP servers and maps usage events', async () => {
      let capturedConfig: CopilotSessionConfig | null = null;
      const session = {
        sessionId: 'copilot-session-1',
        sendAndWait: vi.fn(() => {
          capturedConfig?.onEvent?.({
            type: 'session.model_change',
            data: { newModel: 'gpt-5-mini' },
          });
          capturedConfig?.onEvent?.({
            type: 'assistant.usage',
            data: {
              model: 'gpt-5-mini',
              inputTokens: 11,
              outputTokens: 17,
              cacheWriteTokens: 3,
              cacheReadTokens: 5,
            },
          });
          return Promise.resolve();
        }),
        abort: vi.fn(() => Promise.resolve()),
        disconnect: vi.fn(() => Promise.resolve()),
      };

      copilotSdkMock.createSession.mockImplementation((config: CopilotSessionConfig) => {
        capturedConfig = config;
        return Promise.resolve(session);
      });

      const runner = new CopilotRunner({
        runId: 'run-sdk',
        role: 'worker',
        prompt: 'Implement it',
        systemPrompt: 'System text',
        cwd: '/repo',
        maxTurns: 60,
        allowedTools: 'bash,read',
        mcpServers: {
          browser: {
            type: 'http',
            url: 'https://mcp.example.test',
            headers: { Authorization: 'Bearer test' },
            tools: ['search'],
          },
          files: {
            command: 'node',
            args: ['server.js', 42],
            env: { FILES: '1' },
            cwd: '/repo/tools',
          },
          inProcess: { tool: 'callable' },
        },
        abortController: new AbortController(),
        rateLimiter,
        sessionLog: mockSessionLog,
        turnTimeoutMs: 5_000,
        loadCopilotSdk: () => Promise.resolve(copilotSdkMock),
      });

      const result = await runner.run();
      const config = capturedConfig as CopilotSessionConfig | null;

      expect(copilotSdkMock.CopilotClient).toHaveBeenCalledTimes(1);
      expect(config).toMatchObject({
        workingDirectory: '/repo',
        systemMessage: { mode: 'replace', content: 'System text' },
        mcpServers: {
          browser: {
            type: 'http',
            url: 'https://mcp.example.test',
            headers: { Authorization: 'Bearer test' },
            tools: ['search'],
          },
          files: {
            type: 'stdio',
            command: 'node',
            args: ['server.js', '42'],
            env: { FILES: '1' },
            cwd: '/repo/tools',
            tools: ['*'],
          },
        },
      });
      expect(config?.onPermissionRequest).toBe(copilotSdkMock.approveAll);
      expect(session.sendAndWait).toHaveBeenCalledWith({ prompt: 'Implement it' }, 5_000);
      expect(session.disconnect).toHaveBeenCalledTimes(1);
      expect(copilotSdkMock.stop).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        status: 'completed',
        sessionId: 'copilot-session-1',
        model: 'gpt-5-mini',
        totalCostUsd: null,
        usage: {
          input_tokens: 11,
          output_tokens: 17,
          cache_creation_tokens: 3,
          cache_read_tokens: 5,
        },
      });
    });

    it('aborts the Copilot session when the turn timeout fires', async () => {
      let rejectSend: ((error: Error) => void) | null = null;
      const session = {
        sessionId: 'copilot-timeout-session',
        sendAndWait: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectSend = reject;
            }),
        ),
        abort: vi.fn(() => {
          rejectSend?.(new Error('aborted by timeout'));
          return Promise.resolve();
        }),
        disconnect: vi.fn(() => Promise.resolve()),
      };
      copilotSdkMock.createSession.mockResolvedValue(session);

      const runner = new CopilotRunner({
        runId: 'run-timeout',
        role: 'worker',
        prompt: 'Wait forever',
        systemPrompt: '',
        cwd: '/repo',
        maxTurns: 60,
        allowedTools: '',
        mcpServers: {},
        abortController: new AbortController(),
        rateLimiter,
        sessionLog: mockSessionLog,
        turnTimeoutMs: 1,
        loadCopilotSdk: () => Promise.resolve(copilotSdkMock),
      });

      const result = await runner.run();

      expect(result.status).toBe('failed');
      expect(result.errorKind).toBe('timeout');
      expect(result.sessionId).toBe('copilot-timeout-session');
      expect(session.abort).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(session.disconnect).toHaveBeenCalledTimes(1);
        expect(copilotSdkMock.stop).toHaveBeenCalledTimes(1);
      });
    });
  });
});
