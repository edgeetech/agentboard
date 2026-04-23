# agentboard

**Source:** https://github.com/edgeetech/agentboard

Local agent management portal as a Claude Code plugin. A kanban board where PM / Worker / Reviewer agents — spawned as headless `claude -p` subprocesses — move tasks through predefined workflows. Only the Human (Product Owner) approval step is manual.

One SQLite DB per project, one local web UI, zero cloud dependencies.

## Install

In any Claude Code session:

```
/plugin marketplace add edgeetech/agentboard
/plugin install agentboard@agent-board-local
/reload-plugins
```

Then in any Claude Code session:

```bash
/agentboard:open     # boot server + open UI in browser
/agentboard:doctor   # health checklist
/agentboard:stop     # stop the local server
```

No post-install build. Plugin ships the prebuilt UI bundle.

### Requirements

- **Node ≥ 22** or **Bun ≥ 1.x** on PATH (server uses `node:sqlite`, built-in).
- **`claude` CLI ≥ 2.0.0** on PATH with either `ANTHROPIC_API_KEY` env set or an active OAuth session (`claude /login`).
- Windows, macOS, or Linux.

## Workflows

Pick one per project at creation:

- **WF1** (default): `Todo → Agent Working → Agent Review → Human Approval → Done`
- **WF2**: `Todo → Agent Working → Human Approval → Done` *(skip Reviewer)*

Flow is **autonomous**: task creation auto-dispatches PM; state transitions auto-chain Worker and (WF1) Reviewer. Human approval is the only manual gate.

## Roles

| Role | Does |
|---|---|
| **Project Manager** | Enriches the raw task into a tight brief + 3–7 acceptance criteria, hands off to Worker. Read-only over the repo. |
| **Worker** | Edits files under `repo_path`. No commits, no branches — leaves working tree dirty for the human to review. |
| **Reviewer** *(WF1)* | Checks work against AC, approves to Human or bounces back to Worker with `REWORK:` reason. |
| **Product Owner** | You. Final approval / rejection in the UI. |

Rework loop caps at 3 iterations — after that the task stalls and surfaces a "Retry from Worker" button.

## Cost tracking

Every run parses its `stream-json` usage events and stamps `agent_run.cost_usd` using the hardcoded pricing table (`agent-board-core/src/pricing.mjs`). Task cards show cost chips; project header shows all-time / 7d / 30d totals. Unknown model → $0 with an "uncosted" flag (never silent wrong numbers). Pricing table carries a `PRICING_VERSION`; when Anthropic prices change, a v1.1 reprice skill will recompute historical runs.

## Data location

Outside the repo, never touched by plugin upgrades:

```
~/.agentboard/             (%USERPROFILE%\.agentboard on Windows)
  projects/<code>.db       one SQLite per project
  logs/<run_id>.jsonl      headless Claude stream-json output
  logs/<run_id>.err.log    captured stderr
  run-configs/<id>.json    tmp MCP config per run (deleted on exit)
  config.json              port, pid, token, server_id, active project
  server.lock              single-instance file lock
```

## Security

127.0.0.1-only binding. 32-byte hex Bearer token (file perms 0600 on Unix, ACL-restricted on Windows). All `/api/*` and the HTTP MCP endpoint require the token. `/alive` is the only unauthenticated endpoint and reveals only liveness + plugin version, never the token. DNS-rebinding blocked via `Host` header guard.

## Development

Repo layout:

```
agentboard/
  .claude-plugin/
    marketplace.json                 Marketplace descriptor
  plugins/claude-code/               Claude Code plugin (only dir published to users)
    .claude-plugin/plugin.json       Manifest
    skills/{open,stop,doctor}/       User-invoked slash commands
    hooks/hooks.json                 SessionStart boot hook
    bin/ensure-server.mjs            Boots / reuses local server
    mcp/agentboard.mjs               Stdio MCP for user's Claude session
    agent-board-core/                Vendored server (Node) + built UI
      server.mjs, executor.mjs, src/, db/, prompts/, ui/dist/
```

Rebuild UI after changes:

```bash
cd plugins/claude-code/agent-board-core/ui && npm install && npm run build
```

`agent-board-core/ui/dist/` is committed — ships with the plugin so `/plugin install` is zero-build.

See [CLAUDE.md](./CLAUDE.md) for architecture internals, state machine rules, and sharp edges.

## License

[Elastic License 2.0 (ELv2)](./LICENSE). Same as [context-mode](https://github.com/mksglu/context-mode). You may self-host and modify; you may not offer agentboard as a managed service to third parties.
