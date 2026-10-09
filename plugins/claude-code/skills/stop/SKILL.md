---
name: stop
description: Stop the AgentBoard server. Children in-flight are left to finish (they heartbeat independently); the reaper cleans up if they orphan.
---

1. Run `node --experimental-strip-types --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/ensure-server.ts" stop`.
2. Report what it printed: `stopped`, or `server is not running`.

The server is shared by every host (Claude Code, Codex, Copilot) and the browser UI — stopping it stops it for all of them. Do not delete DB files, logs, or trash.
