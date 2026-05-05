// Copilot SDK agent runner — uses @github/copilot-sdk CopilotClient + createSession.
// Mirrors AgentRunner interface for executor compatibility.

import type {
  CopilotSession,
  SessionEvent,
  SessionConfig,
  MCPServerConfig,
} from '@github/copilot-sdk';

import type { RunResult, TokenUsage, SessionLog } from './agent-runner.ts';
import type { RateLimitTracker } from './rate-limit-tracker.ts';
import { TurnTimeout } from './turn-timeout.ts';

const DEFAULT_TURN_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_TURN_TIMEOUT_MS ?? '900000', 10); // 15 min

/** Raw MCP server entry as stored in AgentBoard config (Claude SDK style). */
interface McpServerEntry {
  type?: string;
  url?: string;
  command?: string;
  args?: unknown[];
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
  tools?: string[];
}

export interface ExtendedSessionLog extends SessionLog {
  warn?: (obj: Record<string, unknown>, msg: string) => void;
}

export interface CopilotRunnerOptions {
  runId: string;
  role: string;
  prompt: string;
  systemPrompt: string;
  cwd: string;
  maxTurns: number;
  allowedTools: string;
  mcpServers: Record<string, unknown>;
  abortController: AbortController;
  turnTimeoutMs?: number;
  rateLimiter?: RateLimitTracker;
  sessionLog?: ExtendedSessionLog | null;
  onEvent?: (eventName: string, detail: Record<string, unknown>) => void;
}

interface PartialState {
  model: string | null;
  totalCostUsd: number | null;
  usage: TokenUsage;
}

export class CopilotRunner {
  private readonly opts: CopilotRunnerOptions;
  private sessionId: string | null = null;
  private partial: PartialState = {
    model: null,
    totalCostUsd: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
  };

  constructor(opts: CopilotRunnerOptions) {
    this.opts = opts;
  }

  async run(): Promise<RunResult> {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } = this.opts;

    if (abortController.signal.aborted) {
      return { status: 'cancelled', error: 'Aborted before start' };
    }

    if (this.opts.rateLimiter?.isLimited('copilot-api') === true) {
      const info = this.opts.rateLimiter.getInfo('copilot-api');
      const waitMs = info.retryAfterMs ?? 5000;
      this.opts.sessionLog?.info({ waitMs }, 'Rate limited — waiting');
      await delay(waitMs, abortController.signal);
    }

