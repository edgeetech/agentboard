// Background tracker poller. For each project with an enabled tracker_config,
// fetches candidate issues and syncs them as agentboard tasks.

import { ulid } from './ulid.mjs';
import { isoNow } from './time.mjs';
import { getDb, listProjectDbs } from './project-registry.mjs';
import { getProject, createTask } from './repo.mjs';
import { createTracker } from './trackers/index.mjs';
import { RateLimitTracker } from './rate-limit-tracker.mjs';

const rateLimiter = new RateLimitTracker();
let pollerStarted = false;

export function startTrackerPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  // Stagger first poll by 5s to let server finish boot
  setTimeout(() => pollAll().catch(logErr), 5_000);
  console.log('[tracker-poller] started');
}

async function pollAll() {
  for (const code of listProjectDbs()) {
    try {
      const db = await getDb(code);
      const cfg = getTrackerConfig(db);
      if (!cfg || !cfg.enabled) continue;

      scheduleProjectPoll(db, code);
    } catch (e) { logErr(e); }
  }
}

function scheduleProjectPoll(db, projectCode) {
  const cfg = getTrackerConfig(db);
  if (!cfg || !cfg.enabled) return;

  setTimeout(async () => {
    try {
      const currentCfg = getTrackerConfig(db);
      if (!currentCfg || !currentCfg.enabled) return;
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
  }, cfg.poll_interval_ms);
}

async function pollProject(db, projectCode, cfg) {
  let tracker;
  try {
    tracker = createTracker(cfg);
  } catch (e) {
    console.warn(`[tracker-poller] ${projectCode}: cannot create tracker:`, e.message);
    return;
  }

  let issues;
  try {
    issues = await tracker.fetchCandidateIssues();
    rateLimiter.recordSuccess(`tracker:${projectCode}`);
  } catch (e) {
    if (e.status === 429) {
      rateLimiter.recordLimit(`tracker:${projectCode}`, e.retryAfterMs ?? 60_000);
      console.warn(`[tracker-poller] ${projectCode}: rate limited, backing off`);
    } else {
      console.error(`[tracker-poller] ${projectCode}: fetch failed:`, e.message);
    }
    return;
  }

  const project = getProject(db);
  if (!project) return;

  const terminalStates = safeParseJson(cfg.terminal_states, ['Done', 'Cancelled']);

  for (const issue of issues) {
    try {
      syncIssue(db, project, cfg, issue, terminalStates);
    } catch (e) {
      console.error(`[tracker-poller] ${projectCode}: sync issue ${issue.identifier} failed:`, e.message);
    }
  }

  console.log(`[tracker-poller] ${projectCode}: synced ${issues.length} issues`);
}

function syncIssue(db, project, cfg, issue, terminalStates) {
  const existing = db.prepare(`
    SELECT * FROM tracker_issue WHERE project_id=? AND tracker_kind=? AND external_id=?
  `).get(project.id, cfg.kind, issue.id);

  const isTerminal = terminalStates.some(s => s.toLowerCase() === issue.state.toLowerCase());

  if (!existing) {
    if (isTerminal) return; // Don't create tasks for already-done issues

    // Create new task + tracker_issue record
    const { task } = createTask(db, {
      title: `[${issue.identifier}] ${issue.title}`,
      description: issue.description || '',
    });

    const now = isoNow();
    db.prepare(`
      INSERT INTO tracker_issue(id, project_id, task_id, tracker_kind, external_id,
                                identifier, title, state, url, synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ulid(), project.id, task.id, cfg.kind, issue.id,
           issue.identifier, issue.title, issue.state, issue.url ?? null, now, now);

    console.log(`[tracker-poller] created task for ${issue.identifier}`);
  } else {
    // Update sync state
    db.prepare(`UPDATE tracker_issue SET state=?, synced_at=? WHERE id=?`)
      .run(issue.state, isoNow(), existing.id);

    // If issue moved to terminal state and task not yet done, mark task done
    if (isTerminal && existing.task_id) {
      const task = db.prepare(`SELECT * FROM task WHERE id=? AND deleted_at IS NULL`).get(existing.task_id);
      if (task && task.status !== 'done') {
        db.prepare(`
          UPDATE task SET status='done', assignee_role='human', version=version+1, updated_at=?
          WHERE id=?
        `).run(isoNow(), existing.task_id);
        db.prepare(`
          INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at)
          VALUES (?, ?, ?, 'done', 'system', ?)
        `).run(ulid(), existing.task_id, task.status, isoNow());
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

function getTrackerConfig(db) {
  try {
    return db.prepare(`SELECT * FROM tracker_config LIMIT 1`).get();
  } catch { return null; }
}

function safeParseJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function logErr(e) { console.error('[tracker-poller]', e?.stack || e); }
