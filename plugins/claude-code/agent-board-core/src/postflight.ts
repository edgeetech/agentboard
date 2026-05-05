// Postflight checks on finish_run(succeeded) — enforced by MCP server.

import type { ActorRole, AssigneeRole, Phase, RunRole } from './types.ts';

export interface CommentLike {
  body?: string | null;
  author_role?: ActorRole;
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
export function checkPhaseGate(role: RunRole, runPhase: Phase | null | undefined): string | null {
  if (role === 'pm') return null;
  if (runPhase === 'DONE') return null;
  return `phase ${runPhase ?? 'DISCOVERY'} is not DONE — call abrun.advance until DONE before finish_run(succeeded)`;
}

export function checkPostflight(
  role: RunRole,
  task: TaskLike,
  comments: readonly CommentLike[],
): string | null {
  const bodies = comments.map(c => c.body ?? '');
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
