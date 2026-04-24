import { json, readJson, matchRoute } from './http-util.mjs';
import { getActiveDb } from './project-registry.mjs';
import {
  listTasks, getTask, getTaskByCode, createTask, transitionTask, retryFromWorker,
  listComments, listRuns, addComment, enqueueRun,
  finishRun,
} from './repo.mjs';
import { isoNow } from './time.mjs';

const KILL_GRACE_MS = 5000;
const MIN_REJECT_COMMENT = 10;
const VALID_DISPATCH_ROLES = ['pm', 'worker', 'reviewer'];
const RECENT_RUNS_LIMIT = 5;

/** Resolve a task by either ULID id or project-scoped code. */
function resolveTask(db, idOrCode) {
  return getTask(db, idOrCode) || getTaskByCode(db, idOrCode);
}

/** Best-effort kill: SIGTERM now, SIGKILL after grace. */
function killProcess(pid, graceMs = KILL_GRACE_MS) {
  if (!pid) return;
  try { process.kill(pid, 'SIGTERM'); } catch {}
  setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch {} }, graceMs).unref?.();
}

// ─────────── handlers for /api/tasks/:id/* routes ───────────

async function handleGetTask(_req, res, _url, _active, task, db) {
  return json(res, 200, {
    task,
    comments: listComments(db, task.id),
    runs: listRuns(db, task.id, RECENT_RUNS_LIMIT),
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

async function handleDispatch(req, res, _url, _active, task, db) {
  const body = await readJson(req);
  const role = body?.role;
  if (!VALID_DISPATCH_ROLES.includes(role)) {
    return json(res, 400, { error: 'role must be pm|worker|reviewer' });
  }
  const dup = db.prepare(`
    SELECT 1 FROM agent_run WHERE task_id=? AND role=? AND status IN ('queued','running') LIMIT 1
  `).get(task.id, role);
  if (dup) return json(res, 409, { error: 'run already queued/running for this role' });
  const runId = enqueueRun(db, task.id, role);
  return json(res, 201, { runId });
}

async function handleCancelRun(_req, res, _url, _active, task, db) {
  const running = db.prepare(`
    SELECT * FROM agent_run WHERE task_id=? AND status='running' ORDER BY started_at DESC LIMIT 1
  `).get(task.id);
  if (!running) return json(res, 404, { error: 'no running run' });
  finishRun(db, running.id, 'cancelled', 'cancelled by user', null);
  killProcess(running.pid);
  return json(res, 200, { ok: true, runId: running.id });
}

async function handleRetryFromWorker(_req, res, _url, _active, task, db) {
  const out = retryFromWorker(db, task.id);
  if (!out.ok) return json(res, out.status || 400, out);
  return json(res, 200, out);
}

async function handleDeleteTask(_req, res, _url, _active, task, db) {
  const running = db.prepare(`SELECT * FROM agent_run WHERE task_id=? AND status='running'`).all(task.id);
  for (const r of running) {
    finishRun(db, r.id, 'cancelled', 'task deleted', null);
    killProcess(r.pid);
  }
  db.prepare(`
    UPDATE agent_run SET status='cancelled', error='task deleted', ended_at=?
    WHERE task_id=? AND status='queued'
  `).run(isoNow(), task.id);
  db.prepare(`
    UPDATE task SET deleted_at=?, version=version+1, updated_at=? WHERE id=?
  `).run(isoNow(), isoNow(), task.id);
  return json(res, 200, { ok: true, cancelled_runs: running.length });
}

async function handleTaskCost(_req, res, _url, _active, task, db) {
  const row = db.prepare(`
    SELECT SUM(input_tokens)AS input, SUM(output_tokens)AS output,
           SUM(cache_creation_tokens)AS cache_creation, SUM(cache_read_tokens)AS cache_read,
           SUM(cost_usd)AS cost_usd, COUNT(*)AS run_count
    FROM agent_run WHERE task_id=?
  `).get(task.id);
  const by_role = db.prepare(`
    SELECT role, SUM(cost_usd) AS cost_usd FROM agent_run WHERE task_id=? GROUP BY role
  `).all(task.id);
  return json(res, 200, { ...row, by_role });
}

// route pattern → { method: handler }
const TASK_ROUTES = [
  ['/api/tasks/:id',                   { GET: handleGetTask, DELETE: handleDeleteTask }],
  ['/api/tasks/:id/transition',        { POST: handleTransition }],
  ['/api/tasks/:id/dispatch',          { POST: handleDispatch }],
  ['/api/tasks/:id/cancel-run',        { POST: handleCancelRun }],
  ['/api/tasks/:id/retry-from-worker', { POST: handleRetryFromWorker }],
  ['/api/tasks/:id/cost',              { GET: handleTaskCost }],
];

export async function handleTasks(req, res, url) {
  const active = await getActiveDb();
  if (!active) return json(res, 400, { error: 'no active project' });
  const { db } = active;
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/tasks' && m === 'GET') {
    const search = url.searchParams.get('search') || '';
    return json(res, 200, { tasks: listTasks(db, { search }) });
  }

  if (p === '/api/tasks' && m === 'POST') {
    const body = await readJson(req);
    const title = (body?.title || '').trim();
    if (!title) return json(res, 400, { error: 'title required' });
    const out = createTask(db, { title, description: body?.description ?? '' });
    return json(res, 201, out);
  }

  for (const [pattern, methodMap] of TASK_ROUTES) {
    const mm = matchRoute(pattern, p);
    if (!mm) continue;
    const handler = methodMap[m];
    if (!handler) continue;
    const task = resolveTask(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
    return handler(req, res, url, active, task, db);
  }

  return null;
}
