import { describe, expect, it } from 'vitest';

import {
  buildSkillsTree,
  collectExpandedBranchIds,
  type SkillTreeSkill,
} from '../ui/src/pages/skillsTree.ts';

function mkSkill(overrides: Partial<SkillTreeSkill> & Pick<SkillTreeSkill, 'id' | 'name' | 'relDir' | 'relPath' | 'layout'>): SkillTreeSkill {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? '',
    emblem: overrides.emblem ?? overrides.name.slice(0, 2).toUpperCase(),
    tags: overrides.tags ?? [],
    relDir: overrides.relDir,
    relPath: overrides.relPath,
    layout: overrides.layout,
    allowedTools: overrides.allowedTools ?? [],
    scannedAt: overrides.scannedAt ?? '2026-01-01T00:00:00Z',
  };
}

describe('buildSkillsTree', () => {
  it('groups built-ins and scanned skills by source path', () => {
    const tree = buildSkillsTree([
      mkSkill({
        id: 'builtin:unit-tests',
        name: 'Unit Tests',
        relDir: 'builtin',
        relPath: 'builtin/unit-tests.md',
        layout: 'file',
      }),
      mkSkill({
        id: 'TST:alpha',
        name: 'Alpha',
        relDir: '.claude/skills',
        relPath: '.claude/skills/alpha/SKILL.md',
        layout: 'folder',
      }),
      mkSkill({
        id: 'TST:gamma',
        name: 'Gamma',
        relDir: 'pkg/.claude/skills',
        relPath: 'pkg/.claude/skills/nested/gamma/SKILL.md',
        layout: 'folder',
      }),
    ]);

    expect(tree.map((node) => node.label)).toEqual(['.claude/skills', 'builtin', 'pkg/.claude/skills']);
    expect(tree[0]?.children[0]).toMatchObject({
      kind: 'leaf',
      label: 'Alpha',
      path: 'alpha',
    });
    expect(tree[1]?.children[0]).toMatchObject({
      kind: 'leaf',
      label: 'Unit Tests',
      path: 'unit-tests.md',
    });
    expect(tree[2]?.children[0]).toMatchObject({
      kind: 'branch',
      label: 'nested',
    });
  });

  it('keeps file-layout leaves and sorts regardless of input order', () => {
    const tree = buildSkillsTree([
      mkSkill({
        id: 'TST:zeta',
        name: 'Zeta',
        relDir: '.claude/skills',
        relPath: '.claude/skills/zeta.md',
        layout: 'file',
      }),
      mkSkill({
        id: 'TST:beta',
        name: 'Beta',
        relDir: '.claude/skills',
        relPath: '.claude/skills/beta/SKILL.md',
        layout: 'folder',
      }),
      mkSkill({
        id: 'TST:alpha',
        name: 'Alpha',
        relDir: '.claude/skills',
        relPath: '.claude/skills/alpha.md',
        layout: 'file',
      }),
    ]);

    const root = tree[0];
    expect(root?.children.map((node) => node.label)).toEqual(['Alpha', 'Beta', 'Zeta']);
    expect(root?.children[0]).toMatchObject({ kind: 'leaf', path: 'alpha.md' });
    expect(root?.children[1]).toMatchObject({ kind: 'leaf', path: 'beta' });
  });

  it('collects every branch id for forced search expansion', () => {
    const tree = buildSkillsTree([
      mkSkill({
        id: 'TST:deep',
        name: 'Deep Skill',
        relDir: 'pkg/.claude/skills',
        relPath: 'pkg/.claude/skills/a/b/deep/SKILL.md',
        layout: 'folder',
      }),
    ]);

    const ids = [...collectExpandedBranchIds(tree)].sort();
    expect(ids).toEqual([
      'branch:pkg/.claude/skills',
      'branch:pkg/.claude/skills/a',
      'branch:pkg/.claude/skills/a/b',
    ]);
  });
});
