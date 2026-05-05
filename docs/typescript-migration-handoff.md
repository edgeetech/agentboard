# AgentBoard TypeScript Migration Handoff

## Summary
Migrate AgentBoard **repo-wide** from repo-owned `.mjs` files to TypeScript while preserving:
- exact runtime behavior
- exact REST, MCP, CLI, plugin, and hook interfaces
- full existing test case coverage
- current first-run install ergonomics

Chosen defaults:
- **Scope:** repo-wide
- **Runtime strategy:** compiled output plus thin `.mjs` shims
- **Artifact strategy:** build locally on first run, do not commit built artifacts

## Current State
The repo is split across:
- a TypeScript UI already in `plugins/claude-code/agent-board-core/ui`
- a backend/runtime still implemented as ESM `.mjs`
- plugin/runtime entrypoints outside the core package that also use `.mjs`

### Important current facts
- Core backend entrypoint is `plugins/claude-code/agent-board-core/server.mjs`
- Core CLI entrypoint is `plugins/claude-code/agent-board-core/bin/agentboard.mjs`
- Plugin bootstrap entrypoint is `plugins/claude-code/bin/ensure-server.mjs`
- Plugin MCP entrypoint is `plugins/claude-code/mcp/agentboard.mjs`
- Plugin manifest points directly to `.mjs` paths in `plugins/claude-code/.claude-plugin/plugin.json`
- Backend tests currently use Vitest with `include: ['test/**/*.test.mjs']`
- Backend `typecheck` script is currently broken and points to missing `src/tsconfig.json`
- UI already uses strict TS in `plugins/claude-code/agent-board-core/ui/tsconfig.json`
- Core package currently boots source files directly; there is no backend build pipeline yet
- First-run bootstrap already installs dependencies in `ensure-server.mjs`; this is the correct place to add local build-on-demand

## Migration Goals
1. Make TypeScript the source of truth for all repo-owned backend/plugin `.mjs` code.
2. Preserve all runtime contracts and user-facing behavior.
3. Keep plugin install/use ergonomic by building on first run if artifacts are missing or stale.
4. Preserve all existing tests and add coverage for the new build/bootstrap/shim layer.
5. Leave no ambiguous implementation decisions for the implementer.

## Exact Scope
### Migrate to TypeScript
#### Core package runtime
- `plugins/claude-code/agent-board-core/src/**/*.mjs`
- `plugins/claude-code/agent-board-core/server.mjs`
- `plugins/claude-code/agent-board-core/bin/agentboard.mjs`

#### Core package tests
- `plugins/claude-code/agent-board-core/test/**/*.test.mjs`

#### Core package maintained helper/dev scripts
- `plugins/claude-code/agent-board-core/check-runs.mjs`
- `plugins/claude-code/agent-board-core/sdk-test.mjs`
- `plugins/claude-code/agent-board-core/test-sdk.mjs`
- `plugins/claude-code/agent-board-core/test-copilot-agent.mjs`
- `plugins/claude-code/agent-board-core/test-copilot-sdk.mjs`
- `plugins/claude-code/agent-board-core/test-copilot-sdk2.mjs`
- `plugins/claude-code/agent-board-core/test-e2e-copilot.mjs`
- `plugins/claude-code/agent-board-core/vitest.config.mjs`

#### Plugin/runtime files outside core
- `plugins/claude-code/bin/ensure-server.mjs`
- `plugins/claude-code/mcp/agentboard.mjs`
- `plugins/claude-code/hooks/session/*.mjs`

#### Root repo scripts
- `scripts/bump-version.mjs`
- root maintained diagnostics/workflow scripts:
  - `check-db.mjs`
  - `check-db2.mjs`
  - `test-copilot-sdk.mjs`
  - `test-workflow.mjs`

### Do not migrate
- `node_modules`
- generated/bundled third-party files unless they are actually maintained source
- UI TS source except only where shared tooling/config integration requires it

## Runtime Strategy
### Chosen approach
Use **compiled backend/plugin output** for execution, with **thin `.mjs` shims** only where fixed runtime contracts require exact `.mjs` paths.

