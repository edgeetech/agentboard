// PreToolUse hook builder for noskills-style phase enforcement.
//
// Two delivery shapes are supported, depending on how the agent process is
// spawned:
//
//   1. Claude Agent SDK inline hooks (preferred for spawned `query()` calls):
//      buildSdkHooks({ runToken, mcpUrl, serverToken })
//      → returns a HookInput object suitable for SDK queryOptions.hooks
//
//   2. Settings.json file (for `claude -p` subprocess runs):
//      writeRunSettings(runDir, { runToken, mcpUrl, serverToken })
//      → writes <runDir>/settings.json + <runDir>/pretooluse.mjs
//      → returns the settings path to pass via --settings
//
// Both shapes call back to the abrun MCP `record_tool` to (a) check phase
// policy and (b) report the tool attempt to the live activity feed. Server
// returns {decision:'allow'|'block', reason}; hook converts to SDK contract.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HookResult {
  continue?: boolean;
  stopReason?: string;
  decision?: 'block' | 'approve';
}

export interface SdkHookParams {
  runToken: string;
  mcpUrl: string;
  serverToken: string;
}

// ─── Inline node hook script (verbatim) ──────────────────────────────────────

const HOOK_NODE_SCRIPT = `#!/usr/bin/env node
// agentboard PreToolUse hook (settings.json delivery shape).
// Reads stdin JSON from Claude Code, calls abrun.record_tool, prints decision.
import { argv } from 'node:process';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
let evt;
try { evt = JSON.parse(raw); } catch { process.exit(0); }

const tool = evt?.tool_name || evt?.tool || '';
const target = evt?.tool_input?.file_path || evt?.tool_input?.command || '';

const runToken   = process.env.AGENTBOARD_RUN_TOKEN;
const mcpUrl     = process.env.AGENTBOARD_MCP_URL;
const serverTok  = process.env.AGENTBOARD_SERVER_TOKEN;
if (!runToken || !mcpUrl || !serverTok) process.exit(0); // best-effort: never block on misconfig

const body = {
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'record_tool', arguments: { run_token: runToken, tool, target } },
};

let decision = 'allow', reason = null;
try {
  const r = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serverTok },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  const txt = j?.result?.content?.[0]?.text;
  if (txt) {
    try { const parsed = JSON.parse(txt); decision = parsed.decision || 'allow'; reason = parsed.reason || null; }
    catch { /* allow */ }
  }
} catch { /* allow on hook failure — never wedge the agent */ }

if (decision === 'block') {
  // Claude Code hook contract: stderr + exit 2 = block with feedback.
  process.stderr.write(reason || 'agentboard: tool blocked by phase policy');
  process.exit(2);
}
process.exit(0);
`;

// ─── Settings.json delivery ───────────────────────────────────────────────────

/** Write settings.json + hook script to a per-run directory. Returns settings path. */
export function writeRunSettings(runDir: string, params: SdkHookParams): string {
  mkdirSync(runDir, { recursive: true });
  const hookPath = join(runDir, 'pretooluse.mjs');
  const settingsPath = join(runDir, 'settings.json');

  writeFileSync(hookPath, HOOK_NODE_SCRIPT, { mode: 0o755 });

  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
          hooks: [{ type: 'command', command: `node "${hookPath.replace(/\\/g, '/')}"` }],
        },
      ],
    },
    env: {
      AGENTBOARD_RUN_TOKEN: params.runToken,
      AGENTBOARD_MCP_URL: params.mcpUrl,
      AGENTBOARD_SERVER_TOKEN: params.serverToken,
    },
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return settingsPath;
}

// ─── SDK inline delivery ──────────────────────────────────────────────────────

/**
 * Inline hooks for the Claude Agent SDK. Pass to queryOptions.hooks.
 * Hook callback signature per SDK 0.2.x: (input, toolUseId, ctx) → Promise<HookResult>.
 */
export function buildSdkHooks(params: SdkHookParams): {
  PreToolUse: {
    matchers: string[];
    hooks: ((input: unknown, toolUseId: string, ctx: unknown) => Promise<HookResult>)[];
  }[];
} {
  const callback = async (input: unknown): Promise<HookResult> => {
    const inp = input as Record<string, unknown> | null | undefined;
    const tool = (inp?.tool_name ?? inp?.tool ?? '') as string;
    const toolInput = inp?.tool_input as Record<string, unknown> | undefined;
    const target = (toolInput?.file_path ?? toolInput?.command ?? '') as string;
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'record_tool', arguments: { run_token: params.runToken, tool, target } },
    };
    try {
      const r = await fetch(params.mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + params.serverToken,
        },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as Record<string, unknown>;
      const result = j.result as Record<string, unknown> | undefined;
      const content = result?.content;
      const txt = Array.isArray(content)
        ? ((content[0] as Record<string, unknown>).text as string | undefined)
        : undefined;
      if (txt !== undefined) {
        const parsed = JSON.parse(txt) as Record<string, unknown>;
        if (parsed.decision === 'block') {
          return {
            continue: false,
            stopReason:
              (parsed.reason as string | undefined) ?? 'agentboard: tool blocked by phase policy',
            decision: 'block',
          };
        }
      }
    } catch {
      /* allow on hook failure */
    }
    return { continue: true };
  };

  return {
    PreToolUse: [
      {
        matchers: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'],
        hooks: [callback],
      },
    ],
  };
}
