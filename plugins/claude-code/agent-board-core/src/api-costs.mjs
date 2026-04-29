import { json, matchRoute } from './http-util.mjs';
import { getDb } from './project-registry.mjs';

export async function handleCosts(req, res, url) {
  let mm;

  if ((mm = matchRoute('/api/projects/:code/costs', url.pathname)) && req.method === 'GET') {
    try {
      const db = await getDb(mm.code);
      const rows = db.prepare(`
        SELECT 
          ar.id, ar.role, ar.status, ar.model, ar.cost_usd, ar.ended_at,
          t.code AS task_code
        FROM agent_run ar
        JOIN task t ON ar.task_id = t.id
        WHERE t.deleted_at IS NULL
        ORDER BY ar.ended_at DESC
        LIMIT 100
      `).all();
      return json(res, 200, { rows });
    } catch {
      return json(res, 400, { error: 'project not found' });
    }
  }

  if ((mm = matchRoute('/api/projects/:code/costs/total', url.pathname)) && req.method === 'GET') {
    try {
      const db = await getDb(mm.code);
      const now = new Date();
      const last7d = new Date(now - 7 * 24 * 3600_000).toISOString();
      const last30d = new Date(now - 30 * 24 * 3600_000).toISOString();
      
      const all_time_row = db.prepare(`
        SELECT SUM(cost_usd) AS total FROM agent_run 
        WHERE task_id IN (SELECT id FROM task WHERE deleted_at IS NULL)
      `).get();
      
      const last7d_row = db.prepare(`
        SELECT SUM(cost_usd) AS total FROM agent_run 
        WHERE ended_at >= ? AND task_id IN (SELECT id FROM task WHERE deleted_at IS NULL)
      `).get(last7d);
      
      const last30d_row = db.prepare(`
        SELECT SUM(cost_usd) AS total FROM agent_run 
        WHERE ended_at >= ? AND task_id IN (SELECT id FROM task WHERE deleted_at IS NULL)
      `).get(last30d);
      
      const uncosted = db.prepare(`
        SELECT COUNT(*) AS count FROM agent_run 
        WHERE status IN ('succeeded', 'failed', 'blocked') AND cost_version = 0
        AND task_id IN (SELECT id FROM task WHERE deleted_at IS NULL)
      `).get();
      
      return json(res, 200, {
        all_time: all_time_row?.total ?? 0,
        last_7d: last7d_row?.total ?? 0,
        last_30d: last30d_row?.total ?? 0,
        uncosted_runs: uncosted?.count ?? 0,
      });
    } catch {
      return json(res, 400, { error: 'project not found' });
    }
  }

  return null;
}
