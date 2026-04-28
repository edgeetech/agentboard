-- agent-board: one SQLite DB per project. Idempotent schema; run on every open.
-- agent_run table and auto_dispatch_pm column removed (simplified mode - no agent spawn).

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

CREATE TABLE IF NOT EXISTS task_attachment (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES task(id),
  file_path   TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_status_live       ON task(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comment_task           ON comment(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attachment_task        ON task_attachment(task_id, created_at);

-- schema_version seed (app upserts on init)
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '2');
