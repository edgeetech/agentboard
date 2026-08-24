import {
  PHASES,
  type DiscoveryMode,
  type ExitVerb,
  type Phase,
  type RunRole,
} from "../domain/types.ts";

interface PhaseRule {
  readonly from: Phase;
  readonly to: Phase;
  readonly byRoles: readonly RunRole[];
  readonly modes: readonly DiscoveryMode[] | null;
}

const RULES: readonly PhaseRule[] = [
  {
    from: "DISCOVERY",
    to: "REFINEMENT",
    byRoles: ["pm", "worker"],
    modes: ["full", "validate", "technical-depth", "explore"],
  },
  {
    from: "REFINEMENT",
    to: "PLANNING",
    byRoles: ["pm", "worker"],
    modes: null,
  },
  { from: "PLANNING", to: "EXECUTING", byRoles: ["pm", "worker"], modes: null },
  { from: "EXECUTING", to: "VERIFICATION", byRoles: ["worker"], modes: null },
  {
    from: "VERIFICATION",
    to: "DONE",
    byRoles: ["worker", "reviewer"],
    modes: null,
  },
  {
    from: "DISCOVERY",
    to: "PLANNING",
    byRoles: ["pm", "worker"],
    modes: ["ship-fast"],
  },
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
  if (from === to) return { ok: false, reason: "no-op transition" };
  if (from === "DONE") return { ok: false, reason: "already DONE" };

  const match = RULES.find(
    (rule) =>
      rule.from === from &&
      rule.to === to &&
      rule.byRoles.includes(byRole) &&
      (rule.modes === null || rule.modes.includes(mode)),
  );
  if (!match)
    return {
      ok: false,
      reason: `no rule: ${from} -> ${to} by ${byRole} (mode=${mode})`,
    };
  return { ok: true };
}

export function nextPhase(from: Phase, mode: DiscoveryMode): Phase | null {
  if (from === "DONE") return null;
  if (mode === "ship-fast") {
    if (from === "DISCOVERY") return "PLANNING";
    if (from === "PLANNING") return "EXECUTING";
    if (from === "EXECUTING") return "VERIFICATION";
    if (from === "VERIFICATION") return "DONE";
    return null;
  }
  const index = PHASES.indexOf(from);
  if (index < 0 || index >= PHASES.length - 1) return null;
  return PHASES[index + 1] ?? null;
}

export interface BehavioralBlock {
  readonly phase: Phase;
  readonly focus: string;
  readonly must: readonly string[];
  readonly mustNot: readonly string[];
}

const BEHAVIORAL: Record<Phase, BehavioralBlock> = {
  DISCOVERY: {
    phase: "DISCOVERY",
    focus: "Understand the request. Ask. Do not code.",
    must: [
      "Ask clarifying questions one at a time as comments",
      "Probe product, engineering, and QA dimensions",
      "Stop and request human input when blocked",
    ],
    mustNot: [
      "Edit any file (PreToolUse hook will block)",
      "Run git writes (commit/push/checkout)",
      "Declare anything done",
    ],
  },
  REFINEMENT: {
    phase: "REFINEMENT",
    focus:
      "Validate assumptions. Surface unknowns. Sharpen acceptance criteria.",
    must: [
      "Restate the spec in your own words",
      "List acceptance criteria as machine-checkable bullets",
      "Identify risks and edge cases",
    ],
    mustNot: ["Edit code", "Skip ambiguous points"],
  },
  PLANNING: {
    phase: "PLANNING",
    focus: "Decide approach. Choose files. Plan tests. No code yet.",
    must: [
      "Enumerate files to modify with one-line reason each",
      "Identify reusable utilities/functions before proposing new code",
      "State test strategy",
    ],
    mustNot: ["Write production code", "Write tests yet (planning only)"],
  },
  EXECUTING: {
    phase: "EXECUTING",
    focus: "Implement the plan. Stay scoped.",
    must: [
      "Edit only files listed in PLANNING (advance back to PLANNING if scope grows)",
      "Keep each commit focused; reference acceptance criteria",
      "Record TODOs as debt via abrun.record_debt - never silently skip",
    ],
    mustNot: [
      "Add unrelated refactors",
      "Disable tests",
      "Skip error handling at trust boundaries",
    ],
  },
  VERIFICATION: {
    phase: "VERIFICATION",
    focus: "Prove it works. Each acceptance criterion needs evidence.",
    must: [
      "Run the test suite; paste failures",
      "Provide one evidence line per acceptance criterion",
      "Resolve or carry forward each open debt item",
    ],
    mustNot: ["Mark DONE without evidence", "Hide failing tests"],
  },
  DONE: {
    phase: "DONE",
    focus: "Run is complete. Outer task FSM takes over.",
    must: ["Post a final summary comment"],
    mustNot: ["Edit further"],
  },
};

export function behavioralFor(phase: Phase): BehavioralBlock {
  return BEHAVIORAL[phase];
}

export function exitWith(_from: Phase, verb: ExitVerb): Phase | null {
  switch (verb) {
    case "cancel":
    case "wontfix":
      return null;
    case "revisit":
      return "DISCOVERY";
  }
}

export interface PhasePolicy {
  blockWrites: boolean;
  blockedTools: string[];
}

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "Bash"];

export function toolPolicy(phase: Phase): PhasePolicy {
  if (phase === "DISCOVERY" || phase === "REFINEMENT") {
    return { blockWrites: true, blockedTools: WRITE_TOOLS };
  }
  return { blockWrites: false, blockedTools: [] };
}
