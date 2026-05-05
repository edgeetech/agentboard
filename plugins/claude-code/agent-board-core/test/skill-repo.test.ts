// DB-backed integration tests for skill-repo helpers + updateProject patch.
// Mirrors phase-repo.test.ts scaffolding.

import { describe, expect, it, beforeEach } from 'vitest';

import type { DbHandle } from '../src/db.ts';
import { getProject, updateProject } from '../src/repo.ts';
import {
  claimNextQueuedScan,
  getScan,
  getSkill,
  getSkillByName,
  latestScan,
  listSkills,
  recordScan,
  updateScan,
  upsertSkillIndex,
} from '../src/skill-repo.ts';
import type { ScannedSkill } from '../src/skill-scanner.ts';

let db: DbHandle;
const PROJECT_CODE = 'TST';

async function makeDb(): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
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
    CREATE TABLE skill_scan (
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
    );
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      workflow_type TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      max_parallel INTEGER NOT NULL DEFAULT 1,
      agent_provider TEXT NOT NULL DEFAULT 'claude',
      concerns_json TEXT NOT NULL DEFAULT '[]',
      allow_git INTEGER NOT NULL DEFAULT 0,
      scan_ignore_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO project (id, code, name, workflow_type, repo_path, created_at, updated_at)
    VALUES ('P1', 'TST', 'Test', 'WF1', '/tmp/x', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
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
  } as unknown as DbHandle;
}

function mkSkill(name: string, relPath: string, overrides: Partial<ScannedSkill> = {}): ScannedSkill {
  return {
    name,
    description: `${name} desc`,
    emblem: name.slice(0, 3).toUpperCase(),
    tags: ['t1'],
    allowedTools: ['Read'],
    layout: 'folder',
    relDir: '.claude/skills',
    relPath,
    ...overrides,
  };
}

