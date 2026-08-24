import type {
  ActorRole,
  AgentRunRecord,
  AssigneeRole,
  CommentRecord,
  DiscoveryMode,
  JsonText,
  PersistencePorts,
  ProjectRecord,
  ProviderId,
  RunRole,
  RunStatus,
  TaskRecord,
  TaskStatus,
  WorkflowType,
} from "../../../../engine/src/index.ts";

import type { SqliteConnectionPort } from "./connection.ts";

export interface SqlitePersistenceOptions {
  readonly now?: () => string;
  readonly id?: (prefix: string) => string;
}

type Row = Record<string, unknown>;

interface RandomSource {
  readonly randomUUID?: () => string;
  readonly getRandomValues?: (values: Uint32Array) => Uint32Array;
}

const PROJECT_PATCH_COLUMNS = {
  name: "name",
  description: "description",
  repoPath: "repo_path",
  maxParallel: "max_parallel",
  agentProvider: "agent_provider",
  agentConfigJson: "agent_config_json",
  scanIgnoreJson: "scan_ignore_json",
  deletedAt: "deleted_at",
} as const satisfies Record<
  keyof Parameters<PersistencePorts["projects"]["updateCurrent"]>[1],
  string
>;

export function createSqlitePersistence(
  db: SqliteConnectionPort,
  options: SqlitePersistenceOptions = {},
): PersistencePorts {
  const now = options.now ?? nowIso;
  const nextId = options.id ?? createSequenceId();

  return {
    projects: {
      getCurrent() {
        const row = db
          .prepare("SELECT * FROM project WHERE deleted_at IS NULL LIMIT 1")
          .get();
        return row === undefined || row === null ? undefined : toProject(row);
      },
      updateCurrent(expectedVersion, patch) {
        const current = db
          .prepare("SELECT id FROM project WHERE deleted_at IS NULL LIMIT 1")
          .get();
        if (current === undefined || current === null)
          return { ok: false, reason: "project not found" };

        const sets: string[] = [];
        const args: unknown[] = [];
        for (const [field, column] of Object.entries(PROJECT_PATCH_COLUMNS)) {
          if (field in patch) {
            sets.push(`${column}=?`);
            args.push(patch[field as keyof typeof patch]);
          }
        }
        if (sets.length === 0) return { ok: false, reason: "no fields" };

        sets.push("version=version+1", "updated_at=?");
        args.push(now(), idOf(current), expectedVersion);

        const result = db
          .prepare(
            `UPDATE project SET ${sets.join(", ")} WHERE id=? AND version=?`,
          )
          .run(...args);
        if (changes(result) === 0)
          return { ok: false, reason: "version mismatch" };

        const updated = db
          .prepare("SELECT * FROM project WHERE id=?")
          .get(idOf(current));
        if (updated === undefined || updated === null)
          return { ok: false, reason: "project not found" };
        return { ok: true, project: toProject(updated) };
      },
    },
    tasks: {
      list(filters = {}) {
        const clauses: string[] = [];
        if (filters.includeDeleted !== true) clauses.push("deleted_at IS NULL");
        if (filters.includeDone !== true) clauses.push("status != 'done'");
        const where =
          clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
        return db
          .prepare(`SELECT * FROM task ${where} ORDER BY seq ASC`)
          .all()
          .map(toTask);
      },
      getById(id) {
        const row = db.prepare("SELECT * FROM task WHERE id=?").get(id);
        return row === undefined || row === null ? undefined : toTask(row);
      },
      getByCode(code) {
        const row = db.prepare("SELECT * FROM task WHERE code=?").get(code);
        return row === undefined || row === null ? undefined : toTask(row);
      },
      create(input) {
        return db.transaction(() => {
          const project = db
            .prepare("SELECT * FROM project WHERE deleted_at IS NULL LIMIT 1")
            .get();
          if (project === undefined || project === null)
            throw new Error("no active project");

          const projectRecord = toProject(project);
          const seqRow = db
            .prepare(
              "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM task WHERE project_id=?",
            )
            .get(projectRecord.id);
          const seq = numberValue(seqRow, "next");
          const id = nextId("task");
          const timestamp = now();

          db.prepare(
            `
            INSERT INTO task(
              id, project_id, seq, code, title, description,
              acceptance_criteria_json, status, assignee_role, agent_provider_override,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?)
          `,
          ).run(
            id,
            projectRecord.id,
            seq,
            `${projectRecord.code}-${seq}`,
            input.title,
            input.description ?? null,
            input.acceptanceCriteriaJson ?? "[]",
            input.assigneeRole ?? null,
            input.agentProviderOverride ?? null,
            timestamp,
            timestamp,
          );

          const task = db.prepare("SELECT * FROM task WHERE id=?").get(id);
          if (task === undefined || task === null)
            throw new Error("created task was not persisted");
          return toTask(task);
        })();
      },
      transition(input) {
        return db.transaction(() => {
          const current = db
            .prepare("SELECT * FROM task WHERE id=?")
            .get(input.taskId);
          if (current === undefined || current === null)
            return { ok: false, reason: "task not found" } as const;
          const currentTask = toTask(current);
          const timestamp = now();

          const result = db
            .prepare(
              "UPDATE task SET status=?, assignee_role=?, version=version+1, updated_at=? WHERE id=? AND version=?",
            )
            .run(
              input.toStatus,
              input.toAssignee,
              timestamp,
              input.taskId,
              input.expectedVersion,
            );
          if (changes(result) === 0)
            return { ok: false, reason: "version mismatch" } as const;

          db.prepare(
            `
            INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          ).run(
            nextId("task-history"),
            input.taskId,
            currentTask.status,
            input.toStatus,
            input.byRole,
            timestamp,
          );

          const task = db
            .prepare("SELECT * FROM task WHERE id=?")
            .get(input.taskId);
          if (task === undefined || task === null)
            return { ok: false, reason: "task not found" } as const;
          return { ok: true, task: toTask(task) } as const;
        })();
      },
    },
    runs: {
      enqueue(taskId, role) {
        const id = nextId("run");
        db.prepare(
          `
          INSERT INTO agent_run(id, task_id, role, status, queued_at)
          VALUES (?, ?, ?, 'queued', ?)
        `,
        ).run(id, taskId, role, now());
        return id;
      },
      getById(id) {
        const row = db.prepare("SELECT * FROM agent_run WHERE id=?").get(id);
        return row === undefined || row === null ? undefined : toRun(row);
      },
      listForTask(taskId, limit = 5) {
        return db
          .prepare(
            "SELECT * FROM agent_run WHERE task_id=? ORDER BY queued_at DESC, rowid DESC LIMIT ?",
          )
          .all(taskId, limit)
          .map(toRun);
      },
      listQueued() {
        return db
          .prepare(
            "SELECT * FROM agent_run WHERE status='queued' ORDER BY queued_at ASC, rowid ASC",
          )
          .all()
          .map(toRun);
      },
      runningCount() {
        const row = db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM agent_run WHERE status='running' AND parent_run_id IS NULL",
          )
          .get();
        return numberValue(row, "cnt");
      },
      finish(runId, status, summary = null, error = null) {
        db.prepare(
          "UPDATE agent_run SET status=?, summary=?, error=?, ended_at=? WHERE id=?",
        ).run(status, summary, error, now(), runId);
      },
      bumpHeartbeat(runId) {
        db.prepare("UPDATE agent_run SET last_heartbeat_at=? WHERE id=?").run(
          now(),
          runId,
        );
      },
    },
    comments: {
      add(taskId, authorRole, body) {
        const id = nextId("comment");
        db.prepare(
          `
          INSERT INTO comment(id, task_id, author_role, body, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
        ).run(id, taskId, authorRole, body, now());
        const comment = db.prepare("SELECT * FROM comment WHERE id=?").get(id);
        if (comment === undefined || comment === null)
          throw new Error("created comment was not persisted");
        return toComment(comment);
      },
      listForTask(taskId) {
        return db
          .prepare(
            "SELECT * FROM comment WHERE task_id=? ORDER BY created_at ASC, rowid ASC",
          )
          .all(taskId)
          .map(toComment);
      },
    },
  };
}

function toProject(value: unknown): ProjectRecord {
  const row = rowValue(value);
  return {
    id: stringValue(row, "id"),
    code: stringValue(row, "code"),
    name: stringValue(row, "name"),
    description: nullableStringValue(row, "description"),
    workflowType: stringValue(row, "workflow_type") as WorkflowType,
    repoPath: stringValue(row, "repo_path"),
    maxParallel: numberValue(row, "max_parallel"),
    agentProvider: providerValue(row, "agent_provider"),
    agentConfigJson: nullableJsonTextValue(row, "agent_config_json"),
    scanIgnoreJson: jsonTextValue(row, "scan_ignore_json", "[]"),
    concernsJson: jsonTextValue(row, "concerns_json", "[]"),
    allowGit: booleanValue(row, "allow_git", false),
    version: numberValue(row, "version"),
    deletedAt: nullableStringValue(row, "deleted_at"),
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
  };
}

function toTask(value: unknown): TaskRecord {
  const row = rowValue(value);
  return {
    id: stringValue(row, "id"),
    projectId: stringValue(row, "project_id"),
    seq: numberValue(row, "seq"),
    code: stringValue(row, "code"),
    title: stringValue(row, "title"),
    description: nullableStringValue(row, "description"),
    acceptanceCriteriaJson: jsonTextValue(
      row,
      "acceptance_criteria_json",
      "[]",
    ),
    status: stringValue(row, "status") as TaskStatus,
    assigneeRole: nullableStringValue(
      row,
      "assignee_role",
    ) as AssigneeRole | null,
    reworkCount: numberValue(row, "rework_count"),
    agentProviderOverride: nullableProviderValue(
      row,
      "agent_provider_override",
    ),
    agentConfigJson: nullableJsonTextValue(row, "agent_config_json"),
    workspacePath: nullableStringValue(row, "workspace_path"),
    discoveryMode: jsonTextValue(
      row,
      "discovery_mode",
      "full",
    ) as DiscoveryMode,
    version: numberValue(row, "version"),
    deletedAt: nullableStringValue(row, "deleted_at"),
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
  };
}

function toRun(value: unknown): AgentRunRecord {
  const row = rowValue(value);
  return {
    id: stringValue(row, "id"),
    taskId: stringValue(row, "task_id"),
    parentRunId: nullableStringValue(row, "parent_run_id"),
    role: stringValue(row, "role") as RunRole,
    status: stringValue(row, "status") as RunStatus,
    attempt: numberValue(row, "attempt"),
    token: nullableStringValue(row, "token"),
    sessionProvider: nullableProviderValue(row, "session_provider"),
    sessionId: nullableStringValue(row, "session_id"),
    error: nullableStringValue(row, "error"),
    summary: nullableStringValue(row, "summary"),
    model: nullableStringValue(row, "model"),
    costUsd: numberValue(row, "cost_usd"),
    queuedAt: stringValue(row, "queued_at"),
    startedAt: nullableStringValue(row, "started_at"),
    endedAt: nullableStringValue(row, "ended_at"),
    lastHeartbeatAt: nullableStringValue(row, "last_heartbeat_at"),
  };
}

function toComment(value: unknown): CommentRecord {
  const row = rowValue(value);
  return {
    id: stringValue(row, "id"),
    taskId: stringValue(row, "task_id"),
    authorRole: stringValue(row, "author_role") as ActorRole,
    body: stringValue(row, "body"),
    createdAt: stringValue(row, "created_at"),
  };
}

function createSequenceId(): (prefix: string) => string {
  return (prefix) => `${prefix}-${randomId()}`;
}

function randomId(): string {
  const source = (globalThis as { readonly crypto?: RandomSource }).crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();

  const values = new Uint32Array(4);
  if (typeof source?.getRandomValues === "function") {
    source.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 0x1_0000_0000);
    }
  }

  return [...values]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

function nowIso(): string {
  return new Date().toISOString();
}

function changes(value: unknown): number {
  if (typeof value !== "object" || value === null || !("changes" in value))
    return 0;
  return Number((value as { readonly changes: unknown }).changes);
}

function idOf(value: unknown): string {
  return stringValue(rowValue(value), "id");
}

function rowValue(value: unknown): Row {
  if (typeof value !== "object" || value === null) {
    throw new Error("expected SQLite row object");
  }
  return value as Row;
}

function stringValue(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string")
    throw new Error(`expected ${key} to be a string`);
  return value;
}

function nullableStringValue(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new Error(`expected ${key} to be a nullable string`);
  return value;
}

function numberValue(value: unknown, key: string): number {
  const row = rowValue(value);
  const field = row[key];
  if (typeof field !== "number")
    throw new Error(`expected ${key} to be a number`);
  return field;
}

function booleanValue(row: Row, key: string, fallback: boolean): boolean {
  const value = row[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  throw new Error(`expected ${key} to be a boolean-compatible value`);
}

function jsonTextValue(row: Row, key: string, fallback: JsonText): JsonText {
  const value = row[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string")
    throw new Error(`expected ${key} to be JSON text`);
  return value;
}

function nullableJsonTextValue(row: Row, key: string): JsonText | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new Error(`expected ${key} to be nullable JSON text`);
  return value;
}

function providerValue(row: Row, key: string): ProviderId {
  return stringValue(row, key) as ProviderId;
}

function nullableProviderValue(row: Row, key: string): ProviderId | null {
  const value = nullableStringValue(row, key);
  return value === null ? null : (value as ProviderId);
}
