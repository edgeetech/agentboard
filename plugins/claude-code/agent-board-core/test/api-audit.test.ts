import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '../src/db.ts';

import { makeP0Db, seedP0Project } from './p0-support-db.ts';

const mockState = vi.hoisted(() => ({
  db: undefined as DbHandle | undefined,
}));

vi.mock('../src/project-registry.ts', () => ({
  getDb: (code: string): Promise<DbHandle> =>
    code === 'TST' && mockState.db
      ? Promise.resolve(mockState.db)
      : Promise.reject(new Error('project not found')),
}));

const { handleAudit } = await import('../src/api-audit.ts');

interface MockRes {
  statusCode: number;
  headers: Record<string, string | number>;
  chunks: Buffer[];
  headersSent: boolean;
  writeHead: (status: number, headers?: Record<string, string | number>) => void;
  end: (chunk?: string | Buffer) => void;
}

function mkRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    chunks: [],
    headersSent: false,
    writeHead(status, headers) {
      res.statusCode = status;
      if (headers) Object.assign(res.headers, headers);
      res.headersSent = true;
    },
    end(chunk) {
      if (chunk !== undefined)
        res.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    },
  };
  return res;
}

function mkReq(): IncomingMessage {
  const req = Readable.from([]) as unknown as IncomingMessage;
  (req as unknown as { method: string }).method = 'GET';
  (req as unknown as { headers: Record<string, string> }).headers = {};
  return req;
}

function body(res: MockRes): string {
  return Buffer.concat(res.chunks).toString('utf8');
}

async function call(path: string): Promise<MockRes> {
  const res = mkRes();
  await handleAudit(mkReq(), res as unknown as ServerResponse, new URL(`http://local${path}`));
  return res;
}

beforeEach(async () => {
  mockState.db = await makeP0Db();
  seedP0Project(mockState.db);
});

describe('handleAudit', () => {
  it('serves task audit JSON and Markdown on the project task audit route', async () => {
    const json = await call('/api/projects/TST/tasks/TST-1/audit?format=json');
    const md = await call('/api/projects/TST/tasks/TST-1/audit?format=md');

    expect(json.statusCode).toBe(200);
    expect(json.headers['Content-Type']).toContain('application/json');
    expect(JSON.parse(body(json))).toMatchObject({ task: { code: 'TST-1' } });
    expect(md.statusCode).toBe(200);
    expect(md.headers['Content-Type']).toContain('text/markdown');
    expect(body(md)).toContain('# Task Audit');
  });

  it('rejects oversized exports with a controlled 413', async () => {
    mockState.db
      ?.prepare(
        `INSERT INTO comment(id, task_id, author_role, body, created_at)
         VALUES ('BIG', 'TASK1', 'human', ?, '2026-01-01T00:00:00Z')`,
      )
      .run('x'.repeat(2_100_000));

    const res = await call('/api/projects/TST/tasks/TST-1/audit?format=json');

    expect(res.statusCode).toBe(413);
    expect(JSON.parse(body(res))).toMatchObject({ error: 'audit export too large' });
  });

  it('ignores non-audit task routes so generic task handlers can own them', async () => {
    const res = mkRes();
    const handled = await handleAudit(
      mkReq(),
      res as unknown as ServerResponse,
      new URL('http://local/api/projects/TST/tasks/TST-1'),
    );

    expect(handled).toBeNull();
    expect(res.headersSent).toBe(false);
  });
});
