---
name: doctor
description: Diagnose the agentboard install. Reports Node/Bun version, claude CLI version, data-dir perms, lock/port state, DB accessibility, token presence, PRICING_VERSION, and rotation hint.
---

Output a checklist (one line per item, `[ok]` / `[warn]` / `[fail]` prefix):

1. Node ≥22 or Bun ≥1 on PATH.
2. `claude --version` on PATH and ≥ 2.0.0 (MIN_CLAUDE_CLI).
3. `ANTHROPIC_API_KEY` env set OR `claude /status` reports active OAuth. Mask the key to first/last 4 chars.
4. `~/.agentboard` exists and is writable; `config.json` perms restricted (0600 on Unix, ACL on Windows).
5. Read `~/.agentboard/config.json`:
   - `port`, `pid` present → `GET http://127.0.0.1:<port>/alive` — compare `server_id` and `plugin_version` from the response.
   - If mismatch: advise `/agentboard stop` then `/agentboard open`.
6. List project DBs under `~/.agentboard/projects/`. For each, probe schema_version in `meta`.
7. Print `PRICING_VERSION` (from `agentboard-core/src/pricing.mjs`) and the "last sourced" date from that file's header comment. Warn if >180 days old.
8. **Update check** (best-effort, non-fatal if network fails):
   - Installed version: read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` `.version`.
   - Latest on GitHub: `curl -fsSL https://raw.githubusercontent.com/edgeetech/agentboard/main/.claude-plugin/marketplace.json` → `plugins[0].version`.
   - Compare semver numerically. Print `[ok] agentboard 0.1.X (latest)` or `[warn] agentboard 0.1.X — upgrade available → 0.1.Y (run /agentboard:update)`.
   - If curl fails, print `[warn] could not reach GitHub to check for updates`.
9. End with: "If `ANTHROPIC_API_KEY` was rotated after the server started, run `/agentboard:stop` then `/agentboard:open` — child processes inherit env from server launch."

Do NOT print the Bearer token or the 32-byte value of `token`. A hint like "token: 64-char hex present" is enough.