    try {
      const result = await TurnTimeout.withTimeout(
        () => this.executeSession(),
        turnTimeoutMs,
        abortController.signal,
      );
      this.opts.rateLimiter?.recordSuccess('copilot-api');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error({ error: error.message }, 'CopilotRunner failed');
      // Check if aborted mid-stream (fired after the entry guard at the top).
      const isAborted = checkAborted(abortController.signal);
      const isTimeout =
        error.name === 'TimeoutError' || /timed out after \d+ms/i.test(error.message);
      return {
        status: isAborted && !isTimeout ? 'cancelled' : 'failed',
        error: error.message,
        errorKind: isTimeout ? 'timeout' : 'error',
        sessionId: this.sessionId,
        model: this.partial.model,
        totalCostUsd: this.partial.totalCostUsd,
        usage: this.partial.usage,
      };
    }
  }

  private async executeSession(): Promise<RunResult> {
    const { CopilotClient, approveAll } = await import('@github/copilot-sdk');

    const {
      prompt,
      systemPrompt,
      cwd,
      mcpServers,
      abortController,
      runId,
      onEvent,
      sessionLog,
      turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
    } = this.opts;

    const usage = this.partial.usage;
    const result: RunResult = {
      status: 'failed',
      sessionId: null,
      model: null,
      totalCostUsd: null,
    };

    const copilotMcpServers = normalizeMcpServers(mcpServers);

    const client = new CopilotClient();
    let session: CopilotSession | undefined;

    const onAbort = (): void => {
      // Best-effort cancel; do not await inside listener.
      session?.abort().catch(() => {
        /* ignore */
      });
    };
    abortController.signal.addEventListener('abort', onAbort);

    try {
      const sessionConfig: SessionConfig = {
        workingDirectory: cwd,
        onPermissionRequest: approveAll,
        onEvent: (event: SessionEvent): void => {
          onEvent?.(event.type, event as unknown as Record<string, unknown>);
          sessionLog?.info({ type: event.type, runId }, 'Copilot event');

          // Initial model hint. Skip "auto" — placeholder for auto-routing,
          // assistant.usage will report the actual model used.
          if (event.type === 'session.model_change') {
            const m = event.data.newModel;
            if (m !== 'auto' && result.model === null) {
              result.model = m;
              this.partial.model = m;
            }
          }

          // Authoritative per-API-call usage. Fires after each model call,
          // delivered while the run is live (unlike session.shutdown which
          // races with disconnect). Always overwrite model — this is the
          // resolved model id even when session was started with "auto".
          if (event.type === 'assistant.usage') {
            const d = event.data;
            result.model = d.model;
            this.partial.model = d.model;
            usage.input_tokens += d.inputTokens ?? 0;
            usage.output_tokens += d.outputTokens ?? 0;
            usage.cache_creation_tokens += d.cacheWriteTokens ?? 0;
            usage.cache_read_tokens += d.cacheReadTokens ?? 0;
          }

          if (event.type === 'session.error') {
            sessionLog?.error(
              { msg: event.data.message, errorType: event.data.errorType },
              'Copilot session.error',
            );
          }
        },
      };

      if (systemPrompt) {
        sessionConfig.systemMessage = { mode: 'replace', content: systemPrompt };
      }
      if (copilotMcpServers !== undefined && Object.keys(copilotMcpServers).length > 0) {
        sessionConfig.mcpServers = copilotMcpServers;
      }

      session = await client.createSession(sessionConfig);
      this.sessionId = session.sessionId;
      result.sessionId = session.sessionId;

      await session.sendAndWait({ prompt }, turnTimeoutMs);
      result.status = 'completed';
    } finally {
      abortController.signal.removeEventListener('abort', onAbort);
      try {
        await session?.disconnect();
      } catch (e) {
        sessionLog?.warn?.(
          { error: e instanceof Error ? e.message : String(e) },
          'session.disconnect failed',
        );
      }
      try {
        await client.stop();
      } catch (e) {
        sessionLog?.warn?.(
          { error: e instanceof Error ? e.message : String(e) },
          'client.stop failed',
        );
      }
    }

    result.usage = usage;
    return result;
  }
}

/**
 * Translate AgentBoard's MCP server map (Claude SDK style) into Copilot SDK
 * MCPServerConfig shapes. Required field for Copilot: `tools: string[]` —
 * `["*"]` means allow all. Stdio configs need `type:'stdio'`.
 */
function normalizeMcpServers(
  mcpServers: Record<string, unknown>,
): Record<string, MCPServerConfig> | undefined {
  const out: Record<string, MCPServerConfig> = {};
  for (const [name, rawCfg] of Object.entries(mcpServers)) {
    if (rawCfg === null || rawCfg === undefined || typeof rawCfg !== 'object') continue;
    const cfg = rawCfg as McpServerEntry;
    const tools = Array.isArray(cfg.tools) && cfg.tools.length > 0 ? cfg.tools.map(String) : ['*'];
    if (cfg.type === 'http' || cfg.type === 'sse') {
      const url = cfg.url ?? '';
      out[name] = {
        type: 'http',
        url,
        ...(cfg.headers !== undefined ? { headers: cfg.headers } : {}),
        tools,
      };
    } else if (cfg.command) {
      out[name] = {
        type: 'stdio',
        command: cfg.command,
        args: (cfg.args ?? []).map(String),
        ...(cfg.env !== undefined ? { env: cfg.env } : {}),
        ...(cfg.cwd !== undefined ? { cwd: cfg.cwd } : {}),
        tools,
      };
    }
    // Skip SDK-callable in-process MCPs — Copilot SDK requires command/url.
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Reads AbortSignal.aborted via an opaque function so TypeScript CFA does not narrow the result. */
function checkAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        },
        { once: true },
      );
    }
  });
}
