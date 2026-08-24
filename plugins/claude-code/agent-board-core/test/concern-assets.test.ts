import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  normalizeAiAsset,
  type AiAssetSource,
  type ConcernAsset,
} from '../../../../packages/engine/src/ai-assets/catalog.ts';
import type { Concern } from '../src/concerns.ts';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const aiConcernsRoot = join(repoRoot, 'ai', 'concerns');
const legacyConcernsRoot = join(repoRoot, 'plugins', 'claude-code', 'agent-board-core', 'concerns');

describe('built-in concern parity', () => {
  it('keeps legacy JSON concerns aligned with /ai Markdown sources', () => {
    const markdownConcerns = readdirSync(aiConcernsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => normalizeAiAsset(readConcernSource(entry.name)))
      .filter((asset): asset is ConcernAsset => asset.kind === 'concern')
      .map((asset) => ({
        id: asset.id,
        title: asset.title,
        description: asset.description,
        phases: asset.phases,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const legacyConcerns = readdirSync(legacyConcernsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(
        (entry) =>
          JSON.parse(readFileSync(join(legacyConcernsRoot, entry.name), 'utf8')) as Concern,
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    expect(legacyConcerns).toEqual(markdownConcerns);
  });
});

function readConcernSource(fileName: string): AiAssetSource {
  const id = basename(fileName, '.md');
  const path = `ai/concerns/${fileName}`;
  return {
    kind: 'concern',
    id,
    path,
    content: readFileSync(join(repoRoot, path), 'utf8'),
  };
}
