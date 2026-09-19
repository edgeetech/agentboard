import type { ProviderId, RoleConfig } from "../configuration/agent-config.ts";
import type {
  AgentRunRecord,
  MaybePromise,
  ProjectRecord,
  TaskRecord,
} from "./persistence.ts";
import type { EngineCostResult, TokenUsage } from "../costs/types.ts";
import type { PricingCatalogPort } from "./pricing.ts";
import type { RetryDecision } from "../runs/retry-policy.ts";

export interface RunExecutionContext {
  readonly run: AgentRunRecord;
  readonly task: TaskRecord;
  readonly project: ProjectRecord;
  readonly roleConfig: RoleConfig;
}

export interface RunPrompt {
  readonly prompt: string;
  readonly systemPrompt: string;
}

export interface RunClaim {
  readonly runToken: string;
}

export interface RunWorkspace {
  readonly cwd: string;
}

export interface RunSessionRef {
  readonly provider: ProviderId;
  readonly sessionId: string;
}

export type RunInvocationErrorKind = "timeout" | "provider" | "unknown";

export type RunInvocationResult =
  | {
      readonly status: "completed";
      readonly summary?: string | null;
      readonly model?: string | null;
      readonly usage?: TokenUsage;
      readonly totalCostUsd?: number | null;
      readonly sessionRef?: RunSessionRef | null;
    }
  | {
      readonly status: "failed";
      readonly error: string;
      readonly errorKind?: RunInvocationErrorKind;
      readonly model?: string | null;
      readonly usage?: TokenUsage;
      readonly totalCostUsd?: number | null;
      readonly sessionRef?: RunSessionRef | null;
    }
  | {
      readonly status: "cancelled";
      readonly error?: string | null;
      readonly model?: string | null;
      readonly usage?: TokenUsage;
      readonly totalCostUsd?: number | null;
      readonly sessionRef?: RunSessionRef | null;
    };

export interface RunInvocationInput {
  readonly context: RunExecutionContext;
  readonly runToken: string;
  readonly signal?: AbortSignal;
  readonly prompt: RunPrompt;
  readonly workspace: RunWorkspace;
  readonly provider: ProviderId;
  readonly roleConfig: RoleConfig;
}

export interface RunCostRecord {
  readonly model: string | null;
  readonly usage: TokenUsage;
  readonly cost: EngineCostResult;
  readonly costUsd: number;
}

export interface RunFailure {
  readonly runId: string;
  readonly taskId: string;
  readonly role: RunExecutionContext["run"]["role"];
  readonly attempt: number;
  readonly error: string;
  readonly reason:
    | RunInvocationErrorKind
    | "postflight"
    | "exception"
    | "cancelled";
}

export interface RunRetryRequest extends RunFailure {
  readonly decision: Extract<RetryDecision, { readonly shouldRetry: true }>;
}

export interface RunHeartbeatHandle {
  stop(): MaybePromise<void>;
}

export interface RunExecutionEvent {
  readonly type: "run.started" | "run.completed" | "run.failed";
  readonly runId: string;
  readonly role: RunExecutionContext["run"]["role"];
  readonly provider: ProviderId;
  readonly error?: string;
  readonly retryScheduled?: boolean;
  readonly reason?: RunFailure["reason"];
}

export interface RunExecutionOptions {
  readonly signal?: AbortSignal;
}

export interface RunExecutionPorts {
  readonly runs: {
    loadContext(runId: string): MaybePromise<RunExecutionContext | undefined>;
    claim(runId: string): MaybePromise<RunClaim | undefined>;
    isClaimActive(runId: string, runToken: string): MaybePromise<boolean>;
    recordSession(runId: string, session: RunSessionRef): MaybePromise<void>;
    recordCost(runId: string, cost: RunCostRecord): MaybePromise<void>;
    finish(input: {
      readonly runId: string;
      readonly runToken: string;
      readonly status: "succeeded" | "failed";
      readonly summary?: string | null;
      readonly error?: string | null;
    }): MaybePromise<boolean>;
  };
  readonly prompts: {
    build(
      context: RunExecutionContext,
      runToken: string,
    ): MaybePromise<RunPrompt>;
  };
  readonly workspace: {
    prepare(context: RunExecutionContext): MaybePromise<RunWorkspace>;
    cleanup(context: RunExecutionContext): MaybePromise<void>;
  };
  readonly runtime: {
    invoke(input: RunInvocationInput): MaybePromise<RunInvocationResult>;
  };
  readonly heartbeat: {
    start(runId: string): MaybePromise<RunHeartbeatHandle>;
  };
  readonly postflight: {
    /** Reload current run/task state using both identifiers before checking. */
    check(runId: string, runToken: string): MaybePromise<string | null>;
  };
  readonly retry: {
    decide(input: { readonly attempt: number }): RetryDecision;
    schedule(input: RunRetryRequest): MaybePromise<void>;
  };
  readonly pricing: PricingCatalogPort;
  readonly events: {
    emit(event: RunExecutionEvent): void;
  };
}
