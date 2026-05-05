// Shared discriminated unions for the agentboard core.

export const PHASES = [
  'DISCOVERY',
  'REFINEMENT',
  'PLANNING',
  'EXECUTING',
  'VERIFICATION',
  'DONE',
] as const;
export type Phase = (typeof PHASES)[number];

export const DISCOVERY_MODES = [
  'full',
  'validate',
  'technical-depth',
  'ship-fast',
  'explore',
] as const;
export type DiscoveryMode = (typeof DISCOVERY_MODES)[number];

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';

export type TaskStatus = 'todo' | 'agent_working' | 'agent_review' | 'human_approval' | 'done';

export type AssigneeRole = 'pm' | 'worker' | 'reviewer' | 'human';
export type ActorRole = AssigneeRole | 'system';
export type RunRole = 'pm' | 'worker' | 'reviewer';

export type WorkflowType = 'WF1' | 'WF2';
export type AgentProvider = 'claude' | 'github_copilot' | 'codex';

export type ExitVerb = 'cancel' | 'wontfix' | 'revisit';
