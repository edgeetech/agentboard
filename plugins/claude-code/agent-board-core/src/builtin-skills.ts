// Built-in skills always available to every project, regardless of disk scan.
// Read-only — edits via PUT are rejected by the HTTP handler.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SkillResponse } from './api-skills.ts';

export interface BuiltinSkill extends SkillResponse {
  body: string;
}

const SCANNED_AT = '1970-01-01T00:00:00Z';
const HERE = dirname(fileURLToPath(import.meta.url));
const AI_SKILLS_DIR = join(HERE, '..', '..', '..', '..', 'ai', 'skills');

const STATIC_BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: 'builtin:code-review',
    name: 'Code Review',
    description: 'Inspect a diff against coding standards, flag bugs, suggest fixes inline.',
    emblem: 'CR',
    tags: ['reviewer', 'default'],
    allowedTools: [],
    relDir: 'builtin',
    relPath: 'builtin/code-review.md',
    layout: 'file',
    scannedAt: SCANNED_AT,
    body: [
      '# Code Review',
      '',
      'Review the proposed diff against the project coding standards.',
      '',
      '- Read the diff in full before commenting.',
      '- Flag correctness bugs, race conditions, and missing error handling first.',
      '- Suggest small, concrete fixes inline rather than abstract advice.',
      '- Group nits separately from blocking issues so the author can triage quickly.',
      '',
      'Finish with a short summary: blockers, suggestions, nits.',
      '',
    ].join('\n'),
  },
  {
    id: 'builtin:unit-tests',
    name: 'Unit Tests',
    description:
      'Generate or update unit tests so new behaviour is covered and regressions are guarded.',
    emblem: 'UT',
    tags: ['worker', 'jest'],
    allowedTools: [],
    relDir: 'builtin',
    relPath: 'builtin/unit-tests.md',
    layout: 'file',
    scannedAt: SCANNED_AT,
    body: [
      '# Unit Tests',
      '',
      'Add or extend unit tests so every new branch of behaviour is covered.',
      '',
      '- Match the existing test style (Jest, Vitest, pytest, ...).',
      '- Cover the happy path, the error path, and at least one edge case.',
      '- Prefer fast, deterministic tests over integration heuristics.',
      '- Use existing fixtures and helpers; do not introduce parallel infrastructure.',
      '',
      'Run the suite locally and report the test count delta.',
      '',
    ].join('\n'),
  },
  {
    id: 'builtin:tech-spec',
    name: 'Tech Spec Drafting',
    description: 'Turn a loose description into acceptance criteria, risks, and a work breakdown.',
    emblem: 'TS',
    tags: ['pm', 'default'],
    allowedTools: [],
    relDir: 'builtin',
    relPath: 'builtin/tech-spec.md',
    layout: 'file',
    scannedAt: SCANNED_AT,
    body: [
      '# Tech Spec Drafting',
      '',
      'Turn a vague request into a concise tech spec the team can act on.',
      '',
      '- Restate the goal in one sentence.',
      '- List acceptance criteria as testable bullets.',
      '- Call out risks, unknowns, and assumptions explicitly.',
      '- Break the work into small, sequenced steps.',
      '',
      'Keep it short: a spec nobody reads is worse than no spec.',
      '',
    ].join('\n'),
  },
  {
    id: 'builtin:refactor',
    name: 'Refactor',
    description:
      'Rework an existing module for clarity, reuse, or performance without changing behaviour.',
    emblem: 'RF',
    tags: ['worker'],
    allowedTools: [],
    relDir: 'builtin',
    relPath: 'builtin/refactor.md',
    layout: 'file',
    scannedAt: SCANNED_AT,
    body: [
      '# Refactor',
      '',
      'Improve internal structure without changing observable behaviour.',
      '',
      '- Make sure tests cover the surface before you start; add characterization tests if not.',
      '- Move in small, reviewable steps; each commit should keep the suite green.',
      '- Prefer extraction and renaming over rewrites.',
      '- Stop when the original goal is met; do not gold-plate adjacent code.',
      '',
    ].join('\n'),
  },
  {
    id: 'builtin:api-client',
    name: 'API Client',
    description: 'Wire a typed API client to a remote service, including retry and error handling.',
    emblem: 'AC',
    tags: ['worker', 'typescript'],
    allowedTools: [],
    relDir: 'builtin',
    relPath: 'builtin/api-client.md',
    layout: 'file',
    scannedAt: SCANNED_AT,
    body: [
      '# API Client',
      '',
      'Build a typed client for a remote HTTP service.',
      '',
      '- Define request/response types from the OpenAPI/JSON schema if available.',
      '- Centralise auth, base URL, and timeouts in one place.',
      '- Add retry with bounded backoff on idempotent verbs only.',
      '- Surface errors as typed results, not thrown strings.',
      '',
    ].join('\n'),
  },
  {
    id: 'builtin:release-notes',
    name: 'Release Notes',
    description: 'Summarise merged PRs into concise release notes grouped by scope and impact.',
    emblem: 'RN',
    tags: ['reviewer'],
    allowedTools: [],
    relDir: 'builtin',
    relPath: 'builtin/release-notes.md',
    layout: 'file',
    scannedAt: SCANNED_AT,
    body: [
      '# Release Notes',
      '',
      'Turn the merged PR list into release notes a user will actually read.',
      '',
      '- Group by scope: features, fixes, breaking changes, internal.',
      '- Lead with user-visible impact, not implementation detail.',
      '- Link the PR or issue for traceability.',
      '- Call out breaking changes with a clear migration sentence.',
      '',
    ].join('\n'),
  },
];

