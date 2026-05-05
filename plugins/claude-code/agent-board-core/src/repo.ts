// Data access layer. All mutations go through here so invariants (CAS,
// task_history audit) are enforced in one place.

import type { DbHandle } from './db.ts';
import { resolveAutoDispatch } from './dispatch-map.ts';
import { PRICING_VERSION } from './pricing.ts';
import { canTransition, allowedPrevStatuses } from './state-machine.ts';
import { isoNow } from './time.ts';
import type {
  ActorRole,
  AssigneeRole,
  Phase,
  RunRole,
  RunStatus,
  TaskStatus,
  WorkflowType,
} from './types.ts';
import { ulid } from './ulid.ts';

/* ─── ROW INTERFACES ────────────────────────────────────────────────────── */

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  workflow_type: WorkflowType;
  repo_path: string;
  max_parallel: number;
  agent_provider: 'claude' | 'github_copilot' | 'codex';
  concerns_json: string;
  allow_git: number;
  scan_ignore_json: string;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectPatch = Partial<Omit<ProjectRow, 'scan_ignore_json'>> & {
  scan_ignore_json?: string[] | string;
};

export interface TaskRow {
  id: string;
  project_id: string;
  seq: number;
  code: string;
  title: string;
  description: string | null;
  acceptance_criteria_json: string;
  status: TaskStatus;
  assignee_role: AssigneeRole | null;
  rework_count: number;
  agent_provider_override: 'claude' | 'github_copilot' | 'codex' | null;
  workspace_path: string | null;
  discovery_mode: 'full' | 'validate' | 'technical-depth' | 'ship-fast' | 'explore';
  prompt_template?: string | null;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRunRow {
  id: string;
  task_id: string;
  role: RunRole;
  status: RunStatus;
  token: string | null;
  pid: number | null;
  claude_session_id: string | null;
  error: string | null;
  logs_path: string | null;
  summary: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  cost_version: number;
  attempt: number;
  last_heartbeat_at: string | null;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
  prompt_template: string | null;
  phase: Phase;
  phase_state_json: string;
  phase_history_json: string;
}

export interface CommentRow {
  id: string;
  task_id: string;
  author_role: ActorRole;
  body: string;
  created_at: string;
}

export interface FilePathRow {
  id: string;
  task_id: string;
  file_path: string;
  label: string | null;
  created_at: string;
}

export interface TransitionInput {
  task_id: string;
  to_status: TaskStatus;
  to_assignee: AssigneeRole | null;
  by_role: ActorRole;
  expected_version: number;
  workflow_type: WorkflowType;
}

export interface TransitionOk {
  ok: true;
  task: TaskRow;
  runId: string | null;
  stalled: boolean;
}
export interface TransitionErr {
  ok: false;
  status: number;
  reason: string;
}
export type TransitionResult = TransitionOk | TransitionErr;

export interface CostData {
  model?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
  };
  cost_usd?: number;
  cost_version?: number;
}

/* ─── HELPERS ───────────────────────────────────────────────────────────── */

function asProject(row: unknown): ProjectRow {
  return row as ProjectRow;
}

function asTask(row: unknown): TaskRow {
  return row as TaskRow;
}

function asRun(row: unknown): AgentRunRow {
  return row as AgentRunRow;
}

function asComment(row: unknown): CommentRow {
  return row as CommentRow;
}

function asFilePath(row: unknown): FilePathRow {
  return row as FilePathRow;
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) throw new Error(`expected ${label} row, got none`);
  return row;
}

/* ─── PROJECTS ─────────────────────────────────────────────────────────── */

export function createProject(
  db: DbHandle,
  {
    code,
    name,
    description,
    workflow_type,
    repo_path,
    agent_provider = 'claude',
  }: {
    code: string;
    name: string;
    description?: string;
    workflow_type: WorkflowType;
    repo_path: string;
    agent_provider?: 'claude' | 'github_copilot' | 'codex';
  },
): ProjectRow {
  const id = ulid();
  const now = isoNow();
  db.prepare(`
    INSERT INTO project(id, code, name, description, workflow_type, repo_path, agent_provider, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, code, name, description ?? '', workflow_type, repo_path, agent_provider, now, now);
  return requireRow(getProject(db), 'project');
}

export function getProject(db: DbHandle): ProjectRow | undefined {
  const row = db.prepare(`SELECT * FROM project WHERE deleted_at IS NULL LIMIT 1`).get();
  if (row === undefined || row === null) return undefined;
  return asProject(row);
}

export function updateProject(
  db: DbHandle,
  patch: ProjectPatch,
  expectedVersion: number,
): { ok: boolean; project?: ProjectRow; reason?: string } {
  const allowed: (keyof Omit<ProjectRow, 'scan_ignore_json'>)[] = ['name', 'description', 'repo_path', 'max_parallel', 'agent_provider', 'deleted_at'];
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); args.push(patch[k]); }
  }
  if ('scan_ignore_json' in patch) {
    const v = patch.scan_ignore_json;
    const serialized = typeof v === 'string' ? v : JSON.stringify(v);
    sets.push(`scan_ignore_json=?`);
    args.push(serialized);
  }
  if (sets.length === 0) return { ok: false, reason: 'no fields' };
  sets.push('version=version+1', 'updated_at=?');
  args.push(isoNow(), expectedVersion);
  const info = db.prepare(
    `UPDATE project SET ${sets.join(', ')} WHERE version=?`,
  ).run(...args) as { changes: number };
  if (info.changes === 0) return { ok: false, reason: 'version mismatch' };
  const project = getProject(db);
  if (!project) return { ok: true };
  return { ok: true, project };
}

/* ─── TASKS ────────────────────────────────────────────────────────────── */

export function listTasks(
  db: DbHandle,
  { includeDeleted = false, search = '' }: { includeDeleted?: boolean; search?: string } = {},
): TaskRow[] {
  const clauses: string[] = [];
  if (!includeDeleted) clauses.push('t.deleted_at IS NULL');
  const params: unknown[] = [];
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
  `).all(...params) as TaskRow[];
}

