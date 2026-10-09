// Data access for session-recorder SQLite databases (one DB per repo, many
// sessions per DB). Pure functions over an opened handle so the same code runs
// on the main thread, inside the session-index worker thread, and in tests.
//
// Query shape matters: listing issues a constant number of grouped queries per
// DB file instead of N queries per session, which is what froze the server when
// a user had tens of thousands of recorded sessions.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SessionDbHandle {
  prepare(sql: string): {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
  exec?(sql: string): void;
  close(): void;
}

export type SessionDbOpener = (path: string) => SessionDbHandle;

export interface SessionSummary {
  dbHash: string;
  id: string;
  projectDir: string | null;
  startedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
  compactCount: number;
  firstPrompt: string | null;
  intent: string | null;
  role: string | null;
}

export interface SessionEventRow {
  id: number;
  type: string;
  category: string | null;
  priority: number | null;
  data: string | null;
  source_hook: string | null;
  created_at: string | null;
}

export interface SessionMetaRow {
  session_id: string;
  project_dir: string | null;
  started_at: string | null;
  last_event_at: string | null;
  event_count: number;
  compact_count: number;
}

export interface SessionEnrichment {
  firstPrompt: string | null;
  intent: string | null;
  role: string | null;
  topFiles: { path: string; count: number }[];
  planFiles: string[];
}

export interface SessionDetail {
  meta: SessionMetaRow | null;
  events: SessionEventRow[];
  hasMore: boolean;
  totalEvents: number;
  typeCounts: { type: string; count: number }[];
  firstEventAt: string | null;
  lastEventAt: string | null;
  resume: { snapshot: string | null; event_count: number; consumed: number } | null;
  enrich: SessionEnrichment | null;
}

const PROMPT_MAX_LEN = 220;
const HASH_RE = /^[a-zA-Z0-9_.-]{1,80}$/;
export const DEFAULT_EVENT_PAGE = 300;
export const MAX_EVENT_PAGE = 1000;

// ─── directories ──────────────────────────────────────────────────────────

export function primarySessionsDir(): string {
  return process.env.AGENTBOARD_SESSION_DIR ?? join(homedir(), '.agentboard', 'sessions');
}

/**
 * Primary AgentBoard recorder dir first, then context-mode's legacy dir. The
 * legacy dir honours CLAUDE_CONFIG_DIR because context-mode writes under the
 * active Claude config dir, which is not always `~/.claude`.
 */
export function sessionsDirs(): string[] {
  const candidates = [primarySessionsDir()];
  if (process.env.INSIGHT_SESSION_DIR !== undefined) {
    candidates.push(process.env.INSIGHT_SESSION_DIR);
  } else {
    const configDir = process.env.CLAUDE_CONFIG_DIR;
    if (configDir !== undefined && configDir !== '') {
      candidates.push(join(configDir, 'context-mode', 'sessions'));
    }
    candidates.push(join(homedir(), '.claude', 'context-mode', 'sessions'));
  }
  return [...new Set(candidates.filter((d) => d !== ''))];
}

export function isSafeHash(s: unknown): s is string {
  return typeof s === 'string' && HASH_RE.test(s);
}

export function hashOf(fileName: string): string {
  return fileName.replace(/\.db$/, '');
}

export function listDbFileNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.db'));
  } catch {
    return [];
  }
}

