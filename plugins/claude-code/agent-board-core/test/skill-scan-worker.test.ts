// Integration tests for the async skill-scan worker.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/db.ts';
import { getScan, listSkills, recordScan } from '../src/skill-repo.ts';
import { startSkillScanWorker } from '../src/skill-scan-worker.ts';

const PROJECT_CODE = 'TST';

async function makeDb(repoPath: string): Promise<DbHandle> {
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
  `);
  d.prepare(
    `INSERT INTO project (id, code, name, workflow_type, repo_path, created_at, updated_at)
     VALUES ('P1', ?, 'Test', 'WF1', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(PROJECT_CODE, repoPath);
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

function makeRepoFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-scan-worker-'));
  const skillDir = join(root, '.claude', 'skills', 'foo');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: foo
description: foo skill
emblem: FOO
tags: [a, b]
---
body
`,
  );
  return root;
}

async function waitFor<T>(
  fn: () => T | undefined | null,
  timeoutMs: number,
  intervalMs = 25,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}

let repoRoots: string[] = [];

afterEach(() => {
  for (const r of repoRoots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  repoRoots = [];
});

describe('skill-scan-worker', () => {
  let db: DbHandle;
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = makeRepoFixture();
    repoRoots.push(repoRoot);
    db = await makeDb(repoRoot);
  });

  it('claims a queued scan and indexes skills (success path)', async () => {
    const scanId = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    const worker = startSkillScanWorker({ db, pollMs: 25, scanTimeoutMs: 10_000 });
    try {
      await waitFor(() => {
        const row = getScan(db, scanId);
        return row?.status === 'succeeded' ? row : null;
      }, 5_000);
      const final = getScan(db, scanId);
      expect(final?.status).toBe('succeeded');
      expect(final?.foundCount).toBe(1);
      expect(final?.addedCount).toBe(1);
      expect(final?.endedAt).not.toBeNull();
      const skills = listSkills(db, PROJECT_CODE);
      expect(skills).toHaveLength(1);
      expect(skills[0]?.name).toBe('foo');
    } finally {
      await worker.stop();
    }
  });

  it('succeeds with zero skills when repo_path points to a missing dir', async () => {
    // The scanner is best-effort: a missing dir warns and returns empty.
    // The worker should still record a successful scan with 0 found.
    db.prepare(`UPDATE project SET repo_path=? WHERE code=?`).run(
      join(repoRoot, '__missing__'),
      PROJECT_CODE,
    );
    const scanId = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    const worker = startSkillScanWorker({ db, pollMs: 25, scanTimeoutMs: 10_000 });
    try {
      await waitFor(() => {
        const row = getScan(db, scanId);
        return row?.status === 'succeeded' || row?.status === 'failed' ? row : null;
      }, 5_000);
      const final = getScan(db, scanId);
      expect(final?.status).toBe('succeeded');
      expect(final?.foundCount).toBe(0);
    } finally {
      await worker.stop();
    }
  });

  it('marks scan failed when repo_path is empty string', async () => {
    db.prepare(`UPDATE project SET repo_path='' WHERE code=?`).run(PROJECT_CODE);
    const scanId = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    const worker = startSkillScanWorker({ db, pollMs: 25, scanTimeoutMs: 10_000 });
    try {
      await waitFor(() => {
        const row = getScan(db, scanId);
        return row?.status === 'failed' ? row : null;
      }, 5_000);
      const final = getScan(db, scanId);
      expect(final?.status).toBe('failed');
      expect(final?.error).toBe('no repo_path');
    } finally {
      await worker.stop();
    }
  });

  it('runs queued scans for the same project sequentially (single-in-flight)', async () => {
    const id1 = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    db.prepare(`UPDATE skill_scan SET created_at='2026-01-01T00:00:00Z' WHERE id=?`).run(id1);
    const id2 = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    db.prepare(`UPDATE skill_scan SET created_at='2026-01-02T00:00:00Z' WHERE id=?`).run(id2);

    const worker = startSkillScanWorker({ db, pollMs: 25, scanTimeoutMs: 10_000 });
    try {
      // Wait until both finish.
      await waitFor(() => {
        const a = getScan(db, id1);
        const b = getScan(db, id2);
        return a?.status === 'succeeded' && b?.status === 'succeeded' ? true : null;
      }, 8_000);

      const a = getScan(db, id1);
      const b = getScan(db, id2);
      expect(a?.status).toBe('succeeded');
      expect(b?.status).toBe('succeeded');
      // Sequencing: scan #2 cannot have started before scan #1 ended.
      const aEnd = a?.endedAt ?? '';
      const bStart = b?.startedAt ?? '';
      expect(aEnd).not.toBe('');
      expect(bStart).not.toBe('');
      expect(bStart >= aEnd).toBe(true);
    } finally {
      await worker.stop();
    }
  });

  it('stop() resolves cleanly with no pending scans', async () => {
    const worker = startSkillScanWorker({ db, pollMs: 25 });
    await worker.stop();
    // Idempotent enough — no throw.
    expect(true).toBe(true);
  });
});
