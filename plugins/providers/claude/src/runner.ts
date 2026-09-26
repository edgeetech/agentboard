import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type {
  ProviderRateLimiter,
  ProviderRunResult,
  ProviderSessionLog,
  ProviderTokenUsage,
} from "../../../../packages/plugin-sdk/src/runtime.ts";
import { withProviderTurnTimeout } from "../../../../packages/plugin-sdk/src/runtime.ts";

const DEFAULT_TURN_TIMEOUT_MS = parseInt(
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.AGENTBOARD_TURN_TIMEOUT_MS ?? "900000",
  10,
);

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
  rateLimiter?: ProviderRateLimiter;
  sessionLog?: ProviderSessionLog | null;
  onEvent?: (eventName: string, detail: Record<string, unknown>) => void;
  /** SDK hooks config (e.g. PreToolUse for noskills phase enforcement). */
  hooks?: Record<string, unknown>;
  /**
   * Whitelisted child-process environment to hand the SDK (see child-env.ts
   * on the host side). Never fall back to `{...process.env}` here — that would
   * leak ambient secrets and let a stray ANTHROPIC_API_KEY silently override a
   * Pro/Max OAuth login (billing to the API instead of the subscription).
   */
  env: Record<string, string>;
  /**
   * Path to the `claude` executable. Only set this when the SDK's own
   * resolution (bundled binary, or PATH lookup) needs to be overridden — e.g. a
   * non-standard install location. Leaving it unset lets the SDK find npm
   * `claude.cmd` shims on Windows and its own bundled binary correctly.
   */
  claudeExecutablePath?: string;
}

/** Internal mutable accumulator for streaming state. */
interface PartialState {
  model: string | null;
  totalCostUsd: number | null;
  usage: ProviderTokenUsage;
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
  type: "text";
  text: string;
}
interface ContentToolUse {
  type: "tool_use";
  name: string;
  input: unknown;
}
interface ContentToolResult {
  type: "tool_result";
  content?: unknown;
  is_error?: boolean;
}

export interface ClaudeRateLimitSignal {
  /** ISO timestamp the limit resets, when the SDK reports one. */
  resetsAt: string | null;
  /** Milliseconds to wait before retrying, when known. */
  retryAfterMs: number | null;
}

/**
 * Classify a claude-agent-sdk `rate_limit_event` / `system.api_retry` message.
 * Returns null when the message carries no actionable rate-limit signal.
 */
export function classifyClaudeRateLimitEvent(msg: unknown): ClaudeRateLimitSignal | null {
  if (msg === null || typeof msg !== "object") return null;
  const obj = msg as Record<string, unknown>;
  if (obj.type === "rate_limit_event") {
    const info = obj.rate_limit_info;
    if (info === null || typeof info !== "object") return null;
    const infoObj = info as Record<string, unknown>;
    if (infoObj.status !== "rejected") return null;
    const resetsAtMs = typeof infoObj.resetsAt === "number" ? infoObj.resetsAt : null;
    return {
      resetsAt: resetsAtMs !== null ? new Date(resetsAtMs).toISOString() : null,
      retryAfterMs: resetsAtMs !== null ? Math.max(0, resetsAtMs - Date.now()) : null,
    };
  }
  if (obj.type === "system" && obj.subtype === "api_retry") {
    const retryMs = typeof obj.retry_delay_ms === "number" ? obj.retry_delay_ms : null;
    const status = typeof obj.error_status === "number" ? obj.error_status : null;
    if (status !== 429 && retryMs === null) return null;
    return { resetsAt: null, retryAfterMs: retryMs ?? 60_000 };
  }
  return null;
}

/**
 * Classify a claude-agent-sdk `result` message with `is_error=true` as a
 * provider usage-limit failure ("You've hit your usage limit… try again…").
 * Returns null when the failure isn't rate-limit shaped.
 */
