// Read-only HTTP view of recorded sessions.
//
// Primary source: AgentBoard's own session recorder at `~/.agentboard/sessions/`
// (hooks in plugins/claude-code/hooks/session/ write these). Back-compat: also
// reads context-mode's session dir so users with both tools see one history.
// Overrides: `AGENTBOARD_SESSION_DIR` (primary), `INSIGHT_SESSION_DIR` (legacy).
//
// Listing is served from SessionIndex (worker-thread scans, paged); the detail
// endpoint opens a single DB and pages its events.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { json } from './http-util.ts';
import { listProjectDbs, getDb } from './project-registry.ts';
import {
  SessionIndex,
  workerScanner,
  type SessionLink,
  type SessionSourceFilter,
} from './session-index.ts';
import {
  deleteAgentboardSessions as deleteSessionsFromStore,
  getReadOpener,
  isSafeHash,
  readSessionDetail,
  resolveDbPath,
  sessionsDirs,
} from './session-store.ts';

interface AgentboardRunRow {
  sid: string | null;
  role: string | null;
  task_code: string | null;
  provider: string | null;
}

/** Map session id → AgentBoard run metadata across every project DB. */
async function loadAgentboardLinks(): Promise<Map<string, SessionLink>> {
  const map = new Map<string, SessionLink>();
  for (const code of listProjectDbs()) {
    const db = await getDb(code).catch(() => null);
    if (!db) continue;
    let repoPath: string | null = null;
    let rows: AgentboardRunRow[] = [];
    try {
      const proj = db.prepare(`SELECT repo_path FROM project LIMIT 1`).get() as
        | { repo_path: string | null }
        | undefined;
      repoPath = proj?.repo_path ?? null;
      rows = db
        .prepare(
          `SELECT COALESCE(r.session_id, r.claude_session_id) AS sid, r.role AS role,
                  t.code AS task_code,
                  COALESCE(r.session_provider, t.agent_provider_override, p.agent_provider, 'claude') AS provider
           FROM agent_run r
           LEFT JOIN task t ON t.id = r.task_id
           LEFT JOIN project p ON p.id = t.project_id
           WHERE COALESCE(r.session_id, r.claude_session_id, '') != ''`,
        )
        .all() as AgentboardRunRow[];
    } catch {
      continue;
    }
    for (const r of rows) {
      if (r.sid === null) continue;
      map.set(r.sid, {
        taskCode: r.task_code,
        role: r.role,
        provider: r.provider ?? 'claude',
        repoPath,
        projectCode: code,
      });
    }
  }
  return map;
}

let index: SessionIndex | null = null;

export function getSessionIndex(): SessionIndex {
  index ??= new SessionIndex({
    dirs: sessionsDirs,
    scanner: workerScanner(),
    links: loadAgentboardLinks,
  });
  return index;
}

/** Delete AgentBoard-linked sessions and make the index notice immediately. */
export async function deleteAgentboardSessions(sessionIds: readonly string[]): Promise<number> {
  const deleted = await deleteSessionsFromStore(sessionIds);
  getSessionIndex().invalidate();
  return deleted;
}

const SOURCES: readonly SessionSourceFilter[] = ['all', 'agentboard', 'cli'];

function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function listSessions(res: ServerResponse, url: URL): Promise<void> {
  if (!(await getReadOpener())) {
    json(res, 503, { error: 'sqlite adapter unavailable' });
    return;
  }
  const source = url.searchParams.get('source') ?? 'all';
  if (!SOURCES.includes(source as SessionSourceFilter)) {
    json(res, 400, { error: 'invalid source' });
    return;
  }
  const page = await getSessionIndex().query({
    q: url.searchParams.get('q') ?? '',
    source: source as SessionSourceFilter,
    offset: intParam(url, 'offset'),
    limit: intParam(url, 'limit'),
  });
  json(res, 200, page);
}

async function sessionDetail(
  res: ServerResponse,
  url: URL,
  hash: string,
  sessionId: string,
): Promise<void> {
  if (!isSafeHash(hash)) {
    json(res, 400, { error: 'invalid hash' });
    return;
  }
  const open = await getReadOpener();
  if (!open) {
    json(res, 503, { error: 'sqlite adapter unavailable' });
    return;
  }
  const dbPath = resolveDbPath(hash);
  if (dbPath === null) {
    json(res, 404, { error: 'db not found' });
    return;
  }

  let db: ReturnType<typeof open>;
  try {
    db = open(dbPath);
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    return;
  }
  try {
    const detail = readSessionDetail(db, sessionId, {
      after: intParam(url, 'after'),
      limit: intParam(url, 'limit'),
    });
    if (!detail.meta && detail.events.length === 0) {
      json(res, 404, { error: 'session not found' });
      return;
    }
    const link = await getSessionIndex().linkFor(sessionId);
    json(res, 200, {
      hash,
      sessionId,
      ...detail,
      provider: link?.provider ?? 'claude',
      taskCode: link?.taskCode ?? null,
      projectCode: link?.projectCode ?? null,
      repoPath: link?.repoPath ?? null,
    });
  } finally {
    try {
      db.close();
    } catch {
      /* best effort */
    }
  }
}

export async function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<true | null> {
  if (req.method !== 'GET') return null;

  if (url.pathname === '/api/sessions') {
    await listSessions(res, url);
    return true;
  }

  const m = /^\/api\/sessions\/([^/]+)\/events\/(.+)$/.exec(url.pathname);
  if (m) {
    await sessionDetail(res, url, decodeURIComponent(m[1] ?? ''), decodeURIComponent(m[2] ?? ''));
    return true;
  }

  return null;
}
