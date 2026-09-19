import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { openProjectDb, type DbHandle } from '../src/db.ts';

interface ColumnInfo {
  name: string;
}

interface MetaRow {
  value: string;
}

interface CountRow {
  count: number;
}

interface SqlRow {
  sql: string;
}

interface ProjectProviderRow {
  agent_provider: string;
}

let tempRoot: string | null = null;

afterEach(() => {
  if (tempRoot !== null) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function tempDbPath(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'agentboard-db-'));
  return join(tempRoot, 'project.sqlite');
}

function seedPreV6Db(path: string, options: { invalidProjectProvider?: boolean } = {}): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      INSERT INTO meta(key, value) VALUES ('schema_version', '4');

      CREATE TABLE project (
        id                TEXT PRIMARY KEY,
        code              TEXT UNIQUE NOT NULL,
        name              TEXT NOT NULL,
        description       TEXT,
        workflow_type     TEXT NOT NULL CHECK (workflow_type IN ('WF1','WF2')),
        repo_path         TEXT NOT NULL,
        max_parallel      INTEGER NOT NULL DEFAULT 1 CHECK (max_parallel BETWEEN 1 AND 3),
        agent_provider    TEXT NOT NULL DEFAULT 'claude' CHECK (agent_provider IN ('claude','github_copilot')),
        version           INTEGER NOT NULL DEFAULT 0,
        deleted_at        TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE task (
        id                       TEXT PRIMARY KEY,
        project_id               TEXT NOT NULL REFERENCES project(id),
        seq                      INTEGER NOT NULL,
        code                     TEXT NOT NULL,
        title                    TEXT NOT NULL,
        description              TEXT,
        acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
        status                   TEXT NOT NULL CHECK (status IN ('todo','agent_working','agent_review','human_approval','done')),
        assignee_role            TEXT CHECK (assignee_role IN ('pm','worker','reviewer','human')),
        rework_count             INTEGER NOT NULL DEFAULT 0,
        agent_provider_override  TEXT CHECK (agent_provider_override IN ('claude', 'github_copilot', NULL)),
        version                  INTEGER NOT NULL DEFAULT 0,
        deleted_at               TEXT,
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL,
        UNIQUE(project_id, seq)
      );
    `);
    if (options.invalidProjectProvider === true) {
      db.exec(`
        PRAGMA ignore_check_constraints=ON;
        INSERT INTO project(id, code, name, workflow_type, repo_path, agent_provider, created_at, updated_at)
        VALUES ('bad-project', 'BAD', 'Bad Project', 'WF1', '/tmp/repo', 'bogus', 'now', 'now');
        PRAGMA ignore_check_constraints=OFF;
      `);
    }
  } finally {
    db.close();
  }
}

function columns(db: DbHandle, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]).map(
    (column) => column.name,
  );
}

function indexNames(db: DbHandle): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all() as ColumnInfo[]
  ).map((row) => row.name);
}

function tableSql(db: DbHandle, table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as SqlRow | undefined;
  return row?.sql ?? '';
}

describe('project database migrations', () => {
  it('migrates an older project DB to current schema and is idempotent', async () => {
    const path = tempDbPath();
    seedPreV6Db(path);

    let db = await openProjectDb(path);
    try {
      expect(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()).toEqual({
        value: '6',
      } satisfies MetaRow);

      expect(columns(db, 'project')).toEqual(
        expect.arrayContaining([
          'agent_provider',
          'agent_config_json',
          'scan_ignore_json',
          'concerns_json',
          'allow_git',
        ]),
      );
      expect(columns(db, 'task')).toEqual(
        expect.arrayContaining([
          'agent_provider_override',
          'agent_config_json',
          'workspace_path',
          'discovery_mode',
        ]),
      );
      expect(columns(db, 'agent_run')).toEqual(
        expect.arrayContaining([
          'session_provider',
          'session_id',
          'phase',
          'phase_state_json',
          'phase_history_json',
          'parent_run_id',
          'member_index',
          'council_size',
          'session_provider_override',
          'cost_breakdown_json',
        ]),
      );

      expect(indexNames(db)).toEqual(
        expect.arrayContaining([
          'idx_agent_run_parent',
          'idx_agent_run_task_queued',
          'idx_task_status_live',
          'idx_retry_state_task',
        ]),
      );

      expect(tableSql(db, 'project')).not.toMatch(/agent_provider\s+[^,]*CHECK\s*\(/i);
      expect(tableSql(db, 'task')).not.toMatch(/agent_provider_override\s+[^,]*CHECK\s*\(/i);
      expect(tableSql(db, 'agent_run')).not.toMatch(
        /session_provider(?:_override)?\s+[^,]*CHECK\s*\(/i,
      );

      db.exec(`
        INSERT INTO project(id, code, name, workflow_type, repo_path, agent_provider, created_at, updated_at)
        VALUES ('p1', 'P1', 'Project', 'WF1', '/tmp/repo', 'gemini', 'now', 'now');
        INSERT INTO task(id, project_id, seq, code, title, status, assignee_role, agent_provider_override, created_at, updated_at)
        VALUES ('t1', 'p1', 1, 'P1-1', 'Task', 'todo', 'pm', 'gemini', 'now', 'now');
        INSERT INTO agent_run(id, task_id, role, status, session_provider, session_provider_override, queued_at)
        VALUES ('r1', 't1', 'pm', 'queued', 'gemini', 'gemini', 'now');
      `);
    } finally {
      db.close();
    }

    db = await openProjectDb(path);
    try {
      expect(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()).toEqual({
        value: '6',
      } satisfies MetaRow);
      expect(columns(db, 'project')).toContain('agent_config_json');
      expect(columns(db, 'task')).toContain('discovery_mode');
      expect(db.prepare("SELECT agent_provider FROM project WHERE id='p1'").get()).toEqual({
        agent_provider: 'gemini',
      } satisfies ProjectProviderRow);
    } finally {
      db.close();
    }
  }, 15_000);

  it('preserves unknown legacy provider values while removing provider CHECK constraints', async () => {
    const path = tempDbPath();
    seedPreV6Db(path, { invalidProjectProvider: true });

    const migrated = await openProjectDb(path);
    migrated.close();

    const db = new DatabaseSync(path);
    try {
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='project'",
          )
          .get(),
      ).toEqual({ count: 1 } satisfies CountRow);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='project_new'",
          )
          .get(),
      ).toEqual({ count: 0 } satisfies CountRow);
      expect(db.prepare("SELECT agent_provider FROM project WHERE id='bad-project'").get()).toEqual(
        { agent_provider: 'bogus' } satisfies ProjectProviderRow,
      );
    } finally {
      db.close();
    }
  });
});
