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

- Existing runtime still imports current `src/state-machine.ts` and `src/phase-machine.ts`.
- Existing runtime imports current `src/rate-limit-tracker.ts`, which now adapts to Engine `RateLimitPolicy`.
- Workflow and phase production paths have not switched to the new Engine package yet.

Tests added/updated:

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
- Legacy rate-limit callers now consume Engine policy through a compatibility adapter.
- Engine package typechecks independently.
- Engine tests run without SQLite, HTTP, browser, filesystem workspace or provider SDKs.

Compatibility concerns:

- Current and Engine workflow implementations are duplicated temporarily.
- Current and Engine retry/config implementations are duplicated temporarily.
- Core TypeScript `rootDir` is temporarily widened so the legacy package can typecheck Engine source imports before package distribution is finalized.
- A later phase must switch runtime imports to Engine and delete the old copies.

Remaining follow-ups:

- Switch extracted policies into the current runtime behind focused compatibility tests.
- Add architecture tests preventing provider-specific imports in Engine as files move.
- Switch existing runtime to use Engine workflow modules after contracts stabilize.

Quality checks:

- lint: not rerun globally; existing baseline still fails.
- typecheck: passed through root `npm run typecheck`.
- unit: passed through root `npm run test`, 30 existing files / 246 tests plus 5 Engine files / 41 tests.
- integration: no separate command yet.
- e2e: placeholder only.
- build: not rerun after Phase 2 extraction.
