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

const { handleHealthSummary } = await import('../src/api-health-summary.ts');

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
  await handleHealthSummary(
    mkReq(),
    res as unknown as ServerResponse,
    new URL(`http://local${path}`),
  );
  return {
    ...(JSON.parse(Buffer.concat(res.chunks).toString('utf8')) as Record<string, unknown>),
    statusCode: res.statusCode,
  };
}

beforeEach(async () => {
  mockState.db = await makeP0Db();
  seedP0Project(mockState.db);
});

describe('handleHealthSummary', () => {
  it('aggregates task, run, skill, tracker, cost, and provider health without CLI probes', async () => {
    mockState.db
      ?.prepare(
        `INSERT INTO agent_run(id, task_id, role, status, session_provider, model, cost_usd,
                               cost_version, queued_at)
         VALUES ('R1', 'TASK1', 'worker', 'succeeded', 'claude', 'model', 0.5, 1,
                 '2026-01-01T00:00:00Z')`,
      )
      .run();
    mockState.db
      ?.prepare(
        `INSERT INTO skill_scan(id, project_code, status, trigger, created_at)
         VALUES ('S1', 'TST', 'succeeded', 'manual', '2026-01-01T00:00:00Z')`,
      )
      .run();
    mockState.db
      ?.prepare(
        `INSERT INTO tracker_config(id, project_id, kind, api_key_env_var, project_slug,
                                    enabled, created_at, updated_at)
         VALUES ('TC1', 'P1', 'github', 'TEST_TRACKER_KEY', 'owner/repo', 1,
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      )
      .run();
    mockState.db
      ?.prepare(
        `INSERT INTO tracker_poll_state(project_id, last_issue_count, updated_at)
         VALUES ('P1', 3, '2026-01-01T00:00:00Z')`,
      )
      .run();

    const res = await call('/api/projects/TST/health-summary');

    expect(res.statusCode).toBe(200);
    expect(res.tasks).toMatchObject({ agent_working: 1 });
    expect(res.runs).toMatchObject({ succeeded: 1 });
    expect(res.costs).toMatchObject({ all_time: 0.5, uncosted_runs: 0 });
    expect(res.providers).toMatchObject({ claude: 1 });
    expect(res.skills).toMatchObject({ status: 'succeeded' });
    expect(res.tracker).toMatchObject({ enabled: true, last_issue_count: 3 });
  });
});
