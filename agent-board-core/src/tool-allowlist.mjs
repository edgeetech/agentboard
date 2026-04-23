// Per-role --allowedTools for spawned `claude -p` runs.
// acceptEdits mode does NOT cover Bash; un-allowlisted shell deadlocks.

const MCP = 'mcp__abrun__*';

const WORKER_BASH = [
  'npm', 'pnpm', 'yarn',
  'node', 'tsc', 'python', 'pip', 'pytest',
  'go', 'cargo', 'dotnet', 'mvn', 'gradle',
  'git status', 'git diff', 'git log', 'git show', 'git rev-parse', 'git ls-files',
  'ls', 'cat', 'find', 'mkdir', 'rm', 'mv', 'cp', 'echo', 'pwd',
].map(c => `Bash(${c}:*)`);

const REVIEWER_BASH = [
  'git diff', 'git log', 'git show', 'git status',
  'ls', 'cat', 'find',
].map(c => `Bash(${c}:*)`);

export const ALLOWLIST = {
  pm:       [MCP, 'Read', 'Grep', 'Glob'],
  worker:   [MCP, 'Read', 'Edit', 'Write', 'Grep', 'Glob', ...WORKER_BASH],
  reviewer: [MCP, 'Read', 'Grep', 'Glob', ...REVIEWER_BASH],
};

export function allowlistFor(role) {
  return ALLOWLIST[role].join(',');
}
