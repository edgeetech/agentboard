// Background tracker poller. For each project with an enabled tracker_config,
// fetches candidate issues and syncs them as agentboard tasks.

import type { DbHandle } from './db.ts';
import { getDb, listProjectDbs } from './project-registry.ts';
import { RateLimitTracker } from './rate-limit-tracker.ts';
import { createTask, getProject } from './repo.ts';
import type { ProjectRow } from './repo.ts';
import { isoNow } from './time.ts';
import { createTracker } from './trackers/index.ts';
import type { TrackerConfigRow } from './trackers/index.ts';
import type { TrackerIssue } from './trackers/tracker.ts';
import { ulid } from './ulid.ts';

/** Extended tracker_config row fields used by the poller. */
interface PollerTrackerConfig extends TrackerConfigRow {
  enabled: boolean | null;
  poll_interval_ms: number;
}

/** Minimal shape of a tracker_issue DB row. */
interface TrackerIssueRow {
  id: string;
  task_id: string | null;
}

const rateLimiter = new RateLimitTracker();
let pollerStarted = false;

export function startTrackerPoller(): void {
  if (pollerStarted) return;
  pollerStarted = true;
  // Stagger first poll by 5s to let server finish boot
  const staggerTimer = setTimeout(() => {
    pollAll().catch(logErr);
  }, 5_000);
  staggerTimer.unref();
}

async function pollAll(): Promise<void> {
  for (const code of listProjectDbs()) {
    try {
      const db = await getDb(code);
      const cfg = getTrackerConfig(db);
      if (!cfg?.enabled) continue;

      scheduleProjectPoll(db, code);
    } catch (e) { logErr(e); }
  }
}

function scheduleProjectPoll(db: DbHandle, projectCode: string): void {
  const cfg = getTrackerConfig(db);
  if (!cfg?.enabled) return;

  const timer = setTimeout(() => {
    const run = async (): Promise<void> => {
      try {
        const currentCfg = getTrackerConfig(db);
        if (!currentCfg?.enabled) return;
        if (rateLimiter.isLimited(`tracker:${projectCode}`)) {
          scheduleProjectPoll(db, projectCode); // reschedule even when rate-limited
          return;
        }
        await pollProject(db, projectCode, currentCfg);
      } catch (e) {
        logErr(e);
      } finally {
        scheduleProjectPoll(db, projectCode);
      }
    };
    void run();
  }, cfg.poll_interval_ms);
  timer.unref();
}

async function pollProject(db: DbHandle, projectCode: string, cfg: PollerTrackerConfig): Promise<void> {
  let tracker: ReturnType<typeof createTracker>;
  try {
    tracker = createTracker(cfg);
  } catch (e) {
    console.warn(`[tracker-poller] ${projectCode}: cannot create tracker:`, (e as Error).message);
    return;
  }

  let issues: TrackerIssue[];
  try {
    issues = await tracker.fetchCandidateIssues();
    rateLimiter.recordSuccess(`tracker:${projectCode}`);
  } catch (e) {
    const err = e as { status?: number; retryAfterMs?: number; message?: string };
    if (err.status === 429) {
      rateLimiter.recordLimit(`tracker:${projectCode}`, err.retryAfterMs ?? 60_000);
      console.warn(`[tracker-poller] ${projectCode}: rate limited, backing off`);
    } else {
      console.error(`[tracker-poller] ${projectCode}: fetch failed:`, err.message);
    }
    return;
  }

  const project = getProject(db);
  if (project === undefined) return;

  const terminalStates = safeParseJson(cfg.terminal_states, ['Done', 'Cancelled']);

  for (const issue of issues) {
    try {
      syncIssue(db, project, cfg, issue, terminalStates);
    } catch (e) {
      console.error(`[tracker-poller] ${projectCode}: sync issue ${issue.identifier} failed:`, (e as Error).message);
    }
  }
}

function syncIssue(
  db: DbHandle,
  project: ProjectRow,
  cfg: PollerTrackerConfig,
  issue: TrackerIssue,
  terminalStates: string[],
): void {
  const existing = db.prepare(`
    SELECT * FROM tracker_issue WHERE project_id=? AND tracker_kind=? AND external_id=?
  `).get(project.id, cfg.kind, issue.id) as TrackerIssueRow | null | undefined;

  const isTerminal = terminalStates.some(s => s.toLowerCase() === issue.state.toLowerCase());

  if (existing === null || existing === undefined) {
    if (isTerminal) return; // Don't create tasks for already-done issues

    // Create new task + tracker_issue record
    const result = createTask(db, {
      title: `[${issue.identifier}] ${issue.title}`,
      description: issue.description ?? '',
    });
    if (result.task === undefined) return;
    const { task } = result;

    const now = isoNow();
    db.prepare(`
      INSERT INTO tracker_issue(id, project_id, task_id, tracker_kind, external_id,
                                identifier, title, state, url, synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ulid(), project.id, task.id, cfg.kind, issue.id,
           issue.identifier, issue.title, issue.state, issue.url ?? null, now, now);
  } else {
    // Update sync state
    db.prepare(`UPDATE tracker_issue SET state=?, synced_at=? WHERE id=?`)
      .run(issue.state, isoNow(), existing.id);

    // If issue moved to terminal state and task not yet done, mark task done
    if (isTerminal && existing.task_id !== null) {
      const taskRow = db.prepare(`SELECT * FROM task WHERE id=? AND deleted_at IS NULL`).get(existing.task_id) as { id: string; status: string } | null | undefined;
      if (taskRow !== null && taskRow !== undefined && taskRow.status !== 'done') {
        db.prepare(`
          UPDATE task SET status='done', assignee_role='human', version=version+1, updated_at=?
          WHERE id=?
        `).run(isoNow(), existing.task_id);
        db.prepare(`
          INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at)
          VALUES (?, ?, ?, 'done', 'system', ?)
        `).run(ulid(), existing.task_id, taskRow.status, isoNow());
        db.prepare(`
          INSERT INTO comment(id, task_id, author_role, body, created_at)
          VALUES (?, ?, 'system', ?, ?)
        `).run(ulid(), existing.task_id,
               `TRACKER_SYNC: issue ${issue.identifier} moved to terminal state "${issue.state}"`,
               isoNow());
      }
    }
  }
}

function getTrackerConfig(db: DbHandle): PollerTrackerConfig | null {
  try {
    const row = db.prepare(`SELECT * FROM tracker_config LIMIT 1`).get() as PollerTrackerConfig | null | undefined;
    return row ?? null;
  } catch { return null; }
}

function safeParseJson(s: string | undefined, fallback: string[]): string[] {
  if (s === undefined) return fallback;
  try {
    const parsed: unknown = JSON.parse(s);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.map(String);
  } catch { return fallback; }
}

function logErr(e: unknown): void {
  console.error('[tracker-poller]', e instanceof Error ? e.stack : e);
}
