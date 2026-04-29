// Retry manager: exponential backoff scheduling for failed agent runs.
// Integrates with retry_state DB table and executor.mjs failure paths.

import { ulid } from './ulid.mjs';
import { isoNow } from './time.mjs';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_BACKOFF_MS = 300_000; // 5 minutes

export function computeBackoffMs(attempt, maxBackoffMs = DEFAULT_MAX_BACKOFF_MS) {
  return Math.min(1000 * Math.pow(2, attempt - 1), maxBackoffMs);
}

/**
 * Record a retry in retry_state and re-enqueue as a new agent_run after backoff.
 * Returns { scheduled: true, delayMs, newRunId, nextAttempt }
 *      or { scheduled: false, reason }.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ runId: string, taskId: string, role: string, attempt: number, error?: string, config?: object }} opts
 */
export function scheduleRetry(db, { runId, taskId, role, attempt, error, config = {} }) {
  const maxAttempts = config.max_retry_attempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxBackoffMs = config.max_retry_backoff_ms ?? DEFAULT_MAX_BACKOFF_MS;

  if (attempt >= maxAttempts) {
    return { scheduled: false, reason: `max attempts (${maxAttempts}) reached` };
  }

  const nextAttempt = attempt + 1;
  const delayMs = computeBackoffMs(attempt, maxBackoffMs);

  const stateId = ulid();
  db.prepare(`
    INSERT INTO retry_state(id, run_id, task_id, attempt, scheduled_at, delay_ms, last_error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(stateId, runId, taskId, nextAttempt,
        new Date(Date.now() + delayMs).toISOString(), delayMs, error ?? null, isoNow());

  const newRunId = ulid();
  const timer = setTimeout(() => {
    try {
      db.prepare(`
        INSERT INTO agent_run(id, task_id, role, status, attempt, queued_at)
        VALUES (?, ?, ?, 'queued', ?, ?)
      `).run(newRunId, taskId, role, nextAttempt, isoNow());
    } catch (e) {
      console.error('[retry-manager] re-enqueue failed:', e?.message || e);
    }
  }, delayMs);
  timer.unref?.();

  return { scheduled: true, delayMs, newRunId, nextAttempt };
}

/**
 * List pending retry states for a task (most recent first).
 */
export function listRetryStates(db, taskId) {
  return db.prepare(`
    SELECT * FROM retry_state WHERE task_id=? ORDER BY created_at DESC
  `).all(taskId);
}
