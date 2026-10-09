// Per-role --allowedTools for spawned `claude -p` runs.
// acceptEdits mode does NOT cover Bash; un-allowlisted shell deadlocks.
//
// Deny-first: destructive shell categories (rm, git push/reset/checkout/clean,
// gh) are NOT in the default list. The agent's cwd is the real repository, so a
// bad call there is unrecoverable. Opt in per project with
// `allow_destructive_tools: true` (see tool-policy.ts).

import { DESTRUCTIVE_BASH_PREFIXES } from './tool-policy.ts';
import { inheritedUserMcpKeys } from './user-mcps.ts';

const MCP = 'mcp__abrun__*';

const WORKER_BASH = [
  'npm',
  'pnpm',
  'yarn',
  'node',
  'tsc',
  'python',
  'pip',
  'pytest',
  'go',
  'cargo',
  'dotnet',
  'mvn',
  'gradle',
  'git status',
  'git diff',
  'git log',
  'git show',
  'git rev-parse',
  'git ls-files',
  // `git switch` covers the legitimate branch-change case; `git checkout` is
  // destructive (`git checkout -- <path>` discards work) and is opt-in only.
  'git switch',
  'git branch',
  'git add',
  'git commit',
  'git pull',
  'git merge',
  'git rebase',
  'git stash',
  'ls',
  'cat',
  'find',
  'mkdir',
  'mv',
  'cp',
  'echo',
  'pwd',
].map((c) => `Bash(${c}:*)`);

const REVIEWER_BASH = ['git diff', 'git log', 'git show', 'git status', 'ls', 'cat', 'find'].map(
  (c) => `Bash(${c}:*)`,
);

/** Added back only when the project opts in to destructive tools. */
const DESTRUCTIVE_BASH = DESTRUCTIVE_BASH_PREFIXES.map((c) => `Bash(${c}:*)`);

// `Skill` lets agents invoke user-installed skills (caveman, ctx-*, etc.).
// Skills don't execute until called; each tool they use still honours this
// allowlist, so exposure is bounded.
const SKILL = 'Skill';

export type Role = 'pm' | 'worker' | 'reviewer';

export const ALLOWLIST: Record<Role, string[]> = {
  pm: [MCP, SKILL, 'Read', 'Grep', 'Glob'],
  worker: [MCP, SKILL, 'Read', 'Edit', 'Write', 'Grep', 'Glob', ...WORKER_BASH],
  reviewer: [MCP, SKILL, 'Read', 'Grep', 'Glob', ...REVIEWER_BASH],
};

export interface AllowlistOptions {
  /** When true, restores rm / git push / git reset / git checkout / git clean / gh. */
  allowDestructive?: boolean;
}

export function allowlistForRole(role: Role, opts: AllowlistOptions = {}): string[] {
  const base = [...ALLOWLIST[role]];
  // PM is read-only and has no Bash at all — destructive opt-in never applies.
  if (opts.allowDestructive === true && role !== 'pm') base.push(...DESTRUCTIVE_BASH);
  return base;
}

export function allowlistFor(role: Role, opts: AllowlistOptions = {}): string {
  const inherited = inheritedUserMcpKeys().map((k) => `mcp__${k}__*`);
  return [...allowlistForRole(role, opts), ...inherited].join(',');
}
