// Pure project-scoped scanner for `.claude/skills/` directories.
// Walks a repo root, returns parsed SKILL.md metadata. No DB, no event-bus.

import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve, sep } from 'node:path';

export interface ScannedSkill {
  name: string;
  description: string;
  emblem: string;
  tags: string[];
  allowedTools: string[];
  layout: 'folder' | 'file';
  relDir: string;
  relPath: string;
}

export interface ScanOptions {
  rootDir: string;
  userIgnore?: string[];
  maxDepth?: number;
  timeoutMs?: number;
}

export const DEFAULT_IGNORE_DIRS: ReadonlySet<string> = new Set<string>([
  // JS/TS
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.yarn',
  // .NET / C#
  'bin',
  'obj',
  'packages',
  '.vs',
  // Python
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.tox',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  // PHP / Go
  'vendor',
  // Rust / JVM
  'target',
  '.gradle',
  // General build / cache
  'build',
  'dist',
  'out',
  'coverage',
  '.cache',
  'tmp',
  '.tmp',
  // Editor / VCS
  '.idea',
  '.vscode',
  '.git',
  '.hg',
  '.svn',
  // iOS
  'Pods',
  'DerivedData',
  // Ruby
  '.bundle',
]);

const IGNORE_GLOB_SUFFIXES: readonly string[] = ['.egg-info', '.xcworkspace'];

interface ParsedIgnore {
  basenames: Set<string>;
  subtreePosixPaths: string[];
}

function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}

function rootAsPosix(rootDir: string): string {
  const abs = resolve(rootDir);
  let posixed = toPosix(abs);
  while (posixed.endsWith('/')) posixed = posixed.slice(0, -1);
  return posixed;
}

export function parseUserIgnore(rules: readonly string[] | undefined, rootDir: string): ParsedIgnore {
  const basenames = new Set<string>();
  const subtreePosixPaths: string[] = [];
  const rootPosix = rootAsPosix(rootDir);
  if (!rules) return { basenames, subtreePosixPaths };
  for (const raw of rules) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    const normalized = toPosix(trimmed).replace(/\/+$/, '');
    if (!normalized) continue;
    const hasSlash = normalized.includes('/');
    if (!hasSlash) {
      basenames.add(normalized);
      continue;
    }
    // Path form
    const isAbs = isAbsolute(trimmed) || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/');
    if (isAbs) {
      // Must be under rootPosix
      const lc = normalized.toLowerCase();
      const rootLc = rootPosix.toLowerCase();
      if (lc === rootLc || lc.startsWith(rootLc + '/')) {
        subtreePosixPaths.push(normalized);
      }
      // else: silently drop
      continue;
    }
    // Relative — resolve against root
    const resolvedAbs = toPosix(resolve(rootDir, normalized)).replace(/\/+$/, '');
    subtreePosixPaths.push(resolvedAbs);
  }
  return { basenames, subtreePosixPaths };
}

export function shouldIgnore(
  absPath: string,
  basename: string,
  rootDir: string,
  rules: { basenames: Set<string>; subtreePosixPaths: string[] },
): boolean {
  if (DEFAULT_IGNORE_DIRS.has(basename)) return true;
  for (const suffix of IGNORE_GLOB_SUFFIXES) {
    if (basename.endsWith(suffix)) return true;
  }
  if (rules.basenames.has(basename)) return true;
  const absPosix = toPosix(absPath).replace(/\/+$/, '');
  const absLc = absPosix.toLowerCase();
  for (const sub of rules.subtreePosixPaths) {
    const subLc = sub.toLowerCase();
    if (absLc === subLc || absLc.startsWith(subLc + '/')) return true;
  }
  // Quiet: rootDir param reserved for future relative-path logic.
  void rootDir;
  return false;
}

export function parseFrontmatter(raw: string): {
  name?: string;
  description?: string;
  emblem?: string;
  tags?: string[];
  allowedTools?: string[];
  body: string;
} {
  // Normalize line endings
  const text = raw.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines.length === 0 || lines[0]?.trim() !== '---') {
    return { body: text };
  }
  // Find closing ---
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { body: text };
  }
  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join('\n').replace(/^\n+/, '');

  const out: {
    name?: string;
    description?: string;
    emblem?: string;
    tags?: string[];
    allowedTools?: string[];
    body: string;
  } = { body };

  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i] ?? '';
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = (m[1] ?? '').toLowerCase();
    const rawVal = (m[2] ?? '').trim();
    if (rawVal === '' || rawVal === '|' || rawVal === '>') {
      // Block scalar / block list follows
      const items: string[] = [];
      i++;
      while (i < fmLines.length) {
        const next = fmLines[i] ?? '';
        const bm = /^\s*-\s+(.*)$/.exec(next);
        if (!bm) break;
        items.push(unquote((bm[1] ?? '').trim()));
        i++;
      }
      assignKey(out, key, items.length > 0 ? items : '');
      continue;
    }
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      const inner = rawVal.slice(1, -1);
      const parts = splitInlineArray(inner).map((s) => unquote(s.trim())).filter((s) => s !== '');
      assignKey(out, key, parts);
      i++;
      continue;
    }
    assignKey(out, key, unquote(rawVal));
    i++;
  }

  return out;
}

