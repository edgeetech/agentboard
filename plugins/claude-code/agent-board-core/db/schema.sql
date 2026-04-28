-- agent-board: one SQLite DB per project. Idempotent schema; run on every open.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS project (
  id                TEXT PRIMARY KEY,
  code              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  workflow_type     TEXT NOT NULL CHECK (workflow_type IN ('WF1','WF2')),
  repo_path         TEXT NOT NULL,
  auto_dispatch_pm  INTEGER NOT NULL DEFAULT 1,
  max_parallel      INTEGER NOT NULL DEFAULT 1 CHECK (max_parallel BETWEEN 1 AND 3),
  version           INTEGER NOT NULL DEFAULT 0,
  deleted_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- workflow_type immutable after create
DROP TRIGGER IF EXISTS project_workflow_immutable;
CREATE TRIGGER project_workflow_immutable
BEFORE UPDATE OF workflow_type ON project
BEGIN
  SELECT RAISE(ABORT, 'workflow_type is immutable');
END;

CREATE TABLE IF NOT EXISTS task (
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
  version                  INTEGER NOT NULL DEFAULT 0,
  deleted_at               TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE(project_id, seq)
);

CREATE TABLE IF NOT EXISTS task_history (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES task(id),
  from_status TEXT,
  to_status   TEXT,
  by_role     TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comment (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES task(id),
  author_role  TEXT NOT NULL CHECK (author_role IN ('pm','worker','reviewer','human','system')),
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run (
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
  last_heartbeat_at      TEXT,
  queued_at              TEXT NOT NULL,
  started_at             TEXT,
  ended_at               TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_run_running      ON agent_run(status, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_task_queued  ON agent_run(task_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_status_live       ON task(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comment_task           ON comment(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_cost         ON agent_run(task_id, ended_at) WHERE status IN ('succeeded','failed','blocked','cancelled');

CREATE TABLE IF NOT EXISTS task_attachment (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES task(id),
  file_path   TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachment_task ON task_attachment(task_id, created_at);

CREATE TABLE IF NOT EXISTS retry_state (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES agent_run(id),
  task_id      TEXT NOT NULL REFERENCES task(id),
  attempt      INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  delay_ms     INTEGER NOT NULL,
  last_error   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retry_state_task ON retry_state(task_id, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS tracker_config (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES project(id) UNIQUE,
  kind             TEXT NOT NULL CHECK (kind IN ('linear','github','gitlab')),
  endpoint         TEXT,
  api_key_env_var  TEXT NOT NULL,
  project_slug     TEXT NOT NULL,
  active_states    TEXT NOT NULL DEFAULT '["Todo","In Progress"]',
  terminal_states  TEXT NOT NULL DEFAULT '["Done","Cancelled","Canceled","Duplicate"]',
  assignee         TEXT,
  poll_interval_ms INTEGER NOT NULL DEFAULT 30000,
  enabled          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracker_issue (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id),
  task_id       TEXT REFERENCES task(id),
  tracker_kind  TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  identifier    TEXT NOT NULL,
  title         TEXT NOT NULL,
  state         TEXT NOT NULL,
  url           TEXT,
  synced_at     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(project_id, tracker_kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_tracker_issue_project ON tracker_issue(project_id, tracker_kind);
CREATE INDEX IF NOT EXISTS idx_tracker_issue_task ON tracker_issue(task_id) WHERE task_id IS NOT NULL;

-- schema_version seed (app upserts on init)
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '3');
