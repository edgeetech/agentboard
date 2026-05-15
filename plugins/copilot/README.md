# agentboard — Copilot CLI plugin

Copilot CLI does not have a native plugin manifest, so agentboard ships here as a small **installer** that wires up the three independent extension surfaces Copilot exposes:

| Surface | Where | What we install |
|---|---|---|
| MCP servers | `~/.copilot/mcp-config.json` (`COPILOT_HOME`-overridable) | An `agentboard` entry that spawns the shared MCP server (`plugins/claude-code/mcp/agentboard.mjs`). Gives Copilot read/dispatch access to the kanban board. |
| Repo hooks | `<repo>/.github/hooks/agentboard.json` | A hook config that runs `hooks/session/hook-runner.ts` on `sessionStart`, `userPromptSubmitted`, and `postToolUse`. Captures session events into `~/.agentboard/sessions/`. |
| Custom instructions | `<repo>/AGENTS.md` | A short stanza listing the agentboard MCP tools. Optional (`--no-agents-md` to skip). |

## Install

```bash
# from the repo root that you want hooks installed in:
node --experimental-strip-types --no-warnings plugins/copilot/install.ts

# or against another repo:
node --experimental-strip-types --no-warnings plugins/copilot/install.ts --repo /absolute/path/to/your/repo
```

The installer is idempotent: re-running is safe; it only writes files that are missing or out-of-date.

## Uninstall

```bash
node --experimental-strip-types --no-warnings plugins/copilot/uninstall.ts            # against current repo
node --experimental-strip-types --no-warnings plugins/copilot/uninstall.ts --repo …   # explicit
```

## Constraints

- **Requires the agentboard `claude-code` plugin to be installed alongside this one.** The hook runner and MCP server delegate to scripts under `plugins/claude-code/`. The installer fails loudly if those paths are missing.
- **Repo-scoped, not global.** Copilot CLI honours `.github/hooks/*.json` only inside the repo you are working on; if you want session capture across multiple repos, run `install.ts --repo` for each.
- **Slash commands have no equivalent.** Copilot CLI does not allow third parties to register new slash commands. Open the board / diagnose / stop are exposed as MCP tools (`server_status`, etc.) instead — invoke them via natural language inside Copilot CLI.
- **Per-event matchers are coarser than Claude/Codex.** Copilot's hook config has no per-tool `matcher`; every `postToolUse` fire calls our hook, which then filters internally.

## Layout

```
plugins/copilot/
  install.ts                 — one-shot installer (idempotent)
  uninstall.ts               — reverses install
  hooks/session/
    hook-runner.ts            — entry-point invoked by the dropped repo hook
  templates/
    agentboard.json.tmpl      — repo hook config; __HOOK_RUNNER__ placeholder substituted at install
  README.md
```
