// Provider-agnostic tool policy.
//
// Single source of truth for "may this agent run this tool right now?". Used by
//   * the Claude PreToolUse hook (via the abrun `record_tool` MCP call),
//   * the Codex / Copilot runner tool gates (argv-spawned providers that have
//     no PreToolUse hook of their own),
//   * the per-role `--allowedTools` list builder (tool-allowlist.ts).
//
// Deny-first: destructive shell categories are NOT granted unless a project
// explicitly opts in with `allow_destructive_tools: true`.
//
// IMPORTANT: this module evaluates the FULL command string. Callers must NOT
// truncate `target` before calling evaluateToolPolicy — truncation is only
// safe for logging/storage of the decision afterwards (see src/api-mcp.ts).

import { readConfig } from './config.ts';
import { dataDir } from './paths.ts';

/** Shell command prefixes considered destructive; denied unless opted in. */
export const DESTRUCTIVE_BASH_PREFIXES = [
  'rm',
  'git push',
  'git reset',
  'git checkout',
  'git clean',
  'gh',
] as const;

export type DestructiveCategory = (typeof DESTRUCTIVE_BASH_PREFIXES)[number];

const GIT_DESTRUCTIVE_SUBCOMMANDS = new Set(['push', 'reset', 'checkout', 'clean']);
const GIT_WRITE_SUBCOMMANDS = new Set([
  'commit',
  'push',
  'checkout',
  'reset',
  'rebase',
  'merge',
  'tag',
  'cherry-pick',
  'clean',
]);
/** Top-level git flags that consume a following value (`git -C <dir> push`). */
const GIT_LEADING_FLAGS_WITH_VALUE = new Set(['-C', '-c']);

/** Commands that just forward to a real command; unwrapped to find the true target. */
const WRAPPER_HEADS = new Set(['sudo', 'nice', 'time', 'env', 'exec', 'xargs']);

const NODE_INLINE_EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
const PYTHON_INLINE_EVAL_FLAGS = new Set(['-c']);
const PYTHON_HEADS = new Set(['python', 'python3', 'py']);

// ── Command segmentation (quote-aware) ───────────────────────────────────────

/**
 * Split a shell command into segments on `&&`, `||`, `;`, `|`, and newlines,
 * without splitting inside single/double quotes. This is what lets us catch
 * `ls && git commit`, `npm test | xargs rm`, `find . -delete; git push`, etc.
 * — the old implementation only ever inspected the whole string as one blob.
 */
function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? '';
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '&' && command[i + 1] === '&') {
      segments.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === '|' && command[i + 1] === '|') {
      segments.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      segments.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  segments.push(cur);
  return segments;
}

/** Tokenize a single command segment on whitespace, respecting quotes (quote chars stripped). */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      started = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(cur);
        cur = '';
        started = false;
      }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) tokens.push(cur);
  return tokens;
}

function basenameOf(token: string): string {
  const base = token.replace(/^.*[/\\]/, '');
  return base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/**
 * Resolve the effective head command of a tokenized segment, unwrapping
 * benign/forwarding prefixes (`sudo`, `env FOO=bar`, `xargs -0`, …) so
 * `xargs rm -rf` and `sudo git push` are evaluated as `rm` / `git push`
 * rather than as the harmless wrapper itself.
 */
function resolveHeadCommand(tokens: string[]): { head: string; rest: string[] } {
  let idx = 0;
  while (idx < tokens.length) {
    const base = basenameOf(tokens[idx] ?? '');
    if (!WRAPPER_HEADS.has(base)) break;
    idx++;
    while (idx < tokens.length && (tokens[idx] ?? '').startsWith('-')) idx++;
    while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx] ?? '')) idx++;
  }
  return { head: basenameOf(tokens[idx] ?? ''), rest: tokens.slice(idx + 1) };
}