describe('skill-repo', () => {
  beforeEach(async () => {
    db = await makeDb();
  });

  it('listSkills empty', () => {
    expect(listSkills(db, PROJECT_CODE)).toEqual([]);
  });

  it('upsertSkillIndex inserts new skills', () => {
    const scanned = [
      mkSkill('alpha', '.claude/skills/alpha/SKILL.md'),
      mkSkill('beta', '.claude/skills/beta/SKILL.md'),
      mkSkill('gamma', '.claude/skills/gamma/SKILL.md'),
    ];
    const r = upsertSkillIndex(db, PROJECT_CODE, scanned);
    expect(r).toEqual({ added: 3, updated: 0, removed: 0 });
    const list = listSkills(db, PROJECT_CODE);
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('upsertSkillIndex diffs: 1 changed, 1 removed, 1 added', () => {
    const initial = [
      mkSkill('alpha', '.claude/skills/alpha/SKILL.md'),
      mkSkill('beta', '.claude/skills/beta/SKILL.md'),
      mkSkill('gamma', '.claude/skills/gamma/SKILL.md'),
    ];
    upsertSkillIndex(db, PROJECT_CODE, initial);

    const next = [
      mkSkill('alpha', '.claude/skills/alpha/SKILL.md', { description: 'changed!' }),
      // beta removed
      mkSkill('gamma', '.claude/skills/gamma/SKILL.md'),
      mkSkill('delta', '.claude/skills/delta/SKILL.md'),
    ];
    const r = upsertSkillIndex(db, PROJECT_CODE, next);
    expect(r).toEqual({ added: 1, updated: 1, removed: 1 });

    const live = listSkills(db, PROJECT_CODE);
    expect(live.map((s) => s.name).sort()).toEqual(['alpha', 'delta', 'gamma']);
    const alpha = live.find((s) => s.name === 'alpha');
    expect(alpha?.description).toBe('changed!');

    // soft-deleted beta still present in DB with deleted_at set
    const allRows = db.prepare(`SELECT * FROM skill WHERE project_code=?`).all(PROJECT_CODE);
    const beta = (allRows as { name: string; deleted_at: string | null }[]).find(
      (r2) => r2.name === 'beta',
    );
    expect(beta?.deleted_at).not.toBeNull();
  });

  it('getSkill / getSkillByName resolves case-insensitively', () => {
    upsertSkillIndex(db, PROJECT_CODE, [mkSkill('AlphaSkill', '.claude/skills/AlphaSkill/SKILL.md')]);
    const live = listSkills(db, PROJECT_CODE);
    const id = live[0]?.id ?? '';
    expect(getSkill(db, id)?.name).toBe('AlphaSkill');
    expect(getSkillByName(db, PROJECT_CODE, 'alphaskill')?.name).toBe('AlphaSkill');
    expect(getSkillByName(db, PROJECT_CODE, 'ALPHASKILL')?.name).toBe('AlphaSkill');
    expect(getSkillByName(db, PROJECT_CODE, 'missing')).toBeNull();
  });

  it('listSkills search filters by name and description', () => {
    upsertSkillIndex(db, PROJECT_CODE, [
      mkSkill('payment-flow', '.claude/skills/payment-flow/SKILL.md', { description: 'handles cards' }),
      mkSkill('user-auth', '.claude/skills/user-auth/SKILL.md', { description: 'login + signup' }),
      mkSkill('logger', '.claude/skills/logger/SKILL.md', { description: 'pretty logs' }),
    ]);
    expect(listSkills(db, PROJECT_CODE, { search: 'payment' }).map((s) => s.name)).toEqual([
      'payment-flow',
    ]);
    expect(listSkills(db, PROJECT_CODE, { search: 'login' }).map((s) => s.name)).toEqual(['user-auth']);
    expect(listSkills(db, PROJECT_CODE, { search: 'pretty' }).map((s) => s.name)).toEqual([
      'logger',
    ]);
    // case-insensitive on name
    expect(listSkills(db, PROJECT_CODE, { search: 'LOGGER' }).map((s) => s.name)).toEqual([
      'logger',
    ]);
  });

  it('recordScan + getScan round-trip', () => {
    const id = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    const row = getScan(db, id);
    expect(row?.status).toBe('queued');
    expect(row?.trigger).toBe('manual');
    expect(row?.projectCode).toBe(PROJECT_CODE);
    expect(row?.foundCount).toBe(0);
  });

  it('updateScan partial patch only updates listed fields', () => {
    const id = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'project_created' });
    updateScan(db, id, { status: 'running', startedAt: '2026-02-01T00:00:00Z' });
    const a = getScan(db, id);
    expect(a?.status).toBe('running');
    expect(a?.startedAt).toBe('2026-02-01T00:00:00Z');
    expect(a?.endedAt).toBeNull();
    expect(a?.foundCount).toBe(0);

    updateScan(db, id, { status: 'succeeded', endedAt: '2026-02-01T00:01:00Z', foundCount: 5, addedCount: 3 });
    const b = getScan(db, id);
    expect(b?.status).toBe('succeeded');
    expect(b?.endedAt).toBe('2026-02-01T00:01:00Z');
    expect(b?.foundCount).toBe(5);
    expect(b?.addedCount).toBe(3);
    // unchanged
    expect(b?.startedAt).toBe('2026-02-01T00:00:00Z');
  });

  it('latestScan returns most recent', () => {
    const id1 = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    // ensure ordering by created_at — bump second row's created_at
    db.prepare(`UPDATE skill_scan SET created_at='2025-01-01T00:00:00Z' WHERE id=?`).run(id1);
    const id2 = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'project_created' });
    db.prepare(`UPDATE skill_scan SET created_at='2026-12-31T00:00:00Z' WHERE id=?`).run(id2);
    expect(latestScan(db, PROJECT_CODE)?.id).toBe(id2);
  });

  it('claimNextQueuedScan claims oldest first, atomic; single-in-flight per project', () => {
    const id1 = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    db.prepare(`UPDATE skill_scan SET created_at='2026-01-01T00:00:00Z' WHERE id=?`).run(id1);
    const id2 = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    db.prepare(`UPDATE skill_scan SET created_at='2026-01-02T00:00:00Z' WHERE id=?`).run(id2);

    const a = claimNextQueuedScan(db);
    expect(a?.id).toBe(id1);
    expect(a?.status).toBe('running');
    expect(a?.startedAt).not.toBeNull();

    // While id1 is still 'running', the second queued scan for the same
    // project must NOT be claimed (single-in-flight per project).
    const blocked = claimNextQueuedScan(db);
    expect(blocked).toBeNull();

    // Finish id1 → id2 becomes claimable.
    db.prepare(`UPDATE skill_scan SET status='succeeded' WHERE id=?`).run(id1);
    const b = claimNextQueuedScan(db);
    expect(b?.id).toBe(id2);
    expect(b?.status).toBe('running');

    db.prepare(`UPDATE skill_scan SET status='succeeded' WHERE id=?`).run(id2);
    const c = claimNextQueuedScan(db);
    expect(c).toBeNull();
  });

  it('claimNextQueuedScan: concurrent claims do not double-claim', () => {
    const id1 = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    db.prepare(`UPDATE skill_scan SET created_at='2026-01-01T00:00:00Z' WHERE id=?`).run(id1);
    const a = claimNextQueuedScan(db);
    const b = claimNextQueuedScan(db);
    expect(a?.id).toBe(id1);
    expect(b).toBeNull();
  });

  it('updateProject persists scan_ignore_json round-trip', () => {
    const before = getProject(db);
    expect(before?.scan_ignore_json).toBe('[]');
    const v = before?.version ?? 0;
    const out = updateProject(db, { scan_ignore_json: ['legacy', 'Tax/foo'] }, v);
    expect(out.ok).toBe(true);
    const after = getProject(db);
    expect(after?.scan_ignore_json).toBe(JSON.stringify(['legacy', 'Tax/foo']));
    expect(JSON.parse(after?.scan_ignore_json ?? '[]')).toEqual(['legacy', 'Tax/foo']);
  });
});
