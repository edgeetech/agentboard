---
name: stop
description: Stop the agentboard core server (Codex plugin).
---

1. Read `~/.agentboard/config.json` (Windows: `%USERPROFILE%\.agentboard\config.json`) for the running server's `pid` and `port`.
2. Send a graceful SIGTERM to the PID. On Windows, use `taskkill /pid <pid>` without `/F` first.
3. Wait up to 10 seconds for the process to exit (poll `~/.agentboard/server.lock` or `tasklist`).
4. Confirm to the user that the server stopped. In-flight agent runs heartbeat independently — the reaper cleans them up if they orphan.

Do not delete `~/.agentboard/` or any project DBs as part of `stop`.
