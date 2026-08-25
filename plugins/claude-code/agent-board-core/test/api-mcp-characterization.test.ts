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
  it('lists queued runs in FIFO order with task summary fields', () => {
    insertTask('T1', 'TST-1', 'Older task');
    insertTask('T2', 'TST-2', 'Newer task');
    insertRun({
      id: 'R-running',
      taskId: 'T1',
      role: 'worker',
      status: 'running',
      queuedAt: '2026-01-01T00:00:00Z',
      token: 'running-token',
    });
    insertRun({
      id: 'R-new',
      taskId: 'T2',
      role: 'worker',
      status: 'queued',
      queuedAt: '2026-01-01T00:02:00Z',
    });
    insertRun({
      id: 'R-old',
      taskId: 'T1',
      role: 'pm',
      status: 'queued',
      queuedAt: '2026-01-01T00:01:00Z',
    });

    const result = callTool(db, 'list_queue', {}) as { queue: Row[] };

    expect(result.queue.map((row) => row.id)).toEqual(['R-old', 'R-new']);
    expect(result.queue[0]).toMatchObject({
      task_code: 'TST-1',
      task_title: 'Older task',
    });
  });

  it('claims queued reviewer runs with a fresh token and verification phase', () => {
    insertTask('T1', 'TST-1', 'Review task');
    insertRun({
      id: 'R-review',
      taskId: 'T1',
      role: 'reviewer',
      status: 'queued',
      queuedAt: '2026-01-01T00:01:00Z',
      token: 'existing-token-must-not-return',
    });

    const result = callTool(db, 'claim_run', { run_id: 'R-review' }) as {
      run_token: string;
      task_id: string;
    };
    const row = getRun('R-review');
    const history = JSON.parse(String(row.phase_history_json)) as Row[];

    expect(result.task_id).toBe('T1');
    expect(result.run_token).toMatch(/^[a-f0-9]{48}$/);
    expect(result.run_token).not.toBe('existing-token-must-not-return');
    expect(row.status).toBe('running');
    expect(row.token).toBe(result.run_token);
    expect(row.phase).toBe('VERIFICATION');
    expect(history).toEqual([
      expect.objectContaining({ from: 'DISCOVERY', to: 'VERIFICATION', by: 'reviewer' }),
    ]);
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
      target: 'git push origin main',
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
      target: 'git push origin main',
      phase: 'EXECUTING',
      reason: 'git writes blocked unless project.allow_git',
    });
  });
});
