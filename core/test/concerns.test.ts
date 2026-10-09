import { describe, expect, it } from 'vitest';

import { loadConcerns, sliceFor } from '../src/concerns.ts';

describe('concerns', () => {
  it('loads built-in packs', () => {
    const ids = loadConcerns(null)
      .map((c) => c.id)
      .sort();
    expect(ids).toEqual(['beautiful-product', 'long-lived', 'well-engineered']);
  });

  it('sliceFor returns only the requested phase', () => {
    const got = sliceFor('EXECUTING', ['well-engineered'], null);
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe('well-engineered');
    expect(got[0]?.slice.reminders.length).toBeGreaterThan(0);
  });

  it('disabled concerns do not leak into the slice', () => {
    expect(sliceFor('EXECUTING', [], null)).toEqual([]);
  });

  it('phases without slice are dropped silently', () => {
    // beautiful-product has no REFINEMENT slice in our pack
    const got = sliceFor('REFINEMENT', ['beautiful-product'], null);
    expect(got).toEqual([]);
  });
});
