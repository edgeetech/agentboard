# AgentBoard Migration Map

Initial Phase 0 map from current modules to intended destinations. This is a working map, not a final API design.

## Top-Level Structure

| Current                                          | Target                                          | Notes                                                                 |
| ------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------- |
| `plugins/claude-code/agent-board-core/ui`        | `apps/ui`                                       | Move UI package after typed contracts/API client are stable.          |
| `plugins/claude-code/agent-board-core/server.ts` | `server/src/bootstrap` and `server/src/http`    | Split bootstrap, static UI serving, auth, routing and worker startup. |
| `plugins/claude-code/agent-board-core/src`       | `packages/*`, `server/*`, `plugins/providers/*` | Use strangler migration, not a single bulk move.                      |
| `plugins/claude-code`                            | `plugins/hosts/claude-code`                     | Host integration, not provider runtime.                               |
| `plugins/codex`                                  | `plugins/hosts/codex`                           | Current launcher/host wrapper delegates to Claude plugin core.        |
| `plugins/copilot`                                | `plugins/hosts/copilot`                         | Current installer/hook integration.                                   |
| `prompts`, `concerns`, `src/builtin-skills.ts`   | `ai/*` plus loaders                             | Built-ins become Markdown assets.                                     |

## Engine Candidates

| Current                  | Target                                                        | Notes                                                                      |
| ------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/types.ts`           | `packages/engine/src/domain`                                  | Split domain status/phase/role types from provider IDs.                    |
| `src/state-machine.ts`   | `packages/engine/src/workflows`                               | Pure task workflow transition rules.                                       |
| `src/phase-machine.ts`   | `packages/engine/src/workflows` or `packages/engine/src/runs` | Pure phase rules and tool policy.                                          |
| `src/postflight.ts`      | `packages/engine/src/runs`                                    | Postflight/phase gate rules.                                               |
| `src/retry-manager.ts`   | `packages/engine/src/runs`                                    | Pure retry policy plus application scheduler integration.                  |
| `src/discovery-modes.ts` | `packages/engine/src/workflows`                               | Provider-neutral discovery mode definitions.                               |
| `src/pricing.ts`         | `packages/engine/src/costs` plus pricing port                 | Keep aggregation/model generic; move provider model tables behind catalog. |
| `src/agent-config.ts`    | `packages/engine/src/configuration`                           | Replace closed provider enum with registry-backed provider ID.             |

## Application/Orchestration Candidates

| Current                    | Target                                                               | Notes                                                                       |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/executor.ts`          | `packages/engine/src/application/runs` plus `server/src/workers`     | Decompose scheduler, coordinator, heartbeat, retry, cost/session recording. |
| `src/council-runner.ts`    | `packages/engine/src/orchestration`                                  | Keep council logic provider-neutral.                                        |
| `src/provider-runtime.ts`  | `packages/engine/src/ports` and re-export from `packages/plugin-sdk` | Avoid duplicated contracts.                                                 |
| `src/provider-registry.ts` | composition root plus `packages/plugin-sdk/src/registry`             | Engine should receive registry via port/composition.                        |
| `src/prompt-builder.ts`    | `packages/engine/src/application/prompts`                            | Consume typed AI catalogs; no filesystem reads.                             |

## Infrastructure Candidates

| Current                    | Target                                                                       | Notes                                               |
| -------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `src/db.ts`                | `packages/infrastructure/src/persistence/sqlite/connection` and `migrations` | Keep SQLite local.                                  |
| `src/repo.ts`              | `packages/infrastructure/src/persistence/sqlite/repositories`                | Remove domain decisions where possible.             |
| `src/phase-repo.ts`        | `packages/infrastructure/src/persistence/sqlite/repositories`                | Implements Engine phase/activity ports.             |
| `src/skill-repo.ts`        | `packages/infrastructure/src/persistence/sqlite/repositories`                | Skill catalog persistence adapter.                  |
| `src/project-registry.ts`  | `packages/infrastructure/src/persistence/sqlite/project-dbs`                 | DB cache/open lifecycle.                            |
| `src/paths.ts`             | `packages/infrastructure/src/filesystem`                                     | Data dir/config/log path resolution.                |
| `src/workspace-manager.ts` | `packages/infrastructure/src/workspace`                                      | Filesystem/process workspace lifecycle.             |
| `src/session-logger.ts`    | `packages/infrastructure/src/logging`                                        | JSONL session logs.                                 |
| `src/child-env.ts`         | `packages/infrastructure/src/security` plus provider/host metadata           | Shared env allow-list utilities only.               |
| `src/trackers/*`           | `packages/infrastructure/src/tracker/*`                                      | Tracker adapters implementing Engine tracker ports. |
| `src/tracker-poller.ts`    | `server/src/workers` plus infrastructure tracker ports                       | Background worker.                                  |

