// The core server ships packaging-safe mirrors of the Engine workflow rules
// (state machine, phase machine) because the plugin cannot import workspace
// packages at runtime. These tests keep the two copies from drifting.

import { describe, expect, it } from 'vitest';

import * as enginePhase from '../../../../packages/engine/src/workflows/run-phase.ts';
import * as engineTask from '../../../../packages/engine/src/workflows/task-state.ts';
import * as corePhase from '../src/phase-machine.ts';
import * as coreTask from '../src/state-machine.ts';

const WORKFLOWS = ['WF1', 'WF2'] as const;
const STATUSES = ['todo', 'agent_working', 'agent_review', 'human_approval', 'done'] as const;
const PHASES = [
  'DISCOVERY',
  'REFINEMENT',
  'PLANNING',
  'EXECUTING',
  'VERIFICATION',
  'DONE',
] as const;
const EXIT_VERBS = ['cancel', 'wontfix', 'revisit'] as const;
const MODES = ['full', 'validate', 'technical-depth', 'ship-fast', 'explore'] as const;
const RUN_ROLES = ['pm', 'worker', 'reviewer'] as const;

describe('core ↔ engine parity', () => {
  it.each(WORKFLOWS)('task transitions match for %s', (wf) => {
    expect(coreTask.transitions(wf)).toEqual(engineTask.transitions(wf));
    for (const to of STATUSES) {
      expect(coreTask.allowedPrevStatuses(wf, to)).toEqual(engineTask.allowedPrevStatuses(wf, to));
    }
  });

  it('phase progression, exits and tool policy match', () => {
    for (const phase of PHASES) {
      expect(corePhase.toolPolicy(phase)).toEqual(enginePhase.toolPolicy(phase));
      expect(corePhase.behavioralFor(phase)).toEqual(enginePhase.behavioralFor(phase));
      for (const mode of MODES) {
        expect(corePhase.nextPhase(phase, mode)).toBe(enginePhase.nextPhase(phase, mode));
        for (const to of PHASES) {
          for (const role of RUN_ROLES) {
            expect(corePhase.canAdvance(phase, to, role, mode)).toEqual(
              enginePhase.canAdvance(phase, to, role, mode),
            );
          }
        }
      }
      for (const verb of EXIT_VERBS) {
        expect(corePhase.exitWith(phase, verb)).toBe(enginePhase.exitWith(phase, verb));
      }
    }
  });
});
