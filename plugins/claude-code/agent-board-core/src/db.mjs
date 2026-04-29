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
        run: (...args) => {
          // Count placeholders to match args
          const placeholderCount = (sql.match(/\?/g) || []).length;
          if (args.length === placeholderCount) {
            // For node:sqlite, pass args as array for positional parameters
            return stmt.run(...args);
          }
          return stmt.run(...args);
        },
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

// Idempotent migrations for existing DBs. Each runs inside a try/catch so
// expected failures (table already dropped, column already exists) are silent.
const MIGRATIONS = [
  // Add agent_provider column to project table (for agent provider selection)
  { sql: `ALTER TABLE project ADD COLUMN agent_provider TEXT NOT NULL DEFAULT 'claude' CHECK (agent_provider IN ('claude','github_copilot'))`,
    why: 'add agent_provider column to support claude/github_copilot selection' },
  // task_attachment: create if not exists (existing DBs opened before schema bump).
  { sql: `CREATE TABLE IF NOT EXISTS task_attachment (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES task(id),
    file_path TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
  )`, why: 'add task_attachment table for file path attachments' },
  { sql: `CREATE INDEX IF NOT EXISTS idx_attachment_task ON task_attachment(task_id, created_at)`,
    why: 'index for attachment lookups' },
  // Ensure agent_run table and indices exist (re-enabled agent spawning system)
  { sql: `CREATE TABLE IF NOT EXISTS agent_run (
    id                     TEXT PRIMARY KEY,
    task_id                TEXT NOT NULL REFERENCES task(id),
    role                   TEXT NOT NULL CHECK (role IN ('pm','worker','reviewer')),
    status                 TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','blocked','cancelled')),
    token                  TEXT,
    pid                    INTEGER,
    claude_session_id      TEXT,
    error                  TEXT,
    logs_path              TEXT,
    summary                TEXT,
    model                  TEXT,
    input_tokens           INTEGER NOT NULL DEFAULT 0,
    output_tokens          INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
    cost_usd               REAL NOT NULL DEFAULT 0,
    cost_version           INTEGER NOT NULL DEFAULT 0,
    attempt                INTEGER NOT NULL DEFAULT 1,
    last_heartbeat_at      TEXT,
    queued_at              TEXT NOT NULL,
    started_at             TEXT,
    ended_at               TEXT,
    prompt_template        TEXT
  )`, why: 'add agent_run table for agent execution queue' },
  { sql: `CREATE INDEX IF NOT EXISTS idx_agent_run_running ON agent_run(status, last_heartbeat_at)`,
    why: 'index for finding running runs' },
  { sql: `CREATE INDEX IF NOT EXISTS idx_agent_run_task_queued ON agent_run(task_id, queued_at DESC)`,
    why: 'index for task run history' },
  { sql: `CREATE INDEX IF NOT EXISTS idx_agent_run_cost ON agent_run(task_id, ended_at) WHERE status IN ('succeeded','failed','blocked','cancelled')`,
    why: 'index for cost calculations' },
  { sql: `ALTER TABLE task ADD COLUMN workspace_path TEXT`,
    why: 'add workspace_path column for workspace isolation' },
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
