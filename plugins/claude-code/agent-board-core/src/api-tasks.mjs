import { json, readJson, matchRoute } from './http-util.mjs';
import { getActiveDb } from './project-registry.mjs';
import {
  listTasks, getTask, getTaskByCode, createTask, transitionTask, retryFromWorker,
  listComments, listRuns, addComment, enqueueRun, getRun,
} from './repo.mjs';
import { finishRun } from './repo.mjs';
import { isoNow } from './time.mjs';

export async function handleTasks(req, res, url) {
  const active = await getActiveDb();
  if (!active) return json(res, 400, { error: 'no active project' });
  const { db } = active;
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/tasks' && m === 'GET') {
    return json(res, 200, { tasks: listTasks(db) });
  }

  if (p === '/api/tasks' && m === 'POST') {
    const body = await readJson(req);
    const title = (body?.title || '').trim();
    if (!title) return json(res, 400, { error: 'title required' });
    const out = createTask(db, { title, description: body?.description ?? '' });
    return json(res, 201, out);
  }

  let mm;
  if ((mm = matchRoute('/api/tasks/:id', p)) && m === 'GET') {
    const task = getTask(db, mm.id) || getTaskByCode(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
    return json(res, 200, {
      task,
      comments: listComments(db, task.id),
      runs: listRuns(db, task.id, 5),
    });
  }

  if ((mm = matchRoute('/api/tasks/:id/transition', p)) && m === 'POST') {
    const task = getTask(db, mm.id) || getTaskByCode(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
    const body = await readJson(req);
    const { to_status, to_assignee, reject_comment } = body || {};
    // Security: REST /transition is strictly the Human path. Ignore any
    // body-supplied `by_role` — agents transition via the HTTP MCP endpoint.
    const by_role = 'human';
    // Human reject → require min 10-char comment
    if (to_assignee === 'worker') {
      if (!reject_comment || reject_comment.trim().length < 10) {
        return json(res, 400, { error: 'reject_comment must be ≥ 10 chars' });
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

  if ((mm = matchRoute('/api/tasks/:id/dispatch', p)) && m === 'POST') {
    const task = getTask(db, mm.id) || getTaskByCode(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
    const body = await readJson(req);
    const role = body?.role;
    if (!['pm', 'worker', 'reviewer'].includes(role)) {
      return json(res, 400, { error: 'role must be pm|worker|reviewer' });
    }
    const dup = db.prepare(`
      SELECT 1 FROM agent_run WHERE task_id=? AND role=? AND status IN ('queued','running') LIMIT 1
    `).get(task.id, role);
    if (dup) return json(res, 409, { error: 'run already queued/running for this role' });
    const runId = enqueueRun(db, task.id, role);
    return json(res, 201, { runId });
  }

  if ((mm = matchRoute('/api/tasks/:id/cancel-run', p)) && m === 'POST') {
    const task = getTask(db, mm.id) || getTaskByCode(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
    const running = db.prepare(`
      SELECT * FROM agent_run WHERE task_id=? AND status='running' ORDER BY started_at DESC LIMIT 1
    `).get(task.id);
    if (!running) return json(res, 404, { error: 'no running run' });
    finishRun(db, running.id, 'cancelled', 'cancelled by user', null);
    if (running.pid) {
      try { process.kill(running.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(running.pid, 'SIGKILL'); } catch {} }, 5000).unref?.();
    }
    return json(res, 200, { ok: true, runId: running.id });
  }

  if ((mm = matchRoute('/api/tasks/:id/retry-from-worker', p)) && m === 'POST') {
    const task = getTask(db, mm.id) || getTaskByCode(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
    const out = retryFromWorker(db, task.id);
    if (!out.ok) return json(res, out.status || 400, out);
    return json(res, 200, out);
  }

  if ((mm = matchRoute('/api/tasks/:id', p)) && m === 'DELETE') {
    const task = getTask(db, mm.id) || getTaskByCode(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
    // Kill running runs + cancel queued
    const running = db.prepare(`SELECT * FROM agent_run WHERE task_id=? AND status='running'`).all(task.id);
    for (const r of running) {
      finishRun(db, r.id, 'cancelled', 'task deleted', null);
      if (r.pid) {
        try { process.kill(r.pid, 'SIGTERM'); } catch {}
        setTimeout(() => { try { process.kill(r.pid, 'SIGKILL'); } catch {} }, 5000).unref?.();
      }
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

  if ((mm = matchRoute('/api/tasks/:id/cost', p)) && m === 'GET') {
    const task = getTask(db, mm.id) || getTaskByCode(db, mm.id);
    if (!task) return json(res, 404, { error: 'not found' });
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

  return null;
}
