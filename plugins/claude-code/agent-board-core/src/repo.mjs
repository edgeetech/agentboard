// Data access layer. All mutations go through here so invariants (CAS,
// task_history audit) are enforced in one place.

import { ulid } from './ulid.mjs';
import { isoNow } from './time.mjs';
import { canTransition, allowedPrevStatuses } from './state-machine.mjs';

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
  const allowed = ['name', 'description', 'repo_path', 'max_parallel', 'deleted_at'];
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
    // Simplified: no auto-dispatch on task creation
    return { task: getTask(db, id) };
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

    // Simplified: no auto-dispatch on task transition
    let runId = null;
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


