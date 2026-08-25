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

    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const queryOptions: Record<string, unknown> = {
      cwd,
      maxTurns,
      abortController: queryAbortController,
      permissionMode: "acceptEdits",
      env: cleanEnv,
      pathToClaudeCodeExecutable: "claude",
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

        const raw = msg as unknown as SdkLegacyError;
        if (raw.type === "error" && raw.status === 429) {
          const retryAfterMs = raw.retry_after_ms ?? 60_000;
          this.opts.rateLimiter?.recordLimit("claude-api", retryAfterMs);
          sessionLog?.info({ retryAfterMs }, "Rate limit detected");
          onEvent?.("run.rate-limited", { runId, retryAfterMs });
        }

        if (msg.type === "result") {
          result.status = "completed";
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
