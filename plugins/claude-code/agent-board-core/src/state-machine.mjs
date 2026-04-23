/**
 * Workflow-aware task state machine. Single source of truth.
 * @typedef {'WF1'|'WF2'} WorkflowType
 * @typedef {'todo'|'agent_working'|'agent_review'|'human_approval'|'done'} TaskStatus
 * @typedef {'pm'|'worker'|'reviewer'|'human'|null} AssigneeRole
 * @typedef {'pm'|'worker'|'reviewer'|'human'|'system'} ActorRole
 */

const WF1 = [
  { from: 'todo',           to: 'agent_working',  allowedAssignees: ['worker'],     byRoles: ['pm'] },
  { from: 'agent_working',  to: 'agent_working',  allowedAssignees: ['worker','pm'], byRoles: ['worker','reviewer','human'] },
  { from: 'agent_working',  to: 'agent_review',   allowedAssignees: ['reviewer'],   byRoles: ['worker'] },
  { from: 'agent_review',   to: 'agent_working',  allowedAssignees: ['worker'],     byRoles: ['reviewer'] },
  { from: 'agent_review',   to: 'human_approval', allowedAssignees: ['human'],      byRoles: ['reviewer'] },
  { from: 'human_approval', to: 'agent_working',  allowedAssignees: ['worker'],     byRoles: ['human'] },
  { from: 'human_approval', to: 'done',           allowedAssignees: ['human'],      byRoles: ['human'] },
];

const WF2 = [
  { from: 'todo',           to: 'agent_working',  allowedAssignees: ['worker'],     byRoles: ['pm'] },
  { from: 'agent_working',  to: 'agent_working',  allowedAssignees: ['worker','pm'], byRoles: ['worker','human'] },
  { from: 'agent_working',  to: 'human_approval', allowedAssignees: ['human'],      byRoles: ['worker'] },
  { from: 'human_approval', to: 'agent_working',  allowedAssignees: ['worker'],     byRoles: ['human'] },
  { from: 'human_approval', to: 'done',           allowedAssignees: ['human'],      byRoles: ['human'] },
];

export function transitions(wf) {
  return wf === 'WF1' ? WF1 : WF2;
}

export function canTransition(wf, from, to, assignee, by) {
  const rules = transitions(wf).filter(t => t.from === from && t.to === to);
  if (rules.length === 0) return { ok: false, reason: `no rule ${wf}: ${from} → ${to}` };
  const r = rules[0];
  if (!r.allowedAssignees.includes(assignee)) {
    return { ok: false, reason: `assignee_role '${assignee}' not allowed for ${to}` };
  }
  if (!r.byRoles.includes(by)) {
    return { ok: false, reason: `role '${by}' cannot perform ${from} → ${to}` };
  }
  return { ok: true };
}

/** Allowed previous statuses for (wf, to). Used by CAS WHERE clause. */
export function allowedPrevStatuses(wf, to) {
  return transitions(wf).filter(t => t.to === to).map(t => t.from);
}
