// REST API routes for tracker config management.
// GET/POST /api/projects/{code}/tracker
// POST /api/projects/{code}/tracker/enable|disable|sync
// GET /api/projects/{code}/tracker/issues

import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import type { DbHandle } from './db.ts';
import { json, readJson } from './http-util.ts';
import { validateCode } from './project-code.ts';
import { getDb } from './project-registry.ts';
import { getProject, type ProjectRow } from './repo.ts';
import { isoNow } from './time.ts';
import {
  getTrackerConfig,
  listTrackerIssues,
  parseStringArray,
  recordTrackerPollState,
  syncTracker,
  trackerStatus,
  type TrackerConfigRow,
} from './tracker-sync.ts';
import { ulid } from './ulid.ts';

const DEFAULT_ACTIVE_STATES = ['Todo', 'In Progress'];
const DEFAULT_TERMINAL_STATES = ['Done', 'Cancelled', 'Canceled', 'Duplicate'];

const TrackerConfigInput = z.object({
  kind: z.enum(['linear', 'github', 'gitlab']).optional(),
  endpoint: z.string().trim().min(1).max(500).optional().nullable(),
  api_key_env_var: z.string().trim().min(1).max(200).optional(),
  project_slug: z.string().trim().min(1).max(500).optional(),
  active_states: z.array(z.string().trim().min(1).max(100)).min(1).max(50).optional(),
  terminal_states: z.array(z.string().trim().min(1).max(100)).min(1).max(50).optional(),
  assignee: z.string().trim().min(1).max(200).optional().nullable(),
  poll_interval_ms: z.number().int().min(5_000).max(86_400_000).optional(),
  enabled: z.boolean().optional(),
});

type TrackerConfigInputValue = z.infer<typeof TrackerConfigInput>;

function serializeTracker(row: TrackerConfigRow | null): Record<string, unknown> | null {
  if (row === null) return null;
  return {
    ...row,
    active_states: parseStringArray(row.active_states, DEFAULT_ACTIVE_STATES),
    terminal_states: parseStringArray(row.terminal_states, DEFAULT_TERMINAL_STATES),
    enabled: row.enabled === 1,
  };
}

