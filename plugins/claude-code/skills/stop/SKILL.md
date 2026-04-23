---
name: stop
description: Stop the agentboard core server. Children in-flight are left to finish (they heartbeat independently); reaper cleans up if they orphan.
---

1. Read `~/.agentboard/config.json` and get `pid`.
2. If the pid is alive, send `SIGTERM`. Wait 2s. If still alive, `SIGKILL`.
3. Remove `port` and `pid` from `config.json` (keep `token`, `active_project_code`, `server_id`, `plugin_version`).
4. Report: server stopped, or "no server running" if pid was dead.

Do not delete DB files, logs, or trash.
