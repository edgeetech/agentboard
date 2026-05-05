// Ported from hatice src/agent-runner.ts — Claude Agent SDK query() wrapper.
// agentboard-specific: integrates with run/task model, not hatice issue model.

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { RateLimitTracker } from './rate-limit-tracker.ts';
import { TurnTimeout } from './turn-timeout.ts';

const DEFAULT_TURN_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_TURN_TIMEOUT_MS ?? '900000', 10); // 15 min

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface SessionLog {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface AgentRunnerOptions {
  runId: string;
  role: string;
  /** Full rendered user prompt. */
  prompt: string;
  /** Role system prompt body. */
  systemPrompt: string;
  /** repo_path (or workspace path). */
  cwd: string;
  maxTurns: number;
  /** Comma-separated tool list. */
  allowedTools: string;
  /** SDK-style MCP servers object. */
  mcpServers: Record<string, unknown>;
  abortController: AbortController;
  turnTimeoutMs?: number;
  rateLimiter?: RateLimitTracker;
  sessionLog?: SessionLog | null;
  onEvent?: (eventName: string, detail: Record<string, unknown>) => void;
  /** SDK hooks config (e.g. PreToolUse for noskills phase enforcement). */
  hooks?: Record<string, unknown>;
}

export interface RunResult {
  status: 'completed' | 'failed' | 'cancelled';
  sessionId?: string | null;
  usage?: TokenUsage;
  model?: string | null;
  totalCostUsd?: number | null;
  error?: string;
  /** Present when status='failed'; 'timeout' marks TurnTimeout aborts so executor can skip auto-retry. */
  errorKind?: 'timeout' | 'error';
}

/** Internal mutable accumulator for streaming state. */
interface PartialState {
  model: string | null;
  totalCostUsd: number | null;
  usage: TokenUsage;
}

/** BetaUsage shape from the Anthropic SDK — field names vary across SDK versions. */
interface BetaUsageCompat {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_input_tokens?: number;
  cache_read_tokens?: number;
}

/** Legacy SDK error envelope (not in the typed SDKMessage union). */
interface SdkLegacyError {
  type: string;
  status?: number;
  retry_after_ms?: number;
}

/** SDKAssistantMessage content block shapes. */
interface ContentText {
  type: 'text';
  text: string;
}
interface ContentToolUse {
  type: 'tool_use';
  name: string;
  input: unknown;
}
interface ContentToolResult {
  type: 'tool_result';
  content?: unknown;
  is_error?: boolean;
}

export class AgentRunner {
  private readonly opts: AgentRunnerOptions;
  private sessionId: string | null = null;
  /** Partial state captured during streaming, surfaced on timeout/abort so cost/usage are not lost. */
  private partial: PartialState = {
    model: null,
    totalCostUsd: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
  };

  constructor(opts: AgentRunnerOptions) {
    this.opts = opts;
  }

  async run(): Promise<RunResult> {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } = this.opts;

    if (abortController.signal.aborted) {
      return { status: 'cancelled', error: 'Aborted before start' };
    }

    // Rate-limit pre-check
    if (this.opts.rateLimiter?.isLimited('claude-api') === true) {
      const info = this.opts.rateLimiter.getInfo('claude-api');
      const waitMs = info.retryAfterMs ?? 5000;
      this.opts.sessionLog?.info({ waitMs }, 'Rate limited — waiting');
      await delay(waitMs, abortController.signal);
    }

    try {
      const result = await TurnTimeout.withTimeout(
        () => this.executeTurn(),
        turnTimeoutMs,
        abortController.signal,
      );
      this.opts.rateLimiter?.recordSuccess('claude-api');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error({ error: error.message }, 'AgentRunner failed');
      // Check if aborted mid-stream (fired after the entry guard at the top).
      // Use a wrapper to defeat false-positive CFA narrowing from the early return.
      const isAborted = checkAborted(abortController.signal);
      const isTimeout =
        error.name === 'TimeoutError' || /Turn timed out after \d+ms/.test(error.message);
      // Surface whatever usage/model/cost we accumulated before the abort so
      // the executor can still record token spend on timed-out / cancelled runs.
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

  private async executeTurn(): Promise<RunResult> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const {
      prompt,
      systemPrompt,
      cwd,
      maxTurns,
      allowedTools,
      mcpServers,
      abortController,
      runId,
      onEvent,
      sessionLog,
    } = this.opts;

    // Strip CLAUDECODE env var — allows spawning Claude from inside a Claude session
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const queryOptions: Record<string, unknown> = {
      cwd,
      maxTurns,
      abortController,
      permissionMode: 'acceptEdits',
      env: cleanEnv,
      pathToClaudeCodeExecutable: 'claude',
      ...(systemPrompt && { systemPrompt }),
      ...(allowedTools && { allowedTools: allowedTools.split(',').map((t) => t.trim()) }),
      ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
      ...(this.opts.hooks !== undefined &&
        Object.keys(this.opts.hooks).length > 0 && { hooks: this.opts.hooks }),
      ...(this.sessionId !== null && { resume: this.sessionId }),
    };

    // exactOptionalPropertyTypes: usage not set until end of stream.
    const result: RunResult = {
      status: 'failed',
      sessionId: null,
      model: null,
      totalCostUsd: null,
    };

    // Use the instance partial as the live accumulator so a timeout/abort
    // mid-stream still has model/usage/totalCostUsd available in the run() catch.
    const usage = this.partial.usage;

    let q: AsyncIterable<SDKMessage>;
    try {
      q = query({ prompt, options: queryOptions });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Failed to start Claude agent query: ${error.message}`);
    }

    try {
      for await (const msg of q) {
        onEvent?.(msg.type, msg);

        // Capture assistant text + tool_use names for postmortem diagnostics.
        let snippet: string | null = null;
        if (msg.type === 'assistant') {
          // TS narrows msg to SDKAssistantMessage here — use it directly.
          const content = msg.message.content;
          if (content.length > 0) {
            const parts: string[] = [];
            for (const c of content) {
              if (c.type === 'text') {
                const ct = c as ContentText;
                parts.push(`text=${ct.text.slice(0, 400)}`);
              } else if (c.type === 'tool_use') {
                const cu = c as ContentToolUse;
                parts.push(`tool=${cu.name} input=${JSON.stringify(cu.input).slice(0, 200)}`);
              }
            }
            if (parts.length > 0) snippet = parts.join(' | ');
          }
        } else if (msg.type === 'user') {
          // TS narrows msg to SDKUserMessage | SDKUserMessageReplay here.
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === 'tool_result') {
                const tr = c as ContentToolResult;
                const text = Array.isArray(tr.content)
                  ? (tr.content as { text?: string }[]).map((p) => p.text ?? '').join('')
                  : String(tr.content ?? '');
                snippet = `tool_result is_error=${String(!!tr.is_error)} text=${text.slice(0, 300)}`;
                break;
              }
            }
          }
        }
        sessionLog?.info(
          { type: msg.type, runId, ...(snippet !== null ? { snippet } : {}) },
          'Agent event',
        );

        // Capture session ID from init.
        // SDKSystemMessage has subtype:'init' | 'compact_boundary' | 'status' | 'api_retry' | ...
        if (msg.type === 'system') {
          // Only 'init' carries session_id/model at top level.
          if (msg.subtype === 'init') {
            this.sessionId = msg.session_id;
            result.sessionId = msg.session_id;
            result.model = msg.model;
            this.partial.model = msg.model;
          }
        }

        // Accumulate usage from assistant message events.
        // Note: the SDK emits type='assistant' (not 'message' — that was the raw Claude CLI
        // stream-json format). The inner message object is the Anthropic API BetaMessage.
        if (msg.type === 'assistant') {
          const u = msg.message.usage as BetaUsageCompat | undefined;
          if (u !== undefined) {
            usage.input_tokens += u.input_tokens ?? 0;
            usage.output_tokens += u.output_tokens ?? 0;
            usage.cache_creation_tokens +=
              u.cache_creation_input_tokens ?? u.cache_creation_tokens ?? 0;
            usage.cache_read_tokens += u.cache_read_input_tokens ?? u.cache_read_tokens ?? 0;
          }
          // Capture model from assistant events (BetaMessage carries model field)
          const betaModel = (msg.message as unknown as { model?: string }).model;
          if (betaModel !== undefined && result.model === null) {
            result.model = betaModel;
            this.partial.model = betaModel;
          }
        }

        // Rate-limit detection — legacy 'error' envelope with status=429.
        // The typed SDKMessage union does not include this shape; narrow via cast.
        const raw = msg as unknown as SdkLegacyError;
        if (raw.type === 'error' && raw.status === 429) {
          const retryAfterMs = raw.retry_after_ms ?? 60_000;
          this.opts.rateLimiter?.recordLimit('claude-api', retryAfterMs);
          sessionLog?.info({ retryAfterMs }, 'Rate limit detected');
          onEvent?.('run.rate-limited', { runId, retryAfterMs });
        }

        // Final result event
        if (msg.type === 'result') {
          const resultMsg = msg;
          result.status = 'completed';
          // Only trust SDK's total_cost_usd when it's actually non-zero (it initialises to 0).
          if (resultMsg.total_cost_usd > 0) {
            result.totalCostUsd = resultMsg.total_cost_usd;
          }
          const ru = resultMsg.usage as BetaUsageCompat | undefined;
          if (ru !== undefined) {
            usage.input_tokens += ru.input_tokens ?? 0;
            usage.output_tokens += ru.output_tokens ?? 0;
            usage.cache_creation_tokens +=
              ru.cache_creation_input_tokens ?? ru.cache_creation_tokens ?? 0;
            usage.cache_read_tokens += ru.cache_read_input_tokens ?? ru.cache_read_tokens ?? 0;
          }
          // Fallback: SDK result.modelUsage has camelCase per-model totals.
          // Use it when usage tokens are still 0 (e.g. subscription billing mode).
          if (usage.input_tokens === 0) {
            let fallbackCost = 0;
            for (const [key, mu] of Object.entries(resultMsg.modelUsage)) {
              usage.input_tokens += mu.inputTokens;
              usage.output_tokens += mu.outputTokens;
              usage.cache_creation_tokens += mu.cacheCreationInputTokens;
              usage.cache_read_tokens += mu.cacheReadInputTokens;
              fallbackCost += mu.costUSD;
              // Capture model name from the modelUsage key if not already set
              if (result.model === null) result.model = key;
            }
            if (fallbackCost > 0 && result.totalCostUsd === null)
              result.totalCostUsd = fallbackCost;
          }
          sessionLog?.info(
            {
              stopReason: resultMsg.stop_reason,
              numTurns: resultMsg.num_turns,
              costUsd: result.totalCostUsd,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
            },
            'Agent result',
          );
        }
      }
    } catch (streamErr) {
      const err = streamErr instanceof Error ? streamErr : new Error(String(streamErr));
      console.error('[agent-runner] stream error caught:', err.message);
      throw new Error(`Agent stream error: ${err.message}`);
    }

    result.usage = usage;
    return result;
  }
}

/** Reads AbortSignal.aborted via an opaque function so TypeScript CFA does not narrow the result. */
function checkAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      },
      { once: true },
    );
  });
}
