import type {
  ProviderRateLimiter,
  ProviderRunResult,
  ProviderSessionLog,
  ProviderToolAttempt,
  ProviderToolGate,
  ProviderTokenUsage,
} from "../../../../packages/plugin-sdk/src/runtime.ts";
import {
  evaluateProviderToolAttempt,
  ProviderToolDeniedError,
  withProviderTurnTimeout,
} from "../../../../packages/plugin-sdk/src/runtime.ts";

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
  excludedTools?: string[];
  onEvent?: (event: CopilotSessionEvent) => void;
  systemMessage?: { mode: "replace"; content: string };
  mcpServers?: Record<string, CopilotMcpServerConfig>;
}

/**
 * Subset of @github/copilot-sdk's CopilotClientOptions this runner cares
 * about. `env` scopes the spawned CLI server's environment (never inherits
 * process.env implicitly); `gitHubToken`/`useLoggedInUser` select between
 * explicit API-key auth and the logged-in subscription user.
 */
export interface CopilotClientOptions {
  env?: Record<string, string | undefined>;
  gitHubToken?: string;
  useLoggedInUser?: boolean;
}

export interface CopilotSdkModule {
  CopilotClient: new (options?: CopilotClientOptions) => CopilotClient;
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
  /**
   * Provider-agnostic policy gate. Copilot's permission request carries only a
   * coarse `kind`, so command-level policy is applied to the tool events on the
   * session stream; a `block` decision aborts the session and fails the run.
   */
  toolGate?: ProviderToolGate;
  /** Native Copilot tool exclusions applied at session creation. */
  excludedTools?: readonly string[];
  /**
   * Whitelisted child-process environment for the spawned CLI server (see
   * child-env.ts on the host side). Never fall back to implicit inheritance —
   * that would let a stray COPILOT_GITHUB_TOKEN/GH_TOKEN/GITHUB_TOKEN (e.g. a
   * tracker PAT without Copilot access) silently override the logged-in user.
   */
  env?: Record<string, string>;
  /** Per-provider auth mode resolved from project.auth_config_json (default 'auto'). */
  authMode?: 'subscription' | 'api_key' | 'auto';
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
    const clientOptions = buildCopilotClientOptions(this.opts.env, this.opts.authMode);
    const client = new CopilotClient(clientOptions);
    let session: CopilotSession | undefined;
    let rateLimitHit: CopilotRateLimitSignal | null = null;

    const onAbort = (): void => {
      session?.abort().catch(() => {
        /* ignore */
      });
    };
    abortController.signal.addEventListener("abort", onAbort);
    turnSignal.addEventListener("abort", onAbort);

    let denial: ProviderToolDeniedError | null = null;
    const gateChecks: Promise<void>[] = [];
    const enforceToolAttempt = (attempt: ProviderToolAttempt): void => {
      gateChecks.push(
        (async () => {
          if (denial !== null) return;
          const verdict = await evaluateProviderToolAttempt(
            this.opts.toolGate,
            attempt,
          );
          if (verdict.decision === "block" && denial === null) {
            denial = new ProviderToolDeniedError(attempt, verdict.reason);
            sessionLog?.error(
              {
                runId,
                tool: attempt.tool,
                target: attempt.target.slice(0, 200),
                reason: verdict.reason,
              },
              "Copilot tool denied by policy — aborting run",
            );
            onEvent?.("run.tool-denied", {
              tool: attempt.tool,
              target: attempt.target,
              reason: verdict.reason,
            });
            onAbort();
          }
        })(),
      );
    };

    // Copilot's permission request only carries a coarse `kind`, so it cannot
    // decide on the command text — but it IS a pre-execution veto point. Once
    // the stream gate has latched a denial, reject everything from here on.
    const permissionHandler = (
      request: unknown,
      invocation: unknown,
    ): unknown => {
      if (denial !== null)
        return { kind: "reject", feedback: (denial as Error).message };
      return (approveAll as (r: unknown, i: unknown) => unknown)(
        request,
        invocation,
      );
    };

