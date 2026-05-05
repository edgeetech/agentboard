// Lazy SQLite adapter. Prefers better-sqlite3 (vendored); falls back to node:sqlite.

import { readFileSync, existsSync } from 'node:fs';

export interface DbHandle {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
  transaction: <T>(fn: (...args: unknown[]) => T) => (...args: unknown[]) => T;
  close(): void;
}

interface Adapter {
  open(path: string): DbHandle;
}

interface StmtLike {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
}

interface BetterLikeDb {
  exec(sql: string): unknown;
  prepare(sql: string): StmtLike;
  pragma(value: string): unknown;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
}

interface NodeLikeDb {
  exec(sql: string): unknown;
  prepare(sql: string): StmtLike;
  close(): void;
}

const SCHEMA_SQL_PATH = new URL('../db/schema.sql', import.meta.url);

let adapter: Adapter | null = null;

async function loadAdapter(): Promise<Adapter> {
  if (adapter) return adapter;
  // Prefer node:sqlite (built-in, zero-install, Node 22+ with --experimental-sqlite)
  try {
    const mod = await import('node:sqlite');
    adapter = {
      open(path: string): DbHandle {
        const db = new mod.DatabaseSync(path);
        db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        return wrapNode(db as unknown as NodeLikeDb);
      },
    };
    return adapter;
  } catch { /* fall through to optional better-sqlite3 */ }

  try {
    // @ts-expect-error better-sqlite3 is optional — no @types package required
    const mod = await import('better-sqlite3') as { default: new (path: string) => BetterLikeDb };
    adapter = {
      open(path: string): DbHandle {
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

function wrapBetter(db: BetterLikeDb): DbHandle {
  return {
    exec: (sql: string): unknown => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        run: (...args: unknown[]): unknown => stmt.run(...args),
        get: (...args: unknown[]): unknown => stmt.get(...args),
        all: (...args: unknown[]): unknown[] => stmt.all(...args),
      };
    },
    transaction: <T>(fn: (...args: unknown[]) => T): ((...args: unknown[]) => T) => db.transaction(fn),
    close: (): void => { db.close(); },
  };
}

function wrapNode(db: NodeLikeDb): DbHandle {
  return {
    exec: (sql: string): unknown => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        run: (...args: unknown[]): unknown => {
          // Count placeholders to match args
          const placeholderCount = (sql.match(/\?/g) ?? []).length;
          if (args.length === placeholderCount) {
            // For node:sqlite, pass args as array for positional parameters
            return stmt.run(...args);
          }
          return stmt.run(...args);
        },
        get: (...args: unknown[]): unknown => stmt.get(...args),
        all: (...args: unknown[]): unknown[] => stmt.all(...args),
      };
    },
    transaction: <T>(fn: (...args: unknown[]) => T): ((...args: unknown[]) => T) => {
      return (...args: unknown[]): T => {
        db.exec('BEGIN');
        try { const r = fn(...args); db.exec('COMMIT'); return r; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      };
    },
    close: (): void => { db.close(); },
  };
}

const SCHEMA_SQL = readFileSync(SCHEMA_SQL_PATH, 'utf8');

interface Migration {
  sql: string;
  why: string;
}

// Idempotent migrations for existing DBs. Each runs inside a try/catch so
// expected failures (table already dropped, column already exists) are silent.
const MIGRATIONS: Migration[] = [
  // Add agent_provider column to project table (for agent provider selection)
  { sql: `ALTER TABLE project ADD COLUMN agent_provider TEXT NOT NULL DEFAULT 'claude' CHECK (agent_provider IN ('claude','github_copilot','codex'))`,
    why: 'add agent_provider column to support claude/github_copilot/codex selection' },
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
  { sql: `ALTER TABLE task ADD COLUMN agent_provider_override TEXT CHECK (agent_provider_override IN ('claude', 'github_copilot', 'codex', NULL))`,
    why: 'add agent_provider_override column for task-level executor selection' },

  // --- noskills-style inner phase machine (additive) ---
  { sql: `ALTER TABLE task ADD COLUMN discovery_mode TEXT NOT NULL DEFAULT 'full' CHECK (discovery_mode IN ('full','validate','technical-depth','ship-fast','explore'))`,
    why: 'noskills discovery mode per task' },
  { sql: `ALTER TABLE agent_run ADD COLUMN phase TEXT NOT NULL DEFAULT 'DISCOVERY' CHECK (phase IN ('DISCOVERY','REFINEMENT','PLANNING','EXECUTING','VERIFICATION','DONE'))`,
    why: 'noskills inner phase per run' },
  { sql: `ALTER TABLE agent_run ADD COLUMN phase_state_json TEXT NOT NULL DEFAULT '{}'`,
    why: 'noskills phase progress, AC evidence, debt state' },
  { sql: `ALTER TABLE agent_run ADD COLUMN phase_history_json TEXT NOT NULL DEFAULT '[]'`,
    why: 'noskills phase transition audit per run' },
  { sql: `ALTER TABLE project ADD COLUMN concerns_json TEXT NOT NULL DEFAULT '[]'`,
    why: 'noskills enabled concerns per project' },
  { sql: `ALTER TABLE project ADD COLUMN allow_git INTEGER NOT NULL DEFAULT 0`,
    why: 'noskills allowGit gate (PreToolUse hook reads this)' },
  { sql: `CREATE TABLE IF NOT EXISTS task_debt (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES task(id),
    run_id TEXT REFERENCES agent_run(id),
    description TEXT NOT NULL,
    carried_count INTEGER NOT NULL DEFAULT 0,
    resolved_at TEXT,
    created_at TEXT NOT NULL
  )`, why: 'noskills debt carryforward' },
  { sql: `CREATE INDEX IF NOT EXISTS idx_task_debt_open ON task_debt(task_id) WHERE resolved_at IS NULL`,
    why: 'fast lookup of open debt per task' },
  { sql: `CREATE TABLE IF NOT EXISTS agent_activity (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_run(id),
    task_id TEXT NOT NULL REFERENCES task(id),
    kind TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    at TEXT NOT NULL
  )`, why: 'append-only activity log for live UI feed' },
  { sql: `CREATE INDEX IF NOT EXISTS idx_agent_activity_run ON agent_activity(run_id, at)`,
    why: 'SSE replay per run' },
  { sql: `CREATE INDEX IF NOT EXISTS idx_agent_activity_task ON agent_activity(task_id, at DESC)`,
    why: 'recent activity per task card' },

  // --- skills scan support ---
  { sql: `CREATE TABLE IF NOT EXISTS skill (
    id TEXT PRIMARY KEY,
    project_code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emblem TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    rel_dir TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    layout TEXT NOT NULL CHECK (layout IN ('folder','file')),
    allowed_tools_json TEXT NOT NULL DEFAULT '[]',
    scanned_at TEXT NOT NULL,
    deleted_at TEXT
  )`, why: 'skill catalog per project' },
  { sql: `CREATE INDEX IF NOT EXISTS skill_project_idx ON skill(project_code, deleted_at)`,
    why: 'fast live skill lookup per project' },
  { sql: `CREATE INDEX IF NOT EXISTS skill_reldir_idx ON skill(project_code, rel_dir)`,
    why: 'lookup skills by rel_dir during scan diff' },
  { sql: `CREATE TABLE IF NOT EXISTS skill_scan (
    id TEXT PRIMARY KEY,
    project_code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
    started_at TEXT,
    ended_at TEXT,
    found_count INTEGER NOT NULL DEFAULT 0,
    added_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    removed_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    trigger TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`, why: 'skill scan run history' },
  { sql: `CREATE INDEX IF NOT EXISTS skill_scan_project_idx ON skill_scan(project_code, status)`,
    why: 'find queued/running scans per project' },
  { sql: `CREATE INDEX IF NOT EXISTS skill_scan_created_idx ON skill_scan(project_code, created_at DESC)`,
    why: 'recent scan history per project' },
  { sql: `INSERT INTO meta(key, value) VALUES ('schema_version', '5')
          ON CONFLICT(key) DO UPDATE SET value='5' WHERE meta.value < '5'`,
    why: 'bump schema_version to 5 for skill+scan tables and project.scan_ignore_json' },
];

function applyMigrations(db: DbHandle): void {
  for (const m of MIGRATIONS) {
    try { db.exec(m.sql); } catch { /* idempotent: column/table already present */ }
  }
  try { migrateProjectAgentProviderCheck(db); } catch { /* ignore */ }
  try { migrateTaskProviderOverrideCheck(db); } catch { /* ignore */ }
  try { migrateProjectScanIgnoreJson(db); } catch { /* ignore */ }
}

function migrateProjectScanIgnoreJson(db: DbHandle): void {
  // PRAGMA-guarded ALTER: only add column if absent.
  const cols = db.prepare(`PRAGMA table_info(project)`).all() as { name: string }[];
  const has = cols.some((c) => c.name === 'scan_ignore_json');
  if (has) return;
  db.exec(`ALTER TABLE project ADD COLUMN scan_ignore_json TEXT NOT NULL DEFAULT '[]'`);
}

function tableSql(db: DbHandle, table: string): string {
  try {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (row !== null && row !== undefined && typeof row === 'object' && 'sql' in row) {
      return String((row as Record<string, unknown>).sql ?? '');
    }
    return '';
  } catch {
    return '';
  }
}

function recreateProjectTrigger(db: DbHandle): void {
  db.exec(`
DROP TRIGGER IF EXISTS project_workflow_immutable;
CREATE TRIGGER project_workflow_immutable
BEFORE UPDATE OF workflow_type ON project
BEGIN
  SELECT RAISE(ABORT, 'workflow_type is immutable');
END;`);
}

function migrateProjectAgentProviderCheck(db: DbHandle): void {
  const sql = tableSql(db, 'project');
  if (!sql || sql.includes("'codex'")) return;
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(`
CREATE TABLE project_new (
  id                TEXT PRIMARY KEY,
  code              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  workflow_type     TEXT NOT NULL CHECK (workflow_type IN ('WF1','WF2')),
  repo_path         TEXT NOT NULL,
  max_parallel      INTEGER NOT NULL DEFAULT 1 CHECK (max_parallel BETWEEN 1 AND 3),
  agent_provider    TEXT NOT NULL DEFAULT 'claude' CHECK (agent_provider IN ('claude','github_copilot','codex')),
  version           INTEGER NOT NULL DEFAULT 0,
  deleted_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
INSERT INTO project_new(id, code, name, description, workflow_type, repo_path, max_parallel, agent_provider, version, deleted_at, created_at, updated_at)
SELECT id, code, name, description, workflow_type, repo_path, max_parallel, agent_provider, version, deleted_at, created_at, updated_at
FROM project;
DROP TABLE project;
ALTER TABLE project_new RENAME TO project;`);
  recreateProjectTrigger(db);
  db.exec('PRAGMA foreign_keys=ON');
}

function migrateTaskProviderOverrideCheck(db: DbHandle): void {
  const sql = tableSql(db, 'task');
  if (!sql || sql.includes("'codex'")) return;
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(`
CREATE TABLE task_new (
  id                       TEXT PRIMARY KEY,
  project_id               TEXT NOT NULL REFERENCES project(id),
  seq                      INTEGER NOT NULL,
  code                     TEXT NOT NULL,
  title                    TEXT NOT NULL,
  description              TEXT,
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  status                   TEXT NOT NULL CHECK (status IN ('todo','agent_working','agent_review','human_approval','done')),
  assignee_role            TEXT CHECK (assignee_role IN ('pm','worker','reviewer','human')),
  rework_count             INTEGER NOT NULL DEFAULT 0,
  agent_provider_override  TEXT CHECK (agent_provider_override IN ('claude', 'github_copilot', 'codex', NULL)),
  workspace_path           TEXT,
  version                  INTEGER NOT NULL DEFAULT 0,
  deleted_at               TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE(project_id, seq)
);
INSERT INTO task_new(id, project_id, seq, code, title, description, acceptance_criteria_json, status, assignee_role, rework_count, agent_provider_override, workspace_path, version, deleted_at, created_at, updated_at)
SELECT id, project_id, seq, code, title, description, acceptance_criteria_json, status, assignee_role, rework_count, agent_provider_override, workspace_path, version, deleted_at, created_at, updated_at
FROM task;
DROP TABLE task;
ALTER TABLE task_new RENAME TO task;
CREATE INDEX IF NOT EXISTS idx_task_status_live ON task(status) WHERE deleted_at IS NULL;`);
  db.exec('PRAGMA foreign_keys=ON');
}

// Open project DB, run idempotent schema, apply migrations, return handle.
export async function openProjectDb(path: string): Promise<DbHandle> {
  const a = await loadAdapter();
  const db = a.open(path);
  db.exec(SCHEMA_SQL);
  applyMigrations(db);
  return db;
}

export function dbExists(path: string): boolean { return existsSync(path); }
