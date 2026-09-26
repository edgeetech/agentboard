import type { IncomingMessage, ServerResponse } from 'node:http';

import { parseAgentConfig, resolveRoleConfig } from './agent-config.ts';
import type { DbHandle } from './db.ts';
import { cancelRun } from './executor.ts';
import { json, readJson, matchRoute } from './http-util.ts';
import { isEstimatedCost } from './pricing.ts';
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
import type { AgentProvider, AssigneeRole, RunRole, TaskStatus } from './types.ts';
import { AGENT_PROVIDERS, isAgentProvider } from './types.ts';

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
    agent_runs: listRunsForTask(db, task.id).map((run) => ({
      ...run,
      cost_is_estimate: isEstimatedCost(run.auth_source),
    })),
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
  const trimmedRejectComment = typeof reject_comment === 'string' ? reject_comment.trim() : '';
  const isReject = to_assignee === 'worker' && task.status !== 'todo';
  if (isReject && trimmedRejectComment.length < MIN_REJECT_COMMENT) {
    json(res, 400, { error: `reject_comment must be ≥ ${MIN_REJECT_COMMENT} chars` });
    return;
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
  // Only persist the reject/informational comment once the transition itself
  // has actually succeeded — previously this was written BEFORE calling
  // transitionTask and kept even when the transition failed (CAS conflict,
  // disallowed transition, …), leaving an orphaned comment with no matching
  // status change.
  if (isReject || trimmedRejectComment) {
    addComment(db, task.id, 'human', trimmedRejectComment);
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
  // NOTE: a legacy `executor_override` request field used to write straight
  // to `project.executor_override` — a column that has never existed in
  // db/schema.sql, so any caller sending it got a 500 ("no such column").
  // Provider selection is `provider` (one-shot, below) / `use_council` /
  // task.agent_config_json / project.agent_provider — this dead field is
  // removed rather than backed by a new column.

  // One-shot per-run provider override (forces single-provider for this run).
  let providerOverride: AgentProvider | null = null;
  if (typeof rawBody.provider === 'string' && rawBody.provider.length > 0) {
    if (!isAgentProvider(rawBody.provider)) {
      json(res, 400, { error: `provider must be one of ${AGENT_PROVIDERS.join(', ')}` });
      return;
    }
    providerOverride = rawBody.provider;
  }

  // use_council=true forces council using the resolved role config; if it
  // doesn't resolve to a council, return 422.
  const useCouncil = rawBody.use_council === true;
  if (useCouncil) {
    if (providerOverride) {
      json(res, 400, { error: 'use_council and provider are mutually exclusive' });
      return;
    }
    if (!project) {
      json(res, 500, { error: 'project missing' });
      return;
    }
    const taskCfg = parseAgentConfig(task.agent_config_json);
    const projectCfg = parseAgentConfig(project.agent_config_json);
    const resolved = resolveRoleConfig(role as RunRole, {
      taskConfig: taskCfg,
      projectConfig: projectCfg,
      legacyTaskOverride: task.agent_provider_override,
      legacyProjectProvider: project.agent_provider,
    });
    if (resolved.type !== 'council') {
      json(res, 422, { error: `no council configured for role '${role}'` });
      return;
    }
  }

  // Guard against double-enqueue: a task with any queued/running run already
  // in flight must not get a second one stacked on top of it.
  const hasInFlightRun = listRunsForTask(db, task.id).some(
    (r) => r.status === 'queued' || r.status === 'running',
  );
  if (hasInFlightRun) {
    json(res, 409, { error: 'a run is already queued or running for this task' });
    return;
  }

  // Manual dispatch reflects assignee/status immediately so the board
  // doesn't lag behind the run. Skip state-machine to avoid double auto-dispatch.
  // Task update + history + enqueue + comment are one transaction so a crash
  // mid-sequence can't leave the task flipped to agent_working/agent_review
  // with no agent_run behind it (or vice versa).
  const tag = providerOverride
    ? ` [provider: ${providerOverride}]`
    : useCouncil
      ? ' [council]'
      : '';
  const runId = db.transaction(() => {
    const desiredStatus =
      role === 'reviewer' ? 'agent_review' : role === 'worker' ? 'agent_working' : task.status;
    const statusChanged = desiredStatus !== task.status;
    const assigneeChanged = task.assignee_role !== role;
    if (statusChanged || assigneeChanged) {
      db.prepare(
        `UPDATE task SET status=?, assignee_role=?, version=version+1, updated_at=? WHERE id=?`,
      ).run(desiredStatus, role, isoNow(), task.id);
      if (statusChanged) {
        db.prepare(
          `INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at) VALUES (?, ?, ?, ?, 'human', ?)`,
        ).run(`th_${runIdSafe()}`, task.id, task.status, desiredStatus, isoNow());
      }
    }
    const id = enqueueRun(db, task.id, role as RunRole, {
      session_provider_override: providerOverride,
    });
    addComment(db, task.id, 'human', `RUN_AGENT: manually dispatched ${role} (run ${id})${tag}`);
    return id;
  })();
  json(res, 201, { run_id: runId, role });
  return true;
}

function handleCancelRun(
  _req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  _active: ProjectDb,
  task: TaskRow,
  db: DbHandle,
): void {
  const runs = listRunsForTask(db, task.id);
  const active = runs.find((r) => r.status === 'running' || r.status === 'queued');
  if (!active) {
    json(res, 404, { error: 'no active run to cancel' });
    return;
  }
  const ok = cancelRun(db, active.id);
  if (!ok) {
    json(res, 404, { error: 'run not found' });
    return;
  }
  addComment(db, task.id, 'human', `CANCELLED: run ${active.id} (${active.role}) by user`);
  json(res, 200, { ok: true, run_id: active.id });
}

function runIdSafe(): string {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
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
  ['/api/tasks/:id/cancel-run', { POST: handleCancelRun as TaskHandler }],
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
    const ALLOWED_ROLES = ['pm', 'worker', 'reviewer', 'human'] as const;
    type AssigneeRoleStr = (typeof ALLOWED_ROLES)[number];
    const rawAssignee = rawBody.assignee_role;
    let assignee_role: AssigneeRoleStr | null = null;
    if (
      typeof rawAssignee === 'string' &&
      (ALLOWED_ROLES as readonly string[]).includes(rawAssignee)
    ) {
      assignee_role = rawAssignee as AssigneeRoleStr;
    }
    const result = createTask(db, {
      title,
      ...(typeof rawBody.description === 'string' ? { description: rawBody.description } : {}),
      ...(assignee_role !== null ? { assignee_role } : {}),
    });
    json(res, 201, { task: result.task, runId: result.runId });
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
