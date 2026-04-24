---
name: update
description: Check edgeetech/agentboard on GitHub for a newer plugin version and upgrade if available. Reads the locally installed version from ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json and compares against the raw marketplace.json on the main branch. Prints exact commands for the user to run if an update is waiting.
---

## Inputs you have access to

- `${CLAUDE_PLUGIN_ROOT}` — absolute path to the currently-installed plugin, e.g.
  `C:/Workspace/.claude/plugins/cache/agent-board-local/agentboard/0.1.16/`
- Tools: `Bash` (for `curl` + `cat`), `Read`, `WebFetch`.

## Steps

1. Read the installed version:
   ```
   cat "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
   ```
   Parse the `version` field → call it `INSTALLED`.

2. Fetch the latest marketplace descriptor. Prefer `curl` so the raw JSON enters your context intact:
   ```
   curl -fsSL https://raw.githubusercontent.com/edgeetech/agentboard/main/.claude-plugin/marketplace.json
   ```
   Parse the `plugins[]` entry with `"name": "agentboard"` → `.version` field is `LATEST`.

3. Compare semver strings numerically (split on `.`, compare each component as integer).

4. Report one of:

   **Already up to date**
   ```
   agentboard 0.1.16 is the latest version.
   ```

   **Update available**
   ```
   agentboard update available: 0.1.16 → 0.1.24
   
   Run these three commands in Claude Code to upgrade:
   
     /plugin marketplace update agent-board-local
     /plugin install agentboard@agent-board-local
     /reload-plugins
   
   After that: if the server is running, restart it so new code is loaded:
   
     /agentboard:stop
     /agentboard:open
   ```

   **Local newer than remote** (developer scenario — unpublished commits)
   ```
   Local 0.1.24 is newer than published 0.1.16. Nothing to install.
   ```

## Failure modes

- Network unreachable or `curl` fails → tell the user "couldn't reach GitHub — try again online" and stop.
- Parse error on either JSON → print raw first 500 chars + error; stop.
- Never auto-run `/plugin install` or any destructive command. Only print the commands; let the user execute them so they own the upgrade.
