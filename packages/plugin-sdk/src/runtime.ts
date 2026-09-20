import type {
  ProviderRuntimeResponse,
  ProviderRuntimeUsage,
} from "./provider.ts";

export interface ProviderTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface ProviderSessionLog {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  warn?: (obj: Record<string, unknown>, msg: string) => void;
}

export interface ProviderRateLimitInfo {
  isLimited: boolean;
  retryAfterMs: number | null;
  lastLimitedAt: Date | null;
  limitCount: number;
  source: string;
}

export interface ProviderRateLimiter {
  recordLimit(source: string, retryAfterMs?: number): void;
  recordSuccess(source: string): void;
  isLimited(source: string): boolean;
  getInfo(source: string): ProviderRateLimitInfo;
}

export interface ProviderRunResult {
  status: "completed" | "failed" | "cancelled";
  sessionId?: string | null;
  usage?: ProviderTokenUsage;
  model?: string | null;
  totalCostUsd?: number | null;
  error?: string;
  errorKind?: "timeout" | "error";
}

export class ProviderTimeoutError extends Error {
  constructor(ms: number) {
    super(`Turn timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export async function withProviderTurnTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const abortFromParent = (): void => {
    controller.abort(parentSignal?.reason);
    clearTimer();
  };

  if (parentSignal?.aborted === true) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  timer = setTimeout(() => {
    controller.abort(new ProviderTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_resolve, reject) => {
        const rejectWithReason = (): void => {
          const reason: unknown = controller.signal.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        };
        if (controller.signal.aborted) {
          rejectWithReason();
          return;
        }
        controller.signal.addEventListener("abort", rejectWithReason, {
          once: true,
        });
      }),
    ]);
  } finally {
    clearTimer();
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export function toProviderRuntimeUsage(
  usage: ProviderTokenUsage,
  costUsd?: number | null,
): ProviderRuntimeUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationTokens: usage.cache_creation_tokens,
    cacheReadTokens: usage.cache_read_tokens,
    ...(costUsd !== undefined && costUsd !== null ? { costUsd } : {}),
  };
}

export function toProviderRuntimeResponse(
  result: ProviderRunResult,
): ProviderRuntimeResponse {
  return {
    status: result.status,
    ...(typeof result.sessionId === "string"
      ? { sessionId: result.sessionId }
      : {}),
    ...(typeof result.model === "string" ? { model: result.model } : {}),
    ...(result.usage !== undefined
      ? { usage: toProviderRuntimeUsage(result.usage, result.totalCostUsd) }
      : {}),
    ...(result.error !== undefined
      ? {
          error: {
            kind:
              result.errorKind === "timeout"
                ? "timeout"
                : result.status === "cancelled"
                  ? "cancelled"
                  : "provider",
            message: result.error,
          },
        }
      : {}),
  };
}

// ── Provider-agnostic tool gate ───────────────────────────────────────────────
//
// Claude runs get a PreToolUse hook. Argv/SDK-spawned providers (Codex,
// Copilot) have no equivalent, so they call a `ProviderToolGate` with every
// tool attempt they observe on their event stream. A `block` decision aborts
// the run: the provider has no way to veto a single call mid-turn, so the only
// honest enforcement is to stop the agent.

export interface ProviderToolAttempt {
  /** Normalised tool name (`Bash`, `Edit`, `Write`, `Read`, …). */
  tool: string;
  /** Shell command or file path the tool was invoked with. */
  target: string;
}

export interface ProviderToolDecision {
  decision: "allow" | "block";
  reason: string | null;
}

export type ProviderToolGate = (
  attempt: ProviderToolAttempt,
) => Promise<ProviderToolDecision> | ProviderToolDecision;

/** Thrown by a runner when the tool gate denies an attempted tool call. */
export class ProviderToolDeniedError extends Error {
  readonly tool: string;
  readonly target: string;

  constructor(attempt: ProviderToolAttempt, reason: string | null) {
    super(
      `tool denied by agentboard policy: ${attempt.tool}${
        attempt.target ? ` (${attempt.target.slice(0, 200)})` : ""
      }${reason ? ` — ${reason}` : ""}`,
    );
    this.name = "ProviderToolDeniedError";
    this.tool = attempt.tool;
    this.target = attempt.target;
  }
}

/**
 * Run the gate fail-closed: any thrown error or malformed decision denies.
 * Providers without a configured gate are allowed through (the caller decides
 * whether a missing gate is acceptable).
 */
export async function evaluateProviderToolAttempt(
  gate: ProviderToolGate | undefined,
  attempt: ProviderToolAttempt,
): Promise<ProviderToolDecision> {
  if (gate === undefined) return { decision: "allow", reason: null };
  try {
    const result = await gate(attempt);
    if (result.decision === "block")
      return { decision: "block", reason: result.reason ?? "blocked by policy" };
    if (result.decision === "allow") return { decision: "allow", reason: null };
    return {
      decision: "block",
      reason: "tool gate returned an unrecognised decision — denying",
    };
  } catch (err) {
    return {
      decision: "block",
      reason: `tool gate evaluation failed — denying: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
