/**
 * Structured Logging Interface for Orchestration
 *
 * Defines structured log events for orchestration layer observability.
 * All log methods are optional (no-op by default) to avoid coupling
 * the Engine to logging infrastructure.
 *
 * Implementations should emit these events to OpenTelemetry,
 * structured log collectors, or monitoring systems.
 */

export interface OrchestrationLogger {
  /**
   * Emitted when a run is claimed from the queue.
   * Used to track queue latency and claim rates.
   */
  runClaimed?(data: {
    runId: string;
    taskId: string;
    provider: string;
    role: string;
    projectId: string;
    queuedAtEpochMs: number;
    claimedAtEpochMs: number;
  }): void;

  /**
   * Emitted when execution starts.
   * Used to track execution latency and provider distribution.
   */
  executionStarted?(data: {
    runId: string;
    provider: string;
    role: string;
    promptSizeBytes: number;
    estimatedDuration: "short" | "medium" | "long";
  }): void;

  /**
   * Emitted when execution completes successfully.
   * Used to track success rates, latency, and costs.
   */
  executionCompleted?(data: {
    runId: string;
    provider: string;
    duration: number; // ms
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): void;

  /**
   * Emitted when execution fails.
   * Used to track error rates and error patterns.
   */
  executionFailed?(data: {
    runId: string;
    provider: string;
    duration: number; // ms
    error: string;
    errorKind?: "timeout" | "rate_limit" | "auth" | "provider" | "exception";
    retryScheduled: boolean;
  }): void;

  /**
   * Emitted when a retry is scheduled.
   * Used to track retry patterns and effectiveness.
   */
  retryScheduled?(data: {
    runId: string;
    taskId: string;
    attempt: number;
    nextAttemptAtEpochMs: number;
    backoffMs: number;
    reason: string;
  }): void;

  /**
   * Emitted when rate limiting is detected.
   * Used to track provider rate limit patterns.
   */
  rateLimited?(data: {
    provider: string;
    retryAfterMs: number;
    limitedUntilEpochMs: number;
    limitCount: number;
  }): void;
}

/**
 * No-op logger (default).
 * Used when no observability infrastructure is configured.
 */
export const noOpLogger: OrchestrationLogger = {};

/**
 * Create a logger that delegates to multiple backends.
 * Useful for emitting to multiple observability systems.
 */
export function createCompositeLogger(
  ...loggers: OrchestrationLogger[]
): OrchestrationLogger {
  return {
    runClaimed(data) {
      for (const logger of loggers) {
        logger.runClaimed?.(data);
      }
    },
    executionStarted(data) {
      for (const logger of loggers) {
        logger.executionStarted?.(data);
      }
    },
    executionCompleted(data) {
      for (const logger of loggers) {
        logger.executionCompleted?.(data);
      }
    },
    executionFailed(data) {
      for (const logger of loggers) {
        logger.executionFailed?.(data);
      }
    },
    retryScheduled(data) {
      for (const logger of loggers) {
        logger.retryScheduled?.(data);
      }
    },
    rateLimited(data) {
      for (const logger of loggers) {
        logger.rateLimited?.(data);
      }
    },
  };
}

/**
 * Example: Console logger for development.
 * DO NOT use in production; use structured logging backend instead.
 */
export function createConsoleLogger(): OrchestrationLogger {
  return {
    runClaimed(data) {
      console.log("[run.claimed]", {
        runId: data.runId,
        provider: data.provider,
        queuedDuration: data.claimedAtEpochMs - data.queuedAtEpochMs,
      });
    },
    executionStarted(data) {
      console.log("[execution.started]", {
        runId: data.runId,
        provider: data.provider,
        promptSize: data.promptSizeBytes,
      });
    },
    executionCompleted(data) {
      console.log("[execution.completed]", {
        runId: data.runId,
        provider: data.provider,
        duration: data.duration,
        tokens: { input: data.inputTokens, output: data.outputTokens },
        cost: data.costUsd,
      });
    },
    executionFailed(data) {
      console.log("[execution.failed]", {
        runId: data.runId,
        provider: data.provider,
        error: data.error,
        errorKind: data.errorKind,
        retry: data.retryScheduled,
      });
    },
    retryScheduled(data) {
      console.log("[retry.scheduled]", {
        runId: data.runId,
        attempt: data.attempt,
        backoff: data.backoffMs,
      });
    },
    rateLimited(data) {
      console.log("[rate.limited]", {
        provider: data.provider,
        retryAfter: data.retryAfterMs,
      });
    },
  };
}
