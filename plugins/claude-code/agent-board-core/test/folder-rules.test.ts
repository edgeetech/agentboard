import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cascade } from '../src/folder-rules.ts';

describe('folder-rules cascade', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fr-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty when no rule files exist', () => {
    expect(cascade(root, root)).toEqual([]);
  });

  it('parses bullet rules from a single file', () => {
    writeFileSync(join(root, '.folder-rules.md'), '# rules\n\n- be terse\n* avoid any\n');
    const got = cascade(root, root).map((r) => r.text);
    expect(got).toEqual(['be terse', 'avoid any']);
  });

  it('cascades parent → child and dedupes', () => {
    writeFileSync(join(root, '.folder-rules.md'), '- be terse\n- avoid any\n');
    const sub = join(root, 'pkg');
    mkdirSync(sub);
    writeFileSync(join(sub, '.folder-rules.md'), '- avoid any\n- prefer pure functions\n');
    const got = cascade(root, sub).map((r) => r.text);
    expect(got).toEqual(['be terse', 'avoid any', 'prefer pure functions']);
  });

  it('does not bleed sibling rules upward', () => {
    const a = join(root, 'a');
    const b = join(root, 'b');
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, '.folder-rules.md'), '- a-only\n');
    writeFileSync(join(b, '.folder-rules.md'), '- b-only\n');
    expect(cascade(root, a).map((r) => r.text)).toEqual(['a-only']);
    expect(cascade(root, b).map((r) => r.text)).toEqual(['b-only']);
  });

  it('returns empty if workspace is outside repo', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    try {
      expect(cascade(root, outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
