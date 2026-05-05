// Inner phase machine: governs a single agent_run from DISCOVERY → DONE.
// Outer task FSM (state-machine.mjs) is unaffected.
//
// Push model (noskills-style): the agent calls `abrun.next` which reads this
// module, then `abrun.advance(to)` which validates here. The agent never
// decides phases silently.

import type { DiscoveryMode, ExitVerb, Phase, RunRole } from './types.ts';
import { PHASES } from './types.ts';

interface PhaseRule {
  readonly from: Phase;
  readonly to: Phase;
  /** Roles allowed to advance into `to`. */
  readonly byRoles: readonly RunRole[];
  /** Modes for which this transition is valid. `null` = all modes. */
  readonly modes: readonly DiscoveryMode[] | null;
}

const RULES: readonly PhaseRule[] = [
  // Standard forward path (full mode)
  {
    from: 'DISCOVERY',
    to: 'REFINEMENT',
    byRoles: ['pm', 'worker'],
    modes: ['full', 'validate', 'technical-depth', 'explore'],
  },
  { from: 'REFINEMENT', to: 'PLANNING', byRoles: ['pm', 'worker'], modes: null },
  { from: 'PLANNING', to: 'EXECUTING', byRoles: ['pm', 'worker'], modes: null },
  { from: 'EXECUTING', to: 'VERIFICATION', byRoles: ['worker'], modes: null },
  { from: 'VERIFICATION', to: 'DONE', byRoles: ['worker', 'reviewer'], modes: null },

  // ship-fast: collapse DISCOVERY → PLANNING (skip REFINEMENT)
  { from: 'DISCOVERY', to: 'PLANNING', byRoles: ['pm', 'worker'], modes: ['ship-fast'] },

  // revisit re-entry (handled by exitWith below; rules here are forward-only)
];

export interface AdvanceResult {
  ok: boolean;
  reason?: string;
}

export function canAdvance(
  from: Phase,
  to: Phase,
  byRole: RunRole,
  mode: DiscoveryMode,
): AdvanceResult {
  if (from === to) return { ok: false, reason: 'no-op transition' };
  if (from === 'DONE') return { ok: false, reason: 'already DONE' };

  const match = RULES.find(
    (r) =>
      r.from === from &&
      r.to === to &&
      r.byRoles.includes(byRole) &&
      (r.modes === null || r.modes.includes(mode)),
  );
  if (!match) return { ok: false, reason: `no rule: ${from} → ${to} by ${byRole} (mode=${mode})` };
  return { ok: true };
}

export function nextPhase(from: Phase, mode: DiscoveryMode): Phase | null {
  if (from === 'DONE') return null;
  if (mode === 'ship-fast') {
    if (from === 'DISCOVERY') return 'PLANNING';
    if (from === 'PLANNING') return 'EXECUTING';
    if (from === 'EXECUTING') return 'VERIFICATION';
    if (from === 'VERIFICATION') return 'DONE';
    return null;
  }
  const idx = PHASES.indexOf(from);
  if (idx < 0 || idx >= PHASES.length - 1) return null;
  return PHASES[idx + 1] ?? null;
}

/** Behavioral push: what the agent must / must-not do in this phase. */
export interface BehavioralBlock {
  readonly phase: Phase;
  readonly focus: string;
  readonly must: readonly string[];
  readonly mustNot: readonly string[];
}

const BEHAVIORAL: Record<Phase, BehavioralBlock> = {
  DISCOVERY: {
    phase: 'DISCOVERY',
    focus: 'Understand the request. Ask. Do not code.',
    must: [
      'Ask clarifying questions one at a time as comments',
      'Probe product, engineering, and QA dimensions',
      'Stop and request human input when blocked',
    ],
    mustNot: [
      'Edit any file (PreToolUse hook will block)',
      'Run git writes (commit/push/checkout)',
      'Declare anything done',
    ],
  },
  REFINEMENT: {
    phase: 'REFINEMENT',
    focus: 'Validate assumptions. Surface unknowns. Sharpen acceptance criteria.',
    must: [
      'Restate the spec in your own words',
      'List acceptance criteria as machine-checkable bullets',
      'Identify risks and edge cases',
    ],
    mustNot: ['Edit code', 'Skip ambiguous points'],
  },
  PLANNING: {
    phase: 'PLANNING',
    focus: 'Decide approach. Choose files. Plan tests. No code yet.',
    must: [
      'Enumerate files to modify with one-line reason each',
      'Identify reusable utilities/functions before proposing new code',
      'State test strategy',
    ],
    mustNot: ['Write production code', 'Write tests yet (planning only)'],
  },
  EXECUTING: {
    phase: 'EXECUTING',
    focus: 'Implement the plan. Stay scoped.',
    must: [
      'Edit only files listed in PLANNING (advance back to PLANNING if scope grows)',
      'Keep each commit focused; reference acceptance criteria',
      'Record TODOs as debt via abrun.record_debt — never silently skip',
    ],
    mustNot: [
      'Add unrelated refactors',
      'Disable tests',
      'Skip error handling at trust boundaries',
    ],
  },
  VERIFICATION: {
    phase: 'VERIFICATION',
    focus: 'Prove it works. Each acceptance criterion needs evidence.',
    must: [
      'Run the test suite; paste failures',
      'Provide one evidence line per acceptance criterion',
      'Resolve or carry forward each open debt item',
    ],
    mustNot: ['Mark DONE without evidence', 'Hide failing tests'],
  },
  DONE: {
    phase: 'DONE',
    focus: 'Run is complete. Outer task FSM takes over.',
    must: ['Post a final summary comment'],
    mustNot: ['Edit further'],
  },
};

export function behavioralFor(phase: Phase): BehavioralBlock {
  return BEHAVIORAL[phase];
}

/** Apply an exit verb. Returns next phase (or null = run terminates). */
export function exitWith(_from: Phase, verb: ExitVerb): Phase | null {
  switch (verb) {
    case 'cancel':
    case 'wontfix':
      return null; // terminate run; outer FSM handles task disposition
    case 'revisit':
      return 'DISCOVERY';
  }
}

export interface PhasePolicy {
  blockWrites: boolean;
  blockedTools: string[];
}

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash'];

export function toolPolicy(phase: Phase): PhasePolicy {
  if (phase === 'DISCOVERY' || phase === 'REFINEMENT') {
    return { blockWrites: true, blockedTools: WRITE_TOOLS };
  }
  return { blockWrites: false, blockedTools: [] };
}
