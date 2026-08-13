import { describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/db.ts';
import { isTrackerPollDue } from '../src/tracker-poller.ts';
import {
  getTrackerConfig,
  getTrackerPollState,
  syncTracker,
  trackerStatus,
  type TrackerConfigRow,
} from '../src/tracker-sync.ts';
import type { Tracker, TrackerIssue } from '../src/trackers/tracker.ts';

async function makeDb(): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      workflow_type TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      max_parallel INTEGER NOT NULL DEFAULT 1,
      agent_provider TEXT NOT NULL DEFAULT 'claude',
      agent_config_json TEXT,
      concerns_json TEXT NOT NULL DEFAULT '[]',
      allow_git INTEGER NOT NULL DEFAULT 0,
      scan_ignore_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE task (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      seq INTEGER NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      assignee_role TEXT,
      rework_count INTEGER NOT NULL DEFAULT 0,
      agent_provider_override TEXT,
      agent_config_json TEXT,
      workspace_path TEXT,
      discovery_mode TEXT NOT NULL DEFAULT 'full',
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, seq)
    );
    CREATE TABLE task_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task(id),
      from_status TEXT,
      to_status TEXT,
      by_role TEXT,
      at TEXT NOT NULL
    );
    CREATE TABLE comment (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task(id),
      author_role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE tracker_config (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id) UNIQUE,
      kind TEXT NOT NULL,
      endpoint TEXT,
      api_key_env_var TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      active_states TEXT NOT NULL DEFAULT '["Todo","In Progress"]',
      terminal_states TEXT NOT NULL DEFAULT '["Done","Cancelled","Canceled","Duplicate"]',
      assignee TEXT,
      poll_interval_ms INTEGER NOT NULL DEFAULT 30000,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tracker_issue (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      task_id TEXT REFERENCES task(id),
      tracker_kind TEXT NOT NULL,
      external_id TEXT NOT NULL,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      url TEXT,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, tracker_kind, external_id)
    );
    CREATE TABLE tracker_poll_state (
      project_id TEXT PRIMARY KEY REFERENCES project(id),
      last_poll_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      last_issue_count INTEGER NOT NULL DEFAULT 0,
      rate_limited INTEGER NOT NULL DEFAULT 0,
      next_poll_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO project(id, code, name, workflow_type, repo_path, created_at, updated_at)
    VALUES ('P1', 'TST', 'Test', 'WF1', 'C:/repo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO tracker_config(id, project_id, kind, api_key_env_var, project_slug, enabled, created_at, updated_at)
    VALUES ('TC1', 'P1', 'github', 'TEST_TRACKER_KEY', 'owner/repo', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
  return {
    exec: (s: string) => {
      d.exec(s);
    },
    prepare: (s: string) => {
      const stmt = d.prepare(s);
      return {
        run: (...a: Parameters<typeof stmt.run>) => stmt.run(...a),
        get: (...a: Parameters<typeof stmt.get>) => stmt.get(...a),
        all: (...a: Parameters<typeof stmt.all>) => stmt.all(...a),
      };
    },
    transaction: <T>(fn: (...args: unknown[]) => T): ((...args: unknown[]) => T) => {
      return (...args: unknown[]): T => {
        d.exec('BEGIN');
        try {
          const r = fn(...args);
          d.exec('COMMIT');
          return r;
        } catch (e) {
          d.exec('ROLLBACK');
          throw e;
        }
      };
    },
    close: () => {
      d.close();
    },
  } as unknown as DbHandle;
}

function issue(overrides: Partial<TrackerIssue> = {}): TrackerIssue {
  return {
    id: 'EXT-1',
    identifier: 'EXT-1',
    title: 'External issue',
    description: 'From tracker',
    state: 'Todo',
    priority: null,
    labels: [],
    blockedBy: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    assignedToWorker: false,
    url: 'https://example.test/issues/EXT-1',
    branchName: null,
    assigneeId: null,
    ...overrides,
  };
}

function fakeTracker(issues: TrackerIssue[]): Tracker {
  return {
    fetchCandidateIssues: () => Promise.resolve(issues),
    fetchIssuesByStates: () => Promise.resolve(issues),
    fetchIssueStatesByIds: () => Promise.resolve(issues),
    createComment: () => Promise.resolve(),
    updateIssueState: () => Promise.resolve(),
  };
}

function failingTracker(error: Error): Tracker {
  return {
    fetchCandidateIssues: () => Promise.reject(error),
    fetchIssuesByStates: () => Promise.reject(error),
    fetchIssueStatesByIds: () => Promise.reject(error),
    createComment: () => Promise.resolve(),
    updateIssueState: () => Promise.resolve(),
  };
}

describe('tracker sync', () => {
  it('creates one task for a tracker issue and stays idempotent on repeat sync', async () => {
    const db = await makeDb();
    const cfg = getTrackerConfig(db, 'P1');
    if (!cfg) throw new Error('missing tracker config');

    const first = await syncTracker(db, 'TST', cfg, () => fakeTracker([issue()]));
    const second = await syncTracker(db, 'TST', cfg, () =>
      fakeTracker([issue({ title: 'External issue renamed' })]),
    );

    expect(first).toMatchObject({ ok: true, issues_fetched: 1, tasks_created: 1 });
    expect(second).toMatchObject({ ok: true, issues_fetched: 1, tasks_created: 0 });
    const tasks = db.prepare(`SELECT * FROM task`).all();
    const trackerIssues = db.prepare(`SELECT * FROM tracker_issue`).all() as { title: string }[];
    expect(tasks).toHaveLength(1);
    expect(trackerIssues).toHaveLength(1);
    expect(trackerIssues[0]?.title).toBe('External issue renamed');
  });

  it('marks linked tasks done when the tracker issue reaches a terminal state', async () => {
    const db = await makeDb();
    const cfg = getTrackerConfig(db, 'P1');
    if (!cfg) throw new Error('missing tracker config');

    await syncTracker(db, 'TST', cfg, () => fakeTracker([issue()]));
    const done = await syncTracker(db, 'TST', cfg, () => fakeTracker([issue({ state: 'Done' })]));

    expect(done).toMatchObject({ ok: true, tasks_completed: 1 });
    const task = db.prepare(`SELECT status, assignee_role FROM task LIMIT 1`).get() as {
      status: string;
      assignee_role: string;
    };
    const history = db.prepare(`SELECT * FROM task_history`).all();
    const comments = db.prepare(`SELECT body FROM comment`).all() as { body: string }[];
    expect(task).toEqual({ status: 'done', assignee_role: 'human' });
    expect(history).toHaveLength(1);
    expect(comments[0]?.body).toContain('TRACKER_SYNC');
  });

  it('records missing credential env vars in persisted tracker status', async () => {
    const db = await makeDb();
    const cfg = getTrackerConfig(db, 'P1');
    if (!cfg) throw new Error('missing tracker config');
    delete process.env.TEST_TRACKER_KEY;

    const result = await syncTracker(db, 'TST', cfg);
    const status = trackerStatus(db, 'P1', cfg);
    const pollState = getTrackerPollState(db, 'P1');

    expect(result.ok).toBe(false);
    expect(result.status_code).toBe(400);
    expect(status.env_present).toBe(false);
    expect(status.last_error).toContain('TEST_TRACKER_KEY');
    expect(pollState?.next_poll_at).toBeTruthy();
  });

  it('checks whether enabled tracker polling is due', () => {
    const cfg = {
      enabled: 1,
      poll_interval_ms: 30_000,
    } as TrackerConfigRow;

    expect(isTrackerPollDue(cfg, null, Date.parse('2026-01-01T00:00:00Z'))).toBe(true);
    expect(
      isTrackerPollDue(
        cfg,
        {
          project_id: 'P1',
          last_poll_at: null,
          last_success_at: null,
          last_error: null,
          last_issue_count: 0,
          rate_limited: 0,
          next_poll_at: '2026-01-01T00:01:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        Date.parse('2026-01-01T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('persists structured rate-limit status and retry timing', async () => {
    const db = await makeDb();
    const cfg = getTrackerConfig(db, 'P1');
    if (!cfg) throw new Error('missing tracker config');
    const before = Date.now();
    const rateLimit = Object.assign(new Error('Too Many Requests'), {
      status: 429,
      retryAfterMs: 60_000,
    });

    const result = await syncTracker(db, 'TST', cfg, () => failingTracker(rateLimit));
    const status = trackerStatus(db, 'P1', cfg);
    const state = getTrackerPollState(db, 'P1');

    expect(result).toMatchObject({ ok: false, status_code: 429 });
    expect(status.rate_limited).toBe(true);
    expect(state?.rate_limited).toBe(1);
    expect(Date.parse(state?.next_poll_at ?? '')).toBeGreaterThanOrEqual(before + 59_000);
  });
});
