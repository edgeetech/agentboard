// Filesystem-derived rule cascade. Walk from repo root down to the workspace
// path, collect every `.folder-rules.md`, parse markdown bullet rules, dedupe,
// return ordered closest-last. Zero LLM cost.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface FolderRule {
  readonly source: string;
  readonly text: string;
}

const RULE_BULLET = /^\s*[-*]\s+(.+?)\s*$/;

function parseRulesFile(path: string): string[] {
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = RULE_BULLET.exec(line);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

/**
 * Collect cascaded rules from `repoPath` down to `workspacePath`.
 * `workspacePath` may equal `repoPath`. Both must be absolute.
 */
export function cascade(repoPath: string, workspacePath: string): FolderRule[] {
  if (!isAbsolute(repoPath) || !isAbsolute(workspacePath)) return [];
  const root = resolve(repoPath);
  const leaf = resolve(workspacePath);
  const rel = relative(root, leaf);
  if (rel.startsWith('..')) return []; // workspace not inside repo

  const segments = rel === '' ? [] : rel.split(sep);
  const rules: FolderRule[] = [];
  const seen = new Set<string>();

  const readAt = (dir: string): void => {
    const file = resolve(dir, '.folder-rules.md');
    for (const text of parseRulesFile(file)) {
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({ source: file, text });
    }
  };

  let current = root;
  readAt(current);
  for (const seg of segments) {
    current = resolve(current, seg);
    readAt(current);
  }
  return rules;
}
