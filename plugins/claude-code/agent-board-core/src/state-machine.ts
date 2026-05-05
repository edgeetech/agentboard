import type { ActorRole, AssigneeRole, TaskStatus, WorkflowType } from './types.ts';

export interface TransitionRule {
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly allowedAssignees: readonly AssigneeRole[];
  readonly byRoles: readonly ActorRole[];
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

const WF1: TransitionRule[] = [
  { from: 'todo', to: 'agent_working', allowedAssignees: ['worker'], byRoles: ['pm', 'human'] },
  { from: 'todo', to: 'agent_review', allowedAssignees: ['reviewer'], byRoles: ['pm', 'reviewer'] },
  {
    from: 'agent_working',
    to: 'agent_working',
    allowedAssignees: ['worker', 'pm'],
    byRoles: ['worker', 'reviewer', 'human'],
  },
  {
    from: 'agent_working',
    to: 'agent_review',
    allowedAssignees: ['reviewer'],
    byRoles: ['worker'],
  },
  { from: 'agent_working', to: 'todo', allowedAssignees: ['pm'], byRoles: ['worker'] },
  {
    from: 'agent_review',
    to: 'agent_working',
    allowedAssignees: ['worker'],
    byRoles: ['reviewer'],
  },
  { from: 'agent_review', to: 'todo', allowedAssignees: ['pm'], byRoles: ['reviewer'] },
  {
    from: 'agent_review',
    to: 'human_approval',
    allowedAssignees: ['human'],
    byRoles: ['reviewer'],
  },
  { from: 'human_approval', to: 'agent_working', allowedAssignees: ['worker'], byRoles: ['human'] },
  { from: 'human_approval', to: 'done', allowedAssignees: ['human'], byRoles: ['human'] },
  {
    from: 'todo',
    to: 'todo',
    allowedAssignees: ['pm', 'human'],
    byRoles: ['worker', 'reviewer', 'pm'],
  },
];

const WF2: TransitionRule[] = [
  { from: 'todo', to: 'agent_working', allowedAssignees: ['worker'], byRoles: ['pm', 'human'] },
  {
    from: 'agent_working',
    to: 'agent_working',
    allowedAssignees: ['worker', 'pm'],
    byRoles: ['worker', 'human'],
  },
  { from: 'agent_working', to: 'todo', allowedAssignees: ['pm'], byRoles: ['worker'] },
  { from: 'agent_working', to: 'human_approval', allowedAssignees: ['human'], byRoles: ['worker'] },
  { from: 'human_approval', to: 'agent_working', allowedAssignees: ['worker'], byRoles: ['human'] },
  { from: 'human_approval', to: 'done', allowedAssignees: ['human'], byRoles: ['human'] },
  { from: 'todo', to: 'todo', allowedAssignees: ['pm', 'human'], byRoles: ['worker', 'pm'] },
];

export function transitions(wf: WorkflowType): TransitionRule[] {
  return wf === 'WF1' ? WF1 : WF2;
}

export function canTransition(
  wf: WorkflowType,
  from: TaskStatus,
  to: TaskStatus,
  assignee: AssigneeRole | null,
  by: ActorRole,
): TransitionResult {
  const rules = transitions(wf).filter((t) => t.from === from && t.to === to);
  const r = rules[0];
  if (!r) return { ok: false, reason: `no rule ${wf}: ${from} → ${to}` };
  if (
    assignee === null ||
    !(r.allowedAssignees as readonly (AssigneeRole | null)[]).includes(assignee)
  ) {
    return { ok: false, reason: `assignee_role '${String(assignee)}' not allowed for ${to}` };
  }
  if (!r.byRoles.includes(by)) {
    return { ok: false, reason: `role '${by}' cannot perform ${from} → ${to}` };
  }
  return { ok: true };
}

export function allowedPrevStatuses(wf: WorkflowType, to: TaskStatus): TaskStatus[] {
  return transitions(wf)
    .filter((t) => t.to === to)
    .map((t) => t.from);
}
