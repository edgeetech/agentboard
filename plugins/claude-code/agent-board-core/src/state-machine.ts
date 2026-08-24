import {
  allowedPrevStatuses as engineAllowedPrevStatuses,
  canTransition as engineCanTransition,
  transitions as engineTransitions,
  type TransitionResult,
  type TransitionRule,
} from '../../../../packages/engine/src/workflows/task-state.ts';

import type { ActorRole, AssigneeRole, TaskStatus, WorkflowType } from './types.ts';

export type { TransitionResult, TransitionRule };

export function transitions(wf: WorkflowType): TransitionRule[] {
  return [...engineTransitions(wf)];
}

export function canTransition(
  wf: WorkflowType,
  from: TaskStatus,
  to: TaskStatus,
  assignee: AssigneeRole | null,
  by: ActorRole,
): TransitionResult {
  return engineCanTransition(wf, from, to, assignee, by);
}

export function allowedPrevStatuses(wf: WorkflowType, to: TaskStatus): TaskStatus[] {
  return engineAllowedPrevStatuses(wf, to);
}
