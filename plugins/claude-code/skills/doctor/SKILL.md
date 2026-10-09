---
name: doctor
description: Diagnose the agentboard install. Reports Node/Bun version, claude CLI version, data-dir perms, lock/port state, DB accessibility, token presence, PRICING_VERSION, and rotation hint.
---

Output a checklist (one line per item, `[ok]` / `[warn]` / `[fail]` prefix):

1. Node ≥22 or Bun ≥1 on PATH.
2. `claude --version` on PATH and ≥ 2.0.0 (MIN_CLAUDE_CLI).
3. `ANTHROPIC_API_KEY` env set OR `claude /status` reports active OAuth. Mask the key to first/last 4 chars.
4. `~/.agentboard` exists and is writable; `config.json` perms restricted (0600 on Unix, ACL on Windows).
5. Run `node --experimental-strip-types --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/ensure-server.ts" status --json`. It reports `running`, `url`, `version` (runtime), `runtime` (install dir) and `boot_error`.
   - `running: true` → `[ok] agentboard <version> at <url> (runtime <runtime>)`.
   - `running: false` with `boot_error` → `[fail] last start failed: <boot_error>`.
   - `running: false` without `boot_error` → `[warn] server not up yet` — first start may still be installing the runtime; suggest `/agentboard:open`.
6. List project DBs under `~/.agentboard/projects/`. For each, probe schema_version in `meta`.
7. Print `PRICING_VERSION` (from `<runtime>/src/pricing.ts`) and the "last sourced" date from that file's header comment. Warn if >180 days old.
8. **Update check** (best-effort): compare the runtime `version` from step 5 with `plugins[0].version` in `https://raw.githubusercontent.com/edgeetech/agentboard/main/.claude-plugin/marketplace.json`. Print `[ok] agentboard X (latest)` or `[warn] agentboard X — update available → Y (run /agentboard:update)`. Network failure → `[warn] could not reach GitHub to check for updates`.
9. End with: "If `ANTHROPIC_API_KEY` was rotated after the server started, run `node --experimental-strip-types --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/ensure-server.ts" restart` — child processes inherit env from server launch."

Do NOT print the Bearer token or the 32-byte value of `token`. A hint like "token: 64-char hex present" is enough.
