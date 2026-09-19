# AgentBoard Current State

Phase 0 inventory for the architecture refactor.

## Git Baseline

- Refactor branch: `refactor/agentboard-architecture-v2`
- Base branch: `main`
- Remote checked before branch creation: `origin`
- Starting worktree state: clean

## Runtime Shape

AgentBoard is currently structured as a plugin-centric repository.

- There is no root `package.json`.
- The main runnable package is `plugins/claude-code/agent-board-core`.
- The React UI is nested inside `plugins/claude-code/agent-board-core/ui`.
- Claude Code, Codex and Copilot host/plugin wrappers live under `plugins/`.
- Codex currently delegates server startup to the Claude Code plugin's shared core.

Primary package:

```text
plugins/claude-code/agent-board-core/
  server.ts
  src/
  db/schema.sql
  prompts/
  concerns/
  test/
  ui/
```

Current host/plugin wrappers:

```text
plugins/claude-code/
plugins/codex/
plugins/copilot/
```

## Current Quality Baseline

Environment:

- Node: `v22.20.0`
- npm: `11.3.0`

Commands run from `plugins/claude-code/agent-board-core`:

| Command                | Result | Notes                               |
| ---------------------- | ------ | ----------------------------------- |
| `npm run typecheck`    | Pass   | `tsc --noEmit -p src/tsconfig.json` |
| `npm run test`         | Pass   | 30 test files, 246 tests            |
| `npm run build`        | Pass   | Server typecheck plus UI Vite build |
| `npm run lint`         | Fail   | 24 existing lint errors             |
| `npm run format:check` | Fail   | 24 existing formatting warnings     |

Build warnings:

- Vite reports deprecated `esbuild`/`optimizeDeps.esbuildOptions` options from the React plugin path.

Lint failure categories:

- import ordering;
- `eqeqeq`;
- unnecessary type assertions;
- non-null assertion style;
- consistent type imports;
- confusing void expression;
- unnecessary conditionals.

Format check reports existing Prettier drift in server, source, tests and `ui/src/api.ts`.

## Module Inventory

### Bootstrap and Server

- `plugins/claude-code/agent-board-core/server.ts` starts the HTTP server, serves UI assets, applies localhost/auth/CSP checks, routes REST/MCP, starts executor, tracker poller and skill scan workers.

### API and MCP

- `src/api-mcp.ts` contains JSON-RPC MCP tool definitions and handlers for run/task/phase/skill/concern operations.
- `src/api-tasks.ts` handles task CRUD, dispatch, retry, cancel, comments, transitions and task/run cost surfaces.
- `src/api-projects.ts` handles project CRUD/switching, repo path validation, project config and skill scan triggers.
- `src/api-skills.ts` handles skill CRUD, scan triggering, scan status and safe path handling.
- `src/api-sessions.ts` reads session SQLite/log locations and exposes session APIs.
- `src/api-activity.ts` exposes activity history and SSE.
- `src/api-tracker.ts`, `src/api-costs.ts`, `src/api-prompts.ts`, `src/api-logs.ts`, `src/api-doctor.ts`, `src/api-health-summary.ts`, `src/api-audit.ts` expose smaller API surfaces.

### Persistence

- `src/db.ts` owns SQLite adapter loading, schema loading and migrations.
- `src/repo.ts` owns broad project/task/run/comment persistence plus queue and transition operations.
- `src/phase-repo.ts` owns phase state/history, debt and activity persistence.
- `src/skill-repo.ts` owns skill and skill-scan persistence.
- `src/project-registry.ts` owns project DB cache/open/close lookup.

### Orchestration

- `src/executor.ts` is the main queue draining and run execution path. It resolves provider config, prepares prompts, configures MCP, manages workspace hooks, starts providers, records sessions/cost/activity, handles postflight and schedules retries.
- `src/council-runner.ts` executes multi-provider council runs.
- `src/phase-machine.ts`, `src/state-machine.ts`, `src/postflight.ts`, `src/retry-manager.ts`, `src/rate-limit-tracker.ts`, `src/turn-timeout.ts`, `src/supervisor.ts` contain workflow/runtime rules and resilience helpers.

### Provider Runtime

