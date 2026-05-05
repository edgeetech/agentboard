import { describe, expect, it } from 'vitest';

import { defaultModeForTaskKind, specFor } from '../src/discovery-modes.ts';
import type { DiscoveryMode } from '../src/types.ts';

describe('discovery-modes', () => {
  it('specFor returns the right shape for each mode', () => {
    const modes: DiscoveryMode[] = ['full', 'validate', 'technical-depth', 'ship-fast', 'explore'];
    for (const m of modes) {
      const s = specFor(m);
      expect(s.mode).toBe(m);
      expect(typeof s.questionCount).toBe('number');
      expect(typeof s.skipRefinement).toBe('boolean');
    }
  });

  it('ship-fast skips refinement', () => {
    expect(specFor('ship-fast').skipRefinement).toBe(true);
    expect(specFor('full').skipRefinement).toBe(false);
  });

  it('unknown mode falls back to full', () => {
    // specFor accepts string; cast to test the fallback branch
    expect(specFor('made-up' as DiscoveryMode).mode).toBe('full');
  });

  it('bug/hotfix tasks default to ship-fast', () => {
    expect(defaultModeForTaskKind('bug')).toBe('ship-fast');
    expect(defaultModeForTaskKind('hotfix')).toBe('ship-fast');
    expect(defaultModeForTaskKind('feature')).toBe('full');
    expect(defaultModeForTaskKind(null)).toBe('full');
  });
});