export function classifyClaudeResultError(msg: unknown): ClaudeRateLimitSignal | null {
  if (msg === null || typeof msg !== "object") return null;
  const obj = msg as Record<string, unknown>;
  if (obj.type !== "result" || obj.is_error !== true) return null;
  const text = [obj.result, ...(Array.isArray(obj.errors) ? obj.errors : [])]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  const status = typeof obj.api_error_status === "number" ? obj.api_error_status : null;
  if (!/usage limit|rate limit|try again/i.test(text) && status !== 429) return null;
  const match = /try again(?: at| after)?\s+([^.,;]+)/i.exec(text);
  const resetsAt = match?.[1] !== undefined ? tryParseFutureDate(match[1]) : null;
  return { resetsAt, retryAfterMs: resetsAt === null ? 60_000 : null };
}

function tryParseFutureDate(text: string): string | null {
  const parsed = Date.parse(text.trim());
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export class AgentRunner {
  private readonly opts: AgentRunnerOptions;
  private sessionId: string | null = null;
  /** Partial state captured during streaming, surfaced on timeout/abort so cost/usage are not lost. */
  private partial: PartialState = {
    model: null,
    totalCostUsd: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    },
  };

  constructor(opts: AgentRunnerOptions) {
    this.opts = opts;
  }

  async run(): Promise<ProviderRunResult> {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } =
      this.opts;
    const timeoutState = { timedOut: false };

    if (abortController.signal.aborted) {
      return { status: "cancelled", error: "Aborted before start" };
    }

    if (this.opts.rateLimiter?.isLimited("claude-api") === true) {
      const info = this.opts.rateLimiter.getInfo("claude-api");
      const waitMs = info.retryAfterMs ?? 5000;
      this.opts.sessionLog?.info({ waitMs }, "Rate limited — waiting");
      await delay(waitMs, abortController.signal);
    }

    try {
      const result = await withProviderTurnTimeout(
        async (turnSignal) => {
          const markTimeout = (): void => {
            const reason: unknown = turnSignal.reason;
            if (reason instanceof Error && reason.name === "TimeoutError") {
              timeoutState.timedOut = true;
            }
          };
          if (turnSignal.aborted) {
            markTimeout();
          } else {
            turnSignal.addEventListener("abort", markTimeout, { once: true });
          }
          try {
            return await this.executeTurn(turnSignal);
          } finally {
            turnSignal.removeEventListener("abort", markTimeout);
          }
        },
        turnTimeoutMs,
        abortController.signal,
      );
      this.opts.rateLimiter?.recordSuccess("claude-api");
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error(
        { error: error.message },
        "AgentRunner failed",
      );
      const isAborted = checkAborted(abortController.signal);
      const isTimeout =
        timeoutState.timedOut ||
        error.name === "TimeoutError" ||
        /Turn timed out after \d+ms/.test(error.message);
      return {
        status: isAborted && !isTimeout ? "cancelled" : "failed",
        error: error.message,
        errorKind: isTimeout ? "timeout" : "error",
        sessionId: this.sessionId,
        model: this.partial.model,
        totalCostUsd: this.partial.totalCostUsd,
        usage: this.partial.usage,
      };
    }
  }

  private async executeTurn(
    turnSignal: AbortSignal,
  ): Promise<ProviderRunResult> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const queryAbortController = new AbortController();
    const abortQuery = (): void =>
      queryAbortController.abort(turnSignal.reason);
    if (turnSignal.aborted) {
      abortQuery();
    } else {
      turnSignal.addEventListener("abort", abortQuery, { once: true });
    }

    const {
      prompt,
      systemPrompt,
      cwd,
      maxTurns,
      allowedTools,
      mcpServers,
      runId,
      onEvent,
      sessionLog,
    } = this.opts;

    const cleanEnv: Record<string, string> = { ...this.opts.env };
    delete cleanEnv.CLAUDECODE;
    const claudeExecutablePath =
      this.opts.claudeExecutablePath ??
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
        ?.AGENTBOARD_CLAUDE_PATH;

    const queryOptions: Record<string, unknown> = {
      cwd,
      maxTurns,
      abortController: queryAbortController,
      permissionMode: "acceptEdits",
      env: cleanEnv,
      // Left unset unless explicitly configured — hardcoding "claude" here broke
      // npm `claude.cmd` installs on Windows and skipped the SDK's own bundled
      // binary resolution.
      ...(claudeExecutablePath !== undefined && claudeExecutablePath !== ""
        ? { pathToClaudeCodeExecutable: claudeExecutablePath }
        : {}),
      ...(systemPrompt && { systemPrompt }),
      ...(allowedTools && {
        allowedTools: allowedTools.split(",").map((tool) => tool.trim()),
      }),
      ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
      ...(this.opts.hooks !== undefined &&
        Object.keys(this.opts.hooks).length > 0 && { hooks: this.opts.hooks }),
      ...(this.sessionId !== null && { resume: this.sessionId }),
    };

    const result: ProviderRunResult = {
      status: "failed",
      sessionId: null,
      model: null,
      totalCostUsd: null,
    };
    const usage = this.partial.usage;
    let pendingRateLimit: ClaudeRateLimitSignal | null = null;

    let q: AsyncIterable<SDKMessage>;
    try {
      q = query({ prompt, options: queryOptions });
    } catch (err) {
      turnSignal.removeEventListener("abort", abortQuery);
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Failed to start Claude agent query: ${error.message}`);
    }

    try {
      for await (const msg of q) {
        onEvent?.(msg.type, msg);

        let snippet: string | null = null;
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (content.length > 0) {
            const parts: string[] = [];
            for (const contentBlock of content) {
              if (contentBlock.type === "text") {
                const text = contentBlock as ContentText;
                parts.push(`text=${text.text.slice(0, 400)}`);
              } else if (contentBlock.type === "tool_use") {
                const toolUse = contentBlock as ContentToolUse;
                parts.push(
                  `tool=${toolUse.name} input=${JSON.stringify(toolUse.input).slice(0, 200)}`,
                );
              }
            }
            if (parts.length > 0) snippet = parts.join(" | ");
          }
        } else if (msg.type === "user") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const contentBlock of content) {
              if (contentBlock.type === "tool_result") {
                const toolResult = contentBlock as ContentToolResult;
                const text = Array.isArray(toolResult.content)
                  ? (toolResult.content as { text?: string }[])
                      .map((part) => part.text ?? "")
                      .join("")
                  : String(toolResult.content ?? "");
                snippet = `tool_result is_error=${String(!!toolResult.is_error)} text=${text.slice(0, 300)}`;
                break;
              }
            }
          }
        }
        sessionLog?.info(
          { type: msg.type, runId, ...(snippet !== null ? { snippet } : {}) },
          "Agent event",
        );

        if (msg.type === "system" && msg.subtype === "init") {
          this.sessionId = msg.session_id;
          result.sessionId = msg.session_id;
          result.model = msg.model;
          this.partial.model = msg.model;
          result.authSource = msg.apiKeySource ?? null;
        }

        if (msg.type === "assistant") {
          const messageUsage = msg.message.usage as BetaUsageCompat | undefined;
          if (messageUsage !== undefined) {
            usage.input_tokens += messageUsage.input_tokens ?? 0;
            usage.output_tokens += messageUsage.output_tokens ?? 0;
            usage.cache_creation_tokens +=
              messageUsage.cache_creation_input_tokens ??
              messageUsage.cache_creation_tokens ??
              0;
            usage.cache_read_tokens +=
              messageUsage.cache_read_input_tokens ??
              messageUsage.cache_read_tokens ??
              0;
          }
          const betaModel = (msg.message as unknown as { model?: string })
            .model;
          if (betaModel !== undefined && result.model === null) {
            result.model = betaModel;
            this.partial.model = betaModel;
          }
        }

        // Legacy pre-typed SDK error envelope (not covered by rate_limit_event
        // or system.api_retry below, but still seen from older SDK builds).
        const raw = msg as unknown as SdkLegacyError;
        if (raw.type === "error" && raw.status === 429) {
          const retryAfterMs = raw.retry_after_ms ?? 60_000;
          this.opts.rateLimiter?.recordLimit("claude-api", retryAfterMs);
          pendingRateLimit = { resetsAt: null, retryAfterMs };
          sessionLog?.info({ retryAfterMs }, "Rate limit detected");
          onEvent?.("run.rate-limited", { runId, retryAfterMs });
        }

        const rateLimitEvent = classifyClaudeRateLimitEvent(msg);
        if (rateLimitEvent !== null) {
          this.opts.rateLimiter?.recordLimit(
            "claude-api",
            rateLimitEvent.retryAfterMs ?? undefined,
          );
          pendingRateLimit = rateLimitEvent;
          sessionLog?.info({ rateLimitEvent }, "Rate limit signal detected");
          onEvent?.("run.rate-limited", {
            runId,
            retryAfterMs: rateLimitEvent.retryAfterMs,
            resetsAt: rateLimitEvent.resetsAt,
          });
        }

        if (msg.type === "result") {
          // Respect is_error instead of unconditionally reporting "completed" —
          // a usage-limit or provider error must not be credited as a clean run.
          if (msg.is_error) {
            const resultRateLimit = classifyClaudeResultError(msg) ?? pendingRateLimit;
            if (resultRateLimit !== null) {
              result.errorKind = "rate_limit";
              result.resetsAt = resultRateLimit.resetsAt;
              this.opts.rateLimiter?.recordLimit(
                "claude-api",
                resultRateLimit.retryAfterMs ?? undefined,
              );
            } else {
              result.errorKind = "error";
            }
            result.status = "failed";
            result.error =
              typeof (msg as { result?: unknown }).result === "string"
                ? (msg as { result: string }).result
                : "claude result reported is_error=true";
          } else {
            result.status = "completed";
          }
          if (msg.total_cost_usd > 0) {
            result.totalCostUsd = msg.total_cost_usd;
            this.partial.totalCostUsd = msg.total_cost_usd;
          }
          const resultUsage = msg.usage as BetaUsageCompat | undefined;
          if (resultUsage !== undefined) {
            usage.input_tokens += resultUsage.input_tokens ?? 0;
            usage.output_tokens += resultUsage.output_tokens ?? 0;
            usage.cache_creation_tokens +=
              resultUsage.cache_creation_input_tokens ??
              resultUsage.cache_creation_tokens ??
              0;
            usage.cache_read_tokens +=
              resultUsage.cache_read_input_tokens ??
              resultUsage.cache_read_tokens ??
              0;
          }
          if (usage.input_tokens === 0) {
            let fallbackCost = 0;
            for (const [key, modelUsage] of Object.entries(msg.modelUsage)) {
              usage.input_tokens += modelUsage.inputTokens;
              usage.output_tokens += modelUsage.outputTokens;
              usage.cache_creation_tokens +=
                modelUsage.cacheCreationInputTokens;
              usage.cache_read_tokens += modelUsage.cacheReadInputTokens;
              fallbackCost += modelUsage.costUSD;
              if (result.model === null) result.model = key;
            }
            if (fallbackCost > 0 && result.totalCostUsd === null) {
              result.totalCostUsd = fallbackCost;
              this.partial.totalCostUsd = fallbackCost;
            }
          }
          sessionLog?.info(
            {
              stopReason: msg.stop_reason,
              numTurns: msg.num_turns,
              costUsd: result.totalCostUsd,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
            },
            "Agent result",
          );
        }
      }
    } catch (streamErr) {
      turnSignal.removeEventListener("abort", abortQuery);
      const err =
        streamErr instanceof Error ? streamErr : new Error(String(streamErr));
      console.error("[agent-runner] stream error caught:", err.message);
      throw new Error(`Agent stream error: ${err.message}`);
    }

    turnSignal.removeEventListener("abort", abortQuery);
    result.usage = usage;
    return result;
  }
}

function checkAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      },
      { once: true },
    );
  });
}
