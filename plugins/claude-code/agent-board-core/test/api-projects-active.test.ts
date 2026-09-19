import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '../src/db.ts';

const mockState = vi.hoisted(() => {
  return {
    config: { active_project_code: 'TST' },
    db: {} as DbHandle,
    getDbCalls: [] as string[],
    writes: [] as Record<string, unknown>[],
  };
});

vi.mock('../src/config.ts', () => {
  return {
    readConfig: () => mockState.config,
    writeConfig: (patch: Record<string, unknown>) => {
      mockState.writes.push(patch);
      if ('active_project_code' in patch && typeof patch.active_project_code === 'string') {
        mockState.config = { active_project_code: patch.active_project_code };
      }
      return mockState.config;
    },
  };
});

vi.mock('../src/project-registry.ts', () => {
  return {
    closeDb: vi.fn(),
    getActiveDb: vi.fn(),
    getDb: (code: string): Promise<DbHandle> => {
      mockState.getDbCalls.push(code);
      return code === 'TST'
        ? Promise.resolve(mockState.db)
        : Promise.reject(new Error('no such project'));
    },
    listProjectDbs: () => ['tst'],
    openOrCreate: vi.fn(),
  };
});

vi.mock('../src/skill-scan-runtime.ts', () => {
  return {
    ensureSkillScanWorker: vi.fn(),
  };
});

const { handleProjects } = await import('../src/api-projects.ts');

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

async function callActiveSelect(
  method: 'PATCH' | 'POST',
  path: '/api/projects/active' | '/api/projects/active/select',
  body?: unknown,
): Promise<{ status: number; body: unknown; handled: boolean | null | undefined }> {
  const res = mkRes();
  const handled = await handleProjects(
    mkReq(method, body),
    res as unknown as ServerResponse,
    new URL(`http://agentboard.local${path}`),
  );
  return { status: res.statusCode, body: readJson(res), handled };
}

beforeEach(() => {
  mockState.config = { active_project_code: 'TST' };
  mockState.getDbCalls = [];
  mockState.writes = [];
});

describe('active project selection routes', () => {
  it('keeps PATCH /api/projects/active as the canonical active-project selector', async () => {
    const out = await callActiveSelect('PATCH', '/api/projects/active', { code: 'TST' });

    expect(out).toEqual({ handled: true, status: 200, body: { ok: true } });
    expect(mockState.writes).toEqual([{ active_project_code: 'TST' }]);
  });

  it('supports POST /api/projects/active/select as a compatibility shim', async () => {
    const out = await callActiveSelect('POST', '/api/projects/active/select', { code: 'TST' });

    expect(out).toEqual({ handled: true, status: 200, body: { ok: true } });
    expect(mockState.writes).toEqual([{ active_project_code: 'TST' }]);
  });

  it('normalizes project code before lookup and config writes', async () => {
    const out = await callActiveSelect('POST', '/api/projects/active/select', { code: ' tst ' });

    expect(out).toEqual({ handled: true, status: 200, body: { ok: true } });
    expect(mockState.getDbCalls).toEqual(['TST']);
    expect(mockState.writes).toEqual([{ active_project_code: 'TST' }]);
  });

  it.each([
    ['PATCH', '/api/projects/active'],
    ['POST', '/api/projects/active/select'],
  ] as const)('returns the same invalid-body response for %s %s', async (method, path) => {
    const out = await callActiveSelect(method, path);

    expect(out).toEqual({ handled: true, status: 400, body: { error: 'invalid body' } });
    expect(mockState.writes).toEqual([]);
  });

  it.each([
    ['PATCH', '/api/projects/active'],
    ['POST', '/api/projects/active/select'],
  ] as const)('returns the same missing-code response for %s %s', async (method, path) => {
    const out = await callActiveSelect(method, path, { code: '' });

    expect(out).toEqual({ handled: true, status: 400, body: { error: 'code required' } });
    expect(mockState.writes).toEqual([]);
  });

  it.each([
    ['PATCH', '/api/projects/active'],
    ['POST', '/api/projects/active/select'],
  ] as const)('returns the same missing-project response for %s %s', async (method, path) => {
    const out = await callActiveSelect(method, path, { code: 'NOPE' });

    expect(out).toEqual({ handled: true, status: 404, body: { error: 'no such project' } });
    expect(mockState.writes).toEqual([]);
  });

  it.each([
    ['PATCH', '/api/projects/active'],
    ['POST', '/api/projects/active/select'],
  ] as const)(
    'rejects invalid project codes before registry lookup for %s %s',
    async (method, path) => {
      const out = await callActiveSelect(method, path, { code: '../TST' });

      expect(out.handled).toBe(true);
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ error: expect.stringContaining('code must be') });
      expect(mockState.getDbCalls).toEqual([]);
      expect(mockState.writes).toEqual([]);
    },
  );
});
