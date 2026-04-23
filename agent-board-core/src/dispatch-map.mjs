/**
 * AUTO_DISPATCH_MAP. Evaluated after any task UPDATE (status OR assignee change).
 * Returns dispatch role, or null.
 */
export function resolveAutoDispatch(status, assignee) {
  if (status === 'todo' && assignee === null) return 'pm';
  if (status === 'agent_working' && assignee === 'worker') return 'worker';
  if (status === 'agent_working' && assignee === 'pm') return 'pm';
  if (status === 'agent_review' && assignee === 'reviewer') return 'reviewer';
  return null;
}
