import { json, readJson, matchRoute } from './http-util.mjs';
import { getActiveDb, getDb } from './project-registry.mjs';
import {
  listTasks, getTask, getTaskByCode, createTask, transitionTask,
  listComments, listFilePaths, addFilePath, deleteFilePath, addComment, getProject,
  listRunsForTask, enqueueRun,
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
    agent_runs: listRunsForTask(db, task.id),
  });
}

async function handleTransition(req, res, _url, active, task, db) {
  const body = await readJson(req);
  const { to_status, to_assignee, reject_comment } = body || {};
  // Security: REST /transition is strictly the Human path. Ignore any
  // body-supplied `by_role` — agents transition via the HTTP MCP endpoint.
  const by_role = 'human';
  // Only require reject_comment if reassigning from reviewer→worker (i.e., rejecting work).
  // For initial Todo→Agent Working assignment, no comment needed.
  if (to_assignee === 'worker' && task.status !== 'todo') {
    if (!reject_comment || reject_comment.trim().length < MIN_REJECT_COMMENT) {
      return json(res, 400, { error: `reject_comment must be ≥ ${MIN_REJECT_COMMENT} chars` });
    }
    addComment(db, task.id, 'human', reject_comment.trim());
  } else if (reject_comment) {
    // If provided for other scenarios, still record it as a comment
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

const RUN_AGENT_ROLES = new Set(['pm', 'worker', 'reviewer']);

async function handleRunAgent(req, res, _url, _active, task, db) {
  const body = await readJson(req);
  const role = (body?.role || '').trim();
  if (!RUN_AGENT_ROLES.has(role)) {
    return json(res, 400, { error: `role must be one of ${[...RUN_AGENT_ROLES].join(', ')}` });
  }
  const project = getProject(db);
  // Validate agent_provider if set, allow both 'claude' and 'github_copilot'
  if (project?.agent_provider && !['claude', 'github_copilot'].includes(project.agent_provider)) {
    return json(res, 400, { error: `agent_provider=${project.agent_provider} invalid` });
  }
  // Validate executor_override if provided (optional, task-level executor selection)
  const executor_override = body?.executor_override;
  if (executor_override && !['claude', 'github_copilot'].includes(executor_override)) {
    return json(res, 400, { error: `executor_override must be 'claude' or 'github_copilot'` });
  }
  // Block if a run is already queued or running for this task — avoid
  // double-spawn races. User can cancel-then-rerun if needed.
  const active = db.prepare(
    `SELECT id, role, status FROM agent_run WHERE task_id=? AND status IN ('queued','running') LIMIT 1`
  ).get(task.id);
  if (active) {
    return json(res, 409, { error: `run ${active.id} already ${active.status} (${active.role})` });
  }
  
  // Update task.agent_provider_override BEFORE enqueueRun to ensure executor reads correct value
  // Must happen atomically to prevent drain loop race (executor sees old value)
  if (executor_override) {
    db.prepare(`UPDATE task SET agent_provider_override=?, version=version+1, updated_at=? WHERE id=?`)
      .run(executor_override, isoNow(), task.id);
  }
  
  const runId = enqueueRun(db, task.id, role);
  addComment(db, task.id, 'human', `RUN_AGENT: manually dispatched ${role} (run ${runId})${executor_override ? ` [executor: ${executor_override}]` : ''}`);
  return json(res, 201, { run_id: runId, role });
}

async function handleDeleteTask(_req, res, _url, _active, task, db) {
  db.prepare(`
    UPDATE task SET deleted_at=?, version=version+1, updated_at=? WHERE id=?
  `).run(isoNow(), isoNow(), task.id);
  return json(res, 200, { ok: true });
}

async function handleAddComment(req, res, _url, _active, task, db) {
  const body = await readJson(req);
  const text = (body?.body || '').trim();
  if (!text) return json(res, 400, { error: 'body required' });
  if (text.length > 4000) return json(res, 400, { error: 'body too long (max 4000)' });
  const comment = addComment(db, task.id, 'human', text);
  return json(res, 201, { comment });
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

async function handleTaskCost(_req, res, _url, _active, task, db) {
  const row = db.prepare(`
    SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count
    FROM agent_run WHERE task_id=?
  `).get(task.id);
  const by_role = db.prepare(`
    SELECT role, SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count FROM agent_run WHERE task_id=? GROUP BY role
  `).all(task.id);
  return json(res, 200, { ...row, by_role });
}

async function handleBoardCost(_req, res, _url, _active, _task, db) {
  const row = db.prepare(`
    SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count
    FROM agent_run WHERE task_id IN (SELECT id FROM task WHERE deleted_at IS NULL)
  `).get();
  const by_role = db.prepare(`
    SELECT role, SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count FROM agent_run 
    WHERE task_id IN (SELECT id FROM task WHERE deleted_at IS NULL) GROUP BY role
  `).all();
  const by_status = db.prepare(`
    SELECT status, SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count FROM agent_run
    WHERE task_id IN (SELECT id FROM task WHERE deleted_at IS NULL) GROUP BY status
  `).all();
  return json(res, 200, { ...row, by_role, by_status });
}

// route pattern → { method: handler }
const TASK_ROUTES = [
  ['/api/tasks/:id',                          { GET: handleGetTask, DELETE: handleDeleteTask }],
  ['/api/tasks/:id/transition',               { POST: handleTransition }],
  ['/api/tasks/:id/dispatch',                 { POST: handleDispatch }],
  ['/api/tasks/:id/retry-from-worker',        { POST: handleRetryFromWorker }],
  ['/api/tasks/:id/run-agent',                { POST: handleRunAgent }],
  ['/api/tasks/:id/comments',                 { POST: handleAddComment }],
  ['/api/tasks/:id/cost',                     { GET: handleTaskCost }],
  ['/api/tasks/:id/file-paths',               { POST: handleAddFilePath }],
  ['/api/tasks/:id/file-paths/:fpId',         { DELETE: handleDeleteFilePath }],
  ['/api/board/cost',                         { GET: handleBoardCost }],
];

/**
 * Per-tab multi-project support: accept both legacy `/api/tasks/...` (uses the
 * global active project) and project-scoped `/api/projects/:code/tasks/...`
 * (explicit, per-tab). Project-scoped routes let the UI open multiple tabs
 * on different projects without racing the active pointer.
 */
async function resolveScope(url) {
  const p = url.pathname;
  const m = /^\/api\/projects\/([A-Za-z0-9]{2,7})(\/tasks(?:\/.*)?|\/board.*)?$/.exec(p);
  if (m) {
    const code = m[1];
    const rest = m[2] || '';
    if (!rest.startsWith('/tasks') && !rest.startsWith('/board')) return { handled: false };
    try {
      const db = await getDb(code);
      return { handled: true, active: { code, db }, db, taskPath: '/api' + rest };
    } catch {
      return { handled: true, notFound: true };
    }
  }
  if (p === '/api/tasks' || p.startsWith('/api/tasks/') || p === '/api/board/cost') {
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

  if (taskPath === '/api/board/cost' && m === 'GET') {
    return handleBoardCost(null, res, url, active, null, db);
  }

  if (taskPath === '/api/tasks' && m === 'GET') {
    const search = url.searchParams.get('search') || '';
    return json(res, 200, { tasks: listTasks(db, { search }) });
  }

  if (taskPath === '/api/tasks' && m === 'POST') {
    const body = await readJson(req);
    const title = (body?.title || '').trim();
    if (!title) return json(res, 400, { error: 'title required' });
    const out = createTask(db, { 
      title, 
      description: body?.description ?? '',
      assignee_role: body?.assignee_role ?? null
    });
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
