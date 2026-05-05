# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Cross-references:**
- **Multi-agent concepts** (workflows, roles, executor lifecycle) → [AGENTS.md](AGENTS.md)
- **Copilot CLI support** → [AGENTS.md § Copilot CLI Setup](AGENTS.md#copilot-cli-setup)
- **Platform features & overview** → [README.md](README.md)

## What this is

`agentboard` is a **Claude Code plugin** that runs a local kanban board driven by headless `claude -p` subprocesses. A Node.js server (`agent-board-core/`) holds per-project SQLite DBs, spawns headless runs with role-specific prompts (PM / Worker / Reviewer), and serves a React UI. The plugin itself (`plugins/claude-code/`) is a thin wrapper that boots the server and exposes read/approve tools over stdio MCP for the user's interactive Claude session.

**AgentBoard is now multi-agent.** Claude Code is the primary executor, but [Copilot CLI is also supported](AGENTS.md#copilot-cli-setup) as of v1.1. This document covers Claude Code plugin implementation details. For executor-agnostic workflows and setup, see [AGENTS.md](AGENTS.md).

## Commands

All core-dev commands run from `plugins/claude-code/agent-board-core/`:

```bash
# Start server standalone (usually done via /agentboard:open, not directly).
# TypeScript runs directly via Node 22 --experimental-strip-types — no JS emit.
node --experimental-sqlite --experimental-strip-types --no-warnings server.ts

# Build pipeline (typecheck + UI bundle; UI dist/ IS committed)
npm run build           # = typecheck && build:ui
npm run typecheck       # tsc --noEmit -p src/tsconfig.json (server)
npm run build:ui        # cd ui && vite build

# Quality gate (CI runs this)
npm run check           # = typecheck && lint && format:check
npm run lint            # eslint flat config (eslint.config.js)
npm run format          # prettier --write .

# Tests
npm test                # vitest run (231 tests across 27 files)
npm run test:watch      # vitest watch

# Pre-commit: simple-git-hooks runs lint-staged on staged .ts/.tsx files.
```

From the plugin directory:

```bash
# Boot/reuse server (idempotent; reads config.json, respawns on version mismatch)
node plugins/claude-code/bin/ensure-server.ts

# From inside Claude Code:
/agentboard:open     # boot server + open UI
/agentboard:stop     # SIGTERM the server
/agentboard:doctor   # health checklist
```

### Test / iterate on a live run

```bash
# Fast-reaper mode (override 15min timeout)
AGENTBOARD_REAPER_TIMEOUT_MS=10000 AGENTBOARD_REAPER_SWEEP_MS=2000 \
  node --experimental-sqlite --experimental-strip-types --no-warnings \
    plugins/claude-code/agent-board-core/server.ts

# Tail a run's stream-json log
cat ~/.agentboard/logs/<run_id>.jsonl | jq .

# Inspect DB directly
sqlite3 ~/.agentboard/projects/<code>.db "SELECT code, status, assignee_role, rework_count FROM task;"
```

## Architecture — the big picture

### Two MCP surfaces with deliberately different names

1. **HTTP MCP key `abrun`** (`plugins/claude-code/agent-board-core/src/api-mcp.ts`) — consumed by **spawned headless `claude -p` runs** via a per-run tmp `--mcp-config` file. Exposes:
   - **Run lifecycle:** `claim_run, get_task, update_task, add_comment, finish_run, add_heartbeat`.
   - **Inner phase machine:** `next` (current phase + allowed transitions), `advance` (move to next phase or take an exit verb), `record_debt`, `resolve_debt`, `record_tool` (PreToolUse hook bookkeeping), `use_skill` (resolve a skill by name, fuzzy-suggest on miss).

   Requires server Bearer token (outer) AND per-run `run_token` (per-call, rotated on `claim_run`). Speaks JSON-RPC 2.0.

2. **Stdio MCP key `agentboard`** (`plugins/claude-code/mcp/agentboard.mjs`) — consumed by the **user's interactive Claude Code session**. Read-only board inspection + Human-role actions (`approve_task, reject_task, dispatch_task`). Thin REST proxy. *(Note: still `.mjs` — interactive plugin entrypoint, not part of the server TS migration.)*

   Keys intentionally differ so `--strict-mcp-config` in the executor filters out the stdio plugin MCP; if both were named `agentboard` they'd shadow each other. **Do not rename `abrun` without also updating `src/tool-allowlist.ts`, all three `prompts/*.md`, and the `mcpServers` key in `executor.ts`.**

### State machine + auto-dispatch

**For generic state machine and dispatch concepts, see [AGENTS.md § Task Lifecycle States](AGENTS.md#task-lifecycle-states) and [AGENTS.md § Dispatch Modes](AGENTS.md#dispatch-modes).**

Claude Code implementation:

- `src/state-machine.ts` holds the `(WF1|WF2, from_status, to_status, by_role)` allow-list. **Human role can now initiate tasks from Todo → Agent Working**, allowing semi-automated workflows where users drive task dispatch.
- `src/dispatch-map.ts` resolves `(status, assignee_role)` → role to auto-dispatch. **Triggers on assignee change as well as status change** — this is how Reviewer-reject (status unchanged, assignee flips reviewer→worker) and Worker-NEEDS_PM (worker→pm) routing work.
- `src/repo.ts::transitionTask` does the CAS, writes `task_history`, and enqueues the next `agent_run` **in the same SQLite transaction**. The executor polls `queued` rows independently, so crash-between-write-and-dispatch is safe.

### Postflight and audit comments

**For role-specific audit requirements, see [AGENTS.md § Roles & Responsibilities](AGENTS.md#roles--responsibilities).**

Claude Code implementation:

On `finish_run(status='succeeded')` the server enforces role-specific required comments (`src/postflight.ts`):

- PM: `description` non-empty + AC 1..20 items + `ENRICHMENT_SUMMARY:` comment.
- Worker: `DEV_COMPLETED`, `FILES_CHANGED`, `DIFF_SUMMARY` (literal `NO_CHANGES` / `NOT_A_REPO` allowed).
- Reviewer: `REVIEW_VERDICT:` (approve|reject) + `RATIONALE:` + on reject `REWORK:` (min 10 chars).

Assignee reassigns within `agent_working` also require a prefixed comment (`REWORK:` for reviewer→worker, `NEEDS_PM:` for worker→pm). Enforced in `update_task` before the CAS.

### Executor lifecycle

**For executor lifecycle phases (spawn → run → cost → transition), see [AGENTS.md § Executor Lifecycle](AGENTS.md#5-executor-lifecycle).**

Claude Code spawning specifics in `src/executor.ts`:

1. Drains `queued` runs respecting `project.max_parallel` (default 1, cap 3).
2. For each: pre-check `repo_path` exists → open stdout/stderr log fds → write tmp MCP config with `run_token` Bearer → **select executor** (Claude or Copilot) based on `task.agent_provider_override ?? project.agent_provider ?? 'claude'` → `spawn` detached process with `--strict-mcp-config --allowedTools <per-role> --permission-mode acceptEdits --output-format stream-json --max-turns 60`.
3. On child exit: parse `logs/<run_id>.jsonl` for `model` (system.init event) + `usage` (per message.usage), compute cost via `src/pricing.ts`, stamp `agent_run.cost_usd` + `cost_version`.
4. Reaper every 60s marks `running` runs as `failed` when `last_heartbeat_at` is older than 15min (each MCP call bumps heartbeat).

### Multi-Provider Agent Execution (Claude & Copilot CLI)

**For agent selection (project/task level) and workflows, see [AGENTS.md § Setting Agents Per-Project & Per-Task](AGENTS.md#4-setting-agents-per-project--per-task).**

Claude Code implementation specifics:

**Provider Resolution in tryClaimAndRun()**

- `src/executor.ts::tryClaimAndRun()` resolves effective provider after task lookup: `task.agent_provider_override ?? project.agent_provider ?? 'claude'`
- Branches to `AgentRunner` (Claude Agent SDK via `@anthropic-ai/claude-agent-sdk`), `CodexRunner` (Codex CLI subprocess), or `CopilotRunner` (Copilot SDK via `@github/copilot-sdk`)
- All implementations return same contract: `{status, sessionId, usage, model, totalCostUsd, error, errorKind}`

**CopilotRunner Implementation (SDK-Based)**

- `src/copilot-runner.ts` mirrors `AgentRunner` interface using `@github/copilot-sdk`
- Uses `CopilotClient` and `createSession()` with event handlers (like Claude SDK's async generator)
- Receives same permission model (approveAll) and event handlers as Claude
- Captures usage, model, cost from SDK session events (no stdout parsing)
- Retry, timeout, rate-limiting, heartbeat logic provider-agnostic

**Cost Tracking**

- `src/pricing.ts` handles Claude, Codex, and Copilot models
- Unknown models → `$0` + `uncosted: true` flag (never silently wrong)
- `agent_run.cost_version` bumped for audit trail when pricing changes

**Fallback & Error Handling**

- If a project selects `'github_copilot'` but Copilot CLI unavailable: task dispatch fails with error (surfaced in UI)
- User can switch project to `'claude'` or ensure Copilot CLI installed
- Future: auto-fallback to Claude (deferred to v1.2)

### Security model

- Server binds `127.0.0.1` only, rejects requests whose `Host` header isn't `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding guard).
- 32-byte hex token in `~/.agentboard/config.json` (0600 on Unix, `icacls` ACL on Windows).
- Browser UI receives token via inlined `<script>` on `GET /` and via `Set-Cookie: ab_token=...` (so plain `<a href="/api/logs/:id">` links authenticate without JS).
- `/alive` is unauthenticated, returns only `{ok, server_id, plugin_version}` — used by `ensure-server.ts` to detect stale config / plugin version upgrades.
- `/healthz` requires Bearer.

## Modification rules

- **UI `dist/` IS committed.** Rebuild via `cd agent-board-core/ui && npm run build` after UI changes. `.gitattributes` marks it `linguist-generated` so GitHub collapses it in PR diffs. Users who install the plugin run `npm install` once on first boot to fetch server runtime deps; the UI bundle itself ships pre-built.
- **TypeScript runs directly — no JS emit.** Server `.ts` files execute under Node 22 `--experimental-strip-types`. `tsc --noEmit` is the typecheck step. UI is bundled by Vite to `ui/dist/`.
- **Data dir is outside the repo.** `~/.agentboard/` on Unix, `%USERPROFILE%\.agentboard` on Windows. Never write project data into `agent-board-core/` or `plugins/`.
- **Pricing table in `src/pricing.ts`** has `PRICING_VERSION`. Bump it when Anthropic prices change, so `/agentboard reprice` can recompute historical runs.
- **Role prompts in `agent-board-core/prompts/{pm,worker,reviewer}.md` are the product.** Treat them like code — version them, iterate against real runs. Drift-guards (postflight + required-comment checks + phase-gate) catch structural mistakes, but tone/brevity is prompt-only. Each prompt receives an "Available skills" Liquid block populated from the project's skill catalog.

## Inner phase machine (per-run FSM)

Each agent run drives an inner state machine on top of the outer task FSM. Lives in `src/phase-machine.ts`, persisted in `agent_run.phase`, `agent_run.phase_state_json`, `agent_run.phase_history_json` (`src/phase-repo.ts`).

```
DISCOVERY → REFINEMENT → PLANNING → EXECUTING → VERIFICATION → DONE
                                 (+ exit verbs: cancel | wontfix | revisit)
```

- **Discovery modes** (`src/discovery-modes.ts`, stamped on `task.discovery_mode`): `full` (default), `validate`, `technical-depth`, `ship-fast` (collapses DISCOVERY→PLANNING, bug-type tasks default here), `explore`.
- **Tools agents call:** `next` to read current state and allowed transitions; `advance` to move forward (or invoke an exit verb); `record_debt` / `resolve_debt` to track follow-up debt items in `task_debt`; `record_tool` is wired to a PreToolUse hook so every tool the agent fires is logged; `use_skill` resolves a project skill by name (case-insensitive, fuzzy top-5 on miss with auto-comment, run continues).
- **Live activity:** every phase transition and tool call writes a row to `agent_activity` and pushes an event onto the `/api/runs/:id/events` SSE channel. The UI run timeline streams from this.
- **Postflight phase gate** (`src/postflight.ts`, tested in `test/postflight-phase-gate.test.ts`): `finish_run(status='succeeded')` requires the run to have reached `DONE` (or an explicit exit verb). This sits in front of the existing role-specific required-comment checks.

## Concerns and skills

- **Concern packs** (`src/concerns.ts`, built-ins in `concerns/`: `well-engineered.json`, `beautiful-product.json`, `long-lived.json`) inject prioritised concern lists into role prompts. `project.concerns_json` lets a project pick or extend packs.
- **Project-scoped skills** (`src/skill-repo.ts`, `src/skill-scanner.ts`, `src/skill-scan-worker.ts`): on project create / repo_path change / manual rescan, the scanner walks `<repo>/**/.claude/skills/*` looking for folder skills (a directory with `SKILL.md`) and flat skills (`<name>.md`). Disk is the single source of truth — UI edits write back to disk. Default ignore list (`node_modules`, `bin`, `obj`, `vendor`, `target`, `__pycache__`, `.git`, `dist`, …) is overlaid with per-project `project.scan_ignore_json` (basenames or repo-relative subtree paths).
- **Built-in catalog** (`src/builtin-skills.ts`): six read-only built-ins (`builtin:code-review`, `builtin:unit-tests`, `builtin:tech-spec`, `builtin:refactor`, `builtin:api-client`, `builtin:release-notes`) merged into the same `/api/skills` endpoint.
- **Skill-scan worker** mirrors the executor Supervisor pattern: 1 s polling, fire-and-forget, single-in-flight per project. Surfaces status via SSE on `/api/skills/scan/events`.
- **Routes:** `GET /api/skills`, `GET /api/skills/:id`, `PUT /api/skills/:id`, `POST /api/skills/scan`, `GET /api/skills/scan/latest`, `GET /api/skills/scan/events`, `GET /api/skills/dirs`.

## Security model specifics (Claude Code & Copilot CLI)

- **Child env is whitelisted, not inherited.** `src/child-env.ts::buildChildEnv` ships only PATH/HOME/USER/LANG/TZ + Claude-auth vars (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, etc.) on POSIX; Windows adds USERPROFILE/APPDATA/LOCALAPPDATA/SYSTEM* and friends. AWS, GitHub, SSH, GCP, cloud SDK vars are dropped. Applies equally to Claude and Copilot spawned processes. If you add a new env var the CLI needs, add it to that module — not `{...process.env}`.
- **`claim_run` returns `run_token` exactly once, to the queued→running CAS winner.** There is no "already-claimed" retry path; a subsequent call on a running run returns an error. This is deliberate; don't add a "convenience" retry.
- **REST `/api/tasks/:id/transition` always writes `by_role='human'`.** Client-supplied `by_role` is ignored. Agent transitions happen through the HTTP MCP endpoint, which is the only place `by_role` is derived from `run.role`.
- **`/alive` is intentionally unauth.** It returns `{ok, server_id, plugin_version}` — used by `ensure-server.ts` to detect stale config or version mismatch. No token, no secrets. Do not protect it.
- **Log files at `~/.agentboard/logs/<run_id>.jsonl` contain full agent transcripts** (prompts, tool I/O, anything the agent echoed). Served via `/api/logs/:run_id` (Bearer-protected, ULID-gated for traversal). Treat the data dir as sensitive — document for users.
- **No rate limiting yet** — still planned. 127.0.0.1-only binding limits risk to local processes with the token.

## Known sharp edges

- `--allowedTools` only matches single commands. Compound shell (`cd X && npx tsc`) triggers permission prompts that deadlock headless runs. If Worker hits this, extend allowlist or push the command structure into the prompt.
- `claude --bare` disables OAuth auth; do NOT re-add it to the executor.
- Windows argv cap (~32KB) bounds the size of `--append-system-prompt`. If role prompts + rendered task body get huge, switch to passing a tmp file path instead.
- `node:sqlite` requires `--experimental-sqlite` on Node 22; `ensure-server.ts` passes it on spawn. Node ≥24 ignores the flag harmlessly.
- `--experimental-strip-types` is required to run the server `.ts` files directly. Both flags are passed by `ensure-server.ts`.

## References

- **Multi-agent workflows & executor-agnostic concepts** → [AGENTS.md](AGENTS.md)
- **Platform features, Copilot CLI setup, and overview** → [README.md](README.md)
- **All agent types and status** → [AGENTS.md § Supported Agents](AGENTS.md#2-supported-agents--status-table)
- `.claude/plans/i-need-you-to-sleepy-scroll.md` (in the parent workspace) — full design plan with architecture, data model, dispatch rules, verification steps. Treat as canonical when plan and code disagree; otherwise trust the code.