/** First non-flag token in `args`, treating `-C`/`-c` as consuming the next token. */
function subcommandFromArgs(args: string[]): string | null {
  let i = 0;
  while (i < args.length) {
    const t = args[i] ?? '';
    if (GIT_LEADING_FLAGS_WITH_VALUE.has(t)) {
      i += 2;
      continue;
    }
    if (t.startsWith('-')) {
      i += 1;
      continue;
    }
    return t;
  }
  return null;
}

/** Returns the destructive category a shell command falls into, or null. Scans every `&&`/`||`/`;`/`|`-separated segment. */
export function destructiveCategoryOf(command: string): string | null {
  if (!command) return null;
  for (const segment of splitCommandSegments(command)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const { head, rest } = resolveHeadCommand(tokens);
    if (head === 'rm') return 'rm';
    if (head === 'gh') return 'gh';
    if (head === 'git') {
      const sub = subcommandFromArgs(rest);
      if (sub !== null && GIT_DESTRUCTIVE_SUBCOMMANDS.has(sub)) return `git ${sub}`;
    }
    if (head === 'find' && rest.some((t) => t === '-delete' || t === '-exec' || t === '-execdir')) {
      return 'find -delete';
    }
  }
  return null;
}

/** True if any segment of `command` is a git write subcommand (commit/push/checkout/reset/rebase/merge/tag/cherry-pick/clean). */
export function isGitWriteCommand(command: string): boolean {
  if (!command) return false;
  for (const segment of splitCommandSegments(command)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const { head, rest } = resolveHeadCommand(tokens);
    if (head !== 'git') continue;
    const sub = subcommandFromArgs(rest);
    if (sub !== null && GIT_WRITE_SUBCOMMANDS.has(sub)) return true;
  }
  return false;
}

/**
 * True if any segment invokes an interpreter's inline-eval form
 * (`node -e`/`--eval`/`-p`, `python -c`). These execute arbitrary code that
 * bypasses every other pattern-based check in this module, so they are
 * blocked unconditionally — there is no `allow_destructive_tools` opt-out.
 * Plain `node script.js` / `npm test` / `npx vitest` remain allowed.
 */
export function isInlineEvalCommand(command: string): boolean {
  if (!command) return false;
  for (const segment of splitCommandSegments(command)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const { head, rest } = resolveHeadCommand(tokens);
    if (
      head === 'node' &&
      rest.some((t) => NODE_INLINE_EVAL_FLAGS.has(t) || t.startsWith('--eval='))
    ) {
      return true;
    }
    if (PYTHON_HEADS.has(head) && rest.some((t) => PYTHON_INLINE_EVAL_FLAGS.has(t))) {
      return true;
    }
  }
  return false;
}

// ── AgentBoard data-dir protection ────────────────────────────────────────────

function normalizeSlashes(s: string): string {
  return s.replace(/\\/g, '/');
}

/** Generic (unexpanded) forms an agent might reference the home dir with. */
const GENERIC_HOME_MARKERS = [
  '~/.agentboard',
  '%userprofile%/.agentboard',
  '%homedrive%%homepath%/.agentboard',
  '$env:userprofile/.agentboard',
  '$home/.agentboard',
  '${home}/.agentboard',
];

/**
 * True if a tool target (file path or shell command) references the
 * AgentBoard data dir (`~/.agentboard` — holds `config.json`, which contains
 * the server's Bearer token, plus every project DB and run log). Blocks
 * Read/Bash/etc. from exfiltrating the token regardless of how the path is
 * spelled: absolute with forward or back slashes, `~/.agentboard`,
 * `%USERPROFILE%\.agentboard`, `$HOME/.agentboard`, `$env:USERPROFILE\...`.
 */
export function referencesAgentboardDataDir(target: string | null | undefined): boolean {
  if (!target) return false;
  const norm = normalizeSlashes(target).toLowerCase();
  let absDir = '';
  try {
    absDir = normalizeSlashes(dataDir()).toLowerCase();
  } catch {
    /* dataDir() is pure path-join; defensive only */
  }
  if (absDir !== '' && norm.includes(absDir)) return true;
  return GENERIC_HOME_MARKERS.some((m) => norm.includes(m));
}

