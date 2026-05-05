// Concerns: phase-scoped review dimensions injected into `abrun.next` payloads.
// Built-in packs ship under <pkg>/concerns/*.json; project overrides live at
// <repo_path>/.agentboard/concerns/*.json. The agent only sees the slice
// relevant to the current phase — never the whole concern object at once.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Phase } from './types.ts';

export interface ConcernPhaseSlice {
  readonly reminders: readonly string[];
  readonly reviewDimensions: readonly string[];
}

export interface Concern {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly phases: Partial<Record<Phase, ConcernPhaseSlice>>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, '..', 'concerns');

function readConcernDir(dir: string): Concern[] {
  if (!existsSync(dir)) return [];
  const out: Concern[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = readFileSync(join(dir, name), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (isConcern(parsed)) out.push(parsed);
    } catch {
      // ignore malformed concern files; never crash the orchestrator
    }
  }
  return out;
}

function isConcern(x: unknown): x is Concern {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.description === 'string' &&
    typeof o.phases === 'object' &&
    o.phases !== null
  );
}

export function loadConcerns(repoPath: string | null | undefined): Concern[] {
  const builtins = readConcernDir(BUILTIN_DIR);
  const overrides = repoPath ? readConcernDir(join(repoPath, '.agentboard', 'concerns')) : [];
  const map = new Map<string, Concern>();
  for (const c of [...builtins, ...overrides]) map.set(c.id, c);
  return [...map.values()];
}

export interface ConcernSliceForPhase {
  readonly id: string;
  readonly title: string;
  readonly slice: ConcernPhaseSlice;
}

export function sliceFor(
  phase: Phase,
  enabledIds: readonly string[],
  repoPath: string | null | undefined,
): ConcernSliceForPhase[] {
  const all = loadConcerns(repoPath);
  const enabled = new Set(enabledIds);
  const out: ConcernSliceForPhase[] = [];
  for (const c of all) {
    if (!enabled.has(c.id)) continue;
    const slice = c.phases[phase];
    if (!slice) continue;
    if (slice.reminders.length === 0 && slice.reviewDimensions.length === 0) continue;
    out.push({ id: c.id, title: c.title, slice });
  }
  return out;
}