    try {
      const sessionConfig: CopilotSessionConfig = {
        workingDirectory: cwd,
        onPermissionRequest: permissionHandler,
        onEvent: (event): void => {
          onEvent?.(event.type, event as unknown as Record<string, unknown>);
          sessionLog?.info({ type: event.type, runId }, "Copilot event");

          const attempt = extractCopilotToolAttempt(
            event as unknown as Record<string, unknown>,
          );
          if (attempt !== null) enforceToolAttempt(attempt);

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
            const signal = classifyCopilotRateLimit(event);
            if (signal !== null && rateLimitHit === null) {
              rateLimitHit = signal;
              this.opts.rateLimiter?.recordLimit(
                "copilot-api",
                signal.retryAfterMs ?? undefined,
              );
              onEvent?.("run.rate-limited", {
                runId,
                retryAfterMs: signal.retryAfterMs,
                resetsAt: signal.resetsAt,
              });
              onAbort();
            }
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
      if (
        this.opts.excludedTools !== undefined &&
        this.opts.excludedTools.length > 0
      ) {
        sessionConfig.excludedTools = [...this.opts.excludedTools];
      }

      session = await client.createSession(sessionConfig);
      this.sessionId = session.sessionId;
      result.sessionId = session.sessionId;

      try {
        await session.sendAndWait({ prompt }, turnTimeoutMs);
      } catch (err) {
        // A rate-limit abort rejects sendAndWait — report it as errorKind
        // 'rate_limit' below rather than an opaque abort failure.
        if (rateLimitHit === null) throw err;
      }
      await Promise.allSettled(gateChecks);
      if (denial !== null) throw denial;
      if (rateLimitHit !== null) {
        const signal: CopilotRateLimitSignal = rateLimitHit;
        result.status = "failed";
        result.errorKind = "rate_limit";
        result.resetsAt = signal.resetsAt;
        result.error = "copilot usage limit reached";
      } else {
        result.status = "completed";
      }
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

/**
 * Build the CopilotClient constructor options for the resolved auth mode.
 * - 'subscription': caller already stripped API-key env vars; force the
 *   logged-in user so a stray token in a shared shell can't override it.
 * - 'api_key': require an explicit token (fail fast — this mirrors the
 *   executor's own pre-dispatch check, but a runner-level guard keeps this
 *   function safe to call directly, e.g. from tests).
 * - 'auto' / unset: pass the whitelisted env through unchanged and let the
 *   CLI resolve auth however it normally would.
 */
export function buildCopilotClientOptions(
  env: Record<string, string> | undefined,
  authMode: CopilotRunnerOptions["authMode"],
): CopilotClientOptions {
  const options: CopilotClientOptions = {
    ...(env !== undefined ? { env } : {}),
  };
  if (authMode === "subscription") {
    options.useLoggedInUser = true;
    return options;
  }
  if (authMode === "api_key") {
    const token = env?.COPILOT_GITHUB_TOKEN ?? env?.GH_TOKEN ?? env?.GITHUB_TOKEN;
    if (token === undefined || token === "") {
      throw new Error(
        "copilot auth_mode=api_key requires COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN to be set",
      );
    }
    options.gitHubToken = token;
    options.useLoggedInUser = false;
  }
  return options;
}

export interface CopilotRateLimitSignal {
  resetsAt: string | null;
  retryAfterMs: number | null;
}

/**
 * Classify a Copilot `session.error` event as a usage-limit failure. Returns
 * null when the error isn't rate-limit shaped.
 */
export function classifyCopilotRateLimit(
  event: CopilotErrorEvent,
): CopilotRateLimitSignal | null {
  const { message, errorType } = event.data;
  const text = `${message ?? ""} ${errorType ?? ""}`;
  if (!/usage limit|rate limit|rate.?limited|429/i.test(text)) return null;
  const match = /try again(?: at| after)?\s+([^.,;]+)/i.exec(text);
  const parsed = match?.[1] !== undefined ? Date.parse(match[1].trim()) : NaN;
  const resetsAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  return { resetsAt, retryAfterMs: resetsAt === null ? 60_000 : null };
}

/**
 * Normalise a Copilot session event into a tool attempt, or null when the event
 * is not a tool call. Copilot emits `tool.*` / `assistant.tool_call` events
 * whose payload carries the tool name plus its arguments.
 */
export function extractCopilotToolAttempt(
  event: Record<string, unknown>,
): ProviderToolAttempt | null {
  const type = typeof event.type === "string" ? event.type : "";
  if (!/tool/i.test(type)) return null;
  const data =
    typeof event.data === "object" && event.data !== null
      ? (event.data as Record<string, unknown>)
      : event;
  const rawName =
    (typeof data.name === "string" ? data.name : undefined) ??
    (typeof data.toolName === "string" ? data.toolName : undefined) ??
    (typeof data.tool === "string" ? data.tool : undefined);
  if (rawName === undefined) return null;

  const argsRaw = data.arguments ?? data.args ?? data.input ?? data.parameters;
  let args: Record<string, unknown> = {};
  if (typeof argsRaw === "string") {
    try {
      args = JSON.parse(argsRaw) as Record<string, unknown>;
    } catch {
      args = { command: argsRaw };
    }
  } else if (typeof argsRaw === "object" && argsRaw !== null) {
    args = argsRaw as Record<string, unknown>;
  }

  const commandRaw = args.command ?? args.cmd ?? args.script;
  const command = Array.isArray(commandRaw)
    ? commandRaw.map(String).join(" ")
    : typeof commandRaw === "string"
      ? commandRaw
      : null;

  if (/^(shell|bash|run_in_terminal|terminal|exec)/i.test(rawName)) {
    return { tool: "Bash", target: command ?? "" };
  }
  const path =
    (typeof args.path === "string" ? args.path : undefined) ??
    (typeof args.file_path === "string" ? args.file_path : undefined) ??
    "";
  if (/^(write|create|edit|str_replace|apply_patch)/i.test(rawName)) {
    return { tool: "Edit", target: path };
  }
  if (command !== null) return { tool: "Bash", target: command };
  return { tool: rawName, target: path };
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
