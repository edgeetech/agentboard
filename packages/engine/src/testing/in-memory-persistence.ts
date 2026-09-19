import { providerId } from "../configuration/agent-config.ts";
import type { ActorRole, AssigneeRole, RunRole, RunStatus, TaskStatus } from "../domain/types.ts";
import type {
  AgentRunRecord,
  CommentRecord,
  PersistencePorts,
  ProjectRecord,
  TaskRecord,
} from "../ports/persistence.ts";

export interface InMemoryPersistenceSeed {
  readonly project?: ProjectRecord;
  readonly tasks?: readonly TaskRecord[];
  readonly runs?: readonly AgentRunRecord[];
  readonly comments?: readonly CommentRecord[];
}

interface MutableProjectRecord extends ProjectRecord {}
interface MutableTaskRecord extends TaskRecord {}
interface MutableRunRecord extends AgentRunRecord {}
interface MutableCommentRecord extends CommentRecord {}

export function createInMemoryPersistence(seed: InMemoryPersistenceSeed = {}): PersistencePorts {
  let seq = 1;
  let project: MutableProjectRecord = seed.project ?? defaultProject(nowIso());
  const tasks = new Map<string, MutableTaskRecord>();
  const runs = new Map<string, MutableRunRecord>();
  const comments = new Map<string, MutableCommentRecord>();

  for (const task of seed.tasks ?? []) tasks.set(task.id, { ...task });
  for (const run of seed.runs ?? []) runs.set(run.id, { ...run });
  for (const comment of seed.comments ?? []) comments.set(comment.id, { ...comment });

  const nextId = (prefix: string): string => `${prefix}-${seq++}`;

  return {
    projects: {
      getCurrent() {
        return cloneProject(project);
      },
      updateCurrent(expectedVersion, patch) {
        if (project.version !== expectedVersion) return { ok: false, reason: "version mismatch" };
        const updatedAt = nowIso();
        project = {
          ...project,
          ...patch,
          version: project.version + 1,
          updatedAt,
        };
        return { ok: true, project: cloneProject(project) };
      },
    },
    tasks: {
      list(filters = {}) {
        const includeDone = filters.includeDone === true;
        const includeDeleted = filters.includeDeleted === true;
        return [...tasks.values()]
          .filter((task) => includeDone || task.status !== "done")
          .filter((task) => includeDeleted || task.deletedAt === null)
          .sort((a, b) => a.seq - b.seq)
          .map(cloneTask);
      },
      getById(id) {
        const task = tasks.get(id);
        return task === undefined ? undefined : cloneTask(task);
      },
      getByCode(code) {
        const task = [...tasks.values()].find((candidate) => candidate.code === code);
        return task === undefined ? undefined : cloneTask(task);
      },
      create(input) {
        const id = nextId("task");
        const createdAt = nowIso();
        const nextSeq = tasks.size + 1;
        const task: MutableTaskRecord = {
          id,
          projectId: project.id,
          seq: nextSeq,
          code: `${project.code}-${nextSeq}`,
          title: input.title,
          description: input.description ?? null,
          acceptanceCriteriaJson: input.acceptanceCriteriaJson ?? "[]",
          status: "todo",
          assigneeRole: input.assigneeRole ?? null,
          reworkCount: 0,
          agentProviderOverride: input.agentProviderOverride ?? null,
          agentConfigJson: null,
          workspacePath: null,
          discoveryMode: "full",
          version: 0,
          deletedAt: null,
          createdAt,
          updatedAt: createdAt,
        };
        tasks.set(id, task);
        return cloneTask(task);
      },
      transition(input) {
        void input.byRole;
        const task = tasks.get(input.taskId);
        if (task === undefined) return { ok: false, reason: "task not found" };
        if (task.version !== input.expectedVersion) return { ok: false, reason: "version mismatch" };
        const updated: MutableTaskRecord = {
          ...task,
          status: input.toStatus,
          assigneeRole: input.toAssignee,
          version: task.version + 1,
          updatedAt: nowIso(),
        };
        tasks.set(task.id, updated);
        return { ok: true, task: cloneTask(updated) };
      },
    },
    runs: {
      enqueue(taskId, role) {
        const id = nextId("run");
        const queuedAt = nowIso();
        runs.set(id, {
          id,
          taskId,
          parentRunId: null,
          role,
          status: "queued",
          attempt: 1,
          token: null,
          sessionProvider: null,
          sessionId: null,
          error: null,
          summary: null,
          model: null,
          costUsd: 0,
          queuedAt,
          startedAt: null,
          endedAt: null,
          lastHeartbeatAt: null,
        });
        return id;
      },
      getById(id) {
        const run = runs.get(id);
        return run === undefined ? undefined : cloneRun(run);
      },
      listForTask(taskId, limit = 5) {
        return [...runs.values()]
          .filter((run) => run.taskId === taskId)
          .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
          .slice(0, limit)
          .map(cloneRun);
      },
      listQueued() {
        return [...runs.values()]
          .filter((run) => run.status === "queued")
          .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
          .map(cloneRun);
      },
      runningCount() {
        return [...runs.values()].filter((run) => run.status === "running").length;
      },
      finish(runId, status, summary = null, error = null) {
        const run = runs.get(runId);
        if (run === undefined) return;
        runs.set(runId, {
          ...run,
          status,
          summary,
          error,
          endedAt: nowIso(),
        });
      },
      bumpHeartbeat(runId) {
        const run = runs.get(runId);
        if (run === undefined) return;
        runs.set(runId, { ...run, lastHeartbeatAt: nowIso() });
      },
    },
    comments: {
      add(taskId, authorRole, body) {
        const id = nextId("comment");
        const comment: MutableCommentRecord = {
          id,
          taskId,
          authorRole,
          body,
          createdAt: nowIso(),
        };
        comments.set(id, comment);
        return cloneComment(comment);
      },
      listForTask(taskId) {
        return [...comments.values()]
          .filter((comment) => comment.taskId === taskId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(cloneComment);
      },
    },
  };
}

function defaultProject(createdAt: string): MutableProjectRecord {
  return {
    id: "project-1",
    code: "AB",
    name: "AgentBoard",
    description: null,
    workflowType: "WF1",
    repoPath: "/workspace",
    maxParallel: 1,
    agentProvider: providerId("claude"),
    agentConfigJson: null,
    scanIgnoreJson: "[]",
    concernsJson: "[]",
    allowGit: false,
    version: 0,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function cloneProject(project: ProjectRecord): ProjectRecord {
  return { ...project };
}

function cloneTask(task: TaskRecord): TaskRecord {
  return { ...task };
}

function cloneRun(run: AgentRunRecord): AgentRunRecord {
  return { ...run };
}

function cloneComment(comment: CommentRecord): CommentRecord {
  return { ...comment };
}

function nowIso(): string {
  return new Date().toISOString();
}