/**
 * Whether destructive shell categories are enabled for a project.
 *
 * Resolution order (first hit wins):
 *   1. project row / run config flag (`allowDestructiveOverride`)
 *   2. ~/.agentboard/config.json → projects.<CODE>.allow_destructive_tools
 *   3. ~/.agentboard/config.json → allow_destructive_tools (global)
 *   4. false
 */
export function destructiveToolsAllowed(
  projectCode?: string | null,
  allowDestructiveOverride?: boolean | null,
): boolean {
  if (typeof allowDestructiveOverride === 'boolean') return allowDestructiveOverride;
  let cfg: Record<string, unknown>;
  try {
    cfg = readConfig();
  } catch {
    return false;
  }
  if (projectCode) {
    const projects = cfg.projects as Record<string, unknown> | undefined;
    const proj = projects?.[projectCode] as Record<string, unknown> | undefined;
    if (typeof proj?.allow_destructive_tools === 'boolean') return proj.allow_destructive_tools;
  }
  return cfg.allow_destructive_tools === true;
}

export interface ToolPolicyInput {
  /** Tool name as reported by the provider (`Bash`, `Edit`, `Write`, …). */
  tool: string;
  /** File path or shell command the tool was invoked with. */
  target?: string | null | undefined;
  /** Tools the current run phase forbids outright. */
  blockedTools?: readonly string[];
  /** Phase label, used only for the denial reason. */
  phase?: string;
  /** project.allow_git — gates git write commands. */
  allowGit?: boolean;
  /** Resolved `allow_destructive_tools` for the project. */
  allowDestructive?: boolean;
}

export interface ToolPolicyDecision {
  decision: 'allow' | 'block';
  reason: string | null;
}

/** Evaluate a single tool attempt. Pure — no IO, safe to call from any runner. */
export function evaluateToolPolicy(input: ToolPolicyInput): ToolPolicyDecision {
  const tool = input.tool;
  const target = input.target ?? '';

  // Highest priority, applies to every tool regardless of phase or
  // allow_destructive_tools: never let an agent read/touch the data dir that
  // holds the server's Bearer token.
  if (referencesAgentboardDataDir(target)) {
    return {
      decision: 'block',
      reason:
        'target references the AgentBoard data dir (~/.agentboard — config/token/logs) — always denied',
    };
  }

  if ((input.blockedTools ?? []).includes(tool)) {
    return { decision: 'block', reason: `phase ${input.phase ?? 'unknown'} forbids ${tool}` };
  }

  if (tool === 'Bash') {
    if (isInlineEvalCommand(target)) {
      return {
        decision: 'block',
        reason:
          'inline code evaluation (node -e/--eval/-p, python -c) is always blocked — it bypasses command review',
      };
    }
    if (input.allowDestructive !== true) {
      const category = destructiveCategoryOf(target);
      if (category !== null) {
        return {
          decision: 'block',
          reason: `destructive command '${category}' blocked — set allow_destructive_tools on this project to permit it`,
        };
      }
    }
    if (isGitWriteCommand(target) && input.allowGit !== true) {
      return { decision: 'block', reason: 'git writes blocked unless project.allow_git' };
    }
  }

  return { decision: 'allow', reason: null };
}

/**
 * Read `allow_destructive_tools` out of a project's `agent_config_json` blob
 * (the per-project run-config surface). Returns null when unset/unparseable so
 * the caller falls through to ~/.agentboard/config.json.
 */
export function projectDestructiveFlag(agentConfigJson: unknown): boolean | null {
  if (typeof agentConfigJson !== 'string' || agentConfigJson.trim() === '') return null;
  try {
    const parsed = JSON.parse(agentConfigJson) as Record<string, unknown>;
    return typeof parsed.allow_destructive_tools === 'boolean'
      ? parsed.allow_destructive_tools
      : null;
  } catch {
    return null;
  }
}
