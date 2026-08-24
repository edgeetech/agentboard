# Refactoring Progress

## Phase 0

Status: Complete for initial implementation baseline.

Moved / Added:

- Added `docs/refactoring/current-state.md`.
- Added `docs/refactoring/compatibility-surfaces.md`.
- Added `docs/refactoring/target-architecture.md`.
- Added `docs/refactoring/migration-map.md`.

Behaviour preserved:

- No runtime source paths were moved.
- Existing core package remains under `plugins/claude-code/agent-board-core`.
- Existing host plugin startup paths were not changed.

Tests added/updated:

- No tests added in Phase 0.
- Existing test inventory recorded.

Architecture improvements:

- Current module responsibilities documented.
- Public compatibility surfaces documented.
- Initial migration map documented.
- Target architecture boundaries documented.

Compatibility concerns:

- Provider IDs are hard-coded in TypeScript, API validation, UI controls and SQLite checks.
- Codex startup currently depends on the Claude Code plugin's shared core path.
- Built-in AI assets are split across Markdown, JSON and TypeScript strings.

Remaining follow-ups:

- Add Playwright characterization suite.
- Add API/MCP contract snapshots.
- Add realistic SQLite fixture migration check.

Quality checks:

- lint: failed at baseline with 24 existing errors.
- typecheck: passed.
- unit: passed, 30 files / 246 tests.
- integration: covered by current Vitest mix; no separate command yet.
- e2e: not present.
- build: passed.

## Phase 1

Status: Initial workspace/package skeleton complete.

Moved / Added:

- Added root `package.json`.
- Added root `tsconfig.base.json` and `tsconfig.json`.
- Added target package scaffolds for `apps/ui`, `packages/engine`, `packages/contracts`, `packages/infrastructure`, `packages/plugin-sdk`, `server` and provider plugin packages.
- Added `plugins/hosts/README.md` and `plugins/providers/README.md`.
- Added `scripts/check-architecture.mjs`.
- Added `docs/refactoring/distribution-plan.md`.

Behaviour preserved:

- Current runtime package remains untouched.
- Root scripts delegate to the existing core package for current checks.
- No plugin launch paths were changed.

Tests added/updated:

- Added `npm run test:architecture`.

Architecture improvements:

- Target package boundaries now exist in the repository tree.
- Architecture boundary checks are executable.
- Architecture boundary checks now cover contracts, infrastructure, plugin-sdk and provider package imports.
- Distribution risk is documented before runtime file moves.

Compatibility concerns:

- Root `npm run check` still delegates to the existing core check, which fails because existing lint/format baselines fail.
- Target packages are scaffolds only; runtime still lives in the old core path.

Remaining follow-ups:

- Expand architecture checks as code moves.
- Decide source TypeScript versus built JavaScript packaging.
- Add host startup smoke tests before moving runtime files.

Quality checks:

- lint: existing core lint still fails at baseline.
- typecheck: passed through root `npm run typecheck`.
- unit: passed through root `npm run test`.
- integration: no separate command yet.
- e2e: placeholder only.
- build: baseline core build passed before Phase 1; not rerun after Phase 1 scaffolding.

## Phase 2

Status: In progress with provider-free policy extractions.

Moved / Added:

- Added provider-free Engine domain types in `packages/engine/src/domain/types.ts`.
- Added task workflow rules in `packages/engine/src/workflows/task-state.ts`.
- Added run phase rules in `packages/engine/src/workflows/run-phase.ts`.
- Added Engine workflow exports.
- Added Engine workflow tests.
- Added retry policy extraction in `packages/engine/src/runs/retry-policy.ts`.
- Added provider/config precedence extraction in `packages/engine/src/configuration/agent-config.ts`.
- Added rate-limit policy extraction in `packages/engine/src/runs/rate-limit-policy.ts`.

Behaviour preserved:

- Existing runtime imports current `src/state-machine.ts`, which now adapts to Engine task workflow policy.
- Existing runtime imports current `src/phase-machine.ts`, which now adapts to Engine phase policy.
- Existing runtime imports current `src/rate-limit-tracker.ts`, which now adapts to Engine `RateLimitPolicy`.
- Runtime callers still use legacy module paths while delegated policy lives in Engine.

Tests added/updated:

- Added `plugins/claude-code/agent-board-core/test/agent-config.test.ts`.
- Added `packages/engine/test/task-state.test.ts`.
- Added `packages/engine/test/run-phase.test.ts`.
- Added `packages/engine/test/retry-policy.test.ts`.
- Added `packages/engine/test/agent-config.test.ts`.
- Added `packages/engine/test/rate-limit-policy.test.ts`.
- Added root `test:engine` and `typecheck:engine` scripts.
- Root `npm run test` now runs existing core tests plus Engine tests.

Architecture improvements:

- Workflow and phase rules now exist in provider-free Engine code.
- Retry, config precedence and rate-limit rules now exist in provider-free Engine code.
- Legacy state-machine callers now consume Engine task workflow policy through a compatibility adapter.
- Legacy phase-machine callers now consume Engine phase policy through a compatibility adapter.
- Legacy rate-limit callers now consume Engine policy through a compatibility adapter.
- Legacy retry scheduling now consumes Engine retry decisions while retaining local DB/timer side effects.
- Legacy role config resolution now consumes Engine config precedence while retaining legacy parsing validation.
- Engine package typechecks independently.
- Engine tests run without SQLite, HTTP, browser, filesystem workspace or provider SDKs.

Compatibility concerns:

- Core TypeScript `rootDir` is temporarily widened so the legacy package can typecheck Engine source imports before package distribution is finalized.
- A later phase must replace relative Engine source imports with packaged workspace imports once distribution is finalized.
- Legacy runtime modules keep packaging-safe local compatibility mirrors of extracted Engine policy until plugin distribution includes repo-root packages.

Remaining follow-ups:

- Switch extracted policies into the current runtime behind focused compatibility tests.
- Add architecture tests preventing provider-specific imports in Engine as files move.
- Switch existing runtime to use Engine workflow modules after contracts stabilize.

Quality checks:

- lint: not rerun globally; existing baseline still fails.
- typecheck: passed through root `npm run typecheck`.
- unit: passed through root `npm run test`, 33 existing files / 258 tests plus 5 Engine files / 41 tests.
- integration: no separate command yet.
- e2e: placeholder only.
- build: not rerun after Phase 2 extraction.

## Phase 3

Status: Initial persistence port seam complete.

Moved / Added:

- Added Engine persistence record and repository port types in `packages/engine/src/ports/persistence.ts`.
- Added Infrastructure SQLite connection/factory port types in `packages/infrastructure/src/persistence/sqlite/connection.ts`.
- Exported persistence ports from Engine and Infrastructure package entry points.
- Added root `typecheck:infrastructure` and included it in `npm run typecheck`.

Behaviour preserved:

- Legacy SQLite implementation remains under `plugins/claude-code/agent-board-core/src`.
- No repository calls or database files were moved in this chunk.

Architecture improvements:

- Engine now has provider-neutral repository interfaces for projects, tasks, runs and comments.
- Infrastructure now has a SQLite adapter contract target before legacy DB code is moved.
- Provider identity uses Engine's existing extensible `ProviderId` type instead of adding hard-coded provider unions.

Quality checks:

- engine typecheck: passed.
- infrastructure typecheck: passed.

Follow-up additions:

- Added `createInMemoryPersistence` as a strict Engine persistence-port contract adapter.
- Added in-memory persistence tests covering project CAS updates, task creation/transition, run queue/finish and comments.
- Engine tests now cover persistence ports without SQLite or legacy runtime imports.
- Added `createSqlitePersistence` in Infrastructure as the first SQLite adapter behind Engine persistence ports.
- Added Infrastructure SQLite repository tests covering project CAS updates, task creation/transition history, run queue/finish and comments.
- Root `npm run test` now includes Infrastructure adapter tests.
- Added offline SQLite backup/restore helpers and tests for migration rollback preparation.

## Governance

Status: Initial repository governance scaffolding complete.

Moved / Added:

- Added `.github/CODEOWNERS`.
- Added `.github/PULL_REQUEST_TEMPLATE.md`.
- Added `CONTRIBUTING.md`.
- Added `CHANGELOG.md`.
- Added `docs/release-checklist.md`.

Behaviour preserved:

- No runtime code changed.
- No package scripts changed.

Architecture improvements:

- PRs now have explicit validation and refactor-safety prompts.
- Meaningful phase/chunk commit policy is documented.
- Release checklist captures migration, rollback, provider and packaging checks.

Quality checks:

- formatting: passed for touched governance files.

## Migration Verification

Status: Initial DB migration verification complete.

Moved / Added:

- Added `plugins/claude-code/agent-board-core/test/db-migrations.test.ts`.
- Updated provider CHECK table rebuild migrations in `plugins/claude-code/agent-board-core/src/db.ts`.

Behaviour preserved:

- Existing `openProjectDb` entry point is unchanged.
- Fresh schema still seeds `schema_version` 6.

Architecture improvements:

- Older project DBs are now migrated through a file-backed `openProjectDb` test.
- Migration idempotence is covered by reopening the same migrated DB.
- Provider CHECK rebuilds now preserve current project/task columns added by later migrations.

Quality checks:

- targeted db migration test: passed.
- typecheck: passed.

Follow-up fixes:

