---
name: update
description: Update AgentBoard. Updates the runtime (server, executor, UI) with git and restarts it, then checks whether the Claude Code plugin itself has a newer version and prints the commands to upgrade it.
---

AgentBoard has two parts that update separately:

- **Runtime** — server, executor and UI, installed at `~/.agentboard/runtime` (or `AGENTBOARD_RUNTIME`). Almost every change lands here.
- **Plugin** — this thin Claude Code adapter: MCP tools, hooks and skills.

## Steps

1. **Update the runtime.** Run `node --experimental-strip-types --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/ensure-server.ts" update`. It pulls the latest runtime with `git pull --ff-only`, reinstalls dependencies and restarts a running server. Report the `updated A → B` or `already at X` line it prints. If it says the runtime is not a git checkout, tell the user how their runtime is installed (`node --experimental-strip-types --no-warnings "${CLAUDE_PLUGIN_ROOT}/bin/ensure-server.ts" path`) and stop.

2. **Check the plugin.** Read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` → `version` (= INSTALLED). Fetch
   `https://raw.githubusercontent.com/edgeetech/agentboard/main/.claude-plugin/marketplace.json` and read the `agentboard` entry's `version` (= LATEST). Compare numerically per component.

3. **Report.** If LATEST > INSTALLED, print:
   ```
   agentboard plugin update available: INSTALLED → LATEST

     /plugin marketplace update agent-board-local
     /plugin install agentboard@agent-board-local
     /reload-plugins
   ```
   The runtime does not need a restart for a plugin update. Otherwise print `agentboard plugin INSTALLED is the latest version.`

## Failure modes

- Network unreachable → say so; the runtime step may still have succeeded.
- Never run `/plugin install` yourself. Only print the commands.
