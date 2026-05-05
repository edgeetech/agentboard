import { describe, expect, it } from 'vitest';

import { checkPhaseGate } from '../src/postflight.ts';

describe('checkPhaseGate', () => {
  it('exempts pm role from phase requirement', () => {
    expect(checkPhaseGate('pm', 'DISCOVERY')).toBeNull();
    expect(checkPhaseGate('pm', undefined)).toBeNull();
  });

  it('worker run must reach DONE', () => {
    expect(checkPhaseGate('worker', 'DONE')).toBeNull();
    const err = checkPhaseGate('worker', 'EXECUTING');
    expect(err).toMatch(/EXECUTING is not DONE/);
  });

  it('reviewer run must reach DONE', () => {
    expect(checkPhaseGate('reviewer', 'DONE')).toBeNull();
    expect(checkPhaseGate('reviewer', 'VERIFICATION')).toMatch(/not DONE/);
  });

  it('null/undefined phase defaults to DISCOVERY in error message', () => {
    expect(checkPhaseGate('worker', null)).toMatch(/DISCOVERY/);
    expect(checkPhaseGate('worker', undefined)).toMatch(/DISCOVERY/);
  });
});
