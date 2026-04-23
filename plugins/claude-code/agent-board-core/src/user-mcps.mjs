// Resolve which user-level MCP servers (from ~/.claude.json) should be
// inherited by dispatched child runs.
//
// Gated by `inherit_user_mcps` in ~/.agentboard/config.json:
//   false | undefined  → inherit nothing (default, matches original isolation)
//   true               → inherit every user MCP
//   string[]           → inherit only listed server keys
//
// The `abrun` key is always filtered out — the run config defines its own.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readConfig } from './config.mjs';

function readUserMcpServers() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
    return cfg && cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
  } catch { return {}; }
}

export function inheritedUserMcpServers() {
  const mode = readConfig().inherit_user_mcps;
  if (!mode) return {};
  const all = readUserMcpServers();
  const out = {};
  const allow = Array.isArray(mode) ? new Set(mode) : null;
  for (const [k, v] of Object.entries(all)) {
    if (k === 'abrun') continue;
    if (allow && !allow.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function inheritedUserMcpKeys() {
  return Object.keys(inheritedUserMcpServers());
}
