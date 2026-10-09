import type { DiscoveryMode } from './types.ts';

export interface DiscoveryModeSpec {
  readonly mode: DiscoveryMode;
  readonly questionCount: number;
  readonly skipRefinement: boolean;
  readonly description: string;
}

const SPECS: Record<DiscoveryMode, DiscoveryModeSpec> = {
  full: {
    mode: 'full',
    questionCount: 6,
    skipRefinement: false,
    description: 'Standard 6 discovery questions across product/engineering/QA.',
  },
  validate: {
    mode: 'validate',
    questionCount: 4,
    skipRefinement: false,
    description: 'Challenge assumptions in a detailed plan; find gaps.',
  },
  'technical-depth': {
    mode: 'technical-depth',
    questionCount: 6,
    skipRefinement: false,
    description: 'Architecture, data flow, integration focus.',
  },
  'ship-fast': {
    mode: 'ship-fast',
    questionCount: 2,
    skipRefinement: true,
    description: 'Minimum viable scope; bug fixes and quick iterations.',
  },
  explore: {
    mode: 'explore',
    questionCount: 5,
    skipRefinement: false,
    description: 'Think bigger; find adjacent opportunities.',
  },
};

export function specFor(mode: DiscoveryMode): DiscoveryModeSpec {
  // Runtime callers may pass unrecognised strings; fall back to full.
  return (SPECS as Record<string, DiscoveryModeSpec | undefined>)[mode] ?? SPECS.full;
}

export function defaultModeForTaskKind(kind: string | null | undefined): DiscoveryMode {
  if (kind === 'bug' || kind === 'hotfix') return 'ship-fast';
  return 'full';
}
