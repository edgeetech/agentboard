// DB-backed integration test for phase-repo helpers. Uses node:sqlite directly
// against an in-memory database; mirrors the schema additions made in
// db/schema.sql + db.mjs MIGRATIONS.

import { describe, expect, it, beforeEach } from 'vitest';

import type { DbHandle } from '../src/db.ts';
import {
  getRunPhaseState,
  setRunPhase,
  recordDebt,
  listOpenDebt,
  resolveDebt,
  carryForwardDebt,
  recordActivity,
  listActivity,
} from '../src/phase-repo.ts';

let db: DbHandle;

async function makeDb(): Promise<DbHandle> {
  const mod = await import('node:sqlite');
  const d = new mod.DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE task (id TEXT PRIMARY KEY, code TEXT, title TEXT);
    CREATE TABLE agent_run (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      phase TEXT NOT NULL DEFAULT 'DISCOVERY',
      phase_state_json TEXT NOT NULL DEFAULT '{}',
      phase_history_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE task_debt (
      id TEXT PRIMARY KEY, task_id TEXT, run_id TEXT,
      description TEXT, carried_count INTEGER DEFAULT 0,
      resolved_at TEXT, created_at TEXT
    );
    CREATE TABLE agent_activity (
      id TEXT PRIMARY KEY, run_id TEXT, task_id TEXT,
      kind TEXT, payload TEXT, at TEXT
    );
    INSERT INTO task (id, code, title) VALUES ('T1', 'T-001', 'demo');
    INSERT INTO agent_run (id, task_id) VALUES ('R1', 'T1');
  `);
  // Cast through unknown — the mock satisfies DbHandle at runtime but
  // node:sqlite's StatementSync signatures use SQLInputValue which is
  // narrower than what DbHandle.prepare() declares internally.
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
  } as unknown as DbHandle;
}

describe('phase-repo', () => {
  beforeEach(async () => {
    db = await makeDb();
  });

  it('getRunPhaseState returns defaults for fresh run', () => {
    const s = getRunPhaseState(db, 'R1');
    expect(s?.phase).toBe('DISCOVERY');
    expect(s?.state).toEqual({});
    expect(s?.history).toEqual([]);
  });

  it('setRunPhase updates phase + appends history', () => {
    setRunPhase(db, 'R1', {
      phase: 'PLANNING',
      state: { plan: ['a', 'b'] },
      appendHistoryEntry: {
        from: 'DISCOVERY',
        to: 'PLANNING',
        by: 'worker',
        at: '2026-01-01T00:00:00Z',
      },
    });
    const s = getRunPhaseState(db, 'R1');
    expect(s?.phase).toBe('PLANNING');
    expect(s?.state.plan).toEqual(['a', 'b']);
    expect(s?.history).toHaveLength(1);
    expect(s?.history[0]?.to).toBe('PLANNING');
  });

  it('recordDebt + listOpenDebt + resolveDebt round-trip', () => {
    const a = recordDebt(db, { task_id: 'T1', run_id: 'R1', description: 'add tests' });
    const b = recordDebt(db, { task_id: 'T1', run_id: 'R1', description: 'fix flaky' });
    const open = listOpenDebt(db, 'T1');
    expect(open).toHaveLength(2);
    resolveDebt(db, a.id);
    const after = listOpenDebt(db, 'T1');
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(b.id);
  });

  it('carryForwardDebt bumps carried_count for open items only', () => {
    const a = recordDebt(db, { task_id: 'T1', run_id: 'R1', description: 'a' });
    recordDebt(db, { task_id: 'T1', run_id: 'R1', description: 'b' });
    resolveDebt(db, a.id);
    carryForwardDebt(db, 'T1');
    const open = listOpenDebt(db, 'T1');
    expect(open).toHaveLength(1);
    expect(open[0]?.carried_count).toBe(1);
  });

  it('recordActivity + listActivity preserve order', () => {
    recordActivity(db, {
      run_id: 'R1',
      task_id: 'T1',
      kind: 'phase:advanced',
      payload: { to: 'PLANNING' },
    });
    recordActivity(db, {
      run_id: 'R1',
      task_id: 'T1',
      kind: 'tool:invoked',
      payload: { tool: 'Read' },
    });
    const log = listActivity(db, 'R1');
    expect(log).toHaveLength(2);
    expect(log[0]?.kind).toBe('phase:advanced');
    expect(log[1]?.payload.tool).toBe('Read');
  });
});
