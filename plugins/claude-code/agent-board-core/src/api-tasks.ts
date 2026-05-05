import type { IncomingMessage, ServerResponse } from 'node:http';

import type { DbHandle } from './db.ts';
import { json, readJson, matchRoute } from './http-util.ts';
import type { ProjectDb } from './project-registry.ts';
import { getActiveDb, getDb } from './project-registry.ts';
import {
  listTasks,
  getTask,
  getTaskByCode,
  createTask,
  transitionTask,
  listComments,
  listFilePaths,
  addFilePath,
  deleteFilePath,
  addComment,
  getProject,
  listRunsForTask,
  enqueueRun,
} from './repo.ts';
import type { TaskRow } from './repo.ts';
import { isoNow } from './time.ts';
import type { AssigneeRole, RunRole, TaskStatus } from './types.ts';

const MIN_REJECT_COMMENT = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function resolveTask(db: DbHandle, idOrCode: string): TaskRow | undefined {
  return getTask(db, idOrCode) ?? getTaskByCode(db, idOrCode);
}

// ── Task sub-route handlers ──────────────────────────────────────────────────

type TaskHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
) => Promise<boolean | null | undefined>;

function handleGetTask(
  _req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  _active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
): void {
  json(res, 200, {
    task,
    project: getProject(db),
    comments: listComments(db, task.id),
    file_paths: listFilePaths(db, task.id),
    agent_runs: listRunsForTask(db, task.id),
  });
}

async function handleTransition(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
): Promise<boolean | null | undefined> {
  const body = await readJson(req);
  const { to_status, to_assignee, reject_comment } = isRecord(body) ? body : {};
  const by_role = 'human' as const;
  if (to_assignee === 'worker' && task.status !== 'todo') {
    if (typeof reject_comment !== 'string' || reject_comment.trim().length < MIN_REJECT_COMMENT) {
      json(res, 400, { error: `reject_comment must be ≥ ${MIN_REJECT_COMMENT} chars` });
      return;
    }
    addComment(db, task.id, 'human', reject_comment.trim());
  } else if (typeof reject_comment === 'string' && reject_comment.trim()) {
    addComment(db, task.id, 'human', reject_comment.trim());
  }
  const project = active.db
    .prepare(`SELECT workflow_type, version FROM project WHERE id=?`)
    .get(task.project_id) as { workflow_type: string; version: number } | undefined;
  const out = transitionTask(db, {
    task_id: task.id,
    to_status: (typeof to_status === 'string' ? to_status : task.status) as TaskStatus,
    to_assignee: typeof to_assignee === 'string' ? (to_assignee as AssigneeRole) : null,
    by_role,
    expected_version: task.version,
    workflow_type: (project?.workflow_type ?? 'WF1') as 'WF1' | 'WF2',
  });
  if (!out.ok) {
    json(res, out.status, { error: out.reason });
    return;
  }
  json(res, 200, out);
  return true;
}

function handleDispatch(_req: IncomingMessage, res: ServerResponse): undefined {
  json(res, 410, { error: 'agent dispatch disabled in simplified mode' });
}

function handleRetryFromWorker(_req: IncomingMessage, res: ServerResponse): undefined {
  json(res, 410, { error: 'agent dispatch disabled in simplified mode' });
}

const RUN_AGENT_ROLES = new Set<string>(['pm', 'worker', 'reviewer']);

async function handleRunAgent(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  _active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
): Promise<boolean | null | undefined> {
  const body = await readJson(req);
  const rawBody = isRecord(body) ? body : {};
  const role = (typeof rawBody.role === 'string' ? rawBody.role : '').trim();
  if (!RUN_AGENT_ROLES.has(role)) {
    json(res, 400, { error: `role must be one of ${[...RUN_AGENT_ROLES].join(', ')}` });
    return;
  }
  const project = getProject(db);
  const executor_override =
    typeof rawBody.executor_override === 'string' ? rawBody.executor_override : null;

  if (project !== undefined && executor_override !== null) {
    db.prepare(`UPDATE project SET executor_override=?, updated_at=? WHERE id=?`).run(
      executor_override,
      isoNow(),
      (project as unknown as { id: string }).id,
    );
  }

  const runId = enqueueRun(db, task.id, role as RunRole);
  addComment(
    db,
    task.id,
    'human',
    `RUN_AGENT: manually dispatched ${role} (run ${runId})${executor_override !== null ? ` [executor: ${executor_override}]` : ''}`,
  );
  json(res, 201, { run_id: runId, role });
  return true;
}