export function getTask(db: DbHandle, id: string): TaskRow | undefined {
  const row = db.prepare(`SELECT * FROM task WHERE id=?`).get(id);
  if (row === undefined || row === null) return undefined;
  return asTask(row);
}

export function getTaskByCode(db: DbHandle, code: string): TaskRow | undefined {
  const row = db.prepare(`SELECT * FROM task WHERE code=?`).get(code);
  if (row === undefined || row === null) return undefined;
  return asTask(row);
}

export function createTask(
  db: DbHandle,
  { title, description = '', assignee_role = null }: { title: string; description?: string; assignee_role?: AssigneeRole | null },
): { task: TaskRow | undefined; runId: string | null } {
  const project = getProject(db);
  if (!project) throw new Error('no active project');
  const tx = db.transaction((): { task: TaskRow | undefined; runId: string | null } => {
    const seqRow = db.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM task WHERE project_id=?`,
    ).get(project.id) as { next: number };
    const seq = seqRow.next;
    const code = `${project.code}-${seq}`;
    const id = ulid();
    const now = isoNow();

    // Determine initial status based on assignee_role
    // - 'pm' stays 'todo' (PM enriches from todo)
    // - 'worker' → 'agent_working' (Worker implements directly)
    // - 'reviewer' → 'agent_review' (Reviewer reviews directly)
    // - null or other → 'todo'
    let initialStatus: TaskStatus = 'todo';
    if (assignee_role === 'worker') initialStatus = 'agent_working';
    else if (assignee_role === 'reviewer') initialStatus = 'agent_review';

    db.prepare(`
      INSERT INTO task(id, project_id, seq, code, title, description,
                       acceptance_criteria_json, status, assignee_role,
                       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
    `).run(id, project.id, seq, code, title, description, initialStatus, assignee_role, now, now);

    // Spawn agent if assignee_role is an agent-runnable role (pm/worker/reviewer)
    let runId: string | null = null;
    const RUN_ROLES: RunRole[] = ['pm', 'worker', 'reviewer'];
    if (assignee_role && (RUN_ROLES as AssigneeRole[]).includes(assignee_role)) {
      runId = enqueueRun(db, id, assignee_role as RunRole);
    }

    return { task: getTask(db, id), runId };
  });
  return tx();
}

/**
 * Enqueue an agent run. Returns run ID.
 */
export function enqueueRun(db: DbHandle, task_id: string, role: RunRole): string {
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
export function transitionTask(db: DbHandle, {
  task_id, to_status, to_assignee, by_role, expected_version, workflow_type,
}: TransitionInput): TransitionResult {
  const tx = db.transaction((): TransitionResult => {
    const cur = getTask(db, task_id);
    if (!cur) return { ok: false, status: 404, reason: 'not found' };

    const check = canTransition(workflow_type, cur.status, to_status, to_assignee, by_role);
    if (!check.ok) return { ok: false, status: 400, reason: check.reason ?? 'transition denied' };

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
    `).run(to_status, to_assignee, isoNow(), task_id, expected_version, ...prevs) as { changes: number };

    if (info.changes === 0) {
      return { ok: false, status: 409, reason: 'version or status CAS failed' };
    }

    db.prepare(`
      INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ulid(), task_id, cur.status, to_status, by_role, isoNow());

    // Stall check
    const post = requireRow(getTask(db, task_id), 'task post-transition');
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
    let runId: string | null = null;
    const nextRole = resolveAutoDispatch(post.status, post.assignee_role);
    if (nextRole && !stalled) {
      runId = enqueueRun(db, task_id, nextRole);
    }
    return { ok: true, task: requireRow(getTask(db, task_id), 'task final'), runId, stalled };
  });
  return tx();
}

/* ─── FILE PATH ATTACHMENTS ─────────────────────────────────────────────── */

export function addFilePath(
  db: DbHandle,
  task_id: string,
  file_path: string,
  label?: string | null,
): FilePathRow {
  const id = ulid();
  db.prepare(`
    INSERT INTO task_attachment(id, task_id, file_path, label, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, task_id, file_path, label ?? null, isoNow());
  return asFilePath(db.prepare(`SELECT * FROM task_attachment WHERE id=?`).get(id));
}

export function listFilePaths(db: DbHandle, task_id: string): FilePathRow[] {
  return db.prepare(`
    SELECT * FROM task_attachment WHERE task_id=? ORDER BY created_at ASC
  `).all(task_id) as FilePathRow[];
}

export function deleteFilePath(db: DbHandle, id: string): boolean {
  const info = db.prepare(`DELETE FROM task_attachment WHERE id=?`).run(id) as { changes: number };
  return info.changes > 0;
}

export function addComment(
  db: DbHandle,
  task_id: string,
  author_role: ActorRole,
  body: string,
): CommentRow {
  const id = ulid();
  db.prepare(`
    INSERT INTO comment(id, task_id, author_role, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, task_id, author_role, body, isoNow());
  return requireRow(getComment(db, id), 'comment');
}

export function getComment(db: DbHandle, id: string): CommentRow | undefined {
  const row = db.prepare(`SELECT * FROM comment WHERE id=?`).get(id);
  if (row === undefined || row === null) return undefined;
  return asComment(row);
}

export function listComments(db: DbHandle, task_id: string): CommentRow[] {
  return db.prepare(`SELECT * FROM comment WHERE task_id=? ORDER BY created_at ASC`).all(task_id) as CommentRow[];
}

/* ─── AGENT RUNS ────────────────────────────────────────────────── */

export function getRun(db: DbHandle, id: string): AgentRunRow | undefined {
  const row = db.prepare(`SELECT * FROM agent_run WHERE id=?`).get(id);
  if (row === undefined || row === null) return undefined;
  return asRun(row);
}

export function listRunsForTask(db: DbHandle, task_id: string): AgentRunRow[] {
  return db.prepare(`
    SELECT * FROM agent_run WHERE task_id=? ORDER BY queued_at DESC
  `).all(task_id) as AgentRunRow[];
}

export function listRuns(db: DbHandle, task_id: string, limit = 5): AgentRunRow[] {
  return db.prepare(`
    SELECT * FROM agent_run WHERE task_id=? ORDER BY queued_at DESC LIMIT ?
  `).all(task_id, limit) as AgentRunRow[];
}

export function listQueuedRunsForProject(db: DbHandle): AgentRunRow[] {
  return db.prepare(`
    SELECT r.* FROM agent_run r
    INNER JOIN task t ON r.task_id = t.id
    WHERE r.status = 'queued'
    ORDER BY r.queued_at ASC
  `).all() as AgentRunRow[];
}

export function runningCount(db: DbHandle): number {
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM agent_run WHERE status IN ('running')
  `).get() as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

export function claimRun(
  db: DbHandle,
  run_id: string,
  run_token: string,
  pid: number | null,
  stdout_path: string | null,
): boolean {
  const now = isoNow();
  const info = db.prepare(`
    UPDATE agent_run
    SET status='running', token=?, pid=?, logs_path=?, started_at=?, last_heartbeat_at=?
    WHERE id=? AND status='queued'
  `).run(run_token, pid, stdout_path, now, now, run_id) as { changes: number };
  return info.changes > 0;
}

export function getRunByToken(db: DbHandle, run_token: string): AgentRunRow | undefined {
  const row = db.prepare(`SELECT * FROM agent_run WHERE token=? AND status='running'`).get(run_token);
  if (row === undefined || row === null) return undefined;
  return asRun(row);
}

export function bumpHeartbeat(db: DbHandle, run_id: string): void {
  db.prepare(`UPDATE agent_run SET last_heartbeat_at=? WHERE id=?`).run(isoNow(), run_id);
}

export function setRunCost(db: DbHandle, run_id: string, costData: CostData): void {
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
    cost_usd ?? 0,
    cost_version ?? PRICING_VERSION,
    run_id,
  );
}

export function finishRun(
  db: DbHandle,
  run_id: string,
  status: RunStatus,
  summary?: string | null,
  error?: string | null,
): void {
  const now = isoNow();
  db.prepare(`
    UPDATE agent_run
    SET status=?, summary=?, error=?, ended_at=?
    WHERE id=?
  `).run(status, summary ?? null, error ?? null, now, run_id);
}

export function reapOrphans(db: DbHandle, timeoutMs: number): AgentRunRow[] {
  const cutoffTime = new Date(Date.now() - timeoutMs).toISOString();
  const orphans = db.prepare(`
    SELECT id FROM agent_run
    WHERE status = 'running' AND last_heartbeat_at < ?
  `).all(cutoffTime) as { id: string }[];

  for (const run of orphans) {
    finishRun(db, run.id, 'failed', null, `orphaned: no heartbeat for ${timeoutMs}ms`);
  }
  return orphans as unknown as AgentRunRow[];
}