function splitInlineArray(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote: '"' | "'" | null = null;
  for (const ch of s) {
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      buf += ch;
      continue;
    }
    if (ch === ',') {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function assignKey(
  out: {
    name?: string;
    description?: string;
    emblem?: string;
    tags?: string[];
    allowedTools?: string[];
    body: string;
  },
  key: string,
  value: string | string[],
): void {
  switch (key) {
    case 'name':
      if (typeof value === 'string') out.name = value;
      break;
    case 'description':
      if (typeof value === 'string') out.description = value;
      break;
    case 'emblem':
      if (typeof value === 'string') out.emblem = value;
      break;
    case 'tags':
      out.tags = Array.isArray(value) ? value : [value].filter((v) => v !== '');
      break;
    case 'allowed-tools':
    case 'allowed_tools':
    case 'allowedtools':
      out.allowedTools = Array.isArray(value) ? value : [value].filter((v) => v !== '');
      break;
    default:
      // Unknown — ignore
      break;
  }
}

function deriveEmblem(name: string): string {
  const cleaned = name.replaceAll(/[^A-Za-z0-9]/g, '');
  if (!cleaned) return name.slice(0, 3).toUpperCase();
  return cleaned.slice(0, 3).toUpperCase();
}

function toRelPosix(rootDir: string, absPath: string): string {
  const rootPosix = rootAsPosix(rootDir);
  const absPosix = toPosix(resolve(absPath));
  if (absPosix.toLowerCase() === rootPosix.toLowerCase()) return '';
  if (absPosix.toLowerCase().startsWith(rootPosix.toLowerCase() + '/')) {
    return absPosix.slice(rootPosix.length + 1);
  }
  return absPosix;
}

interface SkillsDirHit {
  abs: string;
  relDir: string; // posix
}

async function walk(
  rootDir: string,
  maxDepth: number,
  rules: ParsedIgnore,
  hits: SkillsDirHit[],
): Promise<void> {
  // BFS-ish recursion with depth tracking
  async function recurse(absDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (err: unknown) {
      console.warn(`skill-scanner: readdir failed for ${absDir}: ${(err as Error).message}`);
      return;
    }
    // Detect `.claude` containing `skills` subdir
    const dirNames = new Set<string>();
    for (const e of entries) if (e.isDirectory()) dirNames.add(e.name);

    // If this directory itself ends with `.claude/skills`, record it
    const absPosix = toPosix(absDir);
    if (absPosix.toLowerCase().endsWith('/.claude/skills')) {
      hits.push({ abs: absDir, relDir: toRelPosix(rootDir, absDir) });
      // Do not recurse into skill directories
      return;
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const childAbs = absDir + sep + e.name;
      if (shouldIgnore(childAbs, e.name, rootDir, { basenames: rules.basenames, subtreePosixPaths: rules.subtreePosixPaths })) {
        continue;
      }
      await recurse(childAbs, depth + 1);
    }
  }
  await recurse(resolve(rootDir), 0);
}

async function readSkillFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, 'utf8');
  } catch (err: unknown) {
    console.warn(`skill-scanner: readFile failed for ${absPath}: ${(err as Error).message}`);
    return null;
  }
}

async function collectSkillsInDir(
  rootDir: string,
  hit: SkillsDirHit,
): Promise<ScannedSkill[]> {
  let entries;
  try {
    entries = await readdir(hit.abs, { withFileTypes: true });
  } catch (err: unknown) {
    console.warn(`skill-scanner: readdir failed for ${hit.abs}: ${(err as Error).message}`);
    return [];
  }
  const out: ScannedSkill[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      const skillName = e.name;
      const skillMd = hit.abs + sep + skillName + sep + 'SKILL.md';
      const raw = await readSkillFile(skillMd);
      if (raw === null) continue;
      const parsed = parseFrontmatter(raw);
      const name = (parsed.name?.trim()) ?? skillName;
      out.push({
        name,
        description: parsed.description ?? '',
        emblem: (parsed.emblem?.trim()) ?? deriveEmblem(name),
        tags: parsed.tags ?? [],
        allowedTools: parsed.allowedTools ?? [],
        layout: 'folder',
        relDir: hit.relDir,
        relPath: posix.join(hit.relDir, skillName, 'SKILL.md'),
      });
    } else if (e.isFile()) {
      const lower = e.name.toLowerCase();
      if (!lower.endsWith('.md')) continue;
      if (lower === 'readme.md') continue;
      if (lower === 'skill.md') continue; // ambiguous: SKILL.md must live under a folder
      const skillName = e.name.slice(0, -3);
      const abs = hit.abs + sep + e.name;
      const raw = await readSkillFile(abs);
      if (raw === null) continue;
      const parsed = parseFrontmatter(raw);
      const name = (parsed.name?.trim()) ?? skillName;
      out.push({
        name,
        description: parsed.description ?? '',
        emblem: (parsed.emblem?.trim()) ?? deriveEmblem(name),
        tags: parsed.tags ?? [],
        allowedTools: parsed.allowedTools ?? [],
        layout: 'file',
        relDir: hit.relDir,
        relPath: posix.join(hit.relDir, e.name),
      });
    }
  }
  return out;
}

export async function scanSkills(opts: ScanOptions): Promise<ScannedSkill[]> {
  const rootDir = resolve(opts.rootDir);
  const maxDepth = opts.maxDepth ?? 6;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const rules = parseUserIgnore(opts.userIgnore, rootDir);

  const work = (async (): Promise<ScannedSkill[]> => {
    const hits: SkillsDirHit[] = [];
    await walk(rootDir, maxDepth, rules, hits);
    const all: ScannedSkill[] = [];
    for (const hit of hits) {
      const list = await collectSkillsInDir(rootDir, hit);
      all.push(...list);
    }
    all.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
    return all;
  })();

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`skill-scanner: timeout after ${timeoutMs}ms`)); }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
