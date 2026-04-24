// Lazy SQLite adapter. Prefers better-sqlite3 (vendored); falls back to node:sqlite.

import { readFileSync, existsSync } from 'node:fs';

const SCHEMA_SQL_PATH = new URL('../db/schema.sql', import.meta.url);

let adapter = null; // { open(path) -> Database }

async function loadAdapter() {
  if (adapter) return adapter;
  // Prefer node:sqlite (built-in, zero-install, Node 22+ with --experimental-sqlite)
  try {
    const mod = await import('node:sqlite');
    adapter = {
      open(path) {
        const db = new mod.DatabaseSync(path);
        db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        return wrapNode(db);
      },
    };
    return adapter;
  } catch { /* fall through to optional better-sqlite3 */ }

  try {
    const mod = await import('better-sqlite3');
    adapter = {
      open(path) {
        const db = new mod.default(path);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
        return wrapBetter(db);
      },
    };
    return adapter;
  } catch (e) {
    throw new Error(
      'agentboard: node:sqlite unavailable (need Node ≥22 with --experimental-sqlite) and better-sqlite3 not installed. ' +
      'Root cause: ' + (e instanceof Error ? e.message : String(e))
    );
  }
}

function wrapBetter(db) {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
      };
    },
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  };
}

function wrapNode(db) {
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
      };
    },
    transaction: (fn) => {
      return (...args) => {
        db.exec('BEGIN');
        try { const r = fn(...args); db.exec('COMMIT'); return r; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      };
    },
    close: () => db.close(),
  };
}

const SCHEMA_SQL = readFileSync(SCHEMA_SQL_PATH, 'utf8');

// Lightweight migrations for existing DBs. Each entry: (sql, why). Errors are
// swallowed — the expected failure mode is "column already exists" on an
// already-migrated DB, which is fine.
const MIGRATIONS = [
  { sql: `ALTER TABLE agent_run ADD COLUMN claude_session_id TEXT`,
    why: 'store claude --session-id for resume' },
];

function applyMigrations(db) {
  for (const m of MIGRATIONS) {
    try { db.exec(m.sql); } catch { /* idempotent: column/table already present */ }
  }
}

// Open project DB, run idempotent schema, apply migrations, return handle.
export async function openProjectDb(path) {
  const a = await loadAdapter();
  const db = a.open(path);
  db.exec(SCHEMA_SQL);
  applyMigrations(db);
  return db;
}

export function dbExists(path) { return existsSync(path); }
