import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '../src/db.ts';

const mockState = vi.hoisted(() => {
  return {
    db: undefined as DbHandle | undefined,
    getDbCalls: [] as string[],
  };
});

vi.mock('../src/project-registry.ts', () => {
  return {
    getDb: (code: string): Promise<DbHandle> => {
      mockState.getDbCalls.push(code);
      return code === 'TST' && mockState.db
        ? Promise.resolve(mockState.db)
        : Promise.reject(new Error('project not found'));
    },
  };
});

const { handleTracker } = await import('../src/api-tracker.ts');

interface MockRes {
  statusCode: number;
  headers: Record<string, string | number>;
  chunks: Buffer[];
  ended: boolean;
  headersSent: boolean;
  writeHead: (status: number, headers?: Record<string, string | number>) => void;
  write: (chunk: string | Buffer) => boolean;
  end: (chunk?: string | Buffer) => void;
}

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
      concerns_json TEXT NOT NULL DEFAULT '[]',
      allow_git INTEGER NOT NULL DEFAULT 0,
      scan_ignore_json TEXT NOT NULL DEFAULT '[]',
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
    CREATE TABLE comment (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task(id),
      author_role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE tracker_config (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id) UNIQUE,
      kind TEXT NOT NULL,
      endpoint TEXT,
      api_key_env_var TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      active_states TEXT NOT NULL DEFAULT '["Todo","In Progress"]',
      terminal_states TEXT NOT NULL DEFAULT '["Done","Cancelled","Canceled","Duplicate"]',
      assignee TEXT,
      poll_interval_ms INTEGER NOT NULL DEFAULT 30000,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tracker_issue (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      task_id TEXT REFERENCES task(id),
      tracker_kind TEXT NOT NULL,
      external_id TEXT NOT NULL,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      url TEXT,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, tracker_kind, external_id)
    );
    CREATE TABLE tracker_poll_state (
      project_id TEXT PRIMARY KEY REFERENCES project(id),
      last_poll_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      last_issue_count INTEGER NOT NULL DEFAULT 0,
      rate_limited INTEGER NOT NULL DEFAULT 0,
      next_poll_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO project(id, code, name, workflow_type, repo_path, created_at, updated_at)
    VALUES ('P1', 'TST', 'Test', 'WF1', 'C:/repo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
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
    close: () => {
      d.close();
    },
  } as unknown as DbHandle;
}

function mkRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    chunks: [],
    ended: false,
    headersSent: false,
    writeHead(status, headers) {
      res.statusCode = status;
      if (headers) Object.assign(res.headers, headers);
      res.headersSent = true;
    },
    write(chunk) {
      res.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      res.headersSent = true;
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) {
        res.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      res.ended = true;
    },
  };
  return res;
}

function mkReq(method: string, body?: unknown): IncomingMessage {
  const stream =
    body === undefined ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))]);
  const req = stream as unknown as IncomingMessage;
  (req as unknown as { method: string }).method = method;
  (req as unknown as { headers: Record<string, string> }).headers = {};
  return req;
}

