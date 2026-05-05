import { describe, expect, it } from 'vitest';

import { levenshtein } from '../src/string-distance.ts';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('foo', 'foo')).toBe(0);
    expect(levenshtein('', '')).toBe(0);
  });

  it('handles empty cases', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('computes known pairs', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('flaw', 'lawn')).toBe(2);
    expect(levenshtein('gumbo', 'gambol')).toBe(2);
  });

  it('caps pathological input', () => {
    const a = 'a'.repeat(250);
    const b = 'b'.repeat(250);
    expect(levenshtein(a, b)).toBe(250);
  });
});
