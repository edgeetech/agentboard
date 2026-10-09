import type { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { computeBackoffMs, scheduleRetry, listRetryStates } from '../src/retry-manager.ts';

// ─── computeBackoffMs ────────────────────────────────────────────────────────

describe('computeBackoffMs', () => {
  it('attempt 1 returns 1000ms', () => {
    expect(computeBackoffMs(1)).toBe(1000);
  });

  it('attempt 2 returns 2000ms', () => {
    expect(computeBackoffMs(2)).toBe(2000);
  });

  it('attempt 3 returns 4000ms', () => {
    expect(computeBackoffMs(3)).toBe(4000);
  });

  it('caps at DEFAULT_MAX_BACKOFF_MS (5 min)', () => {
    // attempt 20 → 2^19 * 1000 >> 300_000
    expect(computeBackoffMs(20)).toBe(300_000);
  });

  it('respects custom maxBackoffMs', () => {
    expect(computeBackoffMs(5, 10_000)).toBe(10_000);
  });

  it('attempt 1 with tiny max returns max', () => {
    expect(computeBackoffMs(1, 500)).toBe(500);
  });
});

// ─── scheduleRetry ───────────────────────────────────────────────────────────

interface InsertedRow {
  sql: string;
  args: unknown[];
}

function makeDb(rows: unknown[] = []): DatabaseSync & { _rows: InsertedRow[] } {
  const insertedRows: InsertedRow[] = [];
  const db = {
    _rows: insertedRows,
    prepare(sql: string) {
      const isInsert = sql.trimStart().startsWith('INSERT');
      return {
        run(...args: unknown[]) {
          if (isInsert) insertedRows.push({ sql, args });
          return {};
        },
        get() {
          return null;
        },
        all() {
          return rows;
        },
      };
    },
  };
  return db as unknown as DatabaseSync & { _rows: InsertedRow[] };
}

describe('scheduleRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns { scheduled: false } when attempt >= maxAttempts (default 3)', () => {
    const db = makeDb();
    const result = scheduleRetry(db, { runId: 'r1', taskId: 't1', role: 'worker', attempt: 3 });
    expect(result.scheduled).toBe(false);
    if (!result.scheduled) expect(result.reason).toMatch(/max attempts/);
  });

  it('returns { scheduled: false } with custom max_retry_attempts', () => {
    const db = makeDb();
    const result = scheduleRetry(db, {
      runId: 'r1',
      taskId: 't1',
      role: 'worker',
      attempt: 2,
      config: { max_retry_attempts: 2 },
    });
    expect(result.scheduled).toBe(false);
  });

  it('returns { scheduled: true } when attempt < maxAttempts', () => {
    const db = makeDb();
    const result = scheduleRetry(db, { runId: 'r1', taskId: 't1', role: 'worker', attempt: 1 });
    expect(result.scheduled).toBe(true);
    if (result.scheduled) {
      expect(result.nextAttempt).toBe(2);
      expect(result.delayMs).toBe(1000); // current attempt 1 → 2^0 * 1000 = 1s backoff
      expect(typeof result.newRunId).toBe('string');
      expect(result.newRunId.length).toBeGreaterThan(0);
    }
  });

  it('inserts a retry_state row', () => {
    const db = makeDb();
    scheduleRetry(db, { runId: 'r1', taskId: 't1', role: 'worker', attempt: 1 });
    const retryRow = db._rows.find((r) => r.sql.includes('retry_state'));
    expect(retryRow).toBeDefined();
    expect(retryRow?.args[1]).toBe('r1'); // run_id
    expect(retryRow?.args[2]).toBe('t1'); // task_id
    expect(retryRow?.args[3]).toBe(2); // attempt = nextAttempt
  });

  it('schedules agent_run re-enqueue after delayMs via setTimeout', () => {
    const db = makeDb();
    scheduleRetry(db, { runId: 'r1', taskId: 't1', role: 'pm', attempt: 1 });

    const before = db._rows.length;
    vi.runAllTimers();
    // The timer inserts a new agent_run row
    // INSERT INTO agent_run(id, task_id, role, status, attempt, queued_at) VALUES (?, ?, ?, 'queued', ?, ?)
    // args: [newRunId, taskId, role, nextAttempt, isoNow()]
    const runRow = db._rows.slice(before).find((r) => r.sql.includes('agent_run'));
    expect(runRow).toBeDefined();
    expect(runRow?.args[2]).toBe('pm'); // role
    expect(runRow?.args[3]).toBe(2); // attempt = nextAttempt
  });

  it('preserves error string in retry_state row', () => {
    const db = makeDb();
    scheduleRetry(db, {
      runId: 'r1',
      taskId: 't1',
      role: 'worker',
      attempt: 1,
      error: 'API timeout',
    });
    const retryRow = db._rows.find((r) => r.sql.includes('retry_state'));
    expect(retryRow?.args[6]).toBe('API timeout'); // last_error
  });

  it('error defaults to null when not provided', () => {
    const db = makeDb();
    scheduleRetry(db, { runId: 'r1', taskId: 't1', role: 'worker', attempt: 1 });
    const retryRow = db._rows.find((r) => r.sql.includes('retry_state'));
    expect(retryRow?.args[6]).toBeNull();
  });
});

// ─── listRetryStates ─────────────────────────────────────────────────────────

describe('listRetryStates', () => {
  it('returns rows from retry_state for given taskId', () => {
    const fakeRows = [{ id: 's1', task_id: 't1', attempt: 2 }];
    const db = makeDb(fakeRows);
    const result = listRetryStates(db, 't1');
    expect(result).toEqual(fakeRows);
  });

  it('returns empty array when no rows', () => {
    const db = makeDb([]);
    const result = listRetryStates(db, 'nope');
    expect(result).toEqual([]);
  });
});
