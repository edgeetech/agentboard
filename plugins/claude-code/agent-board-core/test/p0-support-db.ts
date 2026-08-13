import type { DbHandle } from '../src/db.ts';

export async function makeP0Db(): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO meta(key, value) VALUES ('schema_version', '7');
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      workflow_type TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      max_parallel INTEGER NOT NULL DEFAULT 1,
      agent_provider TEXT NOT NULL DEFAULT 'claude',
      agent_config_json TEXT,
      concerns_json TEXT NOT NULL DEFAULT '[]',
      allow_git INTEGER NOT NULL DEFAULT 0,
      scan_ignore_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE task (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      seq INTEGER NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      assignee_role TEXT,
      rework_count INTEGER NOT NULL DEFAULT 0,
      agent_provider_override TEXT,
      agent_config_json TEXT,
      workspace_path TEXT,
      discovery_mode TEXT NOT NULL DEFAULT 'full',
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, seq)
    );
    CREATE TABLE task_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task(id),
      from_status TEXT,
      to_status TEXT,
      by_role TEXT,
      at TEXT NOT NULL
    );
    CREATE TABLE comment (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task(id),
      author_role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE task_attachment (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task(id),
      file_path TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE agent_run (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task(id),
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      token TEXT,
      pid INTEGER,
      session_provider TEXT,
      session_id TEXT,
      claude_session_id TEXT,
      error TEXT,
      logs_path TEXT,
      summary TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_version INTEGER NOT NULL DEFAULT 0,
      attempt INTEGER NOT NULL DEFAULT 1,
      last_heartbeat_at TEXT,
      queued_at TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      prompt_template TEXT,
      phase TEXT NOT NULL DEFAULT 'DISCOVERY',
      phase_state_json TEXT NOT NULL DEFAULT '{}',
      phase_history_json TEXT NOT NULL DEFAULT '[]',
      parent_run_id TEXT,
      member_index INTEGER,
      council_size INTEGER,
      session_provider_override TEXT,
      cost_breakdown_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE task_debt (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task(id),
      run_id TEXT REFERENCES agent_run(id),
      description TEXT NOT NULL,
      carried_count INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE agent_activity (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_run(id),
      task_id TEXT NOT NULL REFERENCES task(id),
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      at TEXT NOT NULL
    );
    CREATE TABLE tracker_config (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id) UNIQUE,
      kind TEXT NOT NULL,
      endpoint TEXT,
      api_key_env_var TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      active_states TEXT NOT NULL DEFAULT '["Todo","In Progress"]',
      terminal_states TEXT NOT NULL DEFAULT '["Done","Cancelled","Canceled","Duplicate"]',
      assignee TEXT,
      poll_interval_ms INTEGER NOT NULL DEFAULT 30000,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tracker_issue (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      task_id TEXT REFERENCES task(id),
      tracker_kind TEXT NOT NULL,
      external_id TEXT NOT NULL,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      url TEXT,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, tracker_kind, external_id)
    );
    CREATE TABLE tracker_poll_state (
      project_id TEXT PRIMARY KEY REFERENCES project(id),
      last_poll_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      last_issue_count INTEGER NOT NULL DEFAULT 0,
      rate_limited INTEGER NOT NULL DEFAULT 0,
      next_poll_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE skill_scan (
      id TEXT PRIMARY KEY,
      project_code TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      found_count INTEGER NOT NULL DEFAULT 0,
      added_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      removed_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      trigger TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return {
    exec: (s: string) => {
      d.exec(s);
    },
    prepare: (s: string) => {
      const stmt = d.prepare(s);
      return {
        run: (...a: Parameters<typeof stmt.run>) => stmt.run(...a),
        get: (...a: Parameters<typeof stmt.get>) => stmt.get(...a),
        all: (...a: Parameters<typeof stmt.all>) => stmt.all(...a),
      };
    },
    transaction: <T>(fn: (...args: unknown[]) => T): ((...args: unknown[]) => T) => {
      return (...args: unknown[]): T => {
        d.exec('BEGIN');
        try {
          const r = fn(...args);
          d.exec('COMMIT');
          return r;
        } catch (e) {
          d.exec('ROLLBACK');
          throw e;
        }
      };
    },
    close: () => {
      d.close();
    },
  } as unknown as DbHandle;
}

export function seedP0Project(db: DbHandle, repoPath = process.cwd()): void {
  db.prepare(
    `
    INSERT INTO project(id, code, name, workflow_type, repo_path, created_at, updated_at)
    VALUES ('P1', 'TST', 'Test Project', 'WF1', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  `,
  ).run(repoPath);
  db.prepare(
    `
    INSERT INTO task(id, project_id, seq, code, title, description, acceptance_criteria_json,
                     status, assignee_role, created_at, updated_at)
    VALUES ('TASK1', 'P1', 1, 'TST-1', 'Task <Title>', 'Description',
            '[{"id":"1","text":"Done","checked":false}]', 'agent_working', 'worker',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  `,
  ).run();
}
