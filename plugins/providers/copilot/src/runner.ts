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

interface CopilotModelChangeEvent {
  type: "session.model_change";
  data: { newModel: string };
}

interface CopilotUsageEvent {
  type: "assistant.usage";
  data: {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  };
}

interface CopilotErrorEvent {
  type: "session.error";
  data: { message: string; errorType?: string };
}

export type CopilotSessionEvent =
  | CopilotModelChangeEvent
  | CopilotUsageEvent
  | CopilotErrorEvent
  | { type: string; data?: Record<string, unknown> };

interface CopilotSession {
  sessionId: string;
  sendAndWait(args: { prompt: string }, timeoutMs: number): Promise<void>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

interface CopilotClient {
  createSession(config: CopilotSessionConfig): Promise<CopilotSession>;
  stop(): Promise<void>;
}

export type CopilotMcpServerConfig =
  | {
      type: "http";
      url: string;
      headers?: Record<string, string>;
      tools: string[];
    }
  | {
      type: "stdio";
      command: string;
      args: string[];
      env?: Record<string, string>;
      cwd?: string;
      tools: string[];
    };

export interface CopilotSessionConfig {
  workingDirectory: string;
  onPermissionRequest: unknown;
  onEvent?: (event: CopilotSessionEvent) => void;
  systemMessage?: { mode: "replace"; content: string };
  mcpServers?: Record<string, CopilotMcpServerConfig>;
}

export interface CopilotSdkModule {
  CopilotClient: new () => CopilotClient;
  approveAll: unknown;
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
  rateLimiter?: ProviderRateLimiter;
  sessionLog?: ProviderSessionLog | null;
  onEvent?: (eventName: string, detail: Record<string, unknown>) => void;
  loadCopilotSdk?: () => Promise<CopilotSdkModule>;
}

interface PartialState {
  model: string | null;
  totalCostUsd: number | null;
  usage: ProviderTokenUsage;
}

const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

async function loadDefaultCopilotSdk(): Promise<CopilotSdkModule> {
  return (await dynamicImport("@github/copilot-sdk")) as CopilotSdkModule;
}

export class CopilotRunner {
  private readonly opts: CopilotRunnerOptions;
  private sessionId: string | null = null;
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

  constructor(opts: CopilotRunnerOptions) {
    this.opts = opts;
  }

  async run(): Promise<ProviderRunResult> {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } =
      this.opts;
    const timeoutState = { timedOut: false };

    if (abortController.signal.aborted) {
      return { status: "cancelled", error: "Aborted before start" };
    }

