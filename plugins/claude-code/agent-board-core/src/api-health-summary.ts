import type { IncomingMessage, ServerResponse } from 'node:http';

import { json, matchRoute } from './http-util.ts';
import { validateCode } from './project-code.ts';
import { getDb } from './project-registry.ts';
import { getProject } from './repo.ts';
import { latestScan } from './skill-repo.ts';
import { getTrackerConfig, trackerStatus } from './tracker-sync.ts';

export async function handleHealthSummary(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<null | true> {
  const match = matchRoute('/api/projects/:code/health-summary', url.pathname);
  if (match === null || req.method !== 'GET') return null;
  const code = (match.code ?? '').trim().toUpperCase();
  const codeErr = validateCode(code);
  if (codeErr !== null) {
    json(res, 400, { error: codeErr });
    return true;
  }
  try {
    const db = await getDb(code);
    const project = getProject(db);
    if (project === undefined) {
      json(res, 404, { error: 'project not found' });
      return true;
    }
    const tracker = getTrackerConfig(db, project.id);
    json(res, 200, {
      tasks: counts(
        db,
        `SELECT status, COUNT(*) AS count FROM task WHERE deleted_at IS NULL GROUP BY status`,
      ),
      runs: counts(db, `SELECT status, COUNT(*) AS count FROM agent_run GROUP BY status`),
      queue: {
        queued: scalar(db, `SELECT COUNT(*) AS count FROM agent_run WHERE status='queued'`),
        running: scalar(db, `SELECT COUNT(*) AS count FROM agent_run WHERE status='running'`),
        awaiting_human: scalar(
          db,
          `SELECT COUNT(*) AS count FROM task WHERE status='human_approval' AND deleted_at IS NULL`,
        ),
      },
      skills: latestScan(db, code),
      tracker: trackerStatus(db, project.id, tracker),
      costs: {
        all_time: scalar(db, `SELECT COALESCE(SUM(cost_usd), 0) AS count FROM agent_run`),
        uncosted_runs: scalar(
          db,
          `SELECT COUNT(*) AS count FROM agent_run
           WHERE status IN ('succeeded', 'failed', 'blocked') AND cost_version = 0`,
        ),
      },
      providers: counts(
        db,
        `SELECT COALESCE(session_provider_override, session_provider, 'unknown') AS status,
                COUNT(*) AS count
         FROM agent_run
         GROUP BY COALESCE(session_provider_override, session_provider, 'unknown')`,
      ),
      generated_at: new Date().toISOString(),
    });
    return true;
  } catch {
    json(res, 404, { error: 'project not found' });
    return true;
  }
}

function counts(
  db: { prepare: (sql: string) => { all: () => unknown[] } },
  sql: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = db.prepare(sql).all() as { status: string; count: number }[];
  for (const row of rows) out[row.status] = row.count;
  return out;
}

function scalar(db: { prepare: (sql: string) => { get: () => unknown } }, sql: string): number {
  const row = db.prepare(sql).get() as { count: number } | undefined;
  return row?.count ?? 0;
}