function readJson(res: MockRes): unknown {
  const text = Buffer.concat(res.chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

async function callTracker(method: string, path: string, body?: unknown): Promise<MockRes> {
  const res = mkRes();
  await handleTracker(
    mkReq(method, body),
    res as unknown as ServerResponse,
    new URL(`http://agentboard.local${path}`),
  );
  return res;
}

beforeEach(async () => {
  mockState.db = await makeDb();
  mockState.getDbCalls = [];
  delete process.env.TEST_TRACKER_KEY;
});

describe('handleTracker', () => {
  it('rejects malformed project codes before opening project databases', async () => {
    const res = await callTracker('GET', '/api/projects/..%2FTST/tracker');

    expect(res.statusCode).toBe(400);
    expect(readJson(res)).toMatchObject({ error: expect.stringContaining('code') });
    expect(mockState.getDbCalls).toEqual([]);
  });

  it('rejects invalid percent-encoded project paths before opening project databases', async () => {
    const res = await callTracker('GET', '/api/projects/%E0%A4%A/tracker');

    expect(res.statusCode).toBe(400);
    expect(readJson(res)).toMatchObject({ error: expect.stringContaining('encoding') });
    expect(mockState.getDbCalls).toEqual([]);
  });

  it('returns empty tracker config with persisted status shape', async () => {
    const res = await callTracker('GET', '/api/projects/TST/tracker');

    expect(res.statusCode).toBe(200);
    expect(readJson(res)).toMatchObject({
      tracker: null,
      status: {
        enabled: false,
        env_present: false,
        issues_count: 0,
        last_issue_count: 0,
      },
    });
  });

  it('creates schema-aligned tracker config and reports credential presence', async () => {
    process.env.TEST_TRACKER_KEY = 'fake-key';

    const res = await callTracker('POST', '/api/projects/TST/tracker', {
      kind: 'github',
      api_key_env_var: 'TEST_TRACKER_KEY',
      project_slug: 'owner/repo',
      active_states: ['Open'],
      terminal_states: ['Closed'],
      poll_interval_ms: 10_000,
      enabled: true,
    });

    expect(res.statusCode).toBe(200);
    expect(readJson(res)).toMatchObject({
      tracker: {
        kind: 'github',
        api_key_env_var: 'TEST_TRACKER_KEY',
        project_slug: 'owner/repo',
        active_states: ['Open'],
        terminal_states: ['Closed'],
        enabled: true,
      },
      status: {
        enabled: true,
        env_present: true,
      },
    });
  });

  it('preserves omitted optional fields on tracker config updates', async () => {
    await callTracker('POST', '/api/projects/TST/tracker', {
      kind: 'github',
      endpoint: 'https://api.github.com',
      api_key_env_var: 'TEST_TRACKER_KEY',
      project_slug: 'owner/repo',
      active_states: ['Ready'],
      terminal_states: ['Closed'],
      assignee: 'octocat',
      poll_interval_ms: 15_000,
      enabled: true,
    });

    const res = await callTracker('POST', '/api/projects/TST/tracker', {
      project_slug: 'owner/renamed',
    });

    expect(readJson(res)).toMatchObject({
      tracker: {
        endpoint: 'https://api.github.com',
        project_slug: 'owner/renamed',
        active_states: ['Ready'],
        terminal_states: ['Closed'],
        assignee: 'octocat',
        poll_interval_ms: 15_000,
        enabled: true,
      },
    });
  });

  it('toggles configured trackers on and off', async () => {
    await callTracker('POST', '/api/projects/TST/tracker', {
      kind: 'linear',
      api_key_env_var: 'TEST_TRACKER_KEY',
      project_slug: 'team/project',
    });

    const enabled = await callTracker('POST', '/api/projects/TST/tracker/enable');
    const disabled = await callTracker('POST', '/api/projects/TST/tracker/disable');

    expect(readJson(enabled)).toMatchObject({ ok: true, tracker: { enabled: true } });
    expect(readJson(disabled)).toMatchObject({ ok: true, tracker: { enabled: false } });
  });

  it('manual sync records missing env var as tracker status', async () => {
    await callTracker('POST', '/api/projects/TST/tracker', {
      kind: 'github',
      api_key_env_var: 'TEST_TRACKER_KEY',
      project_slug: 'owner/repo',
      enabled: true,
    });

    const res = await callTracker('POST', '/api/projects/TST/tracker/sync');

    expect(res.statusCode).toBe(400);
    expect(readJson(res)).toMatchObject({
      ok: false,
      issues_fetched: 0,
      status: {
        env_present: false,
        last_error: expect.stringContaining('TEST_TRACKER_KEY'),
      },
    });
  });

  it('lists tracker issues joined to task code and status', async () => {
    await callTracker('POST', '/api/projects/TST/tracker', {
      kind: 'github',
      api_key_env_var: 'TEST_TRACKER_KEY',
      project_slug: 'owner/repo',
    });
    mockState.db
      ?.prepare(
        `
        INSERT INTO task(id, project_id, seq, code, title, status, created_at, updated_at)
        VALUES ('TASK1', 'P1', 1, 'TST-1', 'Task', 'todo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
      `,
      )
      .run();
    mockState.db
      ?.prepare(
        `
        INSERT INTO tracker_issue(id, project_id, task_id, tracker_kind, external_id,
                                  identifier, title, state, synced_at, created_at)
        VALUES ('TI1', 'P1', 'TASK1', 'github', 'EXT1', 'EXT-1', 'External', 'Todo',
                '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
      `,
      )
      .run();

    const res = await callTracker('GET', '/api/projects/TST/tracker/issues');

    expect(res.statusCode).toBe(200);
    expect(readJson(res)).toMatchObject({
      issues: [{ identifier: 'EXT-1', task_code: 'TST-1', task_status: 'todo' }],
    });
  });
});
