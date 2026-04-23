// Data access layer. All mutations go through here so invariants (CAS,
// task_history audit, auto-dispatch enqueue) are enforced in one place.

import { ulid } from './ulid.mjs';
import { isoNow } from './time.mjs';
import { canTransition, allowedPrevStatuses } from './state-machine.mjs';
import { resolveAutoDispatch } from './dispatch-map.mjs';

/* ─── PROJECTS ─────────────────────────────────────────────────────────── */

export function createProject(db, { code, name, description, workflow_type, repo_path }) {
  const id = ulid();
  const now = isoNow();
  db.prepare(`
    INSERT INTO project(id, code, name, description, workflow_type, repo_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, code, name, description ?? '', workflow_type, repo_path, now, now);
  return getProject(db);
}

export function getProject(db) {
  return db.prepare(`SELECT * FROM project WHERE deleted_at IS NULL LIMIT 1`).get();
}

export function updateProject(db, patch, expectedVersion) {
  const allowed = ['name', 'description', 'repo_path', 'max_parallel', 'auto_dispatch_pm', 'deleted_at'];
  const sets = [];
  const args = [];
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); args.push(patch[k]); }
  }
  if (sets.length === 0) return { ok: false, reason: 'no fields' };
  sets.push('version=version+1', 'updated_at=?');
  args.push(isoNow(), expectedVersion);
  const info = db.prepare(
    `UPDATE project SET ${sets.join(', ')} WHERE version=?`
  ).run(...args);
  if (info.changes === 0) return { ok: false, reason: 'version mismatch' };
  return { ok: true, project: getProject(db) };
}

/* ─── TASKS ────────────────────────────────────────────────────────────── */

export function listTasks(db, { includeDeleted = false, search = '' } = {}) {
  const clauses = [];
  if (!includeDeleted) clauses.push('t.deleted_at IS NULL');
  const params = [];
  const q = typeof search === 'string' ? search.trim() : '';
  if (q) {
    const like = '%' + q.toLowerCase() + '%';
    clauses.push(`(
      LOWER(t.title) LIKE ? OR
      LOWER(COALESCE(t.description, '')) LIKE ? OR
      t.id IN (SELECT task_id FROM comment WHERE LOWER(body) LIKE ?)
    )`);
    params.push(like, like, like);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return db.prepare(`SELECT t.* FROM task t ${where} ORDER BY t.seq DESC`).all(...params);
}

export function getTask(db, id) {
  return db.prepare(`SELECT * FROM task WHERE id=?`).get(id);
}

export function getTaskByCode(db, code) {
  return db.prepare(`SELECT * FROM task WHERE code=?`).get(code);
}

export function createTask(db, { title, description = '' }) {
  const project = getProject(db);
  if (!project) throw new Error('no active project');
  const tx = db.transaction(() => {
    const row = db.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM task WHERE project_id=?`
    ).get(project.id);
    const seq = row.next;
    const code = `${project.code}-${seq}`;
    const id = ulid();
    const now = isoNow();
    db.prepare(`
      INSERT INTO task(id, project_id, seq, code, title, description,
                       acceptance_criteria_json, status, assignee_role,
                       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '[]', 'todo', NULL, ?, ?)
    `).run(id, project.id, seq, code, title, description, now, now);
    // Auto-dispatch PM if enabled
    let runId = null;
    if (project.auto_dispatch_pm) {
      runId = enqueueRun(db, id, 'pm');
    }
    return { task: getTask(db, id), runId };
  });
  return tx();
}

/**
 * State-machine CAS transition. Writes task_history in same TX.
 * Evaluates auto-dispatch map and enqueues next run atomically.
 */
