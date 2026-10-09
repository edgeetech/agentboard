# Distribution Plan

Phase 1 distribution notes for moving from the current plugin-vendored runtime to the target monorepo layout.

## Current Distribution

- The runnable server, executor, DB schema, prompts, concerns and packaged UI live in `core/` at the repo root.
- `core/bin/agentboard.ts` is the only way to start, stop, inspect or update the server.
- Host plugins (`plugins/claude-code`, `plugins/codex`) contain no runtime. Their shared `bin/ensure-server.ts` locates the runtime — `AGENTBOARD_RUNTIME`, the surrounding checkout, or the managed `~/.agentboard/runtime` clone created on first use — and forwards to the CLI.
- `agentboard update` runs `git pull --ff-only`, reinstalls dependencies and restarts a running server. Plugin updates no longer restart the server.
- The server serves `core/ui/dist`.

## Target Distribution

AgentBoard should have one shared runtime artifact used by host integrations.

Preferred direction:

```text
server/                 runtime bootstrap
packages/*              shared runtime packages
apps/ui/dist            built UI assets
plugins/hosts/*         host-specific launchers and command integration
plugins/providers/*     provider runtimes
ai/                     built-in Markdown AI assets
```

Host plugins should locate the shared runtime through an explicit runtime root, not by assuming it lives inside the Claude Code plugin.

## Transitional Rules

- Done: the runtime moved from `plugins/claude-code/agent-board-core` to `core/` once host startup had a tested replacement (`plugins/hosts/test/host-launcher.test.ts`, `scripts/check-host-startup.mjs`).
- Keep at least one supported host startup path working after every phase.
- Prefer compatibility bridge scripts over duplicated runtime code.
- Remove bridge scripts once host packages use the new runtime root directly.

## Decisions To Make Before Moving Runtime Files

- Whether published host plugins include the full runtime source tree or a built runtime artifact.
- Whether production startup runs TypeScript source with Node strip-types or built JavaScript from `dist`.
- Where built UI assets are copied for host/plugin packaging.
- How first-run dependency installation works from the new root.
- How plugin version reporting works when one runtime is shared by multiple hosts.
- Whether `plugins/codex` and `plugins/copilot` are moved physically or bridged to `plugins/hosts/*` first.

## Packaging Checks

Checks that guard the runtime/host split:

- Claude Code host can start or reuse the server.
- Codex host can start or reuse the server.
- Standalone CLI can start the server.
- Server can serve UI assets from the new location.
- `/alive` and `/healthz` report expected version/runtime metadata.
- First-run install failure gives a useful manual recovery command.
