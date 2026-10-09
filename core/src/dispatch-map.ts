import type { AssigneeRole, RunRole, TaskStatus } from './types.ts';

export function resolveAutoDispatch(
  status: TaskStatus,
  assignee: AssigneeRole | null,
): RunRole | 'pm' | null {
  if (status === 'todo' && assignee === null) return 'pm';
  if (status === 'agent_working' && assignee === 'worker') return 'worker';
  if (status === 'agent_working' && assignee === 'pm') return 'pm';
  if (status === 'agent_review' && assignee === 'reviewer') return 'reviewer';
  return null;
}
