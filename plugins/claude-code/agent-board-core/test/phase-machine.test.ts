import { describe, expect, it } from 'vitest';

import { behavioralFor, canAdvance, exitWith, nextPhase } from '../src/phase-machine.ts';

describe('phase-machine', () => {
  it('blocks no-op transitions', () => {
    expect(canAdvance('PLANNING', 'PLANNING', 'worker', 'full').ok).toBe(false);
  });

  it('blocks transitions out of DONE', () => {
    expect(canAdvance('DONE', 'EXECUTING', 'worker', 'full').ok).toBe(false);
  });

  it('full mode follows the standard chain', () => {
    expect(canAdvance('DISCOVERY', 'REFINEMENT', 'worker', 'full').ok).toBe(true);
    expect(canAdvance('REFINEMENT', 'PLANNING', 'worker', 'full').ok).toBe(true);
    expect(canAdvance('PLANNING', 'EXECUTING', 'worker', 'full').ok).toBe(true);
    expect(canAdvance('EXECUTING', 'VERIFICATION', 'worker', 'full').ok).toBe(true);
    expect(canAdvance('VERIFICATION', 'DONE', 'worker', 'full').ok).toBe(true);
  });

  it('ship-fast collapses DISCOVERY → PLANNING', () => {
    expect(canAdvance('DISCOVERY', 'PLANNING', 'worker', 'ship-fast').ok).toBe(true);
    expect(canAdvance('DISCOVERY', 'REFINEMENT', 'worker', 'ship-fast').ok).toBe(false);
  });

  it('only worker can move to VERIFICATION', () => {
    expect(canAdvance('EXECUTING', 'VERIFICATION', 'worker', 'full').ok).toBe(true);
    expect(canAdvance('EXECUTING', 'VERIFICATION', 'pm', 'full').ok).toBe(false);
    expect(canAdvance('EXECUTING', 'VERIFICATION', 'reviewer', 'full').ok).toBe(false);
  });

  it('reviewer can sign off VERIFICATION → DONE', () => {
    expect(canAdvance('VERIFICATION', 'DONE', 'reviewer', 'full').ok).toBe(true);
  });

  it('nextPhase respects ship-fast skip', () => {
    expect(nextPhase('DISCOVERY', 'ship-fast')).toBe('PLANNING');
    expect(nextPhase('DISCOVERY', 'full')).toBe('REFINEMENT');
    expect(nextPhase('DONE', 'full')).toBeNull();
  });

  it('exitWith handles cancel/wontfix/revisit', () => {
    expect(exitWith('EXECUTING', 'cancel')).toBeNull();
    expect(exitWith('EXECUTING', 'wontfix')).toBeNull();
    expect(exitWith('EXECUTING', 'revisit')).toBe('DISCOVERY');
  });

  it('behavioralFor returns a slice for every phase', () => {
    for (const p of [
      'DISCOVERY',
      'REFINEMENT',
      'PLANNING',
      'EXECUTING',
      'VERIFICATION',
      'DONE',
    ] as const) {
      const b = behavioralFor(p);
      expect(b.phase).toBe(p);
      expect(b.must.length).toBeGreaterThan(0);
    }
  });
});