### Why
- The plugin manifest and hook/runtime paths currently hardcode `.mjs`
- Direct TS source execution would require loaders/runtime complexity and would change operational assumptions
- Thin shims preserve external path contracts while making TS the internal source of truth

### Required shims
Keep `.mjs` wrapper files only for:
- plugin manifest entrypoints
- hook entrypoints
- MCP stdio entrypoints
- any fixed path launched by external systems or plugin runtime

Each shim must only:
1. resolve the compiled output path
2. import or spawn the built runtime
3. pass through args/env/stdio unchanged

No business logic should remain in shims.

## Build and Tooling Plan
### Backend TS config
Add a backend TypeScript config in `plugins/claude-code/agent-board-core`, separate from UI TS config.

Use:
- `target: ES2022`
- `module: NodeNext`
- `moduleResolution: NodeNext`
- strict mode enabled
- emit enabled
- output directory such as `dist/`
- declarations optional; only add if useful for maintainability, not required for runtime parity

### Script changes
Update core package scripts to include:
- working `build`
- working `typecheck`
- test script that runs TypeScript tests
- keep `start` semantics aligned with current server launch expectations

Likely scripts:
- `build`: compile backend TS and any runtime shims/build helpers
- `typecheck`: run backend TS typecheck
- `test`: run Vitest on `.test.ts`
- keep `build:ui` unchanged unless integration requires orchestration

### Vitest config
Convert backend Vitest config from `.mjs` to TS or keep it as a minimal shim if needed.
Update include from:
- `test/**/*.test.mjs`
to:
- `test/**/*.test.ts`

## File Conversion Rules
### Imports
- Replace all relative `.mjs` imports in TS source with whatever import style matches the chosen NodeNext emit strategy
- Ensure emitted runtime files resolve correctly under Node without custom loaders
- Preserve dynamic imports used for optional SDK loading

### Typing
Convert JSDoc typedef-heavy modules to explicit TS types/interfaces.
Prioritize:
- runners and executor
- repo/db models
- HTTP request/response payloads
- MCP tool payloads
- config/session/tracker structures

### Refactor limits
- No behavior-changing cleanup
- No API redesign
- No schema redesign
- No path/layout redesign beyond necessary build output placement
- No renaming externally visible tool names/endpoints/commands

## Bootstrap and First-Run Build
### Modify `ensure-server`
Extend `plugins/claude-code/bin/ensure-server.mjs` behavior so it:
1. ensures dependencies are installed
2. checks whether compiled backend/plugin outputs exist
3. rebuilds if missing or stale
4. launches compiled runtime via the shim/runtime contract

### Staleness rule
Minimum acceptable:
- rebuild if expected compiled entrypoint is missing

Preferred:
- rebuild if any of these are newer than compiled output:
  - backend source files
  - backend tsconfig
  - package.json
  - plugin manifest or runtime shim config inputs

### User experience requirement
No new manual user build step.
Current “first run installs deps” flow must remain the main operational model.

## Runtime Contracts That Must Not Change
### REST
All existing endpoint paths, payloads, and response shapes must remain unchanged.

### MCP
All existing MCP tool names, input schemas, and behavior must remain unchanged.

### CLI
Existing command names and flags must remain unchanged.

### Plugin manifest
External plugin-visible entrypoint paths must continue to work.

### Hooks
Hook filenames and invocation behavior must remain unchanged externally.

### DB and migrations
No DB schema changes as part of this migration unless required purely for type-safe code organization, which should be avoided.

### Environment and startup
Preserve:
- Node version assumptions
- `--experimental-sqlite`
- auth/env behavior
- filesystem paths
- config formats
- startup logs and readiness behavior

## Test Plan
### Existing test preservation
Convert all current backend tests to `.test.ts` without reducing assertions or scenarios.

Current backend test surface at planning time:
- 13 backend Vitest files
- 113 passing tests on full suite
- about 158 `describe`/`it` matches across backend test files

