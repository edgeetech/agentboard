// Background tracker poller. Reconciles enabled tracker configs repeatedly so
// trackers enabled after server startup begin polling without a restart.

import type { DbHandle } from './db.ts';
import { getDb, listProjectDbs } from './project-registry.ts';
import {
  getTrackerPollState,
  syncTracker,
  type TrackerConfigRow,
  type TrackerPollStateRow,
} from './tracker-sync.ts';

const DEFAULT_RECONCILE_INTERVAL_MS = 5_000;

let pollerStarted = false;
const runningProjects = new Set<string>();

export function startTrackerPoller(reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS): void {
  if (pollerStarted) return;
  pollerStarted = true;

  const run = (): void => {
    void pollDueTrackers().catch(logErr);
  };

  const first = setTimeout(run, reconcileIntervalMs);
  first.unref();
  const interval = setInterval(run, reconcileIntervalMs);
  interval.unref();
}

export async function pollDueTrackers(nowMs = Date.now()): Promise<void> {
  for (const code of listProjectDbs()) {
    if (runningProjects.has(code)) continue;
    runningProjects.add(code);
    try {
      const db = await getDb(code);
      const cfg = getTrackerConfigForPoll(db);
      if (!cfg?.enabled) continue;
      const state = getTrackerPollState(db, cfg.project_id);
      if (!isTrackerPollDue(cfg, state, nowMs)) continue;
      await syncTracker(db, code, cfg);
    } catch (e) {
      logErr(e);
    } finally {
      runningProjects.delete(code);
    }
  }
}

export function isTrackerPollDue(
  cfg: TrackerConfigRow,
  state: TrackerPollStateRow | null,
  nowMs = Date.now(),
): boolean {
  if (cfg.enabled !== 1) return false;
  if (state?.next_poll_at === null || state?.next_poll_at === undefined) return true;
  const dueAt = Date.parse(state.next_poll_at);
  return !Number.isFinite(dueAt) || dueAt <= nowMs;
}

function getTrackerConfigForPoll(db: DbHandle): TrackerConfigRow | null {
  const row = db.prepare(`SELECT * FROM tracker_config WHERE enabled=1 LIMIT 1`).get() as
    | TrackerConfigRow
    | null
    | undefined;
  return row ?? null;
}

function logErr(e: unknown): void {
  console.error('[tracker-poller]', e instanceof Error ? e.stack : e);
}
