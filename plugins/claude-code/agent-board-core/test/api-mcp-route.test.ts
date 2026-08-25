import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '../src/db.ts';

const PROJECT_CODE = 'TST';

let db: DbHandle | undefined;

vi.mock('../src/project-registry.ts', () => {
  return {
    getActiveDb: (): { code: string; db: DbHandle } | null => {
      if (db === undefined) return null;
      return { code: PROJECT_CODE, db };
    },
    getDbForRunId: (runId: string): { code: string; db: DbHandle } | null => {
      if (db === undefined) return null;
      const row = db.prepare(`SELECT id FROM agent_run WHERE id=?`).get(runId);
      return row === undefined || row === null ? null : { code: PROJECT_CODE, db };
    },
    getDbForRunToken: (runToken: string): { code: string; db: DbHandle } | null => {
      if (db === undefined) return null;
      const row = db.prepare(`SELECT id FROM agent_run WHERE token=?`).get(runToken);
      return row === undefined || row === null ? null : { code: PROJECT_CODE, db };
    },
  };
});

const { handleMcp } = await import('../src/api-mcp.ts');

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

interface JsonRpcResponse {
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

type ToolsCallResult = JsonRpcResponse & {
  result?: {
    content: { type: string; text: string }[];
    isError: boolean;
  };
};

async function makeDb(): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE task (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL
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
      phase_history_json TEXT NOT NULL DEFAULT '[]'
    );
  `);
  d.prepare(`INSERT INTO task (id, code, title) VALUES ('T1', 'TST-1', 'Queued task')`).run();
  d.prepare(
    `INSERT INTO agent_run (id, task_id, role, status, queued_at, last_heartbeat_at)
     VALUES ('R1', 'T1', 'worker', 'queued', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
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
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      res.chunks.push(buf);
      res.headersSent = true;
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        res.chunks.push(buf);
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
  return JSON.parse(Buffer.concat(res.chunks).toString('utf8')) as unknown;
}

async function postMcp(body?: unknown): Promise<MockRes> {
  const res = mkRes();
  await handleMcp(
    mkReq('POST', body),
    res as unknown as ServerResponse,
    new URL('http://agentboard.test/mcp'),
  );
  return res;
}

beforeEach(async () => {
  db = await makeDb();
});

describe('handleMcp route characterization', () => {
  it('ignores non-MCP routes and non-POST methods', async () => {
    const getRes = mkRes();
    const otherRes = mkRes();

    await expect(
      handleMcp(
        mkReq('GET', {}),
        getRes as unknown as ServerResponse,
        new URL('http://agentboard.test/mcp'),
      ),
    ).resolves.toBeNull();
    await expect(
      handleMcp(
        mkReq('POST', {}),
        otherRes as unknown as ServerResponse,
        new URL('http://agentboard.test/not-mcp'),
      ),
    ).resolves.toBeNull();

    expect(getRes.ended).toBe(false);
    expect(otherRes.ended).toBe(false);
  });

  it('returns JSON-RPC parse error for an empty body', async () => {
    const res = await postMcp();
    const body = readJson(res) as JsonRpcResponse;

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'parse error' },
    });
  });

  it('serves initialize, ping, notifications and tools/list envelopes', async () => {
    const initialize = readJson(
      await postMcp({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    ) as JsonRpcResponse;
    const ping = readJson(
      await postMcp({ jsonrpc: '2.0', id: 2, method: 'ping' }),
    ) as JsonRpcResponse;
    const tools = readJson(
      await postMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    ) as JsonRpcResponse;
    const notificationRes = await postMcp({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    expect(initialize.result).toMatchObject({
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'abrun', version: '0.1.0' },
    });
    expect(ping.result).toEqual({});
    expect((tools.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['list_queue', 'claim_run', 'record_tool', 'use_skill']),
    );
    expect(notificationRes.statusCode).toBe(202);
    expect(notificationRes.ended).toBe(true);
  });

  it('wraps successful tools/call output as MCP text content', async () => {
    const res = await postMcp({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'list_queue', arguments: {} },
    });
    const body = readJson(res) as ToolsCallResult;
    const text = body.result?.content[0]?.text ?? '';
    const payload = JSON.parse(text) as { queue: { id: string; task_code: string }[] };

    expect(body.result?.isError).toBe(false);
    expect(payload.queue).toEqual([expect.objectContaining({ id: 'R1', task_code: 'TST-1' })]);
  });

  it('wraps tool validation failures as MCP error content', async () => {
    const res = await postMcp({
      jsonrpc: '2.0',
      id: 'call-2',
      method: 'tools/call',
      params: { name: 'get_task', arguments: {} },
    });
    const body = readJson(res) as ToolsCallResult;

    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0]?.text).toBe('Error: run_token required');
  });

  it('wraps database resolution failures as MCP error content', async () => {
    db = undefined;

    const res = await postMcp({
      jsonrpc: '2.0',
      id: 'call-3',
      method: 'tools/call',
      params: { name: 'list_queue', arguments: {} },
    });
    const body = readJson(res) as ToolsCallResult;

    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0]?.text).toBe('Error: no active project');
  });
});
