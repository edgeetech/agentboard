import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  normalizeAiAsset,
  type AiAssetSource,
} from '../../../../packages/engine/src/ai-assets/catalog.ts';
import { BUILTIN_SKILLS } from '../src/builtin-skills.ts';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const skillsRoot = join(repoRoot, 'ai', 'skills');

describe('built-in skill parity', () => {
  it('keeps legacy built-in skills aligned with /ai Markdown sources', () => {
    const markdownSkills = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeAiAsset(readSkillSource(entry.name)))
      .filter((asset) => asset.kind === 'skill')
      .map((asset) => ({
        id: `builtin:${asset.id}`,
        name: asset.name,
        description: asset.description,
        emblem: asset.emblem,
        tags: asset.tags,
        allowedTools: asset.allowedTools,
        relDir: 'builtin',
        relPath: `builtin/${asset.id}.md`,
        layout: 'file',
        body: asset.body.trimEnd(),
      }));

    expect(
      BUILTIN_SKILLS.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        emblem: skill.emblem,
        tags: skill.tags,
        allowedTools: skill.allowedTools,
        relDir: skill.relDir,
        relPath: skill.relPath,
        layout: skill.layout,
        body: skill.body.trimEnd(),
      })).sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(markdownSkills.sort((a, b) => a.id.localeCompare(b.id)));
  });
});

function readSkillSource(id: string): AiAssetSource {
  const path = `ai/skills/${id}/SKILL.md`;
  return {
    kind: 'skill',
    id,
    path,
    content: readFileSync(join(repoRoot, path), 'utf8'),
  };
}