    if (this.opts.rateLimiter?.isLimited("copilot-api") === true) {
      const info = this.opts.rateLimiter.getInfo("copilot-api");
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
            return await this.executeSession(turnSignal);
          } finally {
            turnSignal.removeEventListener("abort", markTimeout);
          }
        },
        turnTimeoutMs,
        abortController.signal,
      );
      this.opts.rateLimiter?.recordSuccess("copilot-api");
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error(
        { error: error.message },
        "CopilotRunner failed",
      );
      const isAborted = checkAborted(abortController.signal);
      const isTimeout =
        timeoutState.timedOut ||
        error.name === "TimeoutError" ||
        /timed out after \d+ms/i.test(error.message);
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

  private async executeSession(
    turnSignal: AbortSignal,
  ): Promise<ProviderRunResult> {
    const { CopilotClient, approveAll } = await (
      this.opts.loadCopilotSdk ?? loadDefaultCopilotSdk
    )();

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
    const result: ProviderRunResult = {
      status: "failed",
      sessionId: null,
      model: null,
      totalCostUsd: null,
    };

    const copilotMcpServers = normalizeMcpServers(mcpServers);
    const client = new CopilotClient();
    let session: CopilotSession | undefined;

    const onAbort = (): void => {
      session?.abort().catch(() => {
        /* ignore */
      });
    };
    abortController.signal.addEventListener("abort", onAbort);
    turnSignal.addEventListener("abort", onAbort);

    try {
      const sessionConfig: CopilotSessionConfig = {
        workingDirectory: cwd,
        onPermissionRequest: approveAll,
        onEvent: (event): void => {
          onEvent?.(event.type, event as unknown as Record<string, unknown>);
          sessionLog?.info({ type: event.type, runId }, "Copilot event");

          if (isModelChangeEvent(event)) {
            const m = event.data.newModel;
            if (m !== "auto" && result.model === null) {
              result.model = m;
              this.partial.model = m;
            }
          }

          if (isUsageEvent(event)) {
            const d = event.data;
            result.model = d.model;
            this.partial.model = d.model;
            usage.input_tokens += d.inputTokens ?? 0;
            usage.output_tokens += d.outputTokens ?? 0;
            usage.cache_creation_tokens += d.cacheWriteTokens ?? 0;
            usage.cache_read_tokens += d.cacheReadTokens ?? 0;
          }

          if (isErrorEvent(event)) {
            sessionLog?.error(
              { msg: event.data.message, errorType: event.data.errorType },
              "Copilot session.error",
            );
          }
        },
      };

      if (systemPrompt) {
        sessionConfig.systemMessage = {
          mode: "replace",
          content: systemPrompt,
        };
      }
      if (
        copilotMcpServers !== undefined &&
        Object.keys(copilotMcpServers).length > 0
      ) {
        sessionConfig.mcpServers = copilotMcpServers;
      }

      session = await client.createSession(sessionConfig);
      this.sessionId = session.sessionId;
      result.sessionId = session.sessionId;

      await session.sendAndWait({ prompt }, turnTimeoutMs);
      result.status = "completed";
    } finally {
      abortController.signal.removeEventListener("abort", onAbort);
      turnSignal.removeEventListener("abort", onAbort);
      try {
        await session?.disconnect();
      } catch (e) {
        sessionLog?.warn?.(
          { error: e instanceof Error ? e.message : String(e) },
          "session.disconnect failed",
        );
      }
      try {
        await client.stop();
      } catch (e) {
        sessionLog?.warn?.(
          { error: e instanceof Error ? e.message : String(e) },
          "client.stop failed",
        );
      }
    }

    result.usage = usage;
    return result;
  }
}

function normalizeMcpServers(
  mcpServers: Record<string, unknown>,
): Record<string, CopilotMcpServerConfig> | undefined {
  const out: Record<string, CopilotMcpServerConfig> = {};
  for (const [name, rawCfg] of Object.entries(mcpServers)) {
    if (rawCfg === null || rawCfg === undefined || typeof rawCfg !== "object")
      continue;
    const cfg = rawCfg as McpServerEntry;
    const tools =
      Array.isArray(cfg.tools) && cfg.tools.length > 0
        ? cfg.tools.map(String)
        : ["*"];
    if (cfg.type === "http" || cfg.type === "sse") {
      const url = cfg.url ?? "";
      out[name] = {
        type: "http",
        url,
        ...(cfg.headers !== undefined ? { headers: cfg.headers } : {}),
        tools,
      };
    } else if (cfg.command) {
      out[name] = {
        type: "stdio",
        command: cfg.command,
        args: (cfg.args ?? []).map(String),
        ...(cfg.env !== undefined ? { env: cfg.env } : {}),
        ...(cfg.cwd !== undefined ? { cwd: cfg.cwd } : {}),
        tools,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isModelChangeEvent(
  event: CopilotSessionEvent,
): event is CopilotModelChangeEvent {
  return event.type === "session.model_change";
}

function isUsageEvent(event: CopilotSessionEvent): event is CopilotUsageEvent {
  return event.type === "assistant.usage";
}

function isErrorEvent(event: CopilotSessionEvent): event is CopilotErrorEvent {
  return event.type === "session.error";
}

function checkAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        },
        { once: true },
      );
    }
  });
}
