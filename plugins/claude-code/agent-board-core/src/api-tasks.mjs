import { json, readJson, matchRoute } from './http-util.mjs';
import { getActiveDb, getDb } from './project-registry.mjs';
import {
  listTasks, getTask, getTaskByCode, createTask, transitionTask,
  listComments, listFilePaths, addFilePath, deleteFilePath, addComment, getProject,
} from './repo.mjs';
import { isoNow } from './time.mjs';

const MIN_REJECT_COMMENT = 10;

/** Resolve a task by either ULID id or project-scoped code. */
function resolveTask(db, idOrCode) {
  return getTask(db, idOrCode) || getTaskByCode(db, idOrCode);
}

// ─────────── handlers for /api/tasks/:id/* routes ───────────

async function handleGetTask(_req, res, _url, _active, task, db) {
  return json(res, 200, {
    task,
    project: getProject(db),
    comments: listComments(db, task.id),
    file_paths: listFilePaths(db, task.id),
  });
}

async function handleTransition(req, res, _url, active, task, db) {
  const body = await readJson(req);
  const { to_status, to_assignee, reject_comment } = body || {};
  // Security: REST /transition is strictly the Human path. Ignore any
  // body-supplied `by_role` — agents transition via the HTTP MCP endpoint.
  const by_role = 'human';
  if (to_assignee === 'worker') {
    if (!reject_comment || reject_comment.trim().length < MIN_REJECT_COMMENT) {
      return json(res, 400, { error: `reject_comment must be ≥ ${MIN_REJECT_COMMENT} chars` });
    }
    addComment(db, task.id, 'human', reject_comment.trim());
  }
  const project = active.db.prepare(`SELECT workflow_type, version FROM project WHERE id=?`).get(task.project_id);
  const out = transitionTask(db, {
    task_id: task.id,
    to_status,
    to_assignee,
    by_role,
    expected_version: task.version,
    workflow_type: project.workflow_type,
  });
  if (!out.ok) return json(res, out.status || 400, { error: out.reason });
  return json(res, 200, out);
}

async function handleDispatch(_req, res) {
  return json(res, 410, { error: 'agent dispatch disabled in simplified mode' });
}

async function handleRetryFromWorker(_req, res) {
  return json(res, 410, { error: 'agent dispatch disabled in simplified mode' });
}

async function handleDeleteTask(_req, res, _url, _active, task, db) {
  db.prepare(`
    UPDATE task SET deleted_at=?, version=version+1, updated_at=? WHERE id=?
  `).run(isoNow(), isoNow(), task.id);
  return json(res, 200, { ok: true });
}

async function handleAddFilePath(req, res, _url, _active, task, db) {
  const body = await readJson(req);
  const file_path = (body?.file_path || '').trim();
  if (!file_path) return json(res, 400, { error: 'file_path required' });
  const fp = addFilePath(db, task.id, file_path, body?.label ?? null);
  return json(res, 201, { file_path: fp });
}

async function handleDeleteFilePath(req, res, url, _active, task, db) {
  const fpId = url.pathname.split('/').pop();
  const deleted = deleteFilePath(db, fpId);
  if (!deleted) return json(res, 404, { error: 'not found' });
  return json(res, 200, { ok: true });
}

// route pattern → { method: handler }
const TASK_ROUTES = [
  ['/api/tasks/:id',                          { GET: handleGetTask, DELETE: handleDeleteTask }],
  ['/api/tasks/:id/transition',               { POST: handleTransition }],
  ['/api/tasks/:id/dispatch',                 { POST: handleDispatch }],
  ['/api/tasks/:id/retry-from-worker',        { POST: handleRetryFromWorker }],
  ['/api/tasks/:id/file-paths',               { POST: handleAddFilePath }],
  ['/api/tasks/:id/file-paths/:fpId',         { DELETE: handleDeleteFilePath }],
];

/**
 * Per-tab multi-project support: accept both legacy `/api/tasks/...` (uses the
 * global active project) and project-scoped `/api/projects/:code/tasks/...`
 * (explicit, per-tab). Project-scoped routes let the UI open multiple tabs
 * on different projects without racing the active pointer.
 */
async function resolveScope(url) {
  const p = url.pathname;
  const m = /^\/api\/projects\/([A-Za-z0-9]{2,7})(\/tasks(?:\/.*)?|\/tasks)?$/.exec(p);
  if (m) {
    const code = m[1];
    const rest = m[2] || '';
    if (!rest.startsWith('/tasks')) return { handled: false };
    try {
      const db = await getDb(code);
      return { handled: true, active: { code, db }, db, taskPath: '/api' + rest };
    } catch {
      return { handled: true, notFound: true };
    }
  }
  if (p === '/api/tasks' || p.startsWith('/api/tasks/')) {
    const active = await getActiveDb();
    if (!active) return { handled: true, noActive: true };
    return { handled: true, active, db: active.db, taskPath: p };
  }
  return { handled: false };
}

export async function handleTasks(req, res, url) {
  const scope = await resolveScope(url);
  if (!scope.handled) return null;
  if (scope.notFound) return json(res, 404, { error: 'no such project' });
  if (scope.noActive) return json(res, 400, { error: 'no active project' });
  const { active, db, taskPath } = scope;
  const m = req.method;

  if (taskPath === '/api/tasks' && m === 'GET') {
    const search = url.searchParams.get('search') || '';
    return json(res, 200, { tasks: listTasks(db, { search }) });
  }

  if (taskPath === '/api/tasks' && m === 'POST') {
    const body = await readJson(req);
    const title = (body?.title || '').trim();
    if (!title) return json(res, 400, { error: 'title required' });
    const out = createTask(db, { title, description: body?.description ?? '' });
    return json(res, 201, out);
  }

  for (const [pattern, methodMap] of TASK_ROUTES) {
    const mm = matchRoute(pattern, taskPath);
    if (!mm) continue;
    const handler = methodMap[m];
    if (!handler) continue;
    const task = resolveTask(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
    return handler(req, res, url, active, task, db);
  }

  return null;
}