- `src/provider-runtime.ts` defines the current provider runtime context/result types.
- `src/provider-registry.ts` wires Claude, Codex and Copilot adapters directly.
- `src/agent-runner.ts` contains Claude Agent SDK execution.
- `src/codex-runner.ts` contains Codex CLI/process execution.
- `src/copilot-runner.ts` contains Copilot SDK/CLI execution.
- `src/agent-config.ts` parses and resolves role/provider configuration.
- `src/codex-config.ts`, `src/child-env.ts`, `src/run-hooks.ts`, `src/tool-allowlist.ts`, `src/user-mcps.ts` contain provider and host-specific runtime support.

### AI Assets, Prompts, Skills and Concerns

- `prompts/*.md` are role/council prompts.
- `concerns/*.json` are built-in concern packs.
- `src/builtin-skills.ts` embeds built-in skill Markdown in TypeScript.
- `src/prompt-builder.ts` assembles role/system prompts with task/project/comment/skill context.
- `src/skill-scanner.ts`, `src/skill-scan-worker.ts`, `src/skill-scan-runtime.ts`, `src/skill-repo.ts` implement project skill discovery and indexing.
- Project-scoped skills are discovered from `.claude/skills`.
- Project-scoped concern overrides are loaded from `.agentboard/concerns/*.json`.

### Trackers

- `src/trackers/github.ts`, `src/trackers/gitlab.ts`, `src/trackers/linear.ts`, `src/trackers/memory.ts`, `src/trackers/index.ts`, `src/trackers/tracker.ts` implement tracker adapters.
- `src/tracker-poller.ts` owns background tracker sync.

### UI

- UI package: `plugins/claude-code/agent-board-core/ui`.
- Main client API file: `ui/src/api.ts`.
- Main app shell/routes: `ui/src/App.tsx`, `ui/src/main.tsx`, `ui/src/components/AppShell.tsx`.
- Feature/page areas include board, projects, roles, personas, skills, sessions and themes.
- UI currently contains hard-coded provider labels/options and resume command logic.

## Largest Source Files

| File                   | Lines | Concern                                                                               |
| ---------------------- | ----: | ------------------------------------------------------------------------------------- |
| `src/api-mcp.ts`       |   818 | MCP transport, tool definitions, auth, workflow, persistence and AI asset use         |
| `src/repo.ts`          |   567 | Persistence plus queue/domain transition semantics                                    |
| `src/executor.ts`      |   562 | Scheduler, runtime orchestration, prompts, providers, workspace, logging, cost, retry |
| `src/api-tasks.ts`     |   472 | Task/run API plus workflow dispatch                                                   |
| `src/api-skills.ts`    |   445 | Skill API, filesystem safety and scan lifecycle                                       |
| `src/api-sessions.ts`  |   432 | Session API plus direct session DB/log enrichment                                     |
| `src/skill-scanner.ts` |   426 | Filesystem traversal, parsing and normalization                                       |
| `src/codex-runner.ts`  |   404 | Codex provider runtime                                                                |
| `src/db.ts`            |   393 | SQLite adapter and migrations                                                         |
| `src/api-projects.ts`  |   383 | Project API, validation and scan integration                                          |

## Existing Test Coverage

Current Vitest coverage is useful but not yet layered by the target architecture.

Test areas:

- API/MCP: `api-mcp-use-skill`, `api-projects-triggers`, `api-skills`
- Providers/runtime: `codex-config`, `copilot-runner`, `executor-copilot`, `provider-registry`, `provider-runtime`
- Workflow/phase: `discovery-modes`, `phase-machine`, `phase-repo`, `postflight-phase-gate`, `state-machine`
- Skills: `skill-repo`, `skill-scanner`, `skill-scan-worker`, `skills-tree`
- Runtime resilience: `event-bus`, `rate-limit-tracker`, `retry-manager`, `run-hooks`, `supervisor`, `turn-timeout`
- Prompt/config/utilities: `concerns`, `folder-rules`, `prompt-builder`, `tracker-factory`, `string-distance`
- Workspace: `workspace-manager`, `workspace-safety`

No Playwright suite was found.

## Immediate Architecture Risks

- Provider IDs are hard-coded in TypeScript unions, validation schemas, API handlers, UI controls and SQLite `CHECK` constraints.
- Engine-like domain logic is mixed into HTTP handlers, MCP handlers and persistence modules.
- Provider runtime logic is currently inside the core package rather than provider plugins.
- Host plugin startup relies on the current `plugins/claude-code/agent-board-core` location.
- Built-in AI assets are split across Markdown, JSON and TypeScript strings.
- Security-sensitive env allow-listing is global instead of provider/host scoped.
- Server bootstrap mixes static UI serving, HTTP routing and long-lived background workers.