export const BUILTIN_SKILLS: BuiltinSkill[] =
  loadBuiltinSkillsFromAiAssets() ?? STATIC_BUILTIN_SKILLS;

export function isBuiltinSkillId(id: string): boolean {
  return id.startsWith('builtin:');
}

export function findBuiltinSkill(id: string): BuiltinSkill | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id);
}

function loadBuiltinSkillsFromAiAssets(): BuiltinSkill[] | null {
  if (!existsSync(AI_SKILLS_DIR)) return null;
  try {
    const skills = readdirSync(AI_SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readBuiltinSkillFromAiAsset(entry.name))
      .sort((a, b) => a.id.localeCompare(b.id));
    return skills.length > 0 ? skills : null;
  } catch {
    return null;
  }
}

function readBuiltinSkillFromAiAsset(id: string): BuiltinSkill {
  const path = join(AI_SKILLS_DIR, id, 'SKILL.md');
  const parsed = parseMarkdownSkill(readFileSync(path, 'utf8'));
  const name = stringField(parsed.frontmatter, 'name', id);
  return {
    id: `builtin:${id}`,
    name,
    description: stringField(parsed.frontmatter, 'description', ''),
    emblem: stringField(parsed.frontmatter, 'emblem', deriveEmblem(name)),
    tags: arrayField(parsed.frontmatter, 'tags'),
    allowedTools: arrayField(parsed.frontmatter, 'allowed-tools'),
    relDir: 'builtin',
    relPath: `builtin/${id}.md`,
    layout: 'file',
    scannedAt: SCANNED_AT,
    body: parsed.body.trimEnd() + '\n',
  };
}

interface ParsedMarkdownSkill {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

function parseMarkdownSkill(content: string): ParsedMarkdownSkill {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return { frontmatter: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: {}, body: normalized };
  return {
    frontmatter: parseFrontmatter(normalized.slice(4, end)),
    body: normalized.slice(end + 5).replace(/^\n+/, ''),
  };
}

function parseFrontmatter(frontmatter: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const line of frontmatter.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] ?? '';
    const raw = (match[2] ?? '').trim();
    out[key] = parseFrontmatterValue(raw);
  }
  return out;
}

function parseFrontmatterValue(raw: string): string | string[] {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const body = raw.slice(1, -1).trim();
    if (body.length === 0) return [];
    return body.split(',').map((item) => item.trim().replace(/^["']|["']$/g, ''));
  }
  return raw.replace(/^["']|["']$/g, '');
}

function stringField(
  frontmatter: Readonly<Record<string, string | string[]>>,
  key: string,
  fallback: string,
): string {
  const value = frontmatter[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function arrayField(
  frontmatter: Readonly<Record<string, string | string[]>>,
  key: string,
): string[] {
  const value = frontmatter[key];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function deriveEmblem(name: string): string {
  const cleaned = name.replaceAll(/[^A-Za-z0-9]/g, '');
  return (cleaned.length > 0 ? cleaned : name).slice(0, 3).toUpperCase();
}
