import type { DbHandle } from './db.ts';
import { getProject, type ProjectRow } from './repo.ts';
import { isoNow } from './time.ts';
import { createTracker } from './trackers/index.ts';
import type { TrackerConfigRow as AdapterTrackerConfigRow } from './trackers/index.ts';
import type { Tracker, TrackerIssue } from './trackers/tracker.ts';
import { ulid } from './ulid.ts';

export type TrackerKind = 'linear' | 'github' | 'gitlab';

export interface TrackerConfigRow {
  id: string;
  project_id: string;
  kind: TrackerKind;
  endpoint: string | null;
  api_key_env_var: string;
  project_slug: string;
  active_states: string;
  terminal_states: string;
  assignee: string | null;
  poll_interval_ms: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface TrackerPollStateRow {
  project_id: string;
  last_poll_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_issue_count: number;
  rate_limited: number;
  next_poll_at: string | null;
  updated_at: string;
}

export interface TrackerIssueRow {
  id: string;
  project_id: string;
  task_id: string | null;
  tracker_kind: string;
  external_id: string;
  identifier: string;
  title: string;
  state: string;
  url: string | null;
  synced_at: string;
  created_at: string;
  task_code?: string | null;
  task_status?: string | null;
}

export interface TrackerStatus {
  env_present: boolean;
  enabled: boolean;
  last_poll_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_issue_count: number;
  next_poll_at: string | null;
  issues_count: number;
  rate_limited: boolean;
}

export interface TrackerSyncStats {
  issues_fetched: number;
  issues_synced: number;
  tasks_created: number;
  tasks_completed: number;
  skipped_terminal: number;
}

export type CreateTrackerFn = (config: AdapterTrackerConfigRow) => Tracker;

export interface TrackerSyncResult extends TrackerSyncStats {
  ok: boolean;
  error?: string;
  status_code?: number;
}

interface TrackerErrorLike {
  status?: number | null;
  retryAfterMs?: number | null;
  message?: string;
}

export function getTrackerConfig(db: DbHandle, projectId: string): TrackerConfigRow | null {
  const row = db.prepare(`SELECT * FROM tracker_config WHERE project_id=?`).get(projectId) as
    | TrackerConfigRow
    | null
    | undefined;
  return row ?? null;
}

export function getTrackerPollState(db: DbHandle, projectId: string): TrackerPollStateRow | null {
  const row = db.prepare(`SELECT * FROM tracker_poll_state WHERE project_id=?`).get(projectId) as
    | TrackerPollStateRow
    | null
    | undefined;
  return row ?? null;
}

export function listTrackerIssues(db: DbHandle, projectId: string): TrackerIssueRow[] {
  return db
    .prepare(
      `
      SELECT ti.*, t.code AS task_code, t.status AS task_status
      FROM tracker_issue ti
      LEFT JOIN task t ON t.id = ti.task_id
      WHERE ti.project_id=?
      ORDER BY ti.created_at DESC
      LIMIT 100
    `,
    )
    .all(projectId) as TrackerIssueRow[];
}

export function trackerStatus(
  db: DbHandle,
  projectId: string,
  cfg: TrackerConfigRow | null = getTrackerConfig(db, projectId),
): TrackerStatus {
  const state = getTrackerPollState(db, projectId);
  const issueRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM tracker_issue WHERE project_id=?`)
    .get(projectId) as { cnt: number } | undefined;
  const envPresent =
    cfg !== null &&
    typeof process.env[cfg.api_key_env_var] === 'string' &&
    process.env[cfg.api_key_env_var] !== '';
  const lastError = state?.last_error ?? null;
  return {
    env_present: envPresent,
    enabled: cfg?.enabled === 1,
    last_poll_at: state?.last_poll_at ?? null,
    last_success_at: state?.last_success_at ?? null,
    last_error: lastError,
    last_issue_count: state?.last_issue_count ?? 0,
    next_poll_at: state?.next_poll_at ?? null,
    issues_count: issueRow?.cnt ?? 0,
    rate_limited: state?.rate_limited === 1,
  };
}

export function recordTrackerPollState(
  db: DbHandle,
  projectId: string,
  patch: Partial<Omit<TrackerPollStateRow, 'project_id' | 'updated_at'>>,
): TrackerPollStateRow {
  const current = getTrackerPollState(db, projectId);
  const next: TrackerPollStateRow = {
    project_id: projectId,
    last_poll_at: patch.last_poll_at ?? current?.last_poll_at ?? null,
    last_success_at: patch.last_success_at ?? current?.last_success_at ?? null,
    last_error: patch.last_error ?? current?.last_error ?? null,
    last_issue_count: patch.last_issue_count ?? current?.last_issue_count ?? 0,
    rate_limited: patch.rate_limited ?? current?.rate_limited ?? 0,
    next_poll_at: patch.next_poll_at ?? current?.next_poll_at ?? null,
    updated_at: isoNow(),
  };
  db.prepare(
    `
    INSERT INTO tracker_poll_state(project_id, last_poll_at, last_success_at, last_error,
                                   last_issue_count, rate_limited, next_poll_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      last_poll_at=excluded.last_poll_at,
      last_success_at=excluded.last_success_at,
      last_error=excluded.last_error,
      last_issue_count=excluded.last_issue_count,
      rate_limited=excluded.rate_limited,
      next_poll_at=excluded.next_poll_at,
      updated_at=excluded.updated_at
  `,
  ).run(
    next.project_id,
    next.last_poll_at,
    next.last_success_at,
    next.last_error,
    next.last_issue_count,
    next.rate_limited,
    next.next_poll_at,
    next.updated_at,
  );
  return next;
}

export async function syncTracker(
  db: DbHandle,
  projectCode: string,
  cfg: TrackerConfigRow,
  createTrackerFn: CreateTrackerFn = createTracker,
): Promise<TrackerSyncResult> {
  const project = getProject(db);
  if (!project) {
    return failedSync(db, cfg, 'project not found', 404);
  }

  const pollStartedAt = isoNow();
  recordTrackerPollState(db, project.id, {
    last_poll_at: pollStartedAt,
    last_error: null,
    rate_limited: 0,
    next_poll_at: nextPollAt(cfg),
  });

  let tracker: Tracker;
  try {
    tracker = createTrackerFn(toAdapterConfig(cfg));
  } catch (e) {
    return failedSync(db, cfg, errorMessage(e), 400);
  }

  let issues: TrackerIssue[];
  try {
    issues = await tracker.fetchCandidateIssues();
  } catch (e) {
    const err = e as TrackerErrorLike;
    const status = typeof err.status === 'number' ? err.status : 400;
    const retryAfterMs = typeof err.retryAfterMs === 'number' ? err.retryAfterMs : undefined;
    return failedSync(db, cfg, errorMessage(e), status, retryAfterMs);
  }

  const stats = syncIssues(db, project, cfg, issues);
  recordTrackerPollState(db, project.id, {
    last_success_at: isoNow(),
    last_error: null,
    last_issue_count: issues.length,
    rate_limited: 0,
    next_poll_at: nextPollAt(cfg),
  });
  console.warn(
    `[tracker-sync] ${projectCode}: fetched=${stats.issues_fetched} synced=${stats.issues_synced} created=${stats.tasks_created}`,
  );
  return { ok: true, ...stats };
}

function failedSync(
  db: DbHandle,
  cfg: TrackerConfigRow,
  error: string,
  statusCode: number,
  retryAfterMs?: number,
): TrackerSyncResult {
  recordTrackerPollState(db, cfg.project_id, {
    last_error: error,
    last_issue_count: 0,
    rate_limited: statusCode === 429 ? 1 : 0,
    next_poll_at: nextPollAt(cfg, retryAfterMs),
  });
  return {
    ok: false,
    error,
    status_code: statusCode,
    issues_fetched: 0,
    issues_synced: 0,
    tasks_created: 0,
    tasks_completed: 0,
    skipped_terminal: 0,
  };
}

function toAdapterConfig(cfg: TrackerConfigRow): AdapterTrackerConfigRow {
  return {
    kind: cfg.kind,
    api_key_env_var: cfg.api_key_env_var,
    project_slug: cfg.project_slug,
    active_states: cfg.active_states,
    terminal_states: cfg.terminal_states,
    ...(cfg.endpoint !== null && { endpoint: cfg.endpoint }),
    ...(cfg.assignee !== null && { assignee: cfg.assignee }),
  };
}

function syncIssues(
  db: DbHandle,
  project: ProjectRow,
  cfg: TrackerConfigRow,
  issues: TrackerIssue[],
): TrackerSyncStats {
  const tx = db.transaction((): TrackerSyncStats => {
    const stats: TrackerSyncStats = {
      issues_fetched: issues.length,
      issues_synced: 0,
      tasks_created: 0,
      tasks_completed: 0,
      skipped_terminal: 0,
    };
    const terminalStates = parseStringArray(cfg.terminal_states, [
      'Done',
      'Cancelled',
      'Canceled',
      'Duplicate',
    ]);

    for (const issue of issues) {
      const existing = db
        .prepare(
          `
          SELECT * FROM tracker_issue
          WHERE project_id=? AND tracker_kind=? AND external_id=?
        `,
        )
        .get(project.id, cfg.kind, issue.id) as TrackerIssueRow | null | undefined;
      const terminal = isTerminalState(issue.state, terminalStates);
      const now = isoNow();

      if (existing === null || existing === undefined) {
        const taskId = terminal ? null : insertTaskForIssue(db, project, issue);
        if (terminal) stats.skipped_terminal += 1;
        else stats.tasks_created += 1;
        db.prepare(
          `
          INSERT INTO tracker_issue(id, project_id, task_id, tracker_kind, external_id,
                                    identifier, title, state, url, synced_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          ulid(),
          project.id,
          taskId,
          cfg.kind,
          issue.id,
          issue.identifier,
          issue.title,
          issue.state,
          issue.url ?? null,
          now,
          now,
        );
        stats.issues_synced += 1;
        continue;
      }

      let taskId = existing.task_id;
      if (!terminal && taskId === null) {
        taskId = insertTaskForIssue(db, project, issue);
        stats.tasks_created += 1;
      }
      db.prepare(
        `
        UPDATE tracker_issue
        SET task_id=?, identifier=?, title=?, state=?, url=?, synced_at=?
        WHERE id=?
      `,
      ).run(
        taskId,
        issue.identifier,
        issue.title,
        issue.state,
        issue.url ?? null,
        now,
        existing.id,
      );
      stats.issues_synced += 1;

      if (terminal && taskId !== null && completeTaskFromTracker(db, taskId, issue)) {
        stats.tasks_completed += 1;
      }
    }
    return stats;
  });
  return tx();
}

