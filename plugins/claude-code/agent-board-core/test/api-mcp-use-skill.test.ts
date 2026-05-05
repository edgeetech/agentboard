// Integration test for the `use_skill` MCP tool in api-mcp.ts.
// Builds a minimal in-memory schema covering the columns touched by the
// callTool path for use_skill (project, task, agent_run, comment,
// agent_activity, skill) and exercises the four key cases:
//   - found path returns body and records skill:used
//   - miss with similar names suggests + auto-comments + records skill:missed
//   - miss with no similar names omits the suggestion list
//   - path traversal (rel_path escaping repo) is rejected

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';

import { callTool } from '../src/api-mcp.ts';
import type { DbHandle } from '../src/db.ts';

const PROJECT_CODE = 'TST';
const RUN_TOKEN = 'tok-abc';
const RUN_ID = 'R1';
const TASK_ID = 'T1';

let db: DbHandle;
let repoPath: string;

type TableRow = Record<string, unknown>;

async function makeDb(repo: string): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      description TEXT, workflow_type TEXT NOT NULL DEFAULT 'WF1',
      repo_path TEXT NOT NULL, max_parallel INTEGER NOT NULL DEFAULT 1,
      agent_provider TEXT NOT NULL DEFAULT 'claude',
      concerns_json TEXT NOT NULL DEFAULT '[]',
      allow_git INTEGER NOT NULL DEFAULT 0,
      scan_ignore_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE task (
      id TEXT PRIMARY KEY, code TEXT, title TEXT,
      description TEXT, status TEXT, version INTEGER DEFAULT 0,
      acceptance_criteria_json TEXT, assignee_role TEXT,
      workspace_path TEXT, discovery_mode TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE agent_run (
      id TEXT PRIMARY KEY, task_id TEXT, role TEXT, status TEXT,
      token TEXT, queued_at TEXT, last_heartbeat_at TEXT,
      phase TEXT NOT NULL DEFAULT 'DISCOVERY',
      phase_state_json TEXT NOT NULL DEFAULT '{}',
      phase_history_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE comment (
      id TEXT PRIMARY KEY, task_id TEXT, author_role TEXT,
      body TEXT, created_at TEXT
    );
    CREATE TABLE agent_activity (
      id TEXT PRIMARY KEY, run_id TEXT, task_id TEXT,
      kind TEXT, payload TEXT, at TEXT
    );
    CREATE TABLE skill (
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
    );
  `);
  d.prepare(
    `INSERT INTO project (id, code, name, repo_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('P1', PROJECT_CODE, 'Test', repo, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  d.prepare(
    `INSERT INTO task (id, code, title, status, version, acceptance_criteria_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(TASK_ID, 'T-001', 'demo', 'agent_working', 0, '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  d.prepare(
    `INSERT INTO agent_run (id, task_id, role, status, token, queued_at, last_heartbeat_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(RUN_ID, TASK_ID, 'worker', 'running', RUN_TOKEN, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
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
  } as unknown as DbHandle;
}

function insertSkill(
  d: DbHandle,
  args: { id: string; name: string; relDir: string; relPath: string; layout?: 'folder' | 'file' },
): void {
  d.prepare(
    `INSERT INTO skill (id, project_code, name, description, emblem, tags_json,
        rel_dir, rel_path, layout, allowed_tools_json, scanned_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, '[]', ?, NULL)`,
  ).run(
    args.id,
    PROJECT_CODE,
    args.name,
    `${args.name} desc`,
    args.name.slice(0, 3).toUpperCase(),
    args.relDir,
    args.relPath,
    args.layout ?? 'folder',
    '2026-01-01T00:00:00Z',
  );
}

function getActivities(d: DbHandle): TableRow[] {
  return d.prepare(`SELECT kind, payload FROM agent_activity ORDER BY at ASC, id ASC`).all() as TableRow[];
}

function getComments(d: DbHandle): TableRow[] {
  return d.prepare(`SELECT author_role, body FROM comment ORDER BY created_at ASC, id ASC`).all() as TableRow[];
}

beforeEach(async () => {
  repoPath = mkdtempSync(join(tmpdir(), 'use-skill-'));
  db = await makeDb(repoPath);
});

describe('use_skill MCP tool', () => {
  it('found: returns body, records skill:used', () => {
    const skillsDir = join(repoPath, '.claude', 'skills', 'ui-quality-check');
    mkdirSync(skillsDir, { recursive: true });
    const body = '---\nname: ui-quality-check\n---\nDo the thing.\n';
    writeFileSync(join(skillsDir, 'SKILL.md'), body, 'utf8');
    insertSkill(db, {
      id: 'S1',
      name: 'ui-quality-check',
      relDir: '.claude/skills',
      relPath: '.claude/skills/ui-quality-check/SKILL.md',
    });

    const res = callTool(db, 'use_skill', { run_token: RUN_TOKEN, name: 'ui-quality-check' }) as {
      found: boolean;
      name: string;
      relPath: string;
      body: string;
      allowedTools: string[];
    };
    expect(res.found).toBe(true);
    expect(res.name).toBe('ui-quality-check');
    expect(res.body).toBe(body);
    expect(res.relPath).toBe('.claude/skills/ui-quality-check/SKILL.md');

    const acts = getActivities(db);
    expect(acts.some((a) => a.kind === 'skill:used')).toBe(true);
    // No comment posted on found path
    expect(getComments(db)).toHaveLength(0);
  });

  it('case-insensitive name match', () => {
    const skillsDir = join(repoPath, '.claude', 'skills', 'AlphaSkill');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'SKILL.md'), 'body', 'utf8');
    insertSkill(db, {
      id: 'S1',
      name: 'AlphaSkill',
      relDir: '.claude/skills',
      relPath: '.claude/skills/AlphaSkill/SKILL.md',
    });

    const res = callTool(db, 'use_skill', { run_token: RUN_TOKEN, name: 'alphaskill' }) as {
      found: boolean;
    };
    expect(res.found).toBe(true);
  });

  it('miss with similar: posts comment with suggestions, records skill:missed', () => {
    insertSkill(db, {
      id: 'S1',
      name: 'ui-quality-check',
      relDir: '.claude/skills',
      relPath: '.claude/skills/ui-quality-check/SKILL.md',
    });
    insertSkill(db, {
      id: 'S2',
      name: 'api-quality-check',
      relDir: '.claude/skills',
      relPath: '.claude/skills/api-quality-check/SKILL.md',
    });

    const res = callTool(db, 'use_skill', { run_token: RUN_TOKEN, name: 'quality-check' }) as {
      found: boolean;
      available: string[];
    };
    expect(res.found).toBe(false);
    expect(res.available.length).toBeGreaterThan(0);

    const comments = getComments(db);
    expect(comments).toHaveLength(1);
    expect(String(comments[0]?.author_role)).toBe('system');
    expect(String(comments[0]?.body)).toContain('not found');
    expect(String(comments[0]?.body)).toContain('Available similar');

    const acts = getActivities(db);
    expect(acts.some((a) => a.kind === 'skill:missed')).toBe(true);
  });

  it('miss with no similar: returns empty available, posts comment without suggestion list', () => {
    insertSkill(db, {
      id: 'S1',
      name: 'aaa',
      relDir: '.claude/skills',
      relPath: '.claude/skills/aaa/SKILL.md',
    });

    const res = callTool(db, 'use_skill', { run_token: RUN_TOKEN, name: 'zzzzzzzzz' }) as {
      found: boolean;
      available: string[];
    };
    expect(res.found).toBe(false);
    expect(res.available).toEqual([]);

    const comments = getComments(db);
    expect(comments).toHaveLength(1);
    expect(String(comments[0]?.body)).toContain('not found');
    expect(String(comments[0]?.body)).not.toContain('Available similar');
  });

  it('path traversal: rel_path escaping repo_path is rejected, no read', () => {
    insertSkill(db, {
      id: 'S1',
      name: 'evil',
      relDir: '..',
      relPath: '../etc/passwd',
    });

    expect(() => callTool(db, 'use_skill', { run_token: RUN_TOKEN, name: 'evil' })).toThrow(
      /escapes repo_path/,
    );

    // skill:missed activity recorded with reason path_traversal
    const acts = getActivities(db);
    const missed = acts.find((a) => a.kind === 'skill:missed');
    expect(missed).toBeTruthy();
  });
});
