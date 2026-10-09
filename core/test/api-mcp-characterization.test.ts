import { describe, expect, it, beforeEach } from 'vitest';

import { callTool } from '../src/api-mcp.ts';
import type { DbHandle } from '../src/db.ts';

let db: DbHandle;

type Row = Record<string, unknown>;

async function makeDb(): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
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
      auth_config_json TEXT,
      scan_ignore_json TEXT NOT NULL DEFAULT '[]',
      allow_git INTEGER NOT NULL DEFAULT 0,
      concerns_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE task (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      discovery_mode TEXT,
      workspace_path TEXT
    );
    CREATE TABLE agent_run (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      token TEXT,
      queued_at TEXT,
      pid INTEGER,
      logs_path TEXT,
      started_at TEXT,
      last_heartbeat_at TEXT,
      phase TEXT NOT NULL DEFAULT 'DISCOVERY',
      phase_state_json TEXT NOT NULL DEFAULT '{}',
      phase_history_json TEXT NOT NULL DEFAULT '[]',
      parent_run_id TEXT,
      member_index INTEGER,
      council_size INTEGER
    );
    CREATE TABLE agent_activity (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      at TEXT NOT NULL
    );
  `);
  d.prepare(
    `INSERT INTO project (
       id, code, name, workflow_type, repo_path, allow_git, concerns_json,
       deleted_at, created_at, updated_at
     ) VALUES (
       'P1', 'TST', 'Test Project', 'WF1', '/', 0, '[]', NULL,
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
     )`,
  ).run();
  return {
    exec: (s: string) => {
      d.exec(s);
    },
    prepare: (s: string) => {
      const stmt = d.prepare(s);
      return {
        run: (...a: Parameters<typeof stmt.run>) => stmt.run(...a),
        get: (...a: Parameters<typeof stmt.get>) => stmt.get(...a),
        all: (...a: Parameters<typeof stmt.all>) => stmt.all(...a),
      };
    },
    transaction: <T>(fn: (...args: unknown[]) => T): ((...args: unknown[]) => T) => {
      return (...args: unknown[]): T => {
        d.exec('BEGIN');
        try {
          const r = fn(...args);
          d.exec('COMMIT');
          return r;
        } catch (e) {
          d.exec('ROLLBACK');
          throw e;
        }
      };
    },
  } as unknown as DbHandle;
}

function insertTask(id: string, code: string, title: string): void {
  db.prepare(`INSERT INTO task (id, code, title) VALUES (?, ?, ?)`).run(id, code, title);
}

function insertRun(args: {
  id: string;
  taskId: string;
  role: string;
  status: string;
  queuedAt: string;
  token?: string | null;
  phase?: string;
}): void {
  db.prepare(
    `INSERT INTO agent_run (id, task_id, role, status, token, queued_at, last_heartbeat_at, phase)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.id,
    args.taskId,
    args.role,
    args.status,
    args.token ?? null,
    args.queuedAt,
    args.queuedAt,
    args.phase ?? 'DISCOVERY',
  );
}

function getRun(id: string): Row {
  return db.prepare(`SELECT * FROM agent_run WHERE id=?`).get(id) as Row;
}

function listActivities(): Row[] {
  return db.prepare(`SELECT * FROM agent_activity ORDER BY at ASC, id ASC`).all() as Row[];
}

beforeEach(async () => {
  db = await makeDb();
});

describe('MCP callTool characterization', () => {
  it('does not expose list_queue or claim_run — the executor claims runs itself', () => {
    insertTask('T1', 'TST-1', 'Review task');
    insertRun({
      id: 'R-review',
      taskId: 'T1',
      role: 'reviewer',
      status: 'queued',
      queuedAt: '2026-01-01T00:01:00Z',
    });
    expect(() => callTool(db, 'list_queue', {})).toThrow(/unknown tool/);
    expect(() => callTool(db, 'claim_run', { run_id: 'R-review' })).toThrow(/unknown tool/);
    // Queued run is untouched — no MCP tool can claim it (and thereby mint
    // its run_token) on the agent's behalf.
    expect(getRun('R-review').status).toBe('queued');
  });

  it('blocks git writes without project allow_git and records audit activity', () => {
    insertTask('T1', 'TST-1', 'Tool policy task');
    insertRun({
      id: 'R1',
      taskId: 'T1',
      role: 'worker',
      status: 'running',
      queuedAt: '2026-01-01T00:01:00Z',
      token: 'run-token',
      phase: 'EXECUTING',
    });

    const result = callTool(db, 'record_tool', {
      run_token: 'run-token',
      tool: 'Bash',
      target: 'git commit -m wip',
    }) as { decision: string; reason: string | null };
    const activities = listActivities();
    const payload = JSON.parse(String(activities[0]?.payload)) as Row;

    expect(result).toEqual({
      decision: 'block',
      reason: 'git writes blocked unless project.allow_git',
    });
    expect(activities[0]).toMatchObject({
      run_id: 'R1',
      task_id: 'T1',
      kind: 'tool:blocked',
    });
    expect(payload).toMatchObject({
      tool: 'Bash',
      target: 'git commit -m wip',
      phase: 'EXECUTING',
      reason: 'git writes blocked unless project.allow_git',
    });
  });
  it('blocks destructive commands unless the project opts in', () => {
    insertTask('T2', 'TST-2', 'Destructive tool task');
    insertRun({
      id: 'R2',
      taskId: 'T2',
      role: 'worker',
      status: 'running',
      queuedAt: '2026-01-01T00:02:00Z',
      token: 'run-token-2',
      phase: 'EXECUTING',
    });

    const result = callTool(db, 'record_tool', {
      run_token: 'run-token-2',
      tool: 'Bash',
      target: 'rm -rf src',
    }) as { decision: string; reason: string | null };

    expect(result.decision).toBe('block');
    expect(result.reason).toContain('allow_destructive_tools');
  });
});
