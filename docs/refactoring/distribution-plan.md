# Distribution Plan

Phase 1 distribution notes for moving from the current plugin-vendored runtime to the target monorepo layout.

## Current Distribution

- The runnable server, executor, DB schema, prompts, concerns and UI are vendored under `plugins/claude-code/agent-board-core`.
- `plugins/claude-code/bin/ensure-server.ts` starts or reuses the shared local server.
- `plugins/codex/bin/ensure-server.ts` delegates to the Claude Code plugin's `ensure-server.ts`.
- First run installs core dependencies in place with npm or Bun if `node_modules` is missing.
- The server serves `agent-board-core/ui/dist`.
- Standalone launch uses `plugins/claude-code/agent-board-core/bin/agentboard.ts`.

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

- Do not move `agent-board-core` until host startup has a tested replacement path.
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

Before moving files out of `agent-board-core`, add checks for:

- Claude Code host can start or reuse the server.
- Codex host can start or reuse the server.
- Standalone CLI can start the server.
- Server can serve UI assets from the new location.
- `/alive` and `/healthz` report expected version/runtime metadata.
- First-run install failure gives a useful manual recovery command.
