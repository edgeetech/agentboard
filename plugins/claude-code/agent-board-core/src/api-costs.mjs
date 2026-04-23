import { json, matchRoute } from './http-util.mjs';
import { getDb } from './project-registry.mjs';
import { isoNow } from './time.mjs';

export async function handleCosts(req, res, url) {
  let mm;

  if ((mm = matchRoute('/api/projects/:code/costs', url.pathname)) && req.method === 'GET') {
    const db = await getDb(mm.code);
    const group = url.searchParams.get('group') || 'role';
    const groupCol = { role: 'role', day: `date(queued_at)`, status: 'status' }[group] || 'role';
    const rows = db.prepare(`
      SELECT ${groupCol} AS bucket,
             SUM(cost_usd) AS cost_usd,
             SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) AS tokens,
             COUNT(*) AS runs
      FROM agent_run
      WHERE status IN ('succeeded','failed','blocked','cancelled')
      GROUP BY bucket
      ORDER BY bucket
    `).all();
    return json(res, 200, { rows });
  }

  if ((mm = matchRoute('/api/projects/:code/costs/total', url.pathname)) && req.method === 'GET') {
    const db = await getDb(mm.code);
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const all = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS c FROM agent_run`).get().c;
    const last7 = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS c FROM agent_run WHERE ended_at >= ?`).get(d7).c;
    const last30 = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS c FROM agent_run WHERE ended_at >= ?`).get(d30).c;
    const uncosted = db.prepare(`SELECT COUNT(*) AS n FROM agent_run WHERE cost_version = 0 AND ended_at IS NOT NULL`).get().n;
    return json(res, 200, { all_time: all, last_7d: last7, last_30d: last30, uncosted_runs: uncosted });
  }

  return null;
}
