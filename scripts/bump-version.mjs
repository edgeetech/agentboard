#!/usr/bin/env node
// Bump patch version in plugin.json + marketplace.json (kept in lockstep).
// Idempotent across multiple commits per day — always increments patch by 1.
//
// Flags:
//   --level patch|minor|major   (default: patch)
//   --dry                       (print what would change, no write)
//
// Usage (wired into .githooks/pre-commit):
//   node scripts/bump-version.mjs
//
// Skipped when the only staged changes are in unrelated paths (configured
// below) — lets you commit docs without bumping.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PLUGIN_JSON      = resolve(ROOT, 'plugins/claude-code/.claude-plugin/plugin.json');
const MARKETPLACE_JSON = resolve(ROOT, '.claude-plugin/marketplace.json');

// Staged-file paths that should NOT trigger a bump (docs-only, meta).
const SKIP_BUMP_PREFIXES = [
  '.gitignore',
  '.gitattributes',
  'LICENSE',
  'README.md',
  'CLAUDE.md',
  '.claude/',
  'scripts/',
  '.githooks/',
];

const args = process.argv.slice(2);
const level = args.includes('--level') ? args[args.indexOf('--level') + 1] : 'patch';
const dry   = args.includes('--dry');

main();

function main() {
  if (shouldSkip()) {
    console.log('[bump-version] staged changes are docs/meta only → skipping');
    return;
  }

  const plugin = readJson(PLUGIN_JSON);
  const marketplace = readJson(MARKETPLACE_JSON);

  const current = plugin.version;
  const next = bump(current, level);
  if (next === current) return;

  plugin.version = next;
  const entry = (marketplace.plugins || []).find(p => p.name === plugin.name);
  if (entry) entry.version = next;

  if (dry) {
    console.log(`[bump-version] would bump ${current} → ${next}`);
    return;
  }
  writeJson(PLUGIN_JSON, plugin);
  writeJson(MARKETPLACE_JSON, marketplace);
  console.log(`[bump-version] ${current} → ${next}`);

  // Re-stage so the bump lands in this commit
  try {
    execFileSync('git', ['add', PLUGIN_JSON, MARKETPLACE_JSON], { stdio: 'ignore' });
  } catch { /* not in a repo or git unavailable; safe to ignore */ }
}

function bump(v, lvl) {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v);
  if (!m) throw new Error(`invalid semver: ${v}`);
  let [, maj, min, pat, tail] = m;
  maj = +maj; min = +min; pat = +pat;
  if (lvl === 'major') { maj++; min = 0; pat = 0; }
  else if (lvl === 'minor') { min++; pat = 0; }
  else { pat++; }
  return `${maj}.${min}.${pat}${tail || ''}`;
}

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function writeJson(p, obj) { writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function shouldSkip() {
  let staged;
  try {
    staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    return false; // no git / no staged — run the bump anyway (manual invocation)
  }
  if (staged.length === 0) return true;
  return staged.every(f => SKIP_BUMP_PREFIXES.some(pre => f === pre || f.startsWith(pre)));
}
