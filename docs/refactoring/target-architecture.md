# AgentBoard Target Architecture

AgentBoard should become an agent-agnostic orchestration engine with a clean board UI, pluggable AI runtimes, Markdown-defined AI behaviour and explicit infrastructure adapters.

## Product Areas

```text
apps/ui       Human-facing board UI
packages/engine
              Domain, workflow and application orchestration
packages/contracts
              Public HTTP/MCP/event DTOs and schemas
packages/infrastructure
              SQLite, filesystem, workspace, logging, security and trackers
packages/plugin-sdk
              Plugin author contracts, registration helpers and test utilities
plugins/providers
              Claude, Codex, Copilot and future provider runtimes
plugins/hosts
              Claude Code, Codex, Copilot and future host integrations
ai            Built-in Markdown AI assets
server        HTTP/MCP bootstrap and adapters
docs          Architecture, ADRs and contribution docs
```

## Dependency Rules

- Engine domain depends on no UI, server, infrastructure or provider implementation.
- Engine application depends on Engine domain and provider-neutral ports.
- Infrastructure depends on Engine ports and implements them.
- Provider plugins implement provider runtime contracts; Engine never imports provider plugins.
- Host plugins launch or integrate AgentBoard; they do not own Engine business logic.
- UI uses typed API clients/contracts; it does not import persistence or provider runtime code.
- Built-in AI assets are Markdown source data, not executable code.

## Contract Ownership

Avoid duplicate provider contracts.

- Engine owns the provider-neutral execution port required by orchestration.
- `plugin-sdk` exposes plugin author APIs, metadata, registration helpers and shared contract test utilities.
- `plugin-sdk` may re-export Engine contract types, but must not fork them.

## Provider Model

Provider IDs must be extensible string identifiers validated against a registry.

Provider metadata should provide:

- display name;
- capabilities;
- availability/auth checks;
- runtime factory;
- supported session/resume behaviour;
- environment requirements;
- resource/cancellation behaviour;
- usage normalization;
- provider-specific error mapping.

Adding a provider such as Gemini should not require Engine business logic changes or SQLite provider enum changes.

## Orchestration Shape

The current executor should be decomposed by responsibility:

- run scheduling and claiming;
- role/provider config resolution;
- prompt preparation;
- workspace lifecycle;
- provider runtime invocation;
- heartbeat/liveness;
- run lifecycle recording;
- activity/event emission;
- retry coordination;
- postflight verification;
- cost recording;
- session recording.

The top-level use case should read as orchestration of these services rather than as implementation detail.

## Persistence Shape

SQLite remains the local persistence engine unless a future product requirement changes it.

Persistence should move behind repository ports:

```text
packages/infrastructure/src/persistence/sqlite/
  connection/
  migrations/
  repositories/
  schema/
```

Domain/application tests should not require SQLite. SQLite tests should use isolated temporary DBs and realistic migration fixtures where practical.

## Server Shape

HTTP/MCP code should be a thin adapter:

1. parse request;
2. validate transport data;
3. call application use case;
4. map result;
5. return response.

Bootstrap/composition should be explicit:

```text
server/src/bootstrap/
  compose-app.ts
  start-http-server.ts
  start-background-workers.ts
```

Long-lived workers should not be hidden inside route modules.

## AI Asset Shape

Built-in AgentBoard AI assets move to:

```text
ai/
  roles/
  personas/
  skills/
  concerns/
  phases/
  fragments/
```

The `/ai` directory is Markdown-only for AgentBoard-owned assets.

Infrastructure loaders may continue reading external project/user formats, such as `.claude/skills` or `.agentboard/concerns/*.json`, then normalize them into typed catalogs.

## UI Shape

The UI moves to `apps/ui` and remains presentation-only.

It should:

- render typed API data;
- send user intents through typed API clients;
- keep server state separate from local UI state;
- show explicit loading, empty, error and disconnected states;
- avoid workflow/provider/persistence implementation logic.

## Release and Compatibility Stance

Compatibility is best-effort. Preserve existing data and public behaviours where reasonable, but do not compromise the target architecture for permanent legacy shims.

For old mechanisms that are intentionally removed:

- document the change;
- provide replacement guidance;
- protect persisted data with backups where practical;
- add tests for the new path.
