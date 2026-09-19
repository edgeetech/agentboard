import type {
  ActorRole,
  AssigneeRole,
  DiscoveryMode,
  RunRole,
  RunStatus,
  TaskStatus,
  WorkflowType,
} from "../domain/types.ts";
import type { ProviderId } from "../configuration/agent-config.ts";

export type MaybePromise<T> = T | Promise<T>;
export type JsonText = string;

export interface ProjectRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly workflowType: WorkflowType;
  readonly repoPath: string;
  readonly maxParallel: number;
  readonly agentProvider: ProviderId;
  readonly agentConfigJson: JsonText | null;
  readonly scanIgnoreJson: JsonText;
  readonly concernsJson: JsonText;
  readonly allowGit: boolean;
  readonly version: number;
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskRecord {
  readonly id: string;
  readonly projectId: string;
  readonly seq: number;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly acceptanceCriteriaJson: JsonText;
  readonly status: TaskStatus;
  readonly assigneeRole: AssigneeRole | null;
  readonly reworkCount: number;
  readonly agentProviderOverride: ProviderId | null;
  readonly agentConfigJson: JsonText | null;
  readonly workspacePath: string | null;
  readonly discoveryMode: DiscoveryMode;
  readonly version: number;
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentRunRecord {
  readonly id: string;
  readonly taskId: string;
  readonly parentRunId: string | null;
  readonly role: RunRole;
  readonly status: RunStatus;
  readonly attempt: number;
  readonly token: string | null;
  readonly sessionProvider: ProviderId | null;
  readonly sessionId: string | null;
  readonly error: string | null;
  readonly summary: string | null;
  readonly model: string | null;
  readonly costUsd: number;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly lastHeartbeatAt: string | null;
}

export interface CommentRecord {
  readonly id: string;
  readonly taskId: string;
  readonly authorRole: ActorRole;
  readonly body: string;
  readonly createdAt: string;
}

export interface ProjectRepositoryPort {
  getCurrent(): MaybePromise<ProjectRecord | undefined>;
  updateCurrent(
    expectedVersion: number,
    patch: Partial<
      Pick<
        ProjectRecord,
        | "name"
        | "description"
        | "repoPath"
        | "maxParallel"
        | "agentProvider"
        | "agentConfigJson"
        | "scanIgnoreJson"
        | "deletedAt"
      >
    >,
  ): MaybePromise<{ readonly ok: true; readonly project: ProjectRecord } | { readonly ok: false; readonly reason: string }>;
}

export interface TaskRepositoryPort {
  list(filters?: {
    readonly includeDone?: boolean;
    readonly includeDeleted?: boolean;
  }): MaybePromise<readonly TaskRecord[]>;
  getById(id: string): MaybePromise<TaskRecord | undefined>;
  getByCode(code: string): MaybePromise<TaskRecord | undefined>;
  create(input: {
    readonly title: string;
    readonly description?: string | null;
    readonly assigneeRole?: AssigneeRole | null;
    readonly acceptanceCriteriaJson?: JsonText;
    readonly agentProviderOverride?: ProviderId | null;
  }): MaybePromise<TaskRecord>;
  transition(input: {
    readonly taskId: string;
    readonly expectedVersion: number;
    readonly toStatus: TaskStatus;
    readonly toAssignee: AssigneeRole | null;
    readonly byRole: ActorRole;
  }): MaybePromise<{ readonly ok: true; readonly task: TaskRecord } | { readonly ok: false; readonly reason: string }>;
}

export interface RunRepositoryPort {
  enqueue(taskId: string, role: RunRole): MaybePromise<string>;
  getById(id: string): MaybePromise<AgentRunRecord | undefined>;
  listForTask(taskId: string, limit?: number): MaybePromise<readonly AgentRunRecord[]>;
  listQueued(): MaybePromise<readonly AgentRunRecord[]>;
  runningCount(): MaybePromise<number>;
  finish(
    runId: string,
    status: Extract<RunStatus, "succeeded" | "failed" | "blocked" | "cancelled">,
    summary?: string | null,
    error?: string | null,
  ): MaybePromise<void>;
  bumpHeartbeat(runId: string): MaybePromise<void>;
}

export interface CommentRepositoryPort {
  add(taskId: string, authorRole: ActorRole, body: string): MaybePromise<CommentRecord>;
  listForTask(taskId: string): MaybePromise<readonly CommentRecord[]>;
}

export interface PersistencePorts {
  readonly projects: ProjectRepositoryPort;
  readonly tasks: TaskRepositoryPort;
  readonly runs: RunRepositoryPort;
  readonly comments: CommentRepositoryPort;
}
