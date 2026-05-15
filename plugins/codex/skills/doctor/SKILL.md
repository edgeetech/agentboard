---
name: doctor
description: Diagnose the agentboard install for the Codex plugin. Reports Node version, codex CLI version, data-dir permissions, lock/port state, DB accessibility, token presence.
---

1. Verify Node is on `PATH` (`node --version`); require >= 22.
2. Verify `codex --version` is on `PATH`.
3. Read `~/.agentboard/config.json` (or `%USERPROFILE%\.agentboard\config.json` on Windows). Confirm it parses, contains `port` and `token`, and that the `port` is reachable on `127.0.0.1`.
4. Hit `GET http://127.0.0.1:<port>/alive` — confirm `{ ok: true, server_id, plugin_version }`.
5. Confirm `~/.agentboard/projects/` exists and is readable; list any `.db` files.
6. Confirm `~/.agentboard/server.lock` is either absent (no server) or owned by a live PID.
7. Output a checklist showing pass/fail for each step. Do NOT print the Bearer token.

If a step fails, suggest the obvious remediation — usually `node --experimental-strip-types --no-warnings "${CODEX_PLUGIN_ROOT}/bin/ensure-server.ts"` to boot the server.
