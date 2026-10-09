import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_IGNORE_DIRS,
  parseFrontmatter,
  scanSkills,
  shouldIgnore,
} from '../src/skill-scanner.ts';

let root: string;

function w(rel: string, content: string): void {
  const parts = rel.split('/');
  const fileName = parts.pop() ?? '';
  const dirAbs = join(root, ...parts);
  mkdirSync(dirAbs, { recursive: true });
  writeFileSync(join(dirAbs, fileName), content);
}

const SKILL_FULL = `---
name: alpha
description: Alpha skill description
emblem: AL
tags: [foo, bar]
allowed-tools:
  - Read
  - Edit
---

# Alpha body
Hello.
`;

const SKILL_UI_QC = `---
name: ui-quality-check
description: Quality check skill
---

Body here.
`;

const SKILL_LEGACY = `---
name: legacy-skill
description: legacy
---
body
`;

const SKILL_MIN = `---
name: foo
---
body
`;

const SKILL_ARCHIVED = `---
name: archived
description: should-be-skipped-when-user-ignored
---
body
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-scan-'));
  // Build fixture tree
  w('repo/.claude/skills/alpha/SKILL.md', SKILL_FULL);
  w('repo/.claude/skills/beta.md', '# Beta\nNo frontmatter here.\n');
  w('repo/.claude/skills/README.md', '# readme\n');
  w('repo/Tax/ui/.claude/skills/ui-quality-check/SKILL.md', SKILL_UI_QC);

  // Default-ignored subtrees
  w('repo/node_modules/.claude/skills/should-not-be-found/SKILL.md', SKILL_MIN);
  w('repo/bin/.claude/skills/should-not-be-found/SKILL.md', SKILL_MIN);
  w('repo/obj/.claude/skills/should-not-be-found/SKILL.md', SKILL_MIN);
  w('repo/vendor/.claude/skills/should-not-be-found/SKILL.md', SKILL_MIN);
  w('repo/__pycache__/.claude/skills/should-not-be-found/SKILL.md', SKILL_MIN);
  w('repo/target/.claude/skills/should-not-be-found/SKILL.md', SKILL_MIN);
  w('repo/.git/.claude/skills/should-not-be-found/SKILL.md', SKILL_MIN);

  // User-ignored
  w('repo/Tax/__archived_maintenance/.claude/skills/should-skip/SKILL.md', SKILL_ARCHIVED);
  w('repo/pkg/legacy/.claude/skills/legacy-skill/SKILL.md', SKILL_LEGACY);

  // Glob suffix
  w('repo/some/foo.egg-info/.claude/skills/x/SKILL.md', SKILL_MIN);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function repoRoot(): string {
  return join(root, 'repo');
}

describe('DEFAULT_IGNORE_DIRS', () => {
  it('contains expected basenames', () => {
    for (const n of ['node_modules', '.git', 'bin', 'obj', 'vendor', '__pycache__', 'target']) {
      expect(DEFAULT_IGNORE_DIRS.has(n)).toBe(true);
    }
  });
});

describe('parseFrontmatter', () => {
  it('parses full frontmatter with inline tag array and block list of tools', () => {
    const p = parseFrontmatter(SKILL_FULL);
    expect(p.name).toBe('alpha');
    expect(p.description).toBe('Alpha skill description');
    expect(p.emblem).toBe('AL');
    expect(p.tags).toEqual(['foo', 'bar']);
    expect(p.allowedTools).toEqual(['Read', 'Edit']);
    expect(p.body).toContain('# Alpha body');
  });

  it('returns body only when no frontmatter', () => {
    const p = parseFrontmatter('# Just a body\nHello\n');
    expect(p.name).toBeUndefined();
    expect(p.body).toContain('# Just a body');
  });

  it('parses tags as block list', () => {
    const raw = `---\nname: x\ntags:\n  - one\n  - two\n  - three\n---\nbody\n`;
    const p = parseFrontmatter(raw);
    expect(p.tags).toEqual(['one', 'two', 'three']);
  });

  it('parses tags as quoted inline array', () => {
    const raw = `---\nname: x\ntags: ["a, b", 'c']\n---\n`;
    const p = parseFrontmatter(raw);
    expect(p.tags).toEqual(['a, b', 'c']);
  });

  it('handles unclosed frontmatter gracefully', () => {
    const raw = `---\nname: x\nno closing\n`;
    const p = parseFrontmatter(raw);
    expect(p.body).toContain('---');
  });
});

describe('shouldIgnore', () => {
  it('matches default basenames at any depth', () => {
    expect(
      shouldIgnore('/some/path/node_modules', 'node_modules', '/some', {
        basenames: new Set(),
        subtreePosixPaths: [],
      }),
    ).toBe(true);
  });

  it('matches user basename rule', () => {
    expect(
      shouldIgnore('/x/y/legacy', 'legacy', '/x', {
        basenames: new Set(['legacy']),
        subtreePosixPaths: [],
      }),
    ).toBe(true);
  });

  it('matches subtree path rule', () => {
    expect(
      shouldIgnore('/x/y/Tax/__archived_maintenance', '__archived_maintenance', '/x', {
        basenames: new Set(),
        subtreePosixPaths: ['/x/y/Tax/__archived_maintenance'],
      }),
    ).toBe(true);
  });

  it('matches *.egg-info glob suffix', () => {
    expect(
      shouldIgnore('/x/foo.egg-info', 'foo.egg-info', '/x', {
        basenames: new Set(),
        subtreePosixPaths: [],
      }),
    ).toBe(true);
  });

  it('matches *.xcworkspace glob suffix', () => {
    expect(
      shouldIgnore('/x/MyApp.xcworkspace', 'MyApp.xcworkspace', '/x', {
        basenames: new Set(),
        subtreePosixPaths: [],
      }),
    ).toBe(true);
  });

  it('does not match unrelated dirs', () => {
    expect(
      shouldIgnore('/x/y/Tax', 'Tax', '/x', {
        basenames: new Set(),
        subtreePosixPaths: [],
      }),
    ).toBe(false);
  });
});

describe('scanSkills — defaults', () => {
  it('finds only valid skills, skipping default-ignored dirs', async () => {
    const skills = await scanSkills({ rootDir: repoRoot() });
    const names = skills.map((s) => s.name).sort();
    // legacy-skill is found because user did NOT ignore it; archived is found too
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('ui-quality-check');
    expect(names).toContain('legacy-skill');
    expect(names).toContain('archived');
    // none of the default-ignored fakes
    for (const s of skills) {
      expect(s.relPath).not.toContain('node_modules');
      expect(s.relPath).not.toContain('/bin/');
      expect(s.relPath).not.toContain('/obj/');
      expect(s.relPath).not.toContain('/vendor/');
      expect(s.relPath).not.toContain('__pycache__');
      expect(s.relPath).not.toContain('/target/');
      expect(s.relPath).not.toContain('.git/');
      expect(s.relPath).not.toContain('.egg-info');
    }
  });

  it('parses metadata, layouts, posix relDir/relPath', async () => {
    const skills = await scanSkills({ rootDir: repoRoot() });
    const alpha = skills.find((s) => s.name === 'alpha');
    expect(alpha?.layout).toBe('folder');
    expect(alpha?.emblem).toBe('AL');
    expect(alpha?.tags).toEqual(['foo', 'bar']);
    expect(alpha?.allowedTools).toEqual(['Read', 'Edit']);
    expect(alpha?.relDir).toBe('.claude/skills');
    expect(alpha?.relPath).toBe('.claude/skills/alpha/SKILL.md');

    const beta = skills.find((s) => s.name === 'beta');
    expect(beta?.layout).toBe('file');
    expect(beta?.emblem).toBe('BET');
    expect(beta?.relPath).toBe('.claude/skills/beta.md');

    const ui = skills.find((s) => s.name === 'ui-quality-check');
    expect(ui?.relDir).toBe('Tax/ui/.claude/skills');
  });

  it('returns sorted by relPath ascending', async () => {
    const skills = await scanSkills({ rootDir: repoRoot() });
    const paths = skills.map((s) => s.relPath);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });
});

describe('scanSkills — user ignore', () => {
  it('excludes by basename rule', async () => {
    const skills = await scanSkills({ rootDir: repoRoot(), userIgnore: ['legacy'] });
    expect(skills.find((s) => s.name === 'legacy-skill')).toBeUndefined();
    expect(skills.find((s) => s.name === 'alpha')).toBeDefined();
  });

  it('excludes by relative subtree path', async () => {
    const skills = await scanSkills({
      rootDir: repoRoot(),
      userIgnore: ['Tax/__archived_maintenance'],
    });
    expect(skills.find((s) => s.name === 'archived')).toBeUndefined();
    expect(skills.find((s) => s.name === 'ui-quality-check')).toBeDefined();
  });

  it('excludes by absolute subtree path inside root', async () => {
    const abs = resolve(repoRoot(), 'Tax/__archived_maintenance').replaceAll('\\', '/');
    const skills = await scanSkills({ rootDir: repoRoot(), userIgnore: [abs] });
    expect(skills.find((s) => s.name === 'archived')).toBeUndefined();
  });

  it('silently drops absolute path outside root', async () => {
    const skills = await scanSkills({
      rootDir: repoRoot(),
      userIgnore: ['/totally/unrelated/path'],
    });
    // Nothing crashes; results identical to defaults
    expect(skills.find((s) => s.name === 'alpha')).toBeDefined();
    expect(skills.find((s) => s.name === 'archived')).toBeDefined();
  });

  it('ignores comments and blank lines', async () => {
    const skills = await scanSkills({
      rootDir: repoRoot(),
      userIgnore: ['# comment', '', '   ', 'legacy'],
    });
    expect(skills.find((s) => s.name === 'legacy-skill')).toBeUndefined();
  });
});

describe('scanSkills — depth + timeout', () => {
  it('respects maxDepth — only top-level .claude/skills at depth=2', async () => {
    // .claude/skills under repoRoot is 2 levels deep; Tax/ui/.claude/skills is 4
    const skills = await scanSkills({ rootDir: repoRoot(), maxDepth: 2 });
    const dirs = new Set(skills.map((s) => s.relDir));
    expect(dirs.has('.claude/skills')).toBe(true);
    expect(dirs.has('Tax/ui/.claude/skills')).toBe(false);
  });

  it('respects maxDepth=0 — finds nothing', async () => {
    const skills = await scanSkills({ rootDir: repoRoot(), maxDepth: 0 });
    expect(skills.length).toBe(0);
  });

  it('completes within default timeoutMs', async () => {
    const skills = await scanSkills({ rootDir: repoRoot() });
    expect(skills.length).toBeGreaterThan(0);
  });
});
