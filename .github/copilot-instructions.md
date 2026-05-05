# Copilot Instructions for AgentBoard

AgentBoard is a multi-agent workflow orchestrator running as a Claude Code plugin. It supports **Claude Code**, **Codex CLI**, and **Copilot CLI** as executors. This file guides Copilot CLI sessions working in this repository.

## Build & Run

### Core Server

The server is pure TypeScript — no JS emit. Node 22 runs `.ts` directly via `--experimental-strip-types`.

```bash
# From plugins/claude-code/agent-board-core/
node --experimental-sqlite --experimental-strip-types --no-warnings server.ts

# Quality gate (CI)
npm run check         # = typecheck && lint && format:check
npm run typecheck     # tsc --noEmit -p src/tsconfig.json
npm run lint          # eslint flat config (eslint.config.js)
npm run format        # prettier --write .
npm test              # vitest run (231 tests across 27 files)

# Build (UI bundle only — no JS emit for server)
npm run build         # = typecheck && build:ui

# Pre-commit: simple-git-hooks runs lint-staged on staged .ts/.tsx files.

# Via plugin entry point
node plugins/claude-code/bin/ensure-server.ts  # Boot server (idempotent, version-aware)
```

### UI (React + TypeScript)

```bash
# From plugins/claude-code/agent-board-core/ui/
npm install
npm run build                      # TypeScript check + Vite build → dist/
npm run dev                        # Watch mode

npx tsc --noEmit                   # Type-check only (no emit)
```

### Testing / Development

```bash
# Fast-reaper (override 15min timeout for quicker iteration)
AGENTBOARD_REAPER_TIMEOUT_MS=10000 AGENTBOARD_REAPER_SWEEP_MS=2000 \
  node --experimental-sqlite --experimental-strip-types --no-warnings \
    plugins/claude-code/agent-board-core/server.ts

# Tail live run logs
cat ~/.agentboard/logs/<run_id>.jsonl | jq .

# Query project DB directly
sqlite3 ~/.agentboard/projects/<project_code>.db "SELECT code, status, agent_provider, rework_count FROM task;"
```

## Architecture

### Three-Layer Stack

1. **Plugin wrapper** (`plugins/claude-code/`) — entry point for slash commands, hooks
2. **Core server** (`plugins/claude-code/agent-board-core/`) — HTTP server, executor, state machine
3. **UI** (`agent-board-core/ui/`) — React 18 + Vite → compiled to `dist/` (committed)

### Executor Engine

Routes runs to one of three runner classes based on the resolved provider.

```
executor.ts (drain loop)
  → tryClaimAndRun(project, run)
    → resolve effective executor provider (task override > project default > 'claude')
    → AgentRunner | CodexRunner | CopilotRunner
    → runner.run() → cost computation
    → finishRun() or scheduleRetry()
```

Key files:
- `src/executor.ts` — drain loop, reaper, run lifecycle, executor provider resolution
- `src/agent-runner.ts` — Claude Agent SDK wrapper
- `src/codex-runner.ts` — Codex CLI subprocess wrapper
- `src/copilot-runner.ts` — Copilot SDK wrapper (mirrors AgentRunner interface)
- `src/repo.ts` — DB queries, task dispatch, state transitions
- `src/retry-manager.ts` — retry scheduling + exponential backoff
- `src/supervisor.ts` — crash recovery wrapper
- `src/phase-machine.ts` / `src/phase-repo.ts` — inner per-run FSM
- `src/skill-repo.ts` / `src/skill-scanner.ts` / `src/skill-scan-worker.ts` — project skills

### Multi-Agent Support

**Status:** ✅ Stable. Claude, Codex CLI, and Copilot CLI all production-ready.

```
project.agent_provider          = 'claude' | 'codex' | 'github_copilot'
task.agent_provider_override    = 'claude' | 'codex' | 'github_copilot' | NULL
```

- Resolution: `task.agent_provider_override ?? project.agent_provider ?? 'claude'`
- Schema: columns, migrations, validation
- API: project POST/PATCH, task `executor_override` parameter
- Cost computation for Claude, Codex, and Copilot models
- Tests covering executor resolution, cost computation, copilot runner, codex config

### Inner Phase Machine

Each run drives an FSM `DISCOVERY → REFINEMENT → PLANNING → EXECUTING → VERIFICATION → DONE` (plus exit verbs `cancel | wontfix | revisit`). Discovery modes (`full` default, `validate`, `technical-depth`, `ship-fast`, `explore`) tune the loop; bug-type tasks default to `ship-fast` (collapses DISCOVERY→PLANNING).

Persisted on `agent_run.phase`, `agent_run.phase_state_json`, `agent_run.phase_history_json`. Live phase + tool activity broadcast over SSE on `/api/runs/:id/events`. Postflight phase gate requires `DONE` (or an exit verb) before `finish_run(succeeded)` is accepted.

### Project-Scoped Skills

