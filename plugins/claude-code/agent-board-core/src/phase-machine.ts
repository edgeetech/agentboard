// Inner phase machine compatibility surface.
//
// Runtime callers still import this legacy module, while phase policy now lives
// in the provider-free Engine package.

import {
  behavioralFor as engineBehavioralFor,
  canAdvance as engineCanAdvance,
  exitWith as engineExitWith,
  nextPhase as engineNextPhase,
  toolPolicy as engineToolPolicy,
  type AdvanceResult,
  type BehavioralBlock,
  type PhasePolicy,
} from '../../../../packages/engine/src/workflows/run-phase.ts';

import type { DiscoveryMode, ExitVerb, Phase, RunRole } from './types.ts';

export type { AdvanceResult, BehavioralBlock, PhasePolicy };

export function canAdvance(
  from: Phase,
  to: Phase,
  byRole: RunRole,
  mode: DiscoveryMode,
): AdvanceResult {
  return engineCanAdvance(from, to, byRole, mode);
}

export function nextPhase(from: Phase, mode: DiscoveryMode): Phase | null {
  return engineNextPhase(from, mode);
}

export function behavioralFor(phase: Phase): BehavioralBlock {
  return engineBehavioralFor(phase);
}

export function exitWith(from: Phase, verb: ExitVerb): Phase | null {
  return engineExitWith(from, verb);
}

export function toolPolicy(phase: Phase): PhasePolicy {
  return engineToolPolicy(phase);
}
