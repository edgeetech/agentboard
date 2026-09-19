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

import { readConfig } from './config.ts';

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

const DESTRUCTIVE_MATCHERS: { category: DestructiveCategory; re: RegExp }[] =
  DESTRUCTIVE_BASH_PREFIXES.map((category) => ({
    category,
    // Anchor at start of the command or after a shell separator (; | && || & (),
    // so `foo && rm -rf x` is caught too.
    re: new RegExp(
      String.raw`(^|[;&|(]|\|\||&&)\s*` + category.replace(/ /g, String.raw`\s+`) + String.raw`\b`,
      'i',
    ),
  }));

/** Returns the destructive category a shell command falls into, or null. */
export function destructiveCategoryOf(command: string): DestructiveCategory | null {
  if (!command) return null;
  for (const { category, re } of DESTRUCTIVE_MATCHERS) {
    if (re.test(command)) return category;
  }
  return null;
}

const GIT_WRITE_RE = /^\s*git\s+(commit|push|checkout|reset|rebase|merge|tag|cherry-pick)\b/;

export function isGitWriteCommand(command: string): boolean {
  return GIT_WRITE_RE.test(command);
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

  if ((input.blockedTools ?? []).includes(tool)) {
    return { decision: 'block', reason: `phase ${input.phase ?? 'unknown'} forbids ${tool}` };
  }

  if (tool === 'Bash') {
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