### Add migration-specific tests
Add tests for:
- backend build output existence/shape
- `ensure-server` build-on-first-run behavior
- shim resolution to compiled output
- compiled server boot path
- plugin MCP entrypoint shim behavior
- hook entrypoint shim behavior
- import path correctness after compilation

### Validation gates
Required validation:
- backend typecheck passes
- UI typecheck still passes
- full backend Vitest suite passes
- smoke test for compiled server startup
- smoke test for plugin bootstrap path
- smoke test for MCP stdio entrypoint

### Acceptance criteria
- all repo-owned backend/plugin `.mjs` source files are migrated to TS or intentionally retained only as shims
- all existing tests pass after conversion
- migration-specific tests pass
- first-run bootstrap still works without manual build steps
- runtime behavior remains unchanged from the user’s perspective

## Recommended Migration Order
1. Add backend TS toolchain and working scripts without removing current `.mjs` runtime.
2. Convert low-risk utility modules in `src/` first:
   - `time`
   - `ulid`
   - `http-util`
   - `dispatch-map`
   - `rate-limit-tracker`
   - `turn-timeout`
3. Convert shared core modules:
   - `paths`
   - `config`
   - `auth`
   - `event-bus`
   - `state-machine`
   - `pricing`
4. Convert data and registry layer:
   - `db`
   - `repo`
   - `project-registry`
5. Convert API handlers.
6. Convert runners/executor/workspace/tracker modules.
7. Convert `server.mjs` and core CLI entrypoint.
8. Convert tests to TS and update Vitest discovery.
9. Convert plugin bootstrap, MCP entrypoint, and hooks.
10. Add thin `.mjs` shims and build-on-first-run integration.
11. Run full validation and smoke tests.
12. Remove obsolete source `.mjs` implementations once shims are verified.

## Resume Context
### Files and entrypoints already inspected
- `plugins/claude-code/agent-board-core/package.json`
- `plugins/claude-code/agent-board-core/ui/package.json`
- `plugins/claude-code/agent-board-core/ui/tsconfig.json`
- `plugins/claude-code/agent-board-core/vitest.config.mjs`
- `plugins/claude-code/agent-board-core/server.mjs`
- `plugins/claude-code/agent-board-core/bin/agentboard.mjs`
- `plugins/claude-code/bin/ensure-server.mjs`
- `plugins/claude-code/mcp/agentboard.mjs`
- `plugins/claude-code/.claude-plugin/plugin.json`
- `AGENTS.md`

### Runtime/package facts already confirmed
- Backend core source tree is still `.mjs` under `agent-board-core/src`
- UI is already TS and strict
- Core backend currently executes source directly, not compiled output
- Plugin manifest currently points to `${CLAUDE_PLUGIN_ROOT}/mcp/agentboard.mjs`
- `ensure-server.mjs` currently spawns `server.mjs` directly
- Full backend Vitest suite currently passes before this migration work starts
- Current core `typecheck` script is broken because `src/tsconfig.json` does not exist

### Repo-wide `.mjs` areas already identified
- root helper scripts
- `plugins/claude-code/agent-board-core/**`
- `plugins/claude-code/bin/**`
- `plugins/claude-code/hooks/session/**`
- `plugins/claude-code/mcp/**`
- `scripts/**`

### What to do first when implementation starts
1. Add a real backend TS config in `plugins/claude-code/agent-board-core`
2. Replace the broken backend `typecheck` script
3. Decide exact emit layout for compiled ESM output and shim targets
4. Prove the build pipeline on one or two leaf utility modules before mass conversion
5. Only update `ensure-server` after the compiled backend entrypoint exists

### What not to do first
- Do not mass-rename all `.mjs` files immediately
- Do not switch plugin manifest/runtime paths before shims exist
- Do not introduce direct TS runtime loaders in production paths
- Do not mix behavior refactors into the migration

### Safe first checkpoint
The first good checkpoint should be:
- backend TS config exists
- backend `typecheck` works
- one or two leaf modules are migrated
- test suite is still green
- build output strategy is proven end-to-end
