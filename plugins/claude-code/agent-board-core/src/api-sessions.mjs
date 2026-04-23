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

function safeAll(db, sql) {
  try {
    if (typeof db.prepare === 'function') return db.prepare(sql).all();
  } catch {}
  return [];
}

export async function handleSessions(req, res, url) {
  if (url.pathname !== '/api/sessions' || req.method !== 'GET') return null;

  const open = await getOpener();
  if (!open) {
    return json(res, 200, { dbs: [], error: 'sqlite adapter unavailable' });
  }

  const dir = sessionsDir();
  const files = listDbFiles(dir);
  const dbs = [];

  for (const f of files) {
    let db;
    try { db = open(f.path); } catch { continue; }
    try {
      const rows = safeAll(
        db,
        `SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
         FROM session_meta ORDER BY started_at DESC`
      );
      dbs.push({
        hash: f.name.replace(/\.db$/, ''),
        size: formatBytes(f.size),
        sizeBytes: f.size,
        sessions: rows.map(s => ({
          id: s.session_id,
          projectDir: s.project_dir,
          startedAt: s.started_at,
          lastEventAt: s.last_event_at,
          eventCount: s.event_count,
          compactCount: s.compact_count,
        })),
      });
    } catch {
      // Ignore DBs without expected schema
    } finally {
      try { db.close(); } catch {}
    }
  }

  return json(res, 200, { dir, dbs });
}
