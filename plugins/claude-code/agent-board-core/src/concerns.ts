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
const AI_CONCERNS_DIR = join(HERE, '..', '..', '..', '..', 'ai', 'concerns');

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
  const builtins = readBuiltinConcerns();
  const overrides = repoPath ? readConcernDir(join(repoPath, '.agentboard', 'concerns')) : [];
  const map = new Map<string, Concern>();
  for (const c of [...builtins, ...overrides]) map.set(c.id, c);
  return [...map.values()];
}

function readBuiltinConcerns(): Concern[] {
  return readMarkdownConcernDir(AI_CONCERNS_DIR) ?? readConcernDir(BUILTIN_DIR);
}

function readMarkdownConcernDir(dir: string): Concern[] | null {
  if (!existsSync(dir)) return null;
  try {
    const concerns = readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => readMarkdownConcern(join(dir, name), name.slice(0, -3)))
      .filter((concern): concern is Concern => concern !== null);
    return concerns.length > 0 ? concerns : null;
  } catch {
    return null;
  }
}

function readMarkdownConcern(path: string, id: string): Concern | null {
  try {
    const parsed = parseMarkdownConcern(readFileSync(path, 'utf8'));
    const title = stringField(parsed.frontmatter, 'title', id);
    return {
      id,
      title,
      description: stringField(parsed.frontmatter, 'description', ''),
      phases: parseConcernPhases(parsed.body),
    };
  } catch {
    return null;
  }
}

interface ParsedMarkdownConcern {
  frontmatter: Record<string, string>;
  body: string;
}

function parseMarkdownConcern(content: string): ParsedMarkdownConcern {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return { frontmatter: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: {}, body: normalized };
  return {
    frontmatter: parseFrontmatter(normalized.slice(4, end)),
    body: normalized.slice(end + 5).replace(/^\n+/, ''),
  };
}

function parseFrontmatter(frontmatter: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1] ?? ''] = (match[2] ?? '').trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function parseConcernPhases(body: string): Partial<Record<Phase, ConcernPhaseSlice>> {
  const phases: Partial<Record<Phase, ConcernPhaseSlice>> = {};
  let current: Phase | null = null;
  let section: 'reminders' | 'reviewDimensions' | null = null;

  for (const line of body.split('\n')) {
    const heading = /^##\s+([A-Z_ -]+)\s*$/.exec(line);
    if (heading) {
      const phase = (heading[1] ?? '').trim().replaceAll(' ', '_');
      current = isPhase(phase) ? phase : null;
      section = null;
      if (current !== null && phases[current] === undefined) {
        phases[current] = { reminders: [], reviewDimensions: [] };
      }
      continue;
    }

    if (/^###\s+Reminders\s*$/i.test(line)) {
      section = 'reminders';
      continue;
    }
    if (/^###\s+Review Dimensions\s*$/i.test(line)) {
      section = 'reviewDimensions';
      continue;
    }

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (current !== null && section !== null && item) {
      const existing = phases[current] ?? { reminders: [], reviewDimensions: [] };
      phases[current] = {
        reminders:
          section === 'reminders' ? [...existing.reminders, item[1] ?? ''] : existing.reminders,
        reviewDimensions:
          section === 'reviewDimensions'
            ? [...existing.reviewDimensions, item[1] ?? '']
            : existing.reviewDimensions,
      };
    }
  }

  return phases;
}

function stringField(
  frontmatter: Readonly<Record<string, string>>,
  key: string,
  fallback: string,
): string {
  const value = frontmatter[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function isPhase(value: string): value is Phase {
  return (
    value === 'DISCOVERY' ||
    value === 'REFINEMENT' ||
    value === 'PLANNING' ||
    value === 'EXECUTING' ||
    value === 'VERIFICATION' ||
    value === 'DONE'
  );
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
