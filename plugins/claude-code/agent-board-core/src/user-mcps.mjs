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
    out[k] = normalizeServer(v);
  }
  return out;
}

/**
 * Some ~/.claude.json entries have `args` as an object with numeric keys
 * ({ "0": "foo", "1": "bar" }) instead of a real array. Claude CLI needs a
 * proper array. Normalize defensively so inheritance works regardless of
 * how the user's config got written.
 */
function normalizeServer(s) {
  if (!s || typeof s !== 'object') return s;
  const out = { ...s };
  if (out.args && !Array.isArray(out.args) && typeof out.args === 'object') {
    const keys = Object.keys(out.args).filter(k => /^\d+$/.test(k))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (keys.length > 0) out.args = keys.map(k => out.args[k]);
  }
  return out;
}

export function inheritedUserMcpKeys() {
  return Object.keys(inheritedUserMcpServers());
}
