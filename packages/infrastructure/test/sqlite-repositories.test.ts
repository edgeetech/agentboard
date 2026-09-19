import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSqlitePersistence,
  type SqliteConnectionPort,
} from "../src/index.ts";

interface TestDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: readonly unknown[]): unknown;
    get(...args: readonly unknown[]): unknown;
    all(...args: readonly unknown[]): readonly unknown[];
  };
  close(): void;
}

let db: TestDatabase;
let persistence: ReturnType<typeof createSqlitePersistence>;
let idTick = 0;

beforeEach(async () => {
  const sqlite = (await import("node:sqlite")) as {
    readonly DatabaseSync: new (path: string) => TestDatabase;
  };
  db = new sqlite.DatabaseSync(":memory:");
  db.exec(TEST_SCHEMA);
  db.prepare(
    `
    INSERT INTO project(
      id, code, name, description, workflow_type, repo_path, max_parallel,
      agent_provider, agent_config_json, scan_ignore_json, concerns_json,
      allow_git, created_at, updated_at
    )
    VALUES ('project-1', 'AB', 'AgentBoard', NULL, 'WF1', '/workspace', 1,
      'claude', NULL, '[]', '[]', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `,
  ).run();

  persistence = createSqlitePersistence(toConnectionPort(db), {
    id: (prefix) => `${prefix}-${++idTick}`,
    now: () => "2026-01-01T00:00:00.000Z",
  });
});

afterEach(() => {
  db.close();
  idTick = 0;
});

describe("createSqlitePersistence", () => {
  it("maps project records and performs versioned updates", () => {
    const project = persistence.projects.getCurrent();
    expect(project).toMatchObject({
      id: "project-1",
      code: "AB",
      workflowType: "WF1",
      agentProvider: "claude",
      allowGit: false,
      version: 0,
    });

    const updated = persistence.projects.updateCurrent(0, {
      name: "Renamed",
      maxParallel: 2,
      agentProvider: "codex" as never,
      scanIgnoreJson: '["node_modules"]',
    });

    expect(updated).toMatchObject({
      ok: true,
      project: {
        name: "Renamed",
        maxParallel: 2,
        agentProvider: "codex",
        scanIgnoreJson: '["node_modules"]',
        version: 1,
      },
    });
    expect(persistence.projects.updateCurrent(0, { name: "Stale" })).toEqual({
      ok: false,
      reason: "version mismatch",
    });
  });

  it("creates, lists, reads and transitions tasks", () => {
    const first = persistence.tasks.create({
      title: "Extract repository",
      description: "Move SQLite behind a port",
      assigneeRole: "worker",
      acceptanceCriteriaJson: '["covered"]',
      agentProviderOverride: "codex" as never,
    });
    const second = persistence.tasks.create({ title: "Done task" });

    expect(first).toMatchObject({
      id: "task-1",
      projectId: "project-1",
      seq: 1,
      code: "AB-1",
      status: "todo",
      discoveryMode: "full",
      agentProviderOverride: "codex",
      version: 0,
    });
    expect(second.code).toBe("AB-2");
    expect(persistence.tasks.list().map((task) => task.code)).toEqual([
      "AB-1",
      "AB-2",
    ]);
    expect(persistence.tasks.getByCode("AB-1")?.title).toBe(
      "Extract repository",
    );

    const transitioned = persistence.tasks.transition({
      taskId: first.id,
      expectedVersion: 0,
      toStatus: "agent_working",
      toAssignee: "worker",
      byRole: "pm",
    });
    expect(transitioned).toMatchObject({
      ok: true,
      task: { status: "agent_working", assigneeRole: "worker", version: 1 },
    });
    expect(
      persistence.tasks.transition({
        taskId: first.id,
        expectedVersion: 0,
        toStatus: "done",
        toAssignee: null,
        byRole: "worker",
      }),
    ).toEqual({ ok: false, reason: "version mismatch" });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM task_history").get(),
    ).toMatchObject({ count: 1 });
  });

  it("enqueues, lists and finishes runs", () => {
    const task = persistence.tasks.create({ title: "Runnable" });
    const runId = persistence.runs.enqueue(task.id, "worker");
    const secondRunId = persistence.runs.enqueue(task.id, "reviewer");

    expect(runId).toBe("run-2");
    expect(secondRunId).toBe("run-3");
    expect(persistence.runs.getById(runId)).toMatchObject({
      id: runId,
      taskId: task.id,
      role: "worker",
      status: "queued",
      costUsd: 0,
      parentRunId: null,
    });
    expect(persistence.runs.listQueued().map((run) => run.id)).toEqual([
      runId,
      secondRunId,
    ]);
    expect(persistence.runs.listForTask(task.id).map((run) => run.id)).toEqual([
      secondRunId,
      runId,
    ]);
    expect(persistence.runs.runningCount()).toBe(0);

    persistence.runs.bumpHeartbeat(runId);
    expect(persistence.runs.getById(runId)?.lastHeartbeatAt).not.toBeNull();

    persistence.runs.finish(runId, "succeeded", "ok");
    expect(persistence.runs.getById(runId)).toMatchObject({
      status: "succeeded",
      summary: "ok",
      error: null,
    });
    expect(persistence.runs.listQueued().map((run) => run.id)).toEqual([
      secondRunId,
    ]);
  });

  it("adds and lists comments in creation order", () => {
    const task = persistence.tasks.create({ title: "Needs discussion" });

    const first = persistence.comments.add(
      task.id,
      "pm",
      "Please inspect this",
    );
    const second = persistence.comments.add(task.id, "worker", "Done");

    expect(first).toMatchObject({
      id: "comment-2",
      taskId: task.id,
      authorRole: "pm",
    });
    expect(
      persistence.comments.listForTask(task.id).map((comment) => comment.id),
    ).toEqual([first.id, second.id]);
  });
});

function toConnectionPort(database: TestDatabase): SqliteConnectionPort {
  return {
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      return database.prepare(sql);
    },
    transaction(fn) {
      return () => {
        database.exec("BEGIN");
        try {
          const result = fn();
          database.exec("COMMIT");
          return result;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      };
    },
    close() {
      database.close();
    },
  };
}

const TEST_SCHEMA = `
CREATE TABLE project (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  workflow_type TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  max_parallel INTEGER NOT NULL DEFAULT 1,
  agent_provider TEXT NOT NULL DEFAULT 'claude',
  agent_config_json TEXT,
  scan_ignore_json TEXT NOT NULL DEFAULT '[]',
  concerns_json TEXT NOT NULL DEFAULT '[]',
  allow_git INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  seq INTEGER NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  assignee_role TEXT,
  rework_count INTEGER NOT NULL DEFAULT 0,
  agent_provider_override TEXT,
  agent_config_json TEXT,
  workspace_path TEXT,
  discovery_mode TEXT NOT NULL DEFAULT 'full',
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, seq)
);

CREATE TABLE task_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id),
  from_status TEXT,
  to_status TEXT,
  by_role TEXT,
  at TEXT NOT NULL
);

CREATE TABLE agent_run (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  token TEXT,
  session_provider TEXT,
  session_id TEXT,
  error TEXT,
  summary TEXT,
  model TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  last_heartbeat_at TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  parent_run_id TEXT REFERENCES agent_run(id)
);

CREATE TABLE comment (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id),
  author_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
