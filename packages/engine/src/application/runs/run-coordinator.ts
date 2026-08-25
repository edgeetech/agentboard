import {
  effectiveProviderForRoleConfig,
  type ProviderId,
} from "../../configuration/agent-config.ts";
import { computeTokenCost } from "../../costs/compute-cost.ts";
import type { TokenUsage } from "../../costs/types.ts";
import type { RetryDecision } from "../../runs/retry-policy.ts";
import type {
  RunExecutionContext,
  RunExecutionEvent,
  RunExecutionPorts,
  RunFailure,
  RunHeartbeatHandle,
  RunInvocationErrorKind,
  RunInvocationResult,
  RunRetryRequest,
  RunExecutionOptions,
} from "../../ports/run-execution.ts";

export type RunCoordinatorStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "not_found"
  | "not_claimed"
  | "superseded";

export interface RunCoordinatorResult {
  readonly runId: string;
  readonly status: RunCoordinatorStatus;
  readonly retryScheduled: boolean;
  readonly error?: string;
}

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

export async function executeRun(
  runId: string,
  ports: RunExecutionPorts,
  options: RunExecutionOptions = {},
): Promise<RunCoordinatorResult> {
  const context = await ports.runs.loadContext(runId);
  if (context === undefined) {
    return { runId, status: "not_found", retryScheduled: false };
  }

  const claim = await ports.runs.claim(runId);
  if (claim === undefined) {
    return { runId, status: "not_claimed", retryScheduled: false };
  }

  const provider = effectiveProviderForRoleConfig(context.roleConfig);
  let heartbeat: RunHeartbeatHandle | undefined;
  let workspacePreparationAttempted = false;

  try {
    workspacePreparationAttempted = true;
    const workspace = await ports.workspace.prepare(context);
    const prompt = await ports.prompts.build(context, claim.runToken);

    heartbeat = await ports.heartbeat.start(runId);
    emitStarted(ports, context, provider);

    const invocation = {
      context,
      runToken: claim.runToken,
      prompt,
      workspace,
      provider,
      roleConfig: context.roleConfig,
    };
    const result =
      options.signal === undefined
        ? await ports.runtime.invoke(invocation)
        : await ports.runtime.invoke({ ...invocation, signal: options.signal });

    if (!(await ports.runs.isClaimActive(runId, claim.runToken))) {
      return { runId, status: "superseded", retryScheduled: false };
    }

    if (options.signal?.aborted === true) {
      return await failRun(ports, context, claim.runToken, {
        error: "cancelled: run aborted",
        reason: "cancelled",
        retry: false,
        status: "cancelled",
      });
    }

    await recordProviderMetadata(ports, runId, result).catch(() => undefined);

    if (result.status === "completed") {
      const postflightError = await ports.postflight.check(
        runId,
        claim.runToken,
      );
      if (postflightError !== null) {
        return await failRun(ports, context, claim.runToken, {
          error: `postflight: ${postflightError}`,
          reason: "postflight",
        });
      }

      const finished = await ports.runs.finish({
        runId,
        runToken: claim.runToken,
        status: "succeeded",
        summary: result.summary ?? null,
        error: null,
      });
      if (!finished) {
        return { runId, status: "superseded", retryScheduled: false };
      }
      ports.events.emit({
        type: "run.completed",
        runId,
        role: context.run.role,
        provider,
        retryScheduled: false,
      });
      return { runId, status: "completed", retryScheduled: false };
    }

    if (result.status === "cancelled") {
      return await failRun(ports, context, claim.runToken, {
        error: `cancelled: ${result.error ?? ""}`.trim(),
        reason: "cancelled",
        retry: false,
        status: "cancelled",
      });
    }

    const timedOut =
      result.errorKind === "timeout" || isTimeoutMessage(result.error);
    return await failRun(ports, context, claim.runToken, {
      error: result.error,
      reason: timedOut ? "timeout" : (result.errorKind ?? "provider"),
      retry: !timedOut,
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    const cancelled = isCancellationError(error, options.signal);
    const timedOut = !cancelled && isTimeoutError(error);
    return await failRun(ports, context, claim.runToken, {
      error: cancelled ? `cancelled: ${message || "run aborted"}` : message,
      reason: cancelled ? "cancelled" : timedOut ? "timeout" : "exception",
      retry: !cancelled && !timedOut,
      ...(cancelled ? { status: "cancelled" as const } : {}),
    });
  } finally {
    if (heartbeat !== undefined) {
      await Promise.resolve()
        .then(() => heartbeat?.stop())
        .catch(() => undefined);
    }
    if (workspacePreparationAttempted) {
      await Promise.resolve()
        .then(() => ports.workspace.cleanup(context))
        .catch(() => undefined);
    }
  }
}

async function recordProviderMetadata(
  ports: RunExecutionPorts,
  runId: string,
  result: RunInvocationResult,
): Promise<void> {
  if (result.sessionRef !== undefined && result.sessionRef !== null) {
    await Promise.resolve()
      .then(() => ports.runs.recordSession(runId, result.sessionRef!))
      .catch(() => undefined);
  }

  if (result.model === undefined && result.usage === undefined) return;

  const usage = result.usage ?? EMPTY_USAGE;
  const computed = computeTokenCost(
    ports.pricing.findRate(result.model),
    usage,
    ports.pricing.version,
  );
  const costUsd =
    result.totalCostUsd !== undefined &&
    result.totalCostUsd !== null &&
    result.totalCostUsd > 0
      ? result.totalCostUsd
      : computed.costUsd;

  await Promise.resolve()
    .then(() =>
      ports.runs.recordCost(runId, {
        model: result.model ?? null,
        usage,
        cost: computed,
        costUsd,
      }),
    )
    .catch(() => undefined);
}

interface FailureOptions {
  readonly error: string;
  readonly reason: RunFailure["reason"];
  readonly retry?: boolean;
  readonly status?: "failed" | "cancelled";
}

async function failRun(
  ports: RunExecutionPorts,
  context: RunExecutionContext,
  runToken: string,
  options: FailureOptions,
): Promise<RunCoordinatorResult> {
  const { run } = context;
  const shouldRetry = options.retry !== false && options.status !== "cancelled";
  let retryScheduled = false;

  const finished = await ports.runs.finish({
    runId: run.id,
    runToken,
    status: "failed",
    summary: null,
    error: options.error,
  });
  if (!finished) {
    return { runId: run.id, status: "superseded", retryScheduled: false };
  }

  if (shouldRetry) {
    const decision = ports.retry.decide({ attempt: run.attempt });
    if (decision.shouldRetry) {
      await ports.retry.schedule({
        runId: run.id,
        taskId: run.taskId,
        role: run.role,
        attempt: run.attempt,
        error: options.error,
        reason: options.reason,
        decision,
      });
      retryScheduled = true;
    }
  }

  const provider = effectiveProviderForRoleConfig(context.roleConfig);
  const event: RunExecutionEvent = {
    type: "run.failed",
    runId: run.id,
    role: run.role,
    provider,
    error: options.error,
    retryScheduled,
    reason: options.reason,
  };
  ports.events.emit(event);

  return {
    runId: run.id,
    status: options.status ?? "failed",
    retryScheduled,
    error: options.error,
  };
}

function emitStarted(
  ports: RunExecutionPorts,
  context: RunExecutionContext,
  provider: ProviderId,
): void {
  ports.events.emit({
    type: "run.started",
    runId: context.run.id,
    role: context.run.role,
    provider,
    retryScheduled: false,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutError(error: unknown): boolean {
  return (
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { readonly name?: unknown }).name === "TimeoutError") ||
    isTimeoutMessage(errorMessage(error))
  );
}

function isTimeoutMessage(message: string): boolean {
  return /Turn timed out after \d+ms/.test(message);
}

function isCancellationError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted === true) return true;
  if (typeof error !== "object" || error === null) return false;
  const value = error as { readonly name?: unknown; readonly code?: unknown };
  return value.name === "AbortError" || value.code === "ABORT_ERR";
}
