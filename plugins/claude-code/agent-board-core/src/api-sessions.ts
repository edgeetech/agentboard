// Read-only view of session SQLite databases.
//
// Primary source: agentboard's own session recorder at `~/.agentboard/sessions/`
// (hooks in plugins/claude-code/hooks/session/ write these). Back-compat:
// also reads context-mode's `~/.claude/context-mode/sessions/` if present,
// so users with both tools see a merged history.
//
// Overrides: `AGENTBOARD_SESSION_DIR` (primary), `INSIGHT_SESSION_DIR`
// (back-compat). DBs are opened read-only.

import { existsSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { json } from './http-util.ts';
import { listProjectDbs, getDb } from './project-registry.ts';

// ─── minimal DbHandle shape used for read-only session DBs ───────────────

interface SessionDbHandle {
  prepare(sql: string): {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
  close(): void;
}

type DbOpener = (path: string) => SessionDbHandle;

// ─── SQL row shapes ───────────────────────────────────────────────────────

interface SessionMetaRow {
  session_id: string;
  project_dir: string | null;
  started_at: string | null;
  last_event_at: string | null;
  event_count: number;
  compact_count: number;
}

interface SessionEventRow {
  id: number;
  type: string;
  category: string | null;
  priority: number | null;
  data: string | null;
  source_hook: string | null;
  created_at: string | null;
}

interface SessionResumeRow {
  snapshot: string | null;
  event_count: number;
  consumed: number;
}

interface TopFileRow {
  path: string | null;
  n: number;
}

interface DataRow {
  data: string | null;
}

interface ProjectRepoRow {
  repo_path: string | null;
}

interface AgentboardRunRow {
  sid: string | null;
  role: string | null;
  task_code: string | null;
  provider: string | null;
}

interface AgentboardEntry {
  source: 'agentboard';
  taskCode: string | null;
  role: string | null;
  provider: string;
  repoPath: string | null;
  projectCode: string;
}

interface EnrichResult {
  firstPrompt: string | null;
  intent: string | null;
  role: string | null;
  topFiles: { path: string; count: number }[];
  planFiles: string[];
}

interface DbFileEntry {
  name: string;
  path: string;
  size: number;
}

// ─── directory helpers ────────────────────────────────────────────────────

function sessionsDirs(): string[] {
  const primary = process.env.AGENTBOARD_SESSION_DIR ?? join(homedir(), '.agentboard', 'sessions');
  const legacy =
    process.env.INSIGHT_SESSION_DIR ?? join(homedir(), '.claude', 'context-mode', 'sessions');
  const seen = new Set<string>();
  return [primary, legacy].filter(
    (d): d is string => Boolean(d) && !seen.has(d) && Boolean(seen.add(d)),
  );
}

// ─── lazy SQLite opener ───────────────────────────────────────────────────

let openerPromise: Promise<DbOpener | null> | null = null;

async function getOpener(): Promise<DbOpener | null> {
  if (openerPromise) return openerPromise;
  openerPromise = (async (): Promise<DbOpener | null> => {
    try {
      type BetterSqliteCtor = new (p: string, o: Record<string, unknown>) => SessionDbHandle;
      // @ts-expect-error better-sqlite3 is optional — no @types package required
      const mod = (await import('better-sqlite3')) as { default: BetterSqliteCtor };
      return (path: string): SessionDbHandle =>
        new mod.default(path, { readonly: true, fileMustExist: true });
    } catch {
      /* fall through */
    }
    try {
      type NodeSqliteCtor = new (p: string, o: Record<string, unknown>) => SessionDbHandle;
      const mod = (await import('node:sqlite')) as { DatabaseSync: NodeSqliteCtor };
      return (path: string): SessionDbHandle =>
        new mod.DatabaseSync(path, { readOnly: true, open: true });
    } catch {
      /* fall through */
    }
    return null;
  })();
  return openerPromise;
}

// ─── utilities ────────────────────────────────────────────────────────────

function listDbFiles(dir: string): DbFileEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.db'))
    .map((n) => {
      const path = join(dir, n);
      let size = 0;
      try {
        size = statSync(path).size;
      } catch {
        /* best effort */
      }
      return { name: n, path, size };
    })
    .sort((a, b) => b.size - a.size);
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const EVENT_LIMIT = 500;
const HASH_RE = /^[a-zA-Z0-9_.-]{1,80}$/;
const PROMPT_MAX_LEN = 220;

function safeDb(db: SessionDbHandle, sql: string, params: unknown[], mode: 'get'): unknown;
function safeDb(db: SessionDbHandle, sql: string, params?: unknown[], mode?: 'all'): unknown[];
function safeDb(
  db: SessionDbHandle,
  sql: string,
  params: unknown[] = [],
  mode: 'get' | 'all' = 'all',
): unknown {
  try {
    if (typeof db.prepare !== 'function') return mode === 'get' ? null : [];
    const stmt = db.prepare(sql);
    return mode === 'get' ? stmt.get(...params) : stmt.all(...params);
  } catch {
    return mode === 'get' ? null : [];
  }
}

function normPrompt(s: unknown): string | null {
  if (s === null || s === undefined || s === '') return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > PROMPT_MAX_LEN ? t.slice(0, PROMPT_MAX_LEN) + '…' : t;
}

// ─── session enrichment ───────────────────────────────────────────────────

function enrichSession(db: SessionDbHandle, sessionId: string): EnrichResult {
  const firstRow = safeDb(
    db,
    `SELECT data FROM session_events
     WHERE session_id = ? AND type = 'user_prompt' AND LENGTH(TRIM(COALESCE(data,''))) >= 6
     ORDER BY id ASC LIMIT 1`,
    [sessionId],
    'get',
  ) as DataRow | null;

  const intentRow = safeDb(
    db,
    `SELECT data FROM session_events WHERE session_id = ? AND type = 'intent'
     ORDER BY id ASC LIMIT 1`,
    [sessionId],
    'get',
  ) as DataRow | null;

  const roleRow = safeDb(
    db,
    `SELECT data FROM session_events WHERE session_id = ? AND type = 'role'
     ORDER BY id ASC LIMIT 1`,
    [sessionId],
    'get',
  ) as DataRow | null;

  const topFiles = (
    safeDb(
      db,
      `SELECT data AS path, COUNT(*) AS n FROM session_events
     WHERE session_id = ? AND type IN ('file_edit','file_write') AND COALESCE(data,'') != ''
     GROUP BY data ORDER BY n DESC, MAX(id) DESC LIMIT 3`,
      [sessionId],
    ) as TopFileRow[]
  ).map((r) => ({ path: r.path ?? '', count: r.n }));

  const planFiles = (
    safeDb(
      db,
      `SELECT DISTINCT data FROM session_events
     WHERE session_id = ? AND type = 'plan_file_write' AND COALESCE(data,'') != ''
     ORDER BY id ASC LIMIT 3`,
      [sessionId],
    ) as DataRow[]
  ).map((r) => r.data ?? '');

  return {
    firstPrompt: normPrompt(firstRow?.data),
    intent: intentRow?.data ?? null,
    role: roleRow?.data ?? null,
    topFiles,
    planFiles,
  };
}

// ─── agentboard session map ───────────────────────────────────────────────

async function loadAgentboardSessionMap(): Promise<Map<string, AgentboardEntry>> {
  const map = new Map<string, AgentboardEntry>();
  for (const code of listProjectDbs()) {
    let db;
    try {
      db = await getDb(code);
    } catch {
      continue;
    }
    let repoPath: string | null = null;
    try {
      const proj = db.prepare(`SELECT repo_path FROM project LIMIT 1`).get() as
        | ProjectRepoRow
        | undefined;
      repoPath = proj?.repo_path ?? null;
    } catch {
      /* best effort */
    }
    let rows: AgentboardRunRow[] = [];
    try {
      rows = db
        .prepare(
          `
        SELECT r.claude_session_id AS sid, r.role AS role, t.code AS task_code,
               COALESCE(t.agent_provider_override, p.agent_provider, 'claude') AS provider
        FROM agent_run r
        LEFT JOIN task t ON t.id = r.task_id
        LEFT JOIN project p ON p.id = t.project_id
        WHERE r.claude_session_id IS NOT NULL AND r.claude_session_id != ''
      `,
        )
        .all() as AgentboardRunRow[];
    } catch {
      /* best effort */
    }
    for (const r of rows) {
      if (!r.sid) continue;
      map.set(r.sid, {
        source: 'agentboard',
        taskCode: r.task_code ?? null,
        role: r.role ?? null,
        provider: r.provider ?? 'claude',
        repoPath,
        projectCode: code,
      });
    }
  }
  return map;
}

// ─── list all sessions ────────────────────────────────────────────────────

async function listSessionsAll(res: ServerResponse): Promise<void> {
  const open = await getOpener();
  if (!open) {
    json(res, 200, { dbs: [], error: 'sqlite adapter unavailable' });
    return;
  }

  const dirs = sessionsDirs();
  const files: DbFileEntry[] = [];
  const seenPaths = new Set<string>();
  for (const d of dirs) {
    for (const f of listDbFiles(d)) {
      if (seenPaths.has(f.path)) continue;
      seenPaths.add(f.path);
      files.push(f);
    }
  }

  const dbs: unknown[] = [];
  const abMap = await loadAgentboardSessionMap();

  for (const f of files) {
    let db: SessionDbHandle | undefined;
    try {
      db = open(f.path);
    } catch {
      continue;
    }
    try {
      const rows = safeDb(
        db,
        `SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
         FROM session_meta ORDER BY started_at DESC`,
      ) as SessionMetaRow[];
      dbs.push({
        hash: f.name.replace(/\.db$/, ''),
        size: formatBytes(f.size),
        sizeBytes: f.size,
        sessions: rows.map((s) => {
          const e = enrichSession(db, s.session_id);
          const ab = abMap.get(s.session_id);
          return {
            id: s.session_id,
            projectDir: s.project_dir,
            startedAt: s.started_at,
            lastEventAt: s.last_event_at,
            eventCount: s.event_count,
            compactCount: s.compact_count,
            firstPrompt: e.firstPrompt,
            intent: e.intent,
            role: e.role ?? ab?.role ?? null,
            topFiles: e.topFiles,
            planFiles: e.planFiles,
            source: ab ? 'agentboard' : 'cli',
          };
        }),
      });
    } catch {
      // schema mismatch — skip
    } finally {
      try {
        db.close();
      } catch {
        /* best effort */
      }
    }
  }
  json(res, 200, { dir: dirs[0], dirs, dbs });
}

// ─── list events for a single session ────────────────────────────────────

function isSafeHash(s: unknown): s is string {
  return typeof s === 'string' && HASH_RE.test(s);
}

async function listSessionEvents(
  res: ServerResponse,
  hash: string,
  sessionId: string,
): Promise<void> {
  const open = await getOpener();
  if (!open) {
    json(res, 200, { events: [], resume: null, error: 'sqlite adapter unavailable' });
    return;
  }
  if (!isSafeHash(hash)) {
    json(res, 400, { error: 'invalid hash' });
    return;
  }

  let dbPath: string | null = null;
  for (const d of sessionsDirs()) {
    const candidate = join(d, hash + '.db');
    if (existsSync(candidate)) {
      dbPath = candidate;
      break;
    }
  }
  if (!dbPath) {
    json(res, 404, { error: 'db not found' });
    return;
  }

  let db: SessionDbHandle;
  try {
    db = open(dbPath);
  } catch (e) {
    json(res, 500, { error: String((e instanceof Error ? e.message : null) ?? e) });
    return;
  }

  try {
    const meta = safeDb(
      db,
      `SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta WHERE session_id = ?`,
      [sessionId],
      'get',
    ) as SessionMetaRow | null;

    const events = safeDb(
      db,
      `SELECT id, type, category, priority, data, source_hook, created_at
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ${EVENT_LIMIT}`,
      [sessionId],
    ) as SessionEventRow[];

    const resume = safeDb(
      db,
      `SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?`,
      [sessionId],
      'get',
    ) as SessionResumeRow | null;

    const enrich = meta ? enrichSession(db, sessionId) : null;
    const abMap = await loadAgentboardSessionMap();
    const ab = abMap.get(sessionId);

    json(res, 200, {
      hash,
      sessionId,
      meta,
      events,
      resume,
      enrich,
      provider: ab?.provider ?? 'claude',
    });
    return;
  } finally {
    try {
      db.close();
    } catch {
      /* best effort */
    }
  }
}

// ─── public handler ───────────────────────────────────────────────────────

export async function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<true | null> {
  if (req.method !== 'GET') return null;

  if (url.pathname === '/api/sessions') {
    await listSessionsAll(res);
    return true;
  }

  const m = /^\/api\/sessions\/([^/]+)\/events\/(.+)$/.exec(url.pathname);
  if (m) {
    const hash = decodeURIComponent(m[1] ?? '');
    const sessionId = decodeURIComponent(m[2] ?? '');
    await listSessionEvents(res, hash, sessionId);
    return true;
  }

  return null;
}