function handleDeleteTask(
  _req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  _active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
): void {
  db.prepare(`UPDATE task SET deleted_at=?, version=version+1, updated_at=? WHERE id=?`).run(
    isoNow(),
    isoNow(),
    task.id,
  );
  json(res, 200, { ok: true });
}

async function handleAddComment(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  _active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
): Promise<boolean | null | undefined> {
  const body = await readJson(req);
  const rawBody = isRecord(body) ? body : {};
  const text = (typeof rawBody.body === 'string' ? rawBody.body : '').trim();
  if (!text) {
    json(res, 400, { error: 'body required' });
    return;
  }
  if (text.length > 4000) {
    json(res, 400, { error: 'body too long (max 4000)' });
    return;
  }
  const comment = addComment(db, task.id, 'human', text);
  json(res, 201, { comment });
  return true;
}

async function handleAddFilePath(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  _active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
): Promise<boolean | null | undefined> {
  const body = await readJson(req);
  const rawBody = isRecord(body) ? body : {};
  const file_path = (typeof rawBody.file_path === 'string' ? rawBody.file_path : '').trim();
  if (!file_path) {
    json(res, 400, { error: 'file_path required' });
    return;
  }
  const label = typeof rawBody.label === 'string' ? rawBody.label : null;
  const fp = addFilePath(db, task.id, file_path, label);
  json(res, 201, { file_path: fp });
  return true;
}

function handleDeleteFilePath(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _active: ProjectDb,
  _task: TaskRow,
  db: DbHandle,
): void {
  const parts = url.pathname.split('/');
  const fpId = parts[parts.length - 1] ?? '';
  const ok = deleteFilePath(db, fpId);
  if (!ok) {
    json(res, 404, { error: 'not found' });
    return;
  }
  json(res, 200, { ok: true });
}

function handleTaskCost(
  _req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  _active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
): void {
  const row = db
    .prepare(
      `
    SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count
    FROM agent_run WHERE task_id=?
  `,
    )
    .get(task.id);
  const by_role = db
    .prepare(
      `
    SELECT role, SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count FROM agent_run
    WHERE task_id=? GROUP BY role
  `,
    )
    .all(task.id);
  json(res, 200, { ...(row as object), by_role });
}

function handleBoardCost(
  _req: IncomingMessage | null,
  res: ServerResponse,
  _url: URL,
  _active: ProjectDb | null,
  _task: TaskRow | null,
  db: DbHandle,
): void {
  const row = db
    .prepare(
      `
    SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
           SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count
    FROM agent_run
    WHERE task_id IN (SELECT id FROM task WHERE deleted_at IS NULL)
  `,
    )
    .get();
  const by_role = db
    .prepare(
      `
    SELECT role, SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count FROM agent_run
    WHERE task_id IN (SELECT id FROM task WHERE deleted_at IS NULL) GROUP BY role
  `,
    )
    .all();
  const by_status = db
    .prepare(
      `
    SELECT status, SUM(cost_usd) AS cost_usd, COUNT(*) AS run_count FROM agent_run
    WHERE task_id IN (SELECT id FROM task WHERE deleted_at IS NULL) GROUP BY status
  `,
    )
    .all();
  json(res, 200, { ...(row as object), by_role, by_status });
}

// ── Route table ──────────────────────────────────────────────────────────────

type MethodMap = Partial<Record<string, TaskHandler>>;

