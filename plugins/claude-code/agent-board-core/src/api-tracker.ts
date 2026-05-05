// REST API routes for tracker config management.
// GET/POST /api/projects/{code}/tracker
// POST /api/projects/{code}/tracker/enable|disable|sync
// GET /api/projects/{code}/tracker/issues

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { DbHandle } from './db.ts';
import { json, readJson } from './http-util.ts';
import { getDb } from './project-registry.ts';
import { getProject } from './repo.ts';
import { isoNow } from './time.ts';
import { ulid } from './ulid.ts';

// ── DB row types ─────────────────────────────────────────────────────────────

interface TrackerConfigRow {
  id: string;
  provider: string;
  base_url: string | null;
  project_key: string | null;
  api_token: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface TrackerIssueRow {
  id: string;
  task_id: string | null;
  task_code: string | null;
  task_status: string | null;
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getConfig(db: DbHandle): TrackerConfigRow | null {
  try {
    return db.prepare(`SELECT * FROM tracker_config LIMIT 1`).get() as TrackerConfigRow | null;
  } catch {
    return null;
  }
}

function getTrackerIssues(db: DbHandle): TrackerIssueRow[] {
  try {
    return db
      .prepare(
        `
      SELECT ti.*, t.code AS task_code, t.status AS task_status
      FROM tracker_issue ti
      LEFT JOIN task t ON t.id = ti.task_id
      ORDER BY ti.created_at DESC
      LIMIT 100
    `,
      )
      .all() as TrackerIssueRow[];
  } catch {
    return [];
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function handleTracker(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean | null | undefined> {
  const m = /^\/api\/projects\/([^/]+)\/tracker(\/[a-z]+)?$/.exec(url.pathname);
  if (!m) return null;

  const code = String(m[1]);
  const sub = m[2];
  const db = await getDb(code).catch(() => null);
  if (!db) {
    json(res, 404, { error: 'project not found' });
    return;
  }
  const project = getProject(db);
  if (!project) {
    json(res, 404, { error: 'project not found' });
    return;
  }

  // GET /api/projects/{code}/tracker
  if (req.method === 'GET' && sub === undefined) {
    const cfg = getConfig(db);
    json(res, 200, { tracker: cfg });
    return true;
  }

  // POST /api/projects/{code}/tracker
  if (req.method === 'POST' && sub === undefined) {
    const body = await readJson(req);
    if (!isRecord(body)) {
      json(res, 400, { error: 'invalid body' });
      return;
    }
    const { provider, base_url, project_key, api_token } = body;
    if (typeof provider !== 'string' || !provider) {
      json(res, 400, { error: 'provider required' });
      return;
    }
    const existing = getConfig(db);
    const now = isoNow();
    if (existing) {
      db.prepare(
        `
        UPDATE tracker_config SET provider=?, base_url=?, project_key=?, api_token=?, updated_at=?
        WHERE id=?
      `,
      ).run(
        provider,
        typeof base_url === 'string' ? base_url : null,
        typeof project_key === 'string' ? project_key : null,
        typeof api_token === 'string' ? api_token : null,
        now,
        existing.id,
      );
      json(res, 200, { tracker: getConfig(db) });
      return true;
    }
    const id = ulid();
    db.prepare(
      `
      INSERT INTO tracker_config (id, provider, base_url, project_key, api_token, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `,
    ).run(
      id,
      provider,
      typeof base_url === 'string' ? base_url : null,
      typeof project_key === 'string' ? project_key : null,
      typeof api_token === 'string' ? api_token : null,
      now,
      now,
    );
    json(res, 201, { tracker: getConfig(db) });
    return true;
  }

  // POST /api/projects/{code}/tracker/enable
  if (req.method === 'POST' && sub === '/enable') {
    const cfg = getConfig(db);
    if (!cfg) {
      json(res, 404, { error: 'no tracker configured' });
      return;
    }
    db.prepare(`UPDATE tracker_config SET enabled=1, updated_at=? WHERE id=?`).run(
      isoNow(),
      cfg.id,
    );
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/projects/{code}/tracker/disable
  if (req.method === 'POST' && sub === '/disable') {
    const cfg = getConfig(db);
    if (!cfg) {
      json(res, 404, { error: 'no tracker configured' });
      return;
    }
    db.prepare(`UPDATE tracker_config SET enabled=0, updated_at=? WHERE id=?`).run(
      isoNow(),
      cfg.id,
    );
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/projects/{code}/tracker/sync — force immediate poll
  if (req.method === 'POST' && sub === '/sync') {
    const cfg = getConfig(db);
    if (!cfg) {
      json(res, 404, { error: 'no tracker configured' });
      return;
    }
    // Dynamic import avoids circular deps at startup. Types not yet available.
    const trackerPath = './trackers/index.mjs';
    const trackerMod = (await import(trackerPath)) as Record<string, unknown>;
    const createTracker = trackerMod.createTracker as (c: TrackerConfigRow) => {
      fetchCandidateIssues(): Promise<unknown[]>;
    };
    try {
      const tracker = createTracker(cfg);
      const issues = await tracker.fetchCandidateIssues();
      json(res, 200, { ok: true, issues_fetched: issues.length });
      return true;
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
      return;
    }
  }

  // GET /api/projects/{code}/tracker/issues
  if (req.method === 'GET' && sub === '/issues') {
    const issues = getTrackerIssues(db);
    json(res, 200, { issues });
    return true;
  }

  return null;
}
