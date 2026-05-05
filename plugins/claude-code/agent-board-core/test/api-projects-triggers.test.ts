// Unit tests for skill-scan trigger predicates and input normalization
// used by the project routes (POST/PATCH /api/projects). The full HTTP
// handlers are exercised indirectly elsewhere; here we cover the bits of
// logic the routes own (skip window, scan_ignore_json normalization) plus
// an integration-style assertion on recordScan via an in-memory DB.

import { describe, expect, it, beforeEach } from 'vitest';

import {
  normalizeScanIgnore,
  shouldSkipSwitchScan,
} from '../src/api-projects.ts';
import type { DbHandle } from '../src/db.ts';
import {
  latestScan,
  recordScan,
  updateScan,
} from '../src/skill-repo.ts';

const PROJECT_CODE = 'TST';

async function makeDb(): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
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

describe('shouldSkipSwitchScan', () => {
  let db: DbHandle;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('returns false when no prior scan', () => {
    expect(shouldSkipSwitchScan(db, PROJECT_CODE)).toBe(false);
  });

  it('returns false when latest scan failed', () => {
    const id = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    updateScan(db, id, { status: 'failed', endedAt: new Date().toISOString() });
    expect(shouldSkipSwitchScan(db, PROJECT_CODE)).toBe(false);
  });

  it('returns false when latest scan is still queued/running', () => {
    recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    expect(shouldSkipSwitchScan(db, PROJECT_CODE)).toBe(false);
  });

  it('returns true when latest succeeded within 30 minutes', () => {
    const id = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    updateScan(db, id, { status: 'succeeded', endedAt: tenMinAgo });
    expect(shouldSkipSwitchScan(db, PROJECT_CODE)).toBe(true);
  });

  it('returns false when latest succeeded outside the 30 minute window', () => {
    const id = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'manual' });
    const fortyMinAgo = new Date(Date.now() - 40 * 60_000).toISOString();
    updateScan(db, id, { status: 'succeeded', endedAt: fortyMinAgo });
    expect(shouldSkipSwitchScan(db, PROJECT_CODE)).toBe(false);
  });
});

describe('normalizeScanIgnore', () => {
  it('passes string[] through unchanged', () => {
    const out = normalizeScanIgnore(['node_modules', 'dist']);
    expect(out).toEqual(['node_modules', 'dist']);
  });

  it('splits newline-separated string and strips comments + blanks', () => {
    const out = normalizeScanIgnore(`node_modules
dist

# a comment
build
`);
    expect(out).toEqual(['node_modules', 'dist', 'build']);
  });

  it('rejects non-string array elements', () => {
    const out = normalizeScanIgnore(['ok', 42 as unknown as string]);
    expect(out).toEqual({ error: 'scan_ignore_json must be string[] or string' });
  });

  it('rejects oversized array', () => {
    const out = normalizeScanIgnore(new Array(201).fill('x'));
    expect(out).toEqual({ error: 'scan_ignore_json must be string[] or string' });
  });

  it('rejects too many lines in string form', () => {
    const lines = new Array(201).fill('foo').join('\n');
    const out = normalizeScanIgnore(lines);
    if (Array.isArray(out)) throw new Error('expected error');
    expect(out.error).toMatch(/too many entries/);
  });

  it('rejects non-array, non-string input', () => {
    const out = normalizeScanIgnore({ bad: true });
    expect(out).toEqual({ error: 'scan_ignore_json must be string[] or string' });
  });
});

describe('recordScan integration', () => {
  it('records a project_created scan and latestScan returns it', async () => {
    const db = await makeDb();
    const id = recordScan(db, { projectCode: PROJECT_CODE, trigger: 'project_created' });
    expect(id.length).toBeGreaterThan(0);
    const last = latestScan(db, PROJECT_CODE);
    expect(last?.trigger).toBe('project_created');
    expect(last?.status).toBe('queued');
  });

  it('records a project_switched scan', async () => {
    const db = await makeDb();
    recordScan(db, { projectCode: PROJECT_CODE, trigger: 'project_switched' });
    expect(latestScan(db, PROJECT_CODE)?.trigger).toBe('project_switched');
  });

  it('records a repo_path_changed scan (also re-used for scan_ignore changes)', async () => {
    const db = await makeDb();
    recordScan(db, { projectCode: PROJECT_CODE, trigger: 'repo_path_changed' });
    expect(latestScan(db, PROJECT_CODE)?.trigger).toBe('repo_path_changed');
  });
});