function writeTrackerConfig(
  db: DbHandle,
  project: ProjectRow,
  input: TrackerConfigInputValue,
): TrackerConfigRow {
  const existing = getTrackerConfig(db, project.id);
  const now = isoNow();
  const kind = input.kind ?? existing?.kind;
  const apiKeyEnvVar = input.api_key_env_var ?? existing?.api_key_env_var;
  const projectSlug = input.project_slug ?? existing?.project_slug;
  if (kind === undefined || apiKeyEnvVar === undefined || projectSlug === undefined) {
    throw new Error('kind, api_key_env_var, and project_slug are required');
  }
  const endpoint = input.endpoint === undefined ? (existing?.endpoint ?? null) : input.endpoint;
  const terminalStates = JSON.stringify(
    input.terminal_states ?? parseStringArray(existing?.terminal_states, DEFAULT_TERMINAL_STATES),
  );
  const activeStates = JSON.stringify(
    input.active_states ?? parseStringArray(existing?.active_states, DEFAULT_ACTIVE_STATES),
  );
  const assignee = input.assignee === undefined ? (existing?.assignee ?? null) : input.assignee;
  const enabled = input.enabled === undefined ? (existing?.enabled ?? 0) : input.enabled ? 1 : 0;

  if (existing) {
    db.prepare(
      `
      UPDATE tracker_config
      SET kind=?, endpoint=?, api_key_env_var=?, project_slug=?, active_states=?,
          terminal_states=?, assignee=?, poll_interval_ms=?, enabled=?, updated_at=?
      WHERE project_id=?
    `,
    ).run(
      kind,
      endpoint ?? null,
      apiKeyEnvVar,
      projectSlug,
      activeStates,
      terminalStates,
      assignee ?? null,
      input.poll_interval_ms ?? existing.poll_interval_ms,
      enabled,
      now,
      project.id,
    );
  } else {
    db.prepare(
      `
      INSERT INTO tracker_config(id, project_id, kind, endpoint, api_key_env_var, project_slug,
                                 active_states, terminal_states, assignee, poll_interval_ms,
                                 enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      ulid(),
      project.id,
      kind,
      endpoint ?? null,
      apiKeyEnvVar,
      projectSlug,
      activeStates,
      terminalStates,
      assignee ?? null,
      input.poll_interval_ms ?? 30_000,
      enabled,
      now,
      now,
    );
  }

  const cfg = getTrackerConfig(db, project.id);
  if (!cfg) throw new Error('tracker config write failed');
  return cfg;
}

function setEnabled(db: DbHandle, project: ProjectRow, enabled: boolean): TrackerConfigRow | null {
  const cfg = getTrackerConfig(db, project.id);
  if (!cfg) return null;
  db.prepare(`UPDATE tracker_config SET enabled=?, updated_at=? WHERE project_id=?`).run(
    enabled ? 1 : 0,
    isoNow(),
    project.id,
  );
  const next = getTrackerConfig(db, project.id);
  if (enabled && next) {
    recordTrackerPollState(db, project.id, { next_poll_at: new Date().toISOString() });
  }
  return next;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function handleTracker(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean | null | undefined> {
  const m = /^\/api\/projects\/([^/]+)\/tracker(\/[a-z]+)?$/.exec(url.pathname);
  if (!m) return null;

  let code: string;
  try {
    code = decodeURIComponent(String(m[1])).trim().toUpperCase();
  } catch {
    json(res, 400, { error: 'invalid project code encoding' });
    return true;
  }
  const codeErr = validateCode(code);
  if (codeErr !== null) {
    json(res, 400, { error: codeErr });
    return true;
  }
  const sub = m[2];
  const db = await getDb(code).catch(() => null);
  if (!db) {
    json(res, 404, { error: 'project not found' });
    return true;
  }
  const project = getProject(db);
  if (!project) {
    json(res, 404, { error: 'project not found' });
    return true;
  }

  if (req.method === 'GET' && sub === undefined) {
    const cfg = getTrackerConfig(db, project.id);
    json(res, 200, { tracker: serializeTracker(cfg), status: trackerStatus(db, project.id, cfg) });
    return true;
  }

  if (req.method === 'POST' && sub === undefined) {
    const body = await readJson(req);
    const parsed = TrackerConfigInput.safeParse(body);
    if (!parsed.success) {
      json(res, 400, { error: parsed.error.issues[0]?.message ?? 'invalid body' });
      return true;
    }
    let cfg: TrackerConfigRow;
    try {
      cfg = writeTrackerConfig(db, project, parsed.data);
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      return true;
    }
    json(res, 200, {
      tracker: serializeTracker(cfg),
      status: trackerStatus(db, project.id, cfg),
    });
    return true;
  }

  if (req.method === 'POST' && sub === '/enable') {
    const cfg = setEnabled(db, project, true);
    if (!cfg) {
      json(res, 404, { error: 'no tracker configured' });
      return true;
    }
    json(res, 200, {
      ok: true,
      tracker: serializeTracker(cfg),
      status: trackerStatus(db, project.id, cfg),
    });
    return true;
  }

  if (req.method === 'POST' && sub === '/disable') {
    const cfg = setEnabled(db, project, false);
    if (!cfg) {
      json(res, 404, { error: 'no tracker configured' });
      return true;
    }
    json(res, 200, {
      ok: true,
      tracker: serializeTracker(cfg),
      status: trackerStatus(db, project.id, cfg),
    });
    return true;
  }

  if (req.method === 'POST' && sub === '/sync') {
    const cfg = getTrackerConfig(db, project.id);
    if (!cfg) {
      json(res, 404, { error: 'no tracker configured' });
      return true;
    }
    const result = await syncTracker(db, code, cfg);
    json(res, result.ok ? 200 : (result.status_code ?? 400), {
      ...result,
      status: trackerStatus(db, project.id, cfg),
    });
    return true;
  }

  if (req.method === 'GET' && sub === '/issues') {
    json(res, 200, { issues: listTrackerIssues(db, project.id) });
    return true;
  }

  return null;
}
