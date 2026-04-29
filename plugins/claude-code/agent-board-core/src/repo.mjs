// Data access layer. All mutations go through here so invariants (CAS,
// task_history audit) are enforced in one place.

import { ulid } from './ulid.mjs';
import { isoNow } from './time.mjs';
import { canTransition, allowedPrevStatuses } from './state-machine.mjs';
import { resolveAutoDispatch } from './dispatch-map.mjs';
import { PRICING_VERSION } from './pricing.mjs';

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
  const allowed = ['name', 'description', 'repo_path', 'max_parallel', 'agent_provider', 'deleted_at'];
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
  return db.prepare(`
    SELECT t.*, EXISTS(
      SELECT 1 FROM agent_run r
      WHERE r.task_id = t.id AND r.status IN ('queued','running')
    ) AS has_active_run
    FROM task t ${where} ORDER BY t.seq DESC
  `).all(...params);
}

export function getTask(db, id) {
  return db.prepare(`SELECT * FROM task WHERE id=?`).get(id);
}

export function getTaskByCode(db, code) {
  return db.prepare(`SELECT * FROM task WHERE code=?`).get(code);
}

export function createTask(db, { title, description = '', assignee_role = null }) {
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
    
    // Determine initial status based on assignee_role
    // - 'pm' stays 'todo' (PM enriches from todo)
    // - 'worker' → 'agent_working' (Worker implements directly)
    // - 'reviewer' → 'agent_review' (Reviewer reviews directly)
    // - null or other → 'todo'
    let initialStatus = 'todo';
    if (assignee_role === 'worker') initialStatus = 'agent_working';
    else if (assignee_role === 'reviewer') initialStatus = 'agent_review';
    
    db.prepare(`
      INSERT INTO task(id, project_id, seq, code, title, description,
                       acceptance_criteria_json, status, assignee_role,
                       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
    `).run(id, project.id, seq, code, title, description, initialStatus, assignee_role, now, now);
    
    // Spawn agent if assignee_role is set
    let runId = null;
    if (assignee_role) {
      if (project.agent_provider === 'claude') {
        // Enqueue run for Claude agents
        runId = enqueueRun(db, id, assignee_role);
      } else if (project.agent_provider === 'CoPilot') {
        // Add comment for CoPilot (not supported yet)
        addComment(db, id, 'system', 'CoPilot agent spawn is not supported yet. This task must be handled manually.');
      }
    }
    
    return { task: getTask(db, id), runId };
  });
  return tx();
}

/**
 * Enqueue an agent run. Returns run ID.
 */
export function enqueueRun(db, task_id, role) {
  const id = ulid();
  const now = isoNow();
  db.prepare(`
    INSERT INTO agent_run(id, task_id, role, status, queued_at)
    VALUES (?, ?, ?, 'queued', ?)
  `).run(id, task_id, role, now);
  return id;
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

    // Auto-dispatch: check if next role should spawn
    let runId = null;
    const nextRole = resolveAutoDispatch(post.status, post.assignee_role);
    if (nextRole && !stalled) {
      runId = enqueueRun(db, task_id, nextRole);
    }
    return { ok: true, task: getTask(db, task_id), runId, stalled };
  });
  return tx();
}


/* ─── FILE PATH ATTACHMENTS ─────────────────────────────────────────────── */

export function addFilePath(db, task_id, file_path, label) {
  const id = ulid();
  db.prepare(`
    INSERT INTO task_attachment(id, task_id, file_path, label, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, task_id, file_path, label ?? null, isoNow());
  return db.prepare(`SELECT * FROM task_attachment WHERE id=?`).get(id);
}

export function listFilePaths(db, task_id) {
  return db.prepare(`
    SELECT * FROM task_attachment WHERE task_id=? ORDER BY created_at ASC
  `).all(task_id);
}

export function deleteFilePath(db, id) {
  const info = db.prepare(`DELETE FROM task_attachment WHERE id=?`).run(id);
  return info.changes > 0;
}

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

/* ─── AGENT RUNS ────────────────────────────────────────────────── */


export function getRun(db, id) {
  return db.prepare(`SELECT * FROM agent_run WHERE id=?`).get(id);
}

export function listRunsForTask(db, task_id) {
  return db.prepare(`
    SELECT * FROM agent_run WHERE task_id=? ORDER BY queued_at DESC
  `).all(task_id);
}

export function listRuns(db, task_id, limit = 5) {
  return db.prepare(`
    SELECT * FROM agent_run WHERE task_id=? ORDER BY queued_at DESC LIMIT ?
  `).all(task_id, limit);
}

export function listQueuedRunsForProject(db) {
  return db.prepare(`
    SELECT r.* FROM agent_run r
    INNER JOIN task t ON r.task_id = t.id
    WHERE r.status = 'queued'
    ORDER BY r.queued_at ASC
  `).all();
}

export function runningCount(db) {
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM agent_run WHERE status IN ('running')
  `).get();
  return row?.cnt ?? 0;
}

export function claimRun(db, run_id, run_token, pid, stdout_path) {
  const now = isoNow();
  const info = db.prepare(`
    UPDATE agent_run
    SET status='running', token=?, pid=?, logs_path=?, started_at=?, last_heartbeat_at=?
    WHERE id=? AND status='queued'
  `).run(run_token, pid, stdout_path, now, now, run_id);
  return info.changes > 0;
}

export function getRunByToken(db, run_token) {
  return db.prepare(`SELECT * FROM agent_run WHERE token=? AND status='running'`).get(run_token);
}

export function bumpHeartbeat(db, run_id) {
  db.prepare(`UPDATE agent_run SET last_heartbeat_at=? WHERE id=?`).run(isoNow(), run_id);
}

export function setRunCost(db, run_id, costData) {
  const { model, usage, cost_usd, cost_version } = costData;
  db.prepare(`
    UPDATE agent_run
    SET model = ?, input_tokens = ?, output_tokens = ?, cache_creation_tokens = ?, cache_read_tokens = ?, cost_usd = ?, cost_version = ?
    WHERE id = ?
  `).run(
    model ?? null,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    usage?.cache_creation_tokens ?? 0,
    usage?.cache_read_tokens ?? 0,
    cost_usd,
    cost_version,
    run_id
  );
}

export function finishRun(db, run_id, status, summary, error) {
  const now = isoNow();
  db.prepare(`
    UPDATE agent_run
    SET status=?, summary=?, error=?, ended_at=?
    WHERE id=?
  `).run(status, summary ?? null, error ?? null, now, run_id);
}

export function reapOrphans(db, timeoutMs) {
  const now = isoNow();
  const cutoffTime = new Date(Date.now() - timeoutMs).toISOString();
  const orphans = db.prepare(`
    SELECT id FROM agent_run
    WHERE status = 'running' AND last_heartbeat_at < ?
  `).all(cutoffTime);
  
  for (const run of orphans) {
    finishRun(db, run.id, 'failed', null, `orphaned: no heartbeat for ${timeoutMs}ms`);
  }
  return orphans;
}