const TASK_ROUTES: [string, MethodMap][] = [
  [
    '/api/tasks/:id',
    { GET: handleGetTask as TaskHandler, DELETE: handleDeleteTask as TaskHandler },
  ],
  ['/api/tasks/:id/transition', { POST: handleTransition }],
  ['/api/tasks/:id/dispatch', { POST: handleDispatch as unknown as TaskHandler }],
  ['/api/tasks/:id/retry-from-worker', { POST: handleRetryFromWorker as unknown as TaskHandler }],
  ['/api/tasks/:id/run-agent', { POST: handleRunAgent }],
  ['/api/tasks/:id/comments', { POST: handleAddComment }],
  ['/api/tasks/:id/cost', { GET: handleTaskCost as TaskHandler }],
  ['/api/tasks/:id/file-paths', { POST: handleAddFilePath }],
  ['/api/tasks/:id/file-paths/:fpId', { DELETE: handleDeleteFilePath as TaskHandler }],
  ['/api/board/cost', { GET: handleBoardCost as TaskHandler }],
];

// ── Scope resolution ─────────────────────────────────────────────────────────

type Scope =
  | { state: 'ok'; active: ProjectDb; db: DbHandle; taskPath: string }
  | { state: 'notFound' }
  | { state: 'noActive' }
  | { state: 'unhandled' };

async function resolveScope(url: URL): Promise<Scope> {
  const p = url.pathname;
  const match = /^\/api\/projects\/([A-Za-z0-9]{2,7})(\/tasks(?:\/.*)?|\/board.*)?$/.exec(p);
  if (match) {
    const code = String(match[1]);
    const rest = match[2] ?? '';
    if (!rest.startsWith('/tasks') && !rest.startsWith('/board')) return { state: 'unhandled' };
    try {
      const db = await getDb(code);
      return { state: 'ok', active: { code, db }, db, taskPath: '/api' + rest };
    } catch {
      return { state: 'notFound' };
    }
  }
  if (p === '/api/tasks' || p.startsWith('/api/tasks/') || p === '/api/board/cost') {
    const active = await getActiveDb();
    if (!active) return { state: 'noActive' };
    return { state: 'ok', active, db: active.db, taskPath: p };
  }
  return { state: 'unhandled' };
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function handleTasks(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean | null | undefined> {
  const scope = await resolveScope(url);
  if (scope.state === 'unhandled') return null;
  if (scope.state === 'notFound') {
    json(res, 404, { error: 'no such project' });
    return;
  }
  if (scope.state === 'noActive') {
    json(res, 400, { error: 'no active project' });
    return;
  }

  const { active, db, taskPath } = scope;
  const m = req.method ?? '';

  if (taskPath === '/api/board/cost' && m === 'GET') {
    handleBoardCost(null, res, url, null, null, db);
    return true;
  }

  if (taskPath === '/api/tasks' && m === 'GET') {
    const search = url.searchParams.get('search') ?? '';
    json(res, 200, { tasks: listTasks(db, { search }) });
    return true;
  }

  if (taskPath === '/api/tasks' && m === 'POST') {
    const body = await readJson(req);
    const rawBody = isRecord(body) ? body : {};
    const title = (typeof rawBody.title === 'string' ? rawBody.title : '').trim();
    if (!title) {
      json(res, 400, { error: 'title required' });
      return;
    }
    const task = createTask(db, {
      title,
      ...(typeof rawBody.description === 'string' ? { description: rawBody.description } : {}),
    });
    json(res, 201, { task });
    return true;
  }

  for (const [pattern, methodMap] of TASK_ROUTES) {
    const mm = matchRoute(pattern, taskPath);
    if (!mm) continue;
    const handler = methodMap[m];
    if (!handler) continue;
    const task = resolveTask(db, mm.id ?? '');
    if (!task) {
      json(res, 404, { error: 'not found' });
      return;
    }
    return handler(req, res, url, active, task, db);
  }

  return null;
}
