// Repo helpers for the inner phase machine. Sits alongside repo.ts (which
// owns the outer task FSM) — kept separate so phase wiring can land without
// touching repo.ts every time.

import { randomUUID } from 'node:crypto';

import type { DbHandle } from './db.ts';
import { isoNow } from './time.ts';
import type { Phase } from './types.ts';

// ─── Re-exported types (sidecar deleted) ────────────────────────────────────

export type { DbHandle };

export interface PhaseHistoryEntry {
  from: Phase;
  to: Phase | 'cancel' | 'wontfix' | 'revisit';
  by: string;
  at: string;
  exit?: 'cancel' | 'wontfix' | 'revisit';
}

export interface RunPhaseState {
  phase: Phase;
  state: Record<string, unknown>;
  history: PhaseHistoryEntry[];
}

export interface DebtRow {
  id: string;
  task_id: string;
  run_id: string | null;
  description: string;
  carried_count: number;
  resolved_at: string | null;
  created_at: string;
}

export interface ActivityRow {
  id: string;
  run_id: string;
  task_id: string;
  kind: string;
  payload: Record<string, unknown>;
  at: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (s === null || s === undefined || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

interface AgentRunRow {
  phase: string | null;
  phase_state_json: string | null;
  phase_history_json: string | null;
}

function isAgentRunRow(x: unknown): x is AgentRunRow {
  if (typeof x !== 'object' || x === null) return false;
  return true;
}

// ─── Phase state ─────────────────────────────────────────────────────────────

export function getRunPhaseState(db: DbHandle, run_id: string): RunPhaseState | null {
  const row = db
    .prepare(
      `
    SELECT phase, phase_state_json, phase_history_json
    FROM agent_run WHERE id=?
  `,
    )
    .get(run_id);
  if (row === null || row === undefined || !isAgentRunRow(row)) return null;
  return {
    phase: (row.phase ?? 'DISCOVERY') as Phase,
    state: safeJson<Record<string, unknown>>(row.phase_state_json, {}),
    history: safeJson<PhaseHistoryEntry[]>(row.phase_history_json, []),
  };
}

export function setRunPhase(
  db: DbHandle,
  run_id: string,
  args: {
    phase: Phase;
    state?: Record<string, unknown>;
    appendHistoryEntry?: PhaseHistoryEntry;
  },
): void {
  const cur = getRunPhaseState(db, run_id);
  if (!cur) throw new Error('run not found');
  const history = cur.history.slice();
  if (args.appendHistoryEntry) history.push(args.appendHistoryEntry);
  const stateJson = JSON.stringify(args.state ?? cur.state);
  const histJson = JSON.stringify(history);
  db.prepare(
    `
    UPDATE agent_run SET phase=?, phase_state_json=?, phase_history_json=?
    WHERE id=?
  `,
  ).run(args.phase, stateJson, histJson, run_id);
}

// ─── Debt ────────────────────────────────────────────────────────────────────

export function recordDebt(
  db: DbHandle,
  args: { task_id: string; run_id: string | null; description: string },
): DebtRow {
  const id = randomUUID();
  const at = isoNow();
  db.prepare(
    `
    INSERT INTO task_debt (id, task_id, run_id, description, carried_count, resolved_at, created_at)
    VALUES (?, ?, ?, ?, 0, NULL, ?)
  `,
  ).run(id, args.task_id, args.run_id, args.description, at);
  return {
    id,
    task_id: args.task_id,
    run_id: args.run_id,
    description: args.description,
    carried_count: 0,
    resolved_at: null,
    created_at: at,
  };
}

export function listOpenDebt(db: DbHandle, task_id: string): DebtRow[] {
  const rows = db
    .prepare(
      `
    SELECT id, task_id, run_id, description, carried_count, created_at
    FROM task_debt
    WHERE task_id=? AND resolved_at IS NULL
    ORDER BY carried_count DESC, created_at ASC
  `,
    )
    .all(task_id);
  return rows as DebtRow[];
}

export function carryForwardDebt(db: DbHandle, task_id: string): void {
  db.prepare(
    `
    UPDATE task_debt SET carried_count = carried_count + 1
    WHERE task_id=? AND resolved_at IS NULL
  `,
  ).run(task_id);
}

export function resolveDebt(db: DbHandle, debt_id: string): void {
  db.prepare(`UPDATE task_debt SET resolved_at=? WHERE id=?`).run(isoNow(), debt_id);
}

// ─── Activity ─────────────────────────────────────────────────────────────────

interface RawActivityRow {
  id: string;
  run_id: string;
  task_id: string;
  kind: string;
  payload: string;
  at: string;
}

function toActivityRow(r: unknown): ActivityRow {
  const raw = r as RawActivityRow;
  return { ...raw, payload: safeJson<Record<string, unknown>>(raw.payload, {}) };
}

export function recordActivity(
  db: DbHandle,
  args: { run_id: string; task_id: string; kind: string; payload?: unknown },
): ActivityRow {
  const id = randomUUID();
  const at = isoNow();
  const payloadStr =
    typeof args.payload === 'string' ? args.payload : JSON.stringify(args.payload ?? {});
  db.prepare(
    `
    INSERT INTO agent_activity (id, run_id, task_id, kind, payload, at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(id, args.run_id, args.task_id, args.kind, payloadStr, at);
  return {
    id,
    run_id: args.run_id,
    task_id: args.task_id,
    kind: args.kind,
    payload: safeJson<Record<string, unknown>>(payloadStr, {}),
    at,
  };
}

export function listActivity(db: DbHandle, run_id: string, since?: string): ActivityRow[] {
  if (since) {
    return db
      .prepare(
        `
      SELECT id, run_id, task_id, kind, payload, at FROM agent_activity
      WHERE run_id=? AND at > ? ORDER BY at ASC
    `,
      )
      .all(run_id, since)
      .map(toActivityRow);
  }
  return db
    .prepare(
      `
    SELECT id, run_id, task_id, kind, payload, at FROM agent_activity
    WHERE run_id=? ORDER BY at ASC
  `,
    )
    .all(run_id)
    .map(toActivityRow);
}

export function listActivityForTask(db: DbHandle, task_id: string, limit = 20): ActivityRow[] {
  return db
    .prepare(
      `
    SELECT id, run_id, task_id, kind, payload, at FROM agent_activity
    WHERE task_id=? ORDER BY at DESC LIMIT ?
  `,
    )
    .all(task_id, limit)
    .map(toActivityRow);
}