export function resolveDbPath(hash: string): string | null {
  if (!isSafeHash(hash)) return null;
  for (const d of sessionsDirs()) {
    const candidate = join(d, `${hash}.db`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ─── sqlite adapter ───────────────────────────────────────────────────────

let readOpenerPromise: Promise<SessionDbOpener | null> | null = null;
let writeOpenerPromise: Promise<SessionDbOpener | null> | null = null;

async function loadOpener(readonly: boolean): Promise<SessionDbOpener | null> {
  try {
    type BetterSqliteCtor = new (p: string, o: Record<string, unknown>) => SessionDbHandle;
    // @ts-expect-error better-sqlite3 is optional — no @types package required
    const mod = (await import('better-sqlite3')) as { default: BetterSqliteCtor };
    return (path) => new mod.default(path, readonly ? { readonly: true, fileMustExist: true } : {});
  } catch {
    /* fall through */
  }
  try {
    type NodeSqliteCtor = new (p: string, o: Record<string, unknown>) => SessionDbHandle;
    const mod = (await import('node:sqlite')) as { DatabaseSync: NodeSqliteCtor };
    return (path) => new mod.DatabaseSync(path, readonly ? { readOnly: true, open: true } : {});
  } catch {
    return null;
  }
}

export function getReadOpener(): Promise<SessionDbOpener | null> {
  readOpenerPromise ??= loadOpener(true);
  return readOpenerPromise;
}

export function getWriteOpener(): Promise<SessionDbOpener | null> {
  writeOpenerPromise ??= loadOpener(false);
  return writeOpenerPromise;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function safeAll<T>(db: SessionDbHandle, sql: string, params: unknown[] = []): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function safeGet(db: SessionDbHandle, sql: string, params: unknown[] = []): unknown {
  try {
    return db.prepare(sql).get(...params) ?? null;
  } catch {
    return null;
  }
}

function normPrompt(s: unknown): string | null {
  if (typeof s !== 'string' || s === '') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > PROMPT_MAX_LEN ? `${t.slice(0, PROMPT_MAX_LEN)}…` : t;
}

const SQLITE_UTC_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * SQLite `datetime('now')` yields "YYYY-MM-DD HH:MM:SS" in UTC with no zone
 * marker; browsers parse that as local time, skewing every "x ago" label by
 * the user's UTC offset. Emit ISO-8601 with an explicit Z.
 */
export function toIsoUtc(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return SQLITE_UTC_RE.test(value) ? `${value.replace(' ', 'T')}Z` : value;
}

function normalizeMeta(row: SessionMetaRow): SessionMetaRow {
  return {
    ...row,
    started_at: toIsoUtc(row.started_at),
    last_event_at: toIsoUtc(row.last_event_at),
  };
}

// ─── listing ──────────────────────────────────────────────────────────────

interface FirstEventRow {
  session_id: string;
  type: string;
  data: string | null;
}

/** All sessions in one DB with list-level enrichment, in O(1) queries. */
export function readSessionSummaries(db: SessionDbHandle, dbHash: string): SessionSummary[] {
  const metas = safeAll<SessionMetaRow>(
    db,
    `SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
     FROM session_meta`,
  );
  if (metas.length === 0) return [];

  const firsts = safeAll<FirstEventRow>(
    db,
    `SELECT e.session_id, e.type, e.data
     FROM session_events e
     JOIN (
       SELECT MIN(id) AS mid FROM session_events
       WHERE type IN ('intent', 'role')
          OR (type = 'user_prompt' AND LENGTH(TRIM(COALESCE(data, ''))) >= 6)
       GROUP BY session_id, type
     ) f ON e.id = f.mid`,
  );
  const bySession = new Map<string, { prompt?: string | null; intent?: string; role?: string }>();
  for (const row of firsts) {
    const entry = bySession.get(row.session_id) ?? {};
    if (row.type === 'user_prompt') entry.prompt = row.data;
    else if (row.type === 'intent' && row.data !== null) entry.intent = row.data;
    else if (row.type === 'role' && row.data !== null) entry.role = row.data;
    bySession.set(row.session_id, entry);
  }

  return metas.map((m) => {
    const e = bySession.get(m.session_id);
    return {
      dbHash,
      id: m.session_id,
      projectDir: m.project_dir,
      startedAt: toIsoUtc(m.started_at),
      lastEventAt: toIsoUtc(m.last_event_at),
      eventCount: m.event_count,
      compactCount: m.compact_count,
      firstPrompt: normPrompt(e?.prompt),
      intent: e?.intent ?? null,
      role: e?.role ?? null,
    };
  });
}

// ─── detail ───────────────────────────────────────────────────────────────

function readEnrichment(db: SessionDbHandle, sessionId: string): SessionEnrichment {
  const first = (type: string, extra = ''): string | null =>
    (
      safeGet(
        db,
        `SELECT data FROM session_events WHERE session_id = ? AND type = ? ${extra}
       ORDER BY id ASC LIMIT 1`,
        [sessionId, type],
      ) as { data: string | null } | null
    )?.data ?? null;

  const topFiles = safeAll<{ path: string | null; n: number }>(
    db,
    `SELECT data AS path, COUNT(*) AS n FROM session_events
     WHERE session_id = ? AND type IN ('file_edit','file_write') AND COALESCE(data,'') != ''
     GROUP BY data ORDER BY n DESC, MAX(id) DESC LIMIT 3`,
    [sessionId],
  ).map((r) => ({ path: r.path ?? '', count: r.n }));

  const planFiles = safeAll<{ data: string | null }>(
    db,
    `SELECT data FROM session_events
     WHERE session_id = ? AND type = 'plan_file_write' AND COALESCE(data,'') != ''
     GROUP BY data ORDER BY MIN(id) ASC LIMIT 3`,
    [sessionId],
  ).map((r) => r.data ?? '');

  return {
    firstPrompt: normPrompt(first('user_prompt', "AND LENGTH(TRIM(COALESCE(data,''))) >= 6")),
    intent: first('intent'),
    role: first('role'),
    topFiles,
    planFiles,
  };
}

export function readSessionDetail(
  db: SessionDbHandle,
  sessionId: string,
  page: { after?: number | undefined; limit?: number | undefined } = {},
): SessionDetail {
  const limit = Math.min(Math.max(1, page.limit ?? DEFAULT_EVENT_PAGE), MAX_EVENT_PAGE);
  const after = page.after ?? 0;
  const metaRow = safeGet(
    db,
    `SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
     FROM session_meta WHERE session_id = ?`,
    [sessionId],
  ) as SessionMetaRow | null;

  // Fetch one extra row to learn whether another page exists without COUNT(*).
  const rows = safeAll<SessionEventRow>(
    db,
    `SELECT id, type, category, priority, data, source_hook, created_at
     FROM session_events WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
    [sessionId, after, limit + 1],
  );
  const hasMore = rows.length > limit;
  const events = (hasMore ? rows.slice(0, limit) : rows).map((e) => ({
    ...e,
    created_at: toIsoUtc(e.created_at),
  }));

  const typeCounts = safeAll<{ type: string; count: number }>(
    db,
    `SELECT type, COUNT(*) AS count FROM session_events WHERE session_id = ?
     GROUP BY type ORDER BY count DESC`,
    [sessionId],
  );
  const bounds = safeGet(
    db,
    `SELECT MIN(created_at) AS first, MAX(created_at) AS last
     FROM session_events WHERE session_id = ?`,
    [sessionId],
  ) as { first: string | null; last: string | null } | null;
  const resume = safeGet(
    db,
    `SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?`,
    [sessionId],
  ) as { snapshot: string | null; event_count: number; consumed: number } | null;

  return {
    meta: metaRow ? normalizeMeta(metaRow) : null,
    events,
    hasMore,
    totalEvents: typeCounts.reduce((n, t) => n + t.count, 0),
    typeCounts,
    firstEventAt: toIsoUtc(bounds?.first),
    lastEventAt: toIsoUtc(bounds?.last),
    resume,
    // Enrichment is page-independent; only compute it for the first page.
    enrich: metaRow && after === 0 ? readEnrichment(db, sessionId) : null,
  };
}

// ─── cleanup ──────────────────────────────────────────────────────────────

/**
 * Remove session rows explicitly linked to AgentBoard runs. Only the primary
 * AgentBoard session directory is writable; the legacy context-mode directory
 * remains a read-only compatibility source.
 */
export async function deleteAgentboardSessions(sessionIds: readonly string[]): Promise<number> {
  const ids = [...new Set(sessionIds.filter((id) => id !== ''))];
  if (ids.length === 0) return 0;

  const open = await getWriteOpener();
  if (!open) throw new Error('sqlite adapter unavailable for session cleanup');

  const dir = primarySessionsDir();
  let deleted = 0;
  for (const name of listDbFileNames(dir)) {
    let db: SessionDbHandle | undefined;
    try {
      db = open(join(dir, name));
      deleted += deleteFromDb(db, ids);
    } finally {
      try {
        db?.close();
      } catch {
        /* best effort */
      }
    }
  }
  return deleted;
}

function deleteFromDb(db: SessionDbHandle, ids: readonly string[]): number {
  if (typeof db.exec !== 'function') throw new Error('sqlite handle is not writable');
  db.prepare('PRAGMA busy_timeout = 5000').run();
  const tables = new Set(
    safeAll<{ name?: unknown }>(db, "SELECT name FROM sqlite_master WHERE type='table'")
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string'),
  );
  if (!tables.has('session_meta')) return 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    const before = db
      .prepare(
        `SELECT COUNT(*) AS count FROM session_meta WHERE session_id IN (${ids.map(() => '?').join(',')})`,
      )
      .get(...ids) as { count?: unknown } | undefined;
    for (const table of ['session_events', 'session_resume', 'session_meta']) {
      if (!tables.has(table)) continue;
      const stmt = db.prepare(`DELETE FROM ${table} WHERE session_id = ?`);
      for (const id of ids) stmt.run(id);
    }
    db.exec('COMMIT');
    return typeof before?.count === 'number' ? before.count : 0;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* preserve the original cleanup error */
    }
    throw error;
  }
}
