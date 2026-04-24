// Read-only view of the context-mode session SQLite databases.
//
// Mirrors the data shape of the ctx-insight `/api/sessions` endpoint so the
// AgentBoard UI can show the same "All recorded AI coding sessions" list
// without depending on the ctx-insight server being running.
//
// Source dir defaults to `~/.claude/context-mode/sessions/` and can be
// overridden via the `INSIGHT_SESSION_DIR` env var. DBs are opened in
// read-only mode — we never write to another tool's data.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { json } from './http-util.mjs';

function sessionsDir() {
  return process.env.INSIGHT_SESSION_DIR || join(homedir(), '.claude', 'context-mode', 'sessions');
}

let openerPromise = null;
async function getOpener() {
  if (openerPromise) return openerPromise;
  openerPromise = (async () => {
    try {
      const mod = await import('better-sqlite3');
      return (path) => new mod.default(path, { readonly: true, fileMustExist: true });
    } catch {}
    try {
      const mod = await import('node:sqlite');
      return (path) => new mod.DatabaseSync(path, { readOnly: true, open: true });
    } catch {}
    return null;
  })();
  return openerPromise;
}

function listDbFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(n => n.endsWith('.db'))
    .map(n => {
      const path = join(dir, n);
      let size = 0;
      try { size = statSync(path).size; } catch {}
      return { name: n, path, size };
    })
    .sort((a, b) => b.size - a.size);
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const EVENT_LIMIT = 500;
const HASH_RE = /^[a-zA-Z0-9_.-]{1,80}$/;
const PROMPT_MAX_LEN = 220;

/** Run a prepared statement catching any error (missing tables, etc.).
 *  `mode` is 'get' → single row|null, 'all' → rows[]. */
function safeDb(db, sql, params = [], mode = 'all') {
  try {
    if (typeof db.prepare !== 'function') return mode === 'get' ? null : [];
    const stmt = db.prepare(sql);
    return mode === 'get' ? stmt.get(...params) : stmt.all(...params);
  } catch {
    return mode === 'get' ? null : [];
  }
}

/** Pull human-readable signals from session_events so the Sessions list can
 *  show a title + tags instead of just the project directory. Best-effort;
 *  every field is optional and missing-table-safe. */
function normPrompt(s) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > PROMPT_MAX_LEN ? t.slice(0, PROMPT_MAX_LEN) + '…' : t;
}

function enrichSession(db, sessionId) {
  const firstRow = safeDb(db,
    `SELECT data FROM session_events
     WHERE session_id = ? AND type = 'user_prompt' AND LENGTH(TRIM(COALESCE(data,''))) >= 6
     ORDER BY id ASC LIMIT 1`,
    [sessionId], 'get');
  const intentRow = safeDb(db,
    `SELECT data FROM session_events WHERE session_id = ? AND type = 'intent'
     ORDER BY id ASC LIMIT 1`,
    [sessionId], 'get');
  const roleRow = safeDb(db,
    `SELECT data FROM session_events WHERE session_id = ? AND type = 'role'
     ORDER BY id ASC LIMIT 1`,
    [sessionId], 'get');
  const topFiles = safeDb(db,
    `SELECT data AS path, COUNT(*) AS n FROM session_events
     WHERE session_id = ? AND type IN ('file_edit','file_write') AND COALESCE(data,'') != ''
     GROUP BY data ORDER BY n DESC, MAX(id) DESC LIMIT 3`,
    [sessionId]).map(r => ({ path: r.path, count: r.n }));
  const planFiles = safeDb(db,
    `SELECT DISTINCT data FROM session_events
     WHERE session_id = ? AND type = 'plan_file_write' AND COALESCE(data,'') != ''
     ORDER BY id ASC LIMIT 3`,
    [sessionId]).map(r => String(r.data || ''));

  return {
    firstPrompt: normPrompt(firstRow?.data),
    intent: intentRow?.data ? String(intentRow.data) : null,
    role: roleRow?.data ? String(roleRow.data) : null,
    topFiles,
    planFiles,
  };
}

async function listSessionsAll(res) {
  const open = await getOpener();
  if (!open) return json(res, 200, { dbs: [], error: 'sqlite adapter unavailable' });

  const dir = sessionsDir();
  const files = listDbFiles(dir);
  const dbs = [];

  for (const f of files) {
    let db;
    try { db = open(f.path); } catch { continue; }
    try {
      const rows = safeDb(db,
        `SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
         FROM session_meta ORDER BY started_at DESC`);
      dbs.push({
        hash: f.name.replace(/\.db$/, ''),
        size: formatBytes(f.size),
        sizeBytes: f.size,
        sessions: rows.map(s => {
          const e = enrichSession(db, s.session_id);
          return {
            id: s.session_id,
            projectDir: s.project_dir,
            startedAt: s.started_at,
            lastEventAt: s.last_event_at,
            eventCount: s.event_count,
            compactCount: s.compact_count,
            firstPrompt: e.firstPrompt,
            intent: e.intent,
            role: e.role,
            topFiles: e.topFiles,
            planFiles: e.planFiles,
          };
        }),
      });
    } catch {
      // schema mismatch — skip
    } finally {
      try { db.close(); } catch {}
    }
  }
  return json(res, 200, { dir, dbs });
}

function isSafeHash(s) { return typeof s === 'string' && HASH_RE.test(s); }

async function listSessionEvents(res, hash, sessionId) {
  const open = await getOpener();
  if (!open) return json(res, 200, { events: [], resume: null, error: 'sqlite adapter unavailable' });
  if (!isSafeHash(hash)) return json(res, 400, { error: 'invalid hash' });

  const dbPath = join(sessionsDir(), hash + '.db');
  if (!existsSync(dbPath)) return json(res, 404, { error: 'db not found' });

  let db;
  try { db = open(dbPath); }
  catch (e) { return json(res, 500, { error: String(e?.message || e) }); }

  try {
    const meta = safeDb(db,
      `SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta WHERE session_id = ?`,
      [sessionId], 'get');
    const events = safeDb(db,
      `SELECT id, type, category, priority, data, source_hook, created_at
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ${EVENT_LIMIT}`,
      [sessionId]);
    const resume = safeDb(db,
      `SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?`,
      [sessionId], 'get');
    const enrich = meta ? enrichSession(db, sessionId) : null;
    return json(res, 200, { hash, sessionId, meta, events, resume, enrich });
  } finally {
    try { db.close(); } catch {}
  }
}

export async function handleSessions(req, res, url) {
  if (req.method !== 'GET') return null;

  if (url.pathname === '/api/sessions') return listSessionsAll(res);

  const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events\/(.+)$/);
  if (m) {
    const hash = decodeURIComponent(m[1]);
    const sessionId = decodeURIComponent(m[2]);
    return listSessionEvents(res, hash, sessionId);
  }

  return null;
}
