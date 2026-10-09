import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AI_SKILLS_DIR } from '../src/builtin-skills.ts';
import { AI_CONCERNS_DIR } from '../src/concerns.ts';

// The loaders fall back to static copies when these dirs are missing, so a
// wrong relative path would otherwise go unnoticed.
describe('repo-root ai/ asset paths', () => {
  it('resolve to the ai/skills and ai/concerns directories', () => {
    expect(existsSync(AI_SKILLS_DIR)).toBe(true);
    expect(existsSync(AI_CONCERNS_DIR)).toBe(true);
    expect(AI_SKILLS_DIR.endsWith(join('ai', 'skills'))).toBe(true);
    expect(AI_CONCERNS_DIR.endsWith(join('ai', 'concerns'))).toBe(true);
  });
});