## Provider Plugin Candidates

| Current                                   | Target                                         | Notes                                      |
| ----------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| `src/agent-runner.ts`                     | `plugins/providers/claude/src`                 | Claude SDK runtime.                        |
| `src/run-hooks.ts`                        | `plugins/providers/claude/src` or host bridge  | Claude SDK hook shape and callback wiring. |
| `src/provider-registry.ts` Claude adapter | `plugins/providers/claude/src/plugin.ts`       | Runtime factory and metadata.              |
| `src/codex-runner.ts`                     | `plugins/providers/codex/src`                  | Codex CLI runtime.                         |
| `src/codex-config.ts`                     | `plugins/providers/codex/src` plus host bridge | Codex config and MCP bridge details.       |
| `src/copilot-runner.ts`                   | `plugins/providers/copilot/src`                | Copilot runtime.                           |
| `src/provider-runtime.ts` resume helper   | provider plugin metadata                       | Resume commands should be provider-owned.  |

## Server/API Candidates

| Current                                    | Target                                                       | Notes                                                  |
| ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------ |
| `src/api-mcp.ts`                           | `server/src/mcp` plus Engine use cases                       | Split tool schemas/transport from domain mutations.    |
| `src/api-projects.ts`                      | `server/src/api/projects`                                    | Handler should call project use cases.                 |
| `src/api-tasks.ts`                         | `server/src/api/tasks`                                       | Handler should call task/run use cases.                |
| `src/api-skills.ts`                        | `server/src/api/skills`                                      | Handler should call skill catalog services.            |
| `src/api-sessions.ts`                      | `server/src/api/sessions` plus infrastructure session reader | Remove direct cross-location DB logic from handler.    |
| `src/api-activity.ts`                      | `server/src/sse` plus Engine events                          | Keep SSE transport separate from activity persistence. |
| `src/api-tracker.ts`                       | `server/src/api/tracker`                                     | Adapter to tracker application service.                |
| `src/http-util.ts`, `src/rest-dispatch.ts` | `server/src/http`                                            | Transport utilities.                                   |

## Contracts Candidates

| Current                                                               | Target                          | Notes                         |
| --------------------------------------------------------------------- | ------------------------------- | ----------------------------- |
| UI API types in `ui/src/api.ts`                                       | `packages/contracts/src/api`    | Shared DTOs/schemas.          |
| MCP tool schemas in `src/api-mcp.ts`                                  | `packages/contracts/src/mcp`    | Shared public MCP contract.   |
| Event/activity payloads in `src/api-activity.ts`, `src/phase-repo.ts` | `packages/contracts/src/events` | Shared SSE/activity contract. |

## AI Asset Candidates

| Current                 | Target                                     | Notes                                             |
| ----------------------- | ------------------------------------------ | ------------------------------------------------- |
| `prompts/pm.md`         | `ai/roles/project-manager.md`              | Keep prompt semantics through snapshot tests.     |
| `prompts/worker.md`     | `ai/roles/worker.md`                       | Keep prompt semantics through snapshot tests.     |
| `prompts/reviewer.md`   | `ai/roles/reviewer.md`                     | Keep prompt semantics through snapshot tests.     |
| `prompts/council.md`    | `ai/fragments/council.md` or `ai/personas` | Decide based on final catalog model.              |
| `concerns/*.json`       | `ai/concerns/*.md`                         | Define Markdown concern schema before conversion. |
| `src/builtin-skills.ts` | `ai/skills/*/SKILL.md`                     | Built-ins become files, not TypeScript strings.   |

## First Extraction Order

1. Add workspace/package skeleton and architecture tests without moving runtime paths.
2. Extract pure workflow/domain functions and tests.
3. Introduce persistence ports and SQLite adapters.
4. Introduce provider runtime contract and fake provider.
5. Move provider implementations one at a time.
6. Move built-in AI assets after schema/loader tests exist.
7. Thin API/MCP handlers.
8. Move UI after contracts are stable.

## Known Open Decisions

- Whether provider ID `github_copilot` remains as persisted/public value or migrates to `copilot`.
- Whether the server runs source TypeScript in production packages or builds to JavaScript.
- Whether plugin marketplace packages contain the full monorepo artifact or a packaged runtime subset.
- Whether concern Markdown uses structured headings only or frontmatter plus body sections.
- Which public HTTP routes need formal versioning versus remaining internal UI routes.
