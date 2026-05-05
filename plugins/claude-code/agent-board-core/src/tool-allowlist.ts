// Per-role --allowedTools for spawned `claude -p` runs.
// acceptEdits mode does NOT cover Bash; un-allowlisted shell deadlocks.

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
  'git checkout',
  'git switch',
  'git branch',
  'git add',
  'git commit',
  'git push',
  'git pull',
  'git merge',
  'git rebase',
  'git reset',
  'git stash',
  'gh', // GitHub CLI — read PRs/issues/comments for tasks like "fix Devin PR feedback"
  'ls',
  'cat',
  'find',
  'mkdir',
  'rm',
  'mv',
  'cp',
  'echo',
  'pwd',
].map((c) => `Bash(${c}:*)`);

const REVIEWER_BASH = [
  'git diff',
  'git log',
  'git show',
  'git status',
  'gh',
  'ls',
  'cat',
  'find',
].map((c) => `Bash(${c}:*)`);

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

export function allowlistFor(role: Role): string {
  const inherited = inheritedUserMcpKeys().map((k) => `mcp__${k}__*`);
  return [...ALLOWLIST[role], ...inherited].join(',');
}