export function transitionTask(db, {
  task_id, to_status, to_assignee, by_role, expected_version, workflow_type,
}) {
  const tx = db.transaction(() => {
    const cur = getTask(db, task_id);
    if (!cur) return { ok: false, status: 404, reason: 'not found' };

    const check = canTransition(workflow_type, cur.status, to_status, to_assignee, by_role);
    if (!check.ok) return { ok: false, status: 400, reason: check.reason };

    const prevs = allowedPrevStatuses(workflow_type, to_status);
    const placeholders = prevs.map(() => '?').join(',');

    // rework counter: incremented when assignee transitions to 'worker'
    // via reject (reviewer-reject or human-reject)
    let reworkBump = '';
    if (to_assignee === 'worker' &&
        ((by_role === 'reviewer' && cur.status === 'agent_review') ||
         (by_role === 'human' && cur.status === 'human_approval'))) {
      reworkBump = ', rework_count = rework_count + 1';
    }

    const info = db.prepare(`
      UPDATE task SET status=?, assignee_role=?, version=version+1, updated_at=?${reworkBump}
      WHERE id=? AND version=? AND status IN (${placeholders})
    `).run(to_status, to_assignee, isoNow(), task_id, expected_version, ...prevs);

    if (info.changes === 0) {
      return { ok: false, status: 409, reason: 'version or status CAS failed' };
    }

    db.prepare(`
      INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ulid(), task_id, cur.status, to_status, by_role, isoNow());

    // Stall check
    const post = getTask(db, task_id);
    let stalled = false;
    if (post.rework_count > 3 && to_assignee === 'worker') {
      // Cap: skip worker dispatch, escalate to human
      db.prepare(`
        UPDATE task SET assignee_role='human', version=version+1, updated_at=?
        WHERE id=?
      `).run(isoNow(), task_id);
      db.prepare(`
        INSERT INTO comment(id, task_id, author_role, body, created_at)
        VALUES (?, ?, 'system', ?, ?)
      `).run(ulid(), task_id,
        `STALLED: rework_count exceeded (N=3), manual intervention required`,
        isoNow());
      stalled = true;
    }

    // Auto-dispatch (unless stalled above)
    let runId = null;
    if (!stalled) {
      const finalAssignee = getTask(db, task_id).assignee_role;
      const finalStatus = getTask(db, task_id).status;
      const dispatchRole = resolveAutoDispatch(finalStatus, finalAssignee);
      if (dispatchRole) {
        // Dedup: skip if existing queued|running run for same (task_id, role)
        const dup = db.prepare(`
          SELECT 1 FROM agent_run WHERE task_id=? AND role=? AND status IN ('queued','running') LIMIT 1
        `).get(task_id, dispatchRole);
        if (!dup) runId = enqueueRun(db, task_id, dispatchRole);
      }
    }
    return { ok: true, task: getTask(db, task_id), runId, stalled };
  });
  return tx();
}

export function retryFromWorker(db, task_id) {
  const tx = db.transaction(() => {
    const cur = getTask(db, task_id);
    if (!cur) return { ok: false, status: 404 };
    db.prepare(`
      UPDATE task SET rework_count=0, assignee_role='worker', status='agent_working',
                      version=version+1, updated_at=?
      WHERE id=?
    `).run(isoNow(), task_id);
    db.prepare(`
      INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at)
      VALUES (?, ?, ?, 'agent_working', 'human', ?)
    `).run(ulid(), task_id, cur.status, isoNow());
    db.prepare(`
      INSERT INTO comment(id, task_id, author_role, body, created_at)
      VALUES (?, ?, 'system', 'Human reset stall — retrying from worker', ?)
    `).run(ulid(), task_id, isoNow());
    // Dedup-safe enqueue
    const dup = db.prepare(`
      SELECT 1 FROM agent_run WHERE task_id=? AND role='worker' AND status IN ('queued','running') LIMIT 1
    `).get(task_id);
    const runId = dup ? null : enqueueRun(db, task_id, 'worker');
    return { ok: true, runId };
  });
  return tx();
}

/* ─── COMMENTS ─────────────────────────────────────────────────────────── */

export function addComment(db, task_id, author_role, body) {
  const id = ulid();
  db.prepare(`
    INSERT INTO comment(id, task_id, author_role, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, task_id, author_role, body, isoNow());
  return getComment(db, id);
}

export function getComment(db, id) {
  return db.prepare(`SELECT * FROM comment WHERE id=?`).get(id);
}

export function listComments(db, task_id) {
  return db.prepare(`SELECT * FROM comment WHERE task_id=? ORDER BY created_at ASC`).all(task_id);
}

/* ─── AGENT RUNS ──────────────────────────────────────────────────────── */

export function enqueueRun(db, task_id, role) {
  const id = ulid();
  db.prepare(`
    INSERT INTO agent_run(id, task_id, role, status, queued_at)
    VALUES (?, ?, ?, 'queued', ?)
  `).run(id, task_id, role, isoNow());
  return id;
}

export function listRuns(db, task_id, limit = 5) {
  return db.prepare(`
    SELECT * FROM agent_run WHERE task_id=? ORDER BY queued_at DESC LIMIT ?
  `).all(task_id, limit);
}

export function getRun(db, id) {
  return db.prepare(`SELECT * FROM agent_run WHERE id=?`).get(id);
}

export function getRunByToken(db, token) {
  return db.prepare(`SELECT * FROM agent_run WHERE token=? AND status='running'`).get(token);
}

export function claimRun(db, run_id, run_token, pid, logs_path) {
  const info = db.prepare(`
    UPDATE agent_run
    SET status='running', token=?, pid=?, logs_path=?, started_at=?, last_heartbeat_at=?
    WHERE id=? AND status='queued'
  `).run(run_token, pid, logs_path, isoNow(), isoNow(), run_id);
  return info.changes > 0;
}

export function bumpHeartbeat(db, run_id) {
  db.prepare(`UPDATE agent_run SET last_heartbeat_at=? WHERE id=?`).run(isoNow(), run_id);
}

export function finishRun(db, run_id, status, summary, error) {
  db.prepare(`
    UPDATE agent_run SET status=?, summary=?, error=?, ended_at=?
    WHERE id=?
  `).run(status, summary ?? null, error ?? null, isoNow(), run_id);
}

export function setRunCost(db, run_id, { model, usage, cost_usd, cost_version }) {
  db.prepare(`
    UPDATE agent_run
    SET model=?, input_tokens=?, output_tokens=?,
        cache_creation_tokens=?, cache_read_tokens=?,
        cost_usd=?, cost_version=?
    WHERE id=?
  `).run(
    model ?? null,
    usage.input_tokens, usage.output_tokens,
    usage.cache_creation_tokens, usage.cache_read_tokens,
    cost_usd, cost_version, run_id,
  );
}

export function listQueuedRunsForProject(db) {
  return db.prepare(`
    SELECT r.* FROM agent_run r
    WHERE r.status='queued'
    ORDER BY r.queued_at ASC
  `).all();
}

export function runningCount(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM agent_run WHERE status='running'`).get().n;
}

export function reapOrphans(db, timeoutMs) {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const rows = db.prepare(`
    SELECT id, task_id FROM agent_run
    WHERE status='running' AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)
  `).all(cutoff);
  if (rows.length === 0) return [];
  const tx = db.transaction(() => {
    for (const r of rows) {
      db.prepare(`
        UPDATE agent_run SET status='failed',
               error='orphaned: no heartbeat > timeout',
               ended_at=? WHERE id=?
      `).run(isoNow(), r.id);
      db.prepare(`
        INSERT INTO comment(id, task_id, author_role, body, created_at)
        VALUES (?, ?, 'system', 'SYSTEM: run orphaned (reaper)', ?)
      `).run(ulid(), r.task_id, isoNow());
    }
  });
  tx();
  return rows;
}
