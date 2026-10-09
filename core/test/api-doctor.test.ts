import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '../src/db.ts';

import { makeP0Db, seedP0Project } from './p0-support-db.ts';

const mockState = vi.hoisted(() => ({
  db: undefined as DbHandle | undefined,
}));

vi.mock('../src/project-registry.ts', () => ({
  getActiveDb: () => Promise.resolve(null),
  getDb: (code: string): Promise<DbHandle> =>
    code === 'TST' && mockState.db
      ? Promise.resolve(mockState.db)
      : Promise.reject(new Error('project not found')),
}));

const { handleDoctor } = await import('../src/api-doctor.ts');

interface MockRes {
  statusCode: number;
  chunks: Buffer[];
  writeHead: (status: number, headers?: Record<string, string | number>) => void;
  end: (chunk?: string | Buffer) => void;
}

function mkReq(): IncomingMessage {
  const req = Readable.from([]) as unknown as IncomingMessage;
  (req as unknown as { method: string }).method = 'GET';
  (req as unknown as { headers: Record<string, string> }).headers = {};
  return req;
}

function mkRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    chunks: [],
    writeHead(status) {
      res.statusCode = status;
    },
    end(chunk) {
      if (chunk !== undefined)
        res.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    },
  };
  return res;
}

async function call(path: string): Promise<Record<string, unknown> & { statusCode: number }> {
  const res = mkRes();
  await handleDoctor(mkReq(), res as unknown as ServerResponse, new URL(`http://local${path}`));
  return {
    ...(JSON.parse(Buffer.concat(res.chunks).toString('utf8')) as Record<string, unknown>),
    statusCode: res.statusCode,
  };
}

beforeEach(async () => {
  mockState.db = await makeP0Db();
  seedP0Project(mockState.db);
});

describe('handleDoctor', () => {
  it('returns stable checks when no active project exists', async () => {
    const res = await call('/api/doctor');

    expect(res.statusCode).toBe(200);
    expect(res.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'project.active' })]),
    );
  });

  it('returns project-specific doctor checks', async () => {
    const res = await call('/api/projects/TST/doctor');

    expect(res.statusCode).toBe(200);
    expect(res.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'database.schema', status: 'ok' })]),
    );
  });
});
