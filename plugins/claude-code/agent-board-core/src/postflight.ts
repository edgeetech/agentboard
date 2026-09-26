// Postflight checks on finish_run(succeeded) — enforced by MCP server.

import type { ActorRole, AssigneeRole, Phase, RunRole } from './types.ts';

export interface CommentLike {
  body?: string | null;
  author_role?: ActorRole;
  created_at?: string;
}

export interface TaskLike {
  description?: string | null;
  acceptance_criteria_json?: string | null;
}

/**
 * Gate finish_run(succeeded) on the inner phase machine.
 * Worker/reviewer runs must reach phase=DONE before they can mark succeeded.
 * pm runs are exempt (they don't run the phase loop; they only enrich tasks).
 */
/**
 * Council members that are NOT the synthesizer (last member) skip postflight —
 * the synthesizer is the one responsible for posting canonical role artifacts.
 */
export function isNonFinalCouncilMember(run: {
  parent_run_id?: string | null;
  member_index?: number | null;
  council_size?: number | null;
}): boolean {
  if (!run.parent_run_id) return false;
  if (run.member_index === null || run.member_index === undefined) return false;
  if (run.council_size === null || run.council_size === undefined) return false;
  return run.member_index < run.council_size - 1;
}

export function checkPhaseGate(role: RunRole, runPhase: Phase | null | undefined): string | null {
  if (role === 'pm') return null;
  if (runPhase === 'DONE') return null;
  return `phase ${runPhase ?? 'DISCOVERY'} is not DONE — call abrun.advance until DONE before finish_run(succeeded)`;
}

/**
 * `comments` has no `run_id` column (see db/schema.sql), so we scope "this
 * run's required comments" by author_role + created_at >= sinceIso (the
 * run's own started_at). Without this, a rework run inherits credit for a
 * PRIOR run's `DEV_COMPLETED`/`REVIEW_VERDICT` comment, or a human comment
 * that happens to start with `REVIEW_VERDICT:` satisfies the reviewer gate.
 * Pass `sinceIso: null` only for callers that can't supply a run start time
 * (falls back to unscoped — do not use for finish_run's real enforcement).
 */
export function checkPostflight(
  role: RunRole,
  task: TaskLike,
  comments: readonly CommentLike[],
  sinceIso: string | null,
): string | null {
  const scoped = comments.filter(
    (c) => c.author_role === role && (sinceIso === null || (c.created_at ?? '') >= sinceIso),
  );
  const bodies = scoped.map(c => c.body ?? '');
  const hasPrefix = (pre: string): boolean => bodies.some(b => b.startsWith(pre));

  if (role === 'pm') {
    if (!task.description?.trim()) {
      return 'description must be non-empty';
    }
    let ac: unknown;
    try { ac = JSON.parse(task.acceptance_criteria_json ?? '[]'); }
    catch { return 'acceptance_criteria_json not valid JSON'; }
    if (!Array.isArray(ac) || ac.length < 1 || ac.length > 20) {
      return 'acceptance_criteria must have 1..20 items';
    }
    for (const item of ac) {
      const it = item as Record<string, unknown>;
      const text = it.text;
      if (typeof text !== 'string' || text.length === 0 || text.length > 500) return 'AC item text must be 1..500 chars';
    }
    if (!hasPrefix('ENRICHMENT_SUMMARY')) return 'missing ENRICHMENT_SUMMARY comment';
    return null;
  }

  if (role === 'worker') {
    if (!hasPrefix('DEV_COMPLETED')) return 'missing DEV_COMPLETED comment';
    if (!hasPrefix('FILES_CHANGED'))  return 'missing FILES_CHANGED comment';
    if (!hasPrefix('DIFF_SUMMARY'))   return 'missing DIFF_SUMMARY comment';
    return null;
  }

  // role === 'reviewer'
  if (!hasPrefix('REVIEW_VERDICT')) return 'missing REVIEW_VERDICT comment';
  if (!hasPrefix('RATIONALE'))      return 'missing RATIONALE comment';
  return null;
}

export interface RunCompletionRun {
  role: RunRole;
  parent_run_id?: string | null;
  member_index?: number | null;
  council_size?: number | null;
}

/**
 * Single source of truth for "may this run call finish_run(succeeded)?" —
 * council-skip, then required-comments, then the inner phase gate, in that
 * order. Used by BOTH the MCP finish_run path (src/api-mcp.ts) and the
 * executor's natural-end-of-turn path (src/executor.ts) so an agent that
 * quietly stops talking without calling finish_run can't skip the phase
 * gate that finish_run itself enforces.
 */
export function evaluateRunCompletion(
  run: RunCompletionRun,
  task: TaskLike,
  comments: readonly CommentLike[],
  phase: Phase | null | undefined,
  sinceIso: string | null,
): string | null {
  if (isNonFinalCouncilMember(run)) return null;
  const pfErr = checkPostflight(run.role, task, comments, sinceIso);
  if (pfErr !== null) return pfErr;
  return checkPhaseGate(run.role, phase);
}

// Rework / NEEDS_PM comment guard: when reassigning to 'worker' (from reviewer)
// or 'pm' (from worker), the run must have added a matching prefixed comment.
export function checkReassignAudit(
  by_role: ActorRole,
  to_assignee: AssigneeRole | null,
  recent_comments: readonly CommentLike[],
): string | null {
  const bodies = recent_comments.map(c => c.body ?? '');
  if (by_role === 'reviewer' && to_assignee === 'worker') {
    const m = bodies.find(b => b.startsWith('REWORK: '));
    if (!m || m.length < 'REWORK: '.length + 10) return 'REWORK comment (≥10 chars after prefix) required';
  }
  if (by_role === 'worker' && to_assignee === 'pm') {
    const m = bodies.find(b => b.startsWith('NEEDS_PM: '));
    if (!m || m.length < 'NEEDS_PM: '.length + 10) return 'NEEDS_PM comment (≥10 chars after prefix) required';
  }
  return null;
}
