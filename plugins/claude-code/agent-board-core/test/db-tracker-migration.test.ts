import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openProjectDb } from '../src/db.ts';

let tmpRoot = '';

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = '';
});

function tempDbPath(name: string): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tracker-migration-'));
  return join(tmpRoot, name);
}

describe('tracker schema migrations', () => {
  it('creates tracker poll state on fresh databases and bumps schema version', async () => {
    const db = await openProjectDb(tempDbPath('fresh.db'));

    const trackerPollColumns = db.prepare(`PRAGMA table_info(tracker_poll_state)`).all() as {
      name: string;
    }[];
    const version = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as {
      value: string;
    };

    expect(trackerPollColumns.map((c) => c.name)).toEqual([
      'project_id',
      'last_poll_at',
      'last_success_at',
      'last_error',
      'last_issue_count',
      'rate_limited',
      'next_poll_at',
      'updated_at',
    ]);
    expect(version.value).toBe('7');
    db.close();
  });

  it('backs up legacy tracker_config tables and recreates the canonical shape', async () => {
    const path = tempDbPath('legacy.db');
    const mod = await import('node:sqlite');
    const legacy = new mod.DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta(key, value) VALUES ('schema_version', '6');
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        workflow_type TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        max_parallel INTEGER NOT NULL DEFAULT 1,
        agent_provider TEXT NOT NULL DEFAULT 'claude',
        version INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE tracker_config (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        base_url TEXT,
        project_key TEXT,
        api_token TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO tracker_config(id, provider, api_token, created_at, updated_at)
      VALUES ('OLD', 'github', 'secret-token', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `);
    legacy.close();

    const db = await openProjectDb(path);
    const trackerColumns = db.prepare(`PRAGMA table_info(tracker_config)`).all() as {
      name: string;
    }[];
    const legacyTable = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='tracker_config_legacy_pre_v7'`,
      )
      .get() as { name: string } | undefined;
    const version = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as {
      value: string;
    };
    const foreignKeys = db.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number };

    expect(trackerColumns.map((c) => c.name)).toEqual([
      'id',
      'project_id',
      'kind',
      'endpoint',
      'api_key_env_var',
      'project_slug',
      'active_states',
      'terminal_states',
      'assignee',
      'poll_interval_ms',
      'enabled',
      'created_at',
      'updated_at',
    ]);
    expect(legacyTable?.name).toBe('tracker_config_legacy_pre_v7');
    expect(version.value).toBe('7');
    expect(foreignKeys.foreign_keys).toBe(1);
    db.close();
  });

  it('re-enables foreign keys when legacy tracker migration hits a backup-name conflict', async () => {
    const path = tempDbPath('legacy-conflict.db');
    const mod = await import('node:sqlite');
    const legacy = new mod.DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta(key, value) VALUES ('schema_version', '6');
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        workflow_type TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        max_parallel INTEGER NOT NULL DEFAULT 1,
        agent_provider TEXT NOT NULL DEFAULT 'claude',
        version INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE tracker_config (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIEW tracker_config_legacy_pre_v7 AS SELECT 'backup-conflict' AS id;
    `);
    legacy.close();

    const db = await openProjectDb(path);
    const trackerColumns = db.prepare(`PRAGMA table_info(tracker_config)`).all() as {
      name: string;
    }[];
    const foreignKeys = db.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number };

    expect(trackerColumns.map((c) => c.name)).toContain('api_key_env_var');
    expect(foreignKeys.foreign_keys).toBe(1);
    db.close();
  });
});