Server scans `<repo>/**/.claude/skills/*` (folder skills with `SKILL.md`, plus flat `<name>.md`) on project create / repo change / manual rescan. Disk is the single source of truth; UI edits write back. Default ignores (node_modules, bin, obj, vendor, target, __pycache__, .git, dist, …) overlaid with per-project `project.scan_ignore_json`. 6 read-only built-ins (id prefix `builtin:`) merged into the same `/api/skills` endpoint. Async scan worker mirrors the executor Supervisor (1 s polling, single-in-flight per project).

### MCP Surfaces

**HTTP MCP `abrun`** — spawned agents call home
- Location: `src/api-mcp.ts`
- Run-lifecycle tools: `claim_run`, `get_task`, `update_task`, `add_comment`, `finish_run`, `add_heartbeat`
- Phase + skill tools: `next`, `advance`, `record_debt`, `resolve_debt`, `record_tool` (PreToolUse hook), `use_skill`
- Auth: Bearer token + per-run rotated `run_token`

**Stdio MCP `agentboard`** — interactive session (your current session)
- Location: `plugins/claude-code/mcp/agentboard.mjs` *(thin REST proxy; not part of server TS migration)*
- Tools: read-only board inspection + human actions (approve, reject, dispatch)
- Auth: Bearer token only

### State Machine & Dispatch

Task workflow states:
```
todo → agent_working → [agent_review] → human_approval → done
              ↑                                    ↑
              └────── rework loop (max 3 tries) ──┘
```

Auto-dispatch (`src/dispatch-map.ts`):
- `(status, assignee_role) → next_role` (workflow-aware)
- Triggers on status change **or** assignee change (e.g., reviewer reject flips assignee back to worker)
- Transaction: state CAS + task history + enqueue next run (atomic)

### Postflight Validation

On `finish_run(status='succeeded')`, server enforces role-specific required comments (`src/postflight.ts`) and the inner phase gate (run must have reached `DONE` or an exit verb):

**PM:** description + 1–20 acceptance criteria + `ENRICHMENT_SUMMARY:` comment
**Worker:** `DEV_COMPLETED`, `FILES_CHANGED`, `DIFF_SUMMARY` (or `NO_CHANGES` / `NOT_A_REPO`)
**Reviewer:** `REVIEW_VERDICT:` (approve|reject) + `RATIONALE:` + on reject: `REWORK:` (≥10 chars)

Both Claude and Copilot agents must satisfy same postflight rules.

## Key Conventions

### Project-Level Configuration

```typescript
// agent_provider at project creation
{
  code: 'ACME',
  name: 'ACME Corp',
  workflow_type: 'WF1',           // WF1 = PM→Worker→Reviewer→Human, WF2 = PM→Worker→Human
  repo_path: '/path/to/repo',
  agent_provider: 'claude',       // 'claude' | 'codex' | 'github_copilot'
  max_parallel: 1,                // 1–3 agents in flight per project
  concerns_json: ['well-engineered'],
  scan_ignore_json: [],           // basenames or repo-relative subtree paths
  allow_git: false,
}
```

### Task-Level Override

```typescript
// When manually dispatching a task
PATCH /api/tasks/:id/transition
{
  role: 'worker',
  executor_override: 'github_copilot'   // 'claude' | 'codex' | 'github_copilot'
}
```

The `executor_override` is persisted in `task.agent_provider_override` and resolved at spawn time.

### TypeScript everywhere

- **Server:** pure `.ts`, executed directly via Node 22 `--experimental-strip-types`. `tsc --noEmit` is the typecheck step. No JS emit.
- **UI:** TypeScript source → compiled by Vite → `ui/dist/` (committed artifact, marked `linguist-generated`)

### Committed Artifacts

- **`ui/dist/`** — compiled UI. Users get pre-built artifact; no `npm install` needed.
- Rebuild after UI changes: `cd agent-board-core/ui && npm run build`

### Data Directory (Outside Repo)

- Unix: `~/.agentboard/`
- Windows: `%USERPROFILE%\.agentboard`
- Contains: per-project SQLite DBs, run logs, MCP configs, token, server lock
- Never write to `agent-board-core/` or `plugins/` directories

### Pricing & Cost Tracking

File: `src/pricing.ts` (Claude, Codex, and Copilot models)

- `PRICING_VERSION` bumped when prices change (enables `/agentboard reprice` to recompute history)
- Unknown models → `$0` + uncosted flag (never silently wrong)
- Cost computed on every run finish, even if run was orphaned

### Role Prompts (Product Code)

Location: `agent-board-core/prompts/<role>.md`

- Treat as product code — version, iterate, test against real runs
- Postflight + required-comment checks catch structural drift
- Tone/brevity tuned per role; same prompts used for Claude and Copilot agents

## Common Tasks

### Add a New Role Prompt

