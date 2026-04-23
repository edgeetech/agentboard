// Postflight checks on finish_run(succeeded) — enforced by MCP server.

export function checkPostflight(role, task, comments) {
  const bodies = comments.map(c => c.body || '');
  const hasPrefix = (pre) => bodies.some(b => b.startsWith(pre));

  if (role === 'pm') {
    if (!task.description || !task.description.trim()) {
      return 'description must be non-empty';
    }
    let ac;
    try { ac = JSON.parse(task.acceptance_criteria_json || '[]'); }
    catch { return 'acceptance_criteria_json not valid JSON'; }
    if (!Array.isArray(ac) || ac.length < 1 || ac.length > 20) {
      return 'acceptance_criteria must have 1..20 items';
    }
    for (const item of ac) {
      if (!item.text || item.text.length > 500) return 'AC item text must be 1..500 chars';
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

  if (role === 'reviewer') {
    if (!hasPrefix('REVIEW_VERDICT')) return 'missing REVIEW_VERDICT comment';
    if (!hasPrefix('RATIONALE'))      return 'missing RATIONALE comment';
    return null;
  }

  return null;
}

// Rework / NEEDS_PM comment guard: when reassigning to 'worker' (from reviewer)
// or 'pm' (from worker), the run must have added a matching prefixed comment.
export function checkReassignAudit(by_role, to_assignee, recent_comments) {
  const bodies = recent_comments.map(c => c.body || '');
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
