# AgentBoard Compatibility Surfaces

Compatibility is best-effort for this refactor. Preserve behaviour where reasonable, but prefer the target architecture over permanent legacy shims. Never silently destroy persisted data.

## Local Data

Current local data lives outside the repository, normally under:

```text
~/.agentboard/
  projects/<code>.db
  logs/
  run-configs/
  trash/
  config.json
  server.lock
```

Important persisted surfaces:

- per-project SQLite DBs;
- project/task/run/comment/history/activity rows;
- skill scan index and scan status;
- tracker configuration and poll state;
- run logs and session references;
- `config.json` server token/port/active project fields.

## SQLite Schema

Current schema and migrations live in:

```text
plugins/claude-code/agent-board-core/db/schema.sql
plugins/claude-code/agent-board-core/src/db.ts
```

Known provider-specific schema issues:

- `project.agent_provider` has a provider enum `CHECK`.
- `task.agent_provider_override` has a provider enum `CHECK`.
- `agent_run.session_provider` and `agent_run.session_provider_override` have provider enum `CHECK`s.
- `agent_run.claude_session_id` remains for legacy compatibility.

Migration direction:

- move schema/migrations to `packages/infrastructure/src/persistence/sqlite`;
- use extensible provider IDs rather than closed SQLite enum checks;
- create backup/restore tests for destructive changes;
- use realistic fixtures where practical.

## HTTP API

Public HTTP surfaces are routed from `server.ts` and handlers under `src/api-*.ts`.

Current versioning status:

- REST routes under `/api` are the current unversioned legacy surface.
- `/mcp` is the current unversioned HTTP MCP surface.
- `plugins/claude-code/mcp/agentboard.mjs` is the current unversioned stdio MCP host-plugin surface.
- `packages/contracts/src/versioning.ts` records these current surfaces and shared deprecation metadata types.
- No surface is deprecated as of this refactor checkpoint.

Observed surfaces:

- `GET /alive`
- `GET /healthz`
- `POST /mcp`
- UI static assets and SPA fallback
- project APIs under `/api/projects`
- task/run APIs under `/api/tasks`
- run activity APIs under `/api/runs/:id/events` and `/api/runs/:id/activity`
- active state/activity APIs under `/api/projects/active-states` and `/api/tasks/:id/activity`
- skills APIs under `/api/skills`
- sessions APIs under `/api/sessions`
- tracker APIs under `/api/tracker`
- costs APIs under `/api/costs`
- prompts/logs/doctor/health/audit APIs

Important behaviours:

- localhost and host-header protections;
- bearer auth and cookie auth for selected browser log links;
- CORS limited to local origins;
- CSP nonce and token injection for UI;
- JSON error shapes consumed by UI and host tools.

Versioning and deprecation policy:

- Introduce new incompatible HTTP surfaces behind an explicit version namespace or version header before removing old routes.
- Keep old unversioned routes available until a release notes entry, migration note and rollback path exist.
- Use `Deprecation` and `Sunset` metadata only after the replacement surface exists and is validated.
- MCP protocol version changes must update the shared contracts package before runtime handlers are migrated.

## HTTP MCP (`abrun`)

Current run-facing MCP endpoint:

```text
POST /mcp
```

Current tool names:

- `list_queue`
- `claim_run`
- `get_task`
- `update_task`
- `add_comment`
- `finish_run`
- `add_heartbeat`
- `get_project`
- `next`
- `advance`
- `record_debt`
- `resolve_debt`
- `use_skill`
- `record_tool`

Important behaviours:

- server bearer auth;
- per-run `run_token` authorization for mutations;
- phase/tool policy enforcement;
- postflight checks;
- skill lookup and fuzzy suggestions;
- concern and folder-rule slices in phase payloads.

## Host Plugin MCP

Claude Code stdio MCP:

```text
plugins/claude-code/mcp/agentboard.mjs
```

Observed tool names:

- `list_projects`
- `get_board`
- `get_task`
- `list_comments`
- `list_runs`
- `approve_task`
- `reject_task`
- `dispatch_task`
- `server_status`

The current dispatch schema hard-codes provider enum values. This should move to registry-backed provider metadata.

## Host Startup and Packaging

Current startup paths:

- `plugins/claude-code/bin/ensure-server.ts`
- `plugins/codex/bin/ensure-server.ts`
- `plugins/claude-code/skills/open/SKILL.md`
- `plugins/claude-code/agent-board-core/bin/agentboard.ts`

Current behaviour:

- Claude Code starts or reuses the shared local server.
- Codex delegates to the Claude Code plugin's `ensure-server.ts` and shared `agent-board-core`.
- First run can install core dependencies in place with npm or Bun.
- Server spawns detached with Node and `--experimental-sqlite`.

Migration risk:

- moving the core package will break host launchers unless a distribution plan updates these paths.

## Provider Configuration

Current provider IDs:

- `claude`
- `github_copilot`
- `codex`

Known hard-coded areas:

- `src/types.ts`
- `src/agent-config.ts`
- `src/provider-registry.ts`
- `src/provider-runtime.ts`
- `src/api-projects.ts`
- `src/api-tasks.ts`
- `src/api-sessions.ts`
- `db/schema.sql`
- `src/db.ts`
- UI provider selectors and resume command generation

Target:

- provider IDs are strings validated against the provider registry;
- provider metadata drives labels, availability, capabilities and resume commands;
- adding a provider does not require Engine business logic changes or SQLite enum changes.

## AI Asset Compatibility

Built-in AgentBoard assets:

- role/council prompts in `prompts/*.md`;
- concern packs in `concerns/*.json`;
- built-in skills in `src/builtin-skills.ts`.

Project/user assets:

- skills from `.claude/skills`;
- concern overrides from `.agentboard/concerns/*.json`.

Target:

- built-in AgentBoard AI assets move to `/ai` as Markdown;
- project/user legacy formats can remain supported by infrastructure loaders where practical;
- Engine consumes normalized typed assets only.

## Security Surfaces

Preserve or intentionally replace with equal-or-better controls:

- localhost binding;
- DNS rebinding/host-header guard;
- bearer server token;
- per-run tokens;
- env allow-listing;
- cwd/workspace validation;
- static asset path containment;
- log path validation;
- CSP nonce and HttpOnly cookie behaviour.

## Best-Effort Break Policy

If an old surface is removed:

1. document the replacement;
2. add release notes;
3. preserve data through backup/restore where practical;
4. add tests for the new path.