- Migration execution now suppresses only duplicate `ALTER TABLE ... ADD COLUMN` errors.
- Real schema/data migration failures now throw with migration context.
- Provider CHECK table rebuilds restore `PRAGMA foreign_keys=ON` in `finally`.
- `openProjectDb` closes the SQLite handle if schema or migration startup fails.
- Added invalid legacy provider data coverage to prove migration failures are not swallowed.
- Provider CHECK table rebuilds now run in a transaction and clean temporary tables after failed copies.
- Added core `npm run test:migrations`, root `npm run verify:db-migrations` and a named CI migration verification step.

## Contracts

Status: Initial MCP contract seam complete.

Moved / Added:

- Added `packages/contracts/src/mcp.ts`.
- Exported MCP contracts from `packages/contracts/src/index.ts`.
- Added root `typecheck:contracts` and included it in `npm run typecheck`.

Behaviour preserved:

- Runtime HTTP and MCP handlers are unchanged.
- UI API consumers are unchanged.

Architecture improvements:

- Current MCP protocol version is represented as a typed contract literal.
- JSON-RPC request/response, MCP initialize, tool definition and tool call result shapes now have a package boundary.
- Contracts package now participates in root typechecking.

Quality checks:

- contracts typecheck: passed.
- root typecheck: passed.

## Provider Runtime Limits

Status: Initial provider sandbox/resource contract complete.

Moved / Added:

- Added explicit `ProviderRuntimeLimits`, `ProviderSandboxPolicy` and `ProviderRuntimeEnforcement` contracts in `provider-runtime.ts`.
- Added `buildProviderRuntimePolicy` for deterministic context policy construction.
- Populated provider runtime limits/sandbox policy in `executor.ts`.
- Added provider enforcement declarations for Claude, Copilot and Codex adapters.
- Expanded provider runtime and registry tests.

Behaviour preserved:

- Provider execution behavior is unchanged.
- Current unsupported controls are declared as intentionally ignored rather than enforced.

Architecture improvements:

- Provider adapters now expose which controls they enforce versus ignore.
- Copilot `approveAll` and Codex disabled sandbox behavior are explicit in adapter metadata.
- Future sandbox/resource-limit work has a typed contract and test seam.

Quality checks:

- targeted provider tests: passed.
- root typecheck: passed.
- root test/build/architecture: passed.
- formatting: passed for provider/progress files; `executor.ts` not formatted to avoid baseline churn.

Follow-up fixes:

- Removed Codex `--dangerously-bypass-approvals-and-sandbox` launch flag.
- Codex now launches with `--sandbox workspace-write` and `--approve-for-me`.
- Added Codex launch argument regression coverage.
- Codex provider metadata now marks `approvalMode` intentionally ignored because the runner uses fixed approve-for-me automation.

## CI Enforcement

Status: Initial GitHub Actions validation workflow complete, with dependency-resolution compatibility fix.

Moved / Added:

- Added `.github/workflows/ci.yml`.

Behaviour preserved:

- No runtime code changed.
- Existing baseline lint/format commands are not added to CI yet because they currently fail.

Architecture improvements:

- Pull requests and pushes to `main`/`refactor/**` now run typecheck, unit tests, architecture checks and build.
- CI runs on Ubuntu and Windows with Node 22.x.
- CI installs with `--legacy-peer-deps` to match the current SDK/Zod dependency baseline until dependency modernization is handled separately.
- Added missing `apps/ui/tsconfig.json` scaffold required by root TypeScript references and fresh CI installs.
- CI installs the legacy core UI package before build so Vite plugin dependencies are available on fresh runners.

Quality checks:

- workflow syntax is static YAML only; local validation covered by existing root gate commands from the previous chunk.

## Observability

Status: Initial in-memory observability snapshot complete.

Moved / Added:

- Added `plugins/claude-code/agent-board-core/src/observability.ts`.
- Added `plugins/claude-code/agent-board-core/test/observability.test.ts`.
- Added SSE counters in `api-activity.ts`.
- Added run outcome, duration and retry counters in `executor.ts`.
- Added authenticated `/healthz` observability snapshot in `server.ts`.

Behaviour preserved:

- No database schema changes.
- No HTTP route shape changes except additional `/healthz.observability` fields.
- Metrics are process-local and best-effort.

Architecture improvements:

- Run lifecycle and SSE health now have a typed snapshot surface.
- Observability can evolve toward SLOs without coupling to persistence.

Quality checks:

- targeted observability test: passed.
- root typecheck: passed.

Follow-up fixes:

- Recorded terminal run outcomes when a provider returns after MCP `finish_run` already changed the DB row out of `running`.
- Added terminal DB status to observability outcome mapping coverage.
- Added shared observability snapshot and initial SLO target contracts with evaluator tests in `packages/contracts`.

## API Versioning

Status: Initial API versioning/deprecation contract complete.

Moved / Added:

- Added `packages/contracts/src/versioning.ts`.
- Exported versioning contracts from `packages/contracts/src/index.ts`.
- Documented current unversioned REST/MCP surfaces and deprecation policy in `docs/refactoring/compatibility-surfaces.md`.

Behaviour preserved:

- Runtime HTTP, HTTP MCP and stdio MCP handlers are unchanged.
- No API surface is marked deprecated yet.

Architecture improvements:

- REST/MCP surface identifiers and deprecation metadata now have a shared contracts package seam.
- Future versioned route work has documented compatibility and sunset requirements.

Quality checks:

- contracts typecheck: passed.
- root typecheck/test/build/architecture: passed.

Follow-up additions:

- Added a focused REST project-read contract snapshot in `packages/contracts/src/rest-projects.ts`.
- Added DTO contracts for project rows, project list/active responses, suggested project codes and active run state responses.
- Root `npm run test` now includes contracts package tests.
- Added task/run/board/activity REST route snapshots for active-project and explicit project-scoped task APIs.
- Added project mutation, skill, session, prompt, cost, log and health route snapshots in `packages/contracts/src/rest-legacy.ts`.
- Added REST contract uniqueness checks for route ids and method/path pairs.
- Added API surface versioning/deprecation validators and contract tests so deprecated surfaces require replacement, reason and sunset metadata.

## AI Asset Schema

Status: Initial Markdown AI asset normalization seam complete, with built-in skill and concern sources added.

Moved / Added:

- Added Markdown frontmatter parser in `packages/engine/src/ai-assets/markdown.ts`.
- Added role, skill and concern asset normalization in `packages/engine/src/ai-assets/catalog.ts`.
- Added Engine AI asset tests in `packages/engine/test/ai-assets.test.ts`.
- Added `/ai` Markdown source tree for built-in skills and concern packs.
- Added built-in AI asset source validation in `packages/engine/test/built-in-ai-assets.test.ts`.

Behaviour preserved:

- Existing prompt, JSON concern and built-in skill runtime paths are unchanged.
- Runtime still reads legacy prompt, concern and built-in skill paths until loader migration is complete.

Architecture improvements:

- Built-in role prompts, skills and concerns now have a provider-free Markdown target shape.
- Concern Markdown parsing supports phase-scoped reminders and review dimensions.
- Later compatibility adapters can normalize legacy assets into the same catalog shape before moving files.

Quality checks:

- engine typecheck: passed.
- engine tests: passed, 6 files / 46 tests.

Follow-up additions:

- Built-in skills now have Markdown source files under `/ai/skills`.
- Built-in concern packs now have Markdown source files under `/ai/concerns`.
- Engine tests verify the `/ai` source files normalize through the shared AI asset catalog parser.
- Infrastructure now has a filesystem-port loader for built-in AI assets.
- Infrastructure tests cover built-in skill/concern loading and duplicate-ID rejection.

## Plugin SDK

Status: Initial provider plugin SDK contract complete.

Moved / Added:

- Added `packages/plugin-sdk/src/provider.ts`.
- Added `packages/plugin-sdk/src/registry.ts`.
- Added `packages/plugin-sdk/src/testing.ts`.
- Added `packages/plugin-sdk/test/provider-sdk.test.ts`.
- Added `docs/contributing/adding-a-plugin.md`.
- Added root `typecheck:plugin-sdk` and `test:plugin-sdk` scripts.

Behaviour preserved:

- Provider runtime loading and execution remain in the legacy core package.
- Claude, Codex and Copilot adapters are not moved in this chunk.

Architecture improvements:

- Provider manifests now have an author-facing SDK contract.
- Provider runtime controls must be declared as enforced or intentionally ignored.
- Provider registry and fake-provider contract tests now have a package seam.
- Plugin author documentation now describes sandbox/resource-limit expectations.
- SDK testing now includes a deterministic provider fixture for proving new provider registration without Engine changes.

Quality checks:

- plugin-sdk typecheck: passed.
- plugin-sdk test: passed, 1 file / 7 tests.

Follow-up additions:

- `assertProviderContract` now checks declared streaming, resume and usage capabilities against normalized fake responses.
- `createDeterministicProviderAdapter` provides stable events, session refs, model and usage for provider extensibility tests.
- Provider package targets now export validated SDK manifests for Claude, Codex and GitHub Copilot without moving legacy runtime execution.
- Root `npm run typecheck` and `npm run test` now include provider package manifest seams.

## PR Feedback

Status: Initial review feedback resolved.

Moved / Added:

- Removed legacy runtime deep imports of repo-root Engine files until plugin packaging guarantees workspace packages are present.
- Added an architecture check rejecting repo-root package imports from the legacy runtime.
- Updated the architecture checker to resolve the repository root with `fileURLToPath`.

Behaviour preserved:

- Engine package extraction remains available as the target package seam.
- Legacy runtime callers still use their existing module paths.