function insertTaskForIssue(db: DbHandle, project: ProjectRow, issue: TrackerIssue): string {
  const seqRow = db
    .prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM task WHERE project_id=?`)
    .get(project.id) as { next: number };
  const taskId = ulid();
  const now = isoNow();
  db.prepare(
    `
    INSERT INTO task(id, project_id, seq, code, title, description,
                     acceptance_criteria_json, status, assignee_role,
                     created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '[]', 'todo', NULL, ?, ?)
  `,
  ).run(
    taskId,
    project.id,
    seqRow.next,
    `${project.code}-${seqRow.next}`,
    `[${issue.identifier}] ${issue.title}`,
    issue.description ?? '',
    now,
    now,
  );
  return taskId;
}

function completeTaskFromTracker(db: DbHandle, taskId: string, issue: TrackerIssue): boolean {
  const task = db
    .prepare(`SELECT id, status FROM task WHERE id=? AND deleted_at IS NULL`)
    .get(taskId) as { id: string; status: string } | null | undefined;
  if (task === null || task === undefined || task.status === 'done') return false;
  const now = isoNow();
  db.prepare(
    `
    UPDATE task
    SET status='done', assignee_role='human', version=version+1, updated_at=?
    WHERE id=?
  `,
  ).run(now, taskId);
  db.prepare(
    `
    INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at)
    VALUES (?, ?, ?, 'done', 'system', ?)
  `,
  ).run(ulid(), taskId, task.status, now);
  db.prepare(
    `
    INSERT INTO comment(id, task_id, author_role, body, created_at)
    VALUES (?, ?, 'system', ?, ?)
  `,
  ).run(
    ulid(),
    taskId,
    `TRACKER_SYNC: issue ${issue.identifier} moved to terminal state "${issue.state}"`,
    now,
  );
  return true;
}

function nextPollAt(cfg: TrackerConfigRow, retryAfterMs?: number): string {
  const interval = Math.max(5_000, retryAfterMs ?? cfg.poll_interval_ms);
  return new Date(Date.now() + interval).toISOString();
}

function isTerminalState(state: string, terminalStates: string[]): boolean {
  return terminalStates.some((s) => s.toLowerCase() === state.toLowerCase());
}

export function parseStringArray(raw: string | null | undefined, fallback: string[]): string[] {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : fallback;
  } catch {
    return fallback;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
