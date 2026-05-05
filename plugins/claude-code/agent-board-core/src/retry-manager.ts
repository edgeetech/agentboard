// Retry manager: exponential backoff scheduling for failed agent runs.
// Integrates with retry_state DB table and executor.mjs failure paths.

import type { DatabaseSync } from 'node:sqlite';

import { isoNow } from './time.ts';
import { ulid } from './ulid.ts';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_BACKOFF_MS = 300_000; // 5 minutes

export interface RetryConfig {
  max_retry_attempts?: number;
  max_retry_backoff_ms?: number;
}

export interface ScheduleRetryOpts {
  runId: string;
  taskId: string;
  role: string;
  attempt: number;
  error?: string;
  config?: RetryConfig;
}

export type ScheduleRetryResult =
  | { scheduled: true; delayMs: number; newRunId: string; nextAttempt: number }
  | { scheduled: false; reason: string };

export function computeBackoffMs(
  attempt: number,
  maxBackoffMs: number = DEFAULT_MAX_BACKOFF_MS,
): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), maxBackoffMs);
}

/**
 * Record a retry in retry_state and re-enqueue as a new agent_run after backoff.
 * Returns { scheduled: true, delayMs, newRunId, nextAttempt }
 *      or { scheduled: false, reason }.
 */
export function scheduleRetry(
  db: DatabaseSync,
  { runId, taskId, role, attempt, error, config = {} }: ScheduleRetryOpts,
): ScheduleRetryResult {
  const maxAttempts = config.max_retry_attempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxBackoffMs = config.max_retry_backoff_ms ?? DEFAULT_MAX_BACKOFF_MS;

  if (attempt >= maxAttempts) {
    return { scheduled: false, reason: `max attempts (${maxAttempts}) reached` };
  }

  const nextAttempt = attempt + 1;
  const delayMs = computeBackoffMs(nextAttempt - 1, maxBackoffMs);

  const stateId = ulid();
  db.prepare(
    `
    INSERT INTO retry_state(id, run_id, task_id, attempt, scheduled_at, delay_ms, last_error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    stateId,
    runId,
    taskId,
    nextAttempt,
    new Date(Date.now() + delayMs).toISOString(),
    delayMs,
    error ?? null,
    isoNow(),
  );

  const newRunId = ulid();
  const timer = setTimeout(() => {
    try {
      db.prepare(
        `
        INSERT INTO agent_run(id, task_id, role, status, attempt, queued_at)
        VALUES (?, ?, ?, 'queued', ?, ?)
      `,
      ).run(newRunId, taskId, role, nextAttempt, isoNow());
    } catch (e) {
      console.error('[retry-manager] re-enqueue failed:', e instanceof Error ? e.message : e);
    }
  }, delayMs);
  timer.unref();

  return { scheduled: true, delayMs, newRunId, nextAttempt };
}

/**
 * List pending retry states for a task (most recent first).
 */
export function listRetryStates(db: DatabaseSync, taskId: string): unknown[] {
  return db
    .prepare(
      `
    SELECT * FROM retry_state WHERE task_id=? ORDER BY created_at DESC
  `,
    )
    .all(taskId);
}
