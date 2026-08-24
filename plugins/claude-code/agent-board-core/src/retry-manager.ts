// Retry manager: exponential backoff scheduling for failed agent runs.
// Integrates with retry_state DB table and executor.mjs failure paths.

import type { DatabaseSync } from 'node:sqlite';

import {
  computeBackoffMs as computeEngineBackoffMs,
  decideRetry,
  normalizeRetryConfig,
} from '../../../../packages/engine/src/runs/retry-policy.ts';

import { isoNow } from './time.ts';
import { ulid } from './ulid.ts';

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

export function computeBackoffMs(attempt: number, maxBackoffMs?: number): number {
  return computeEngineBackoffMs(attempt, maxBackoffMs);
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
  const retry = decideRetry({
    attempt,
    config: normalizeRetryConfig(config),
  });

  if (!retry.shouldRetry) {
    return { scheduled: false, reason: retry.reason };
  }

  const { delayMs, nextAttempt } = retry;

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