1. Create `plugins/claude-code/agent-board-core/prompts/<new_role>.md`
2. Update `src/tool-allowlist.ts` — add tools for role
3. Update `src/dispatch-map.ts` — define routing (which roles can transition to/from)
4. Update `src/postflight.ts` — add required comments (if any) for role
5. Test with `npm run check` + `npm test` + live run

### Support a New Agent Provider

1. **Executor:** Add a new runner class alongside `AgentRunner` / `CodexRunner` / `CopilotRunner`
   - Provider detection → conditional dispatch in `executor.ts::tryClaimAndRun()`
   - Reuse: cost computation, retry, timeout, MCP config (provider-agnostic)

2. **Pricing:** Add provider models to `src/pricing.ts`

3. **Availability:** Detect provider CLI in `src/config.ts`

4. **Task Override:** Ensure `task.agent_provider_override` flows through dispatch

5. **UI:** Display provider badge + model per run

### Enable Copilot for a Project

1. Set `project.agent_provider = 'github_copilot'` via UI or API
2. Copilot CLI must be in PATH on server machine
3. First task enqueued will spawn Copilot agent

### Debug a Failing Run

```bash
# Get session ID from UI (run detail panel)
session_id="<from UI>"

# Resume in your terminal (join live transcript)
claude --resume $session_id

# Or tail raw logs
cat ~/.agentboard/logs/<run_id>.jsonl | jq '.'

# Query run state
sqlite3 ~/.agentboard/projects/<code>.db "
  SELECT id, role, status, error, model, cost_usd
  FROM agent_run WHERE task_id='<task_id>' ORDER BY queued_at DESC;
"
```

## Sharp Edges & Known Limitations

- **`--allowedTools` single-command only.** Compound shell (`cd X && npm install`) triggers permission deadlocks. Push complex logic into role prompts or extend allowlist.
- **Windows argv cap (~32KB).** If role prompts + task body get huge, switch from `--append-system-prompt` to tmp file path.
- **Node 22 requires `--experimental-sqlite` and `--experimental-strip-types`.** `ensure-server.ts` passes both; Node ≥24 ignores harmlessly.
- **Copilot/Codex CLI not on all machines.** Dispatch fails with a surfaced error if the selected provider's CLI/SDK is unavailable.
- **Role prompts tuned for Claude.** Codex and Copilot inherit the same prompts; may need per-provider tuning.

## Current State

- ✅ Project-level agent provider selection (Claude / Codex / Copilot)
- ✅ Task-level executor override
- ✅ Copilot SDK runner + cost tracking
- ✅ Codex CLI runner + cost tracking
- ✅ Inner phase machine (DISCOVERY → … → DONE) + discovery modes
- ✅ Project-scoped skills + 6 built-ins
- ✅ Schema v5 (task_debt, agent_activity, skill, skill_scan, plus phase columns and project flags)
- 🔄 Per-run rate limiting on MCP mutations
- 🔄 Skill-scan UI tree view (table view ships today)

## Further Reading

- **CLAUDE.md** (repo root) — detailed internals, state machine, dispatch rules, phase machine, skills, security model
- **AGENTS.md** (repo root) — multi-agent workflows, MCP tools, executor lifecycle
- **README.md** — feature tour, quick-start, workflow description

## Environment Setup

### Node ≥ 22 or Bun ≥ 1.x

```bash
node --version        # ≥22.x
# or
bun --version         # ≥1.x
```

### Claude Agent SDK

Resolved via `@anthropic-ai/claude-agent-sdk` dependency. Server uses `node:http` and `node:sqlite` (native).

### Codex CLI

```bash
codex --version       # Must be in PATH when project.agent_provider='codex'
```

### Copilot CLI

```bash
copilot --version     # Must be in PATH when project.agent_provider='github_copilot'
```

### Authentication

- Claude agents: `ANTHROPIC_API_KEY` env or active Claude CLI OAuth
- Codex agents: Codex CLI's own OpenAI auth
- Copilot agents: GitHub Copilot CLI authentication

## Files You'll Edit Most

| File | Purpose |
|------|---------|
| `src/executor.ts` | Executor drain loop, run lifecycle, provider resolution |
| `src/agent-runner.ts` | Claude Agent SDK wrapper |
| `src/codex-runner.ts` | Codex CLI subprocess wrapper |
| `src/copilot-runner.ts` | Copilot SDK wrapper |
| `src/repo.ts` | DB queries, task dispatch, state transitions |
| `src/dispatch-map.ts` | Workflow routing rules |
| `src/postflight.ts` | Role-specific finish requirements + phase gate |
| `src/phase-machine.ts` / `src/phase-repo.ts` | Inner per-run FSM |
| `src/skill-repo.ts` / `src/skill-scanner.ts` | Project skills catalog |
| `plugins/claude-code/agent-board-core/prompts/*.md` | Role system/user prompts |
| `db/schema.sql` | Database schema (idempotent, run on every open) — schema v5 |
| `plugins/claude-code/agent-board-core/ui/src/**` | React UI components |
