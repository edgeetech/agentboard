// REST API routes for tracker config management.
// GET/POST /api/projects/{code}/tracker
// POST /api/projects/{code}/tracker/enable|disable|sync
// GET /api/projects/{code}/tracker/issues

import { json, readJson } from './http-util.mjs';
import { ulid } from './ulid.mjs';
import { isoNow } from './time.mjs';
import { getDb } from './project-registry.mjs';
import { getProject } from './repo.mjs';

export async function handleTracker(req, res, url) {
  const m = url.pathname.match(/^\/api\/projects\/([^/]+)\/tracker(\/[a-z]+)?$/);
  if (!m) return null;

  const [, code, sub] = m;
  const db = await getDb(code);
  if (!db) return json(res, 404, { error: 'project not found' });
  const project = getProject(db);
  if (!project) return json(res, 404, { error: 'project not found' });

  // GET /api/projects/{code}/tracker
  if (req.method === 'GET' && !sub) {
    const cfg = getConfig(db);
    return json(res, 200, { tracker: cfg ?? null });
  }

  // POST /api/projects/{code}/tracker — set config
  if (req.method === 'POST' && !sub) {
    const body = await readJson(req);
    if (!body?.kind || !body?.api_key_env_var || !body?.project_slug) {
      return json(res, 400, { error: 'kind, api_key_env_var, project_slug required' });
    }
    if (!['linear', 'github', 'gitlab'].includes(body.kind)) {
      return json(res, 400, { error: 'kind must be linear|github|gitlab' });
    }
    const now = isoNow();
    const existing = getConfig(db);
    if (existing) {
      db.prepare(`
        UPDATE tracker_config SET kind=?, endpoint=?, api_key_env_var=?, project_slug=?,
          active_states=?, terminal_states=?, assignee=?, poll_interval_ms=?, updated_at=?
        WHERE project_id=?
      `).run(body.kind, body.endpoint ?? null, body.api_key_env_var, body.project_slug,
             JSON.stringify(body.active_states ?? ['Todo','In Progress']),
             JSON.stringify(body.terminal_states ?? ['Done','Cancelled','Canceled','Duplicate']),
             body.assignee ?? null, body.poll_interval_ms ?? 30000, now, project.id);
    } else {
      db.prepare(`
        INSERT INTO tracker_config(id, project_id, kind, endpoint, api_key_env_var, project_slug,
          active_states, terminal_states, assignee, poll_interval_ms, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(ulid(), project.id, body.kind, body.endpoint ?? null, body.api_key_env_var,
             body.project_slug,
             JSON.stringify(body.active_states ?? ['Todo','In Progress']),
             JSON.stringify(body.terminal_states ?? ['Done','Cancelled','Canceled','Duplicate']),
             body.assignee ?? null, body.poll_interval_ms ?? 30000, now, now);
    }
    return json(res, 200, { tracker: getConfig(db) });
  }

  // POST /api/projects/{code}/tracker/enable
  if (req.method === 'POST' && sub === '/enable') {
    const cfg = getConfig(db);
    if (!cfg) return json(res, 404, { error: 'no tracker configured' });
    db.prepare(`UPDATE tracker_config SET enabled=1, updated_at=? WHERE project_id=?`)
      .run(isoNow(), project.id);
    return json(res, 200, { enabled: true });
  }

  // POST /api/projects/{code}/tracker/disable
  if (req.method === 'POST' && sub === '/disable') {
    const cfg = getConfig(db);
    if (!cfg) return json(res, 404, { error: 'no tracker configured' });
    db.prepare(`UPDATE tracker_config SET enabled=0, updated_at=? WHERE project_id=?`)
      .run(isoNow(), project.id);
    const updated = getConfig(db);
    return json(res, 200, { enabled: updated.enabled });
  }

  // POST /api/projects/{code}/tracker/sync — force immediate poll
  if (req.method === 'POST' && sub === '/sync') {
    const cfg = getConfig(db);
    if (!cfg) return json(res, 404, { error: 'no tracker configured' });
    // Import dynamically to avoid circular deps at startup
    const { createTracker } = await import('./trackers/index.mjs');
    try {
      const tracker = createTracker(cfg);
      const issues = await tracker.fetchCandidateIssues();
      return json(res, 200, { ok: true, issues_fetched: issues.length });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // GET /api/projects/{code}/tracker/issues
  if (req.method === 'GET' && sub === '/issues') {
    const issues = getTrackerIssues(db);
    return json(res, 200, { issues });
  }

  return null;
}

function getConfig(db) {
  try { return db.prepare(`SELECT * FROM tracker_config LIMIT 1`).get(); } catch { return null; }
}

function getTrackerIssues(db) {
  try {
    return db.prepare(`
      SELECT ti.*, t.code AS task_code, t.status AS task_status
      FROM tracker_issue ti
      LEFT JOIN task t ON t.id = ti.task_id
      ORDER BY ti.created_at DESC
      LIMIT 100
    `).all();
  } catch { return []; }
}
