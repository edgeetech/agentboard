# Copilot Instructions for AgentBoard

AgentBoard is a multi-agent workflow orchestrator running as a Claude Code plugin. This file guides Copilot CLI sessions working in this repository.

## Build & Run

### Core Server

```bash
# From plugins/claude-code/agent-board-core/
node server.mjs                    # Start server standalone (127.0.0.1 only)

# Via plugin entry point
node plugins/claude-code/bin/ensure-server.mjs  # Boot server (idempotent, version-aware)
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
  node --experimental-sqlite --no-warnings plugins/claude-code/agent-board-core/server.mjs

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

Current: Uses Claude Agent SDK via `AgentRunner` class in `src/agent-runner.mjs`

```
executor.mjs (drain loop)
  → tryClaimAndRun(project, run)
    → resolve effective executor provider (task override > project default > 'claude')
    → AgentRunner({ provider, role, prompt, systemPrompt, mcp, ... })
    → runner.run() → stream-json parsing → cost computation
    → finishRun() or scheduleRetry()
```

Key files:
- `src/executor.mjs` — drain loop, reaper, run lifecycle, executor provider resolution
- `src/agent-runner.mjs` — Claude Agent SDK wrapper
- `src/copilot-runner.mjs` — Copilot CLI wrapper (mirrors AgentRunner interface)
- `src/repo.mjs` — DB queries, task dispatch, state transitions
- `src/retry-manager.mjs` — retry scheduling + exponential backoff
- `src/supervisor.mjs` — crash recovery wrapper

### Multi-Agent Support

**Status:** 🔄 In Progress. Schema and routing logic complete; Copilot CLI spawning in active implementation.

```
project.agent_provider  = 'claude' | 'github_copilot'  [ready]
task.agent_provider_override  = 'claude' | 'github_copilot' | NULL  [ready]
```

**Implemented:**
- Resolution: `task.agent_provider_override ?? project.agent_provider ?? 'claude'` ✅
- Schema: both columns, migrations, validation ✅
- API: project POST/PATCH, task executor_override parameter ✅
- Cost computation for both models ✅
- Unit tests: executor resolution, cost computation ✅

**In Progress:**
- CopilotRunner spawn logic (placeholder → actual Copilot CLI integration)
- Copilot CLI availability detection
- Integration tests with mocked Copilot CLI

### MCP Surfaces

**HTTP MCP `abrun`** — spawned agents call home
- Location: `src/api-mcp.mjs`
- Tools: `claim_run`, `get_task`, `update_task`, `add_comment`, `finish_run`, `add_heartbeat`
- Auth: Bearer token + per-run rotated `run_token`

**Stdio MCP `agentboard`** — interactive session (your current session)
- Location: `mcp/agentboard.mjs`
- Tools: read-only board inspection + human actions (approve, reject, dispatch)
- Auth: Bearer token only

### State Machine & Dispatch

Task workflow states:
```
todo → agent_working → [agent_review] → human_approval → done
              ↑                                    ↑
              └────── rework loop (max 3 tries) ──┘
```

Auto-dispatch (`src/dispatch-map.mjs`):
- `(status, assignee_role) → next_role` (workflow-aware)
- Triggers on status change **or** assignee change (e.g., reviewer reject flips assignee back to worker)
- Transaction: state CAS + task history + enqueue next run (atomic)

### Postflight Validation

On `finish_run(status='succeeded')`, server enforces role-specific required comments (`src/postflight.mjs`):

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
  agent_provider: 'claude',       // or 'github_copilot' (when fully supported)
  max_parallel: 1,                // 1–3 agents in flight per project
}
```

### Task-Level Override (Ready)

```typescript
// When manually dispatching a task
PATCH /api/tasks/:id/transition
{
  role: 'worker',
  executor_override: 'github_copilot'   // overrides project.agent_provider for this run
}
```

The `executor_override` is persisted in `task.agent_provider_override` and resolved at spawn time.

### TypeScript + JSDoc

- **Core:** vanilla `.mjs` with JSDoc type hints (no runtime compilation)
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

File: `src/pricing.mjs` (Claude models + Copilot models when added)

- `PRICING_VERSION` bumped when prices change (enables `/agentboard reprice` in v1.1)
- Unknown models → `$0` + uncosted flag (never silently wrong)
- Cost computed on every run finish, even if run was orphaned

### Role Prompts (Product Code)

Location: `agent-board-core/prompts/<role>.md`

- Treat as product code — version, iterate, test against real runs
- Postflight + required-comment checks catch structural drift
- Tone/brevity tuned per role; same prompts used for Claude and Copilot agents

## Common Tasks

### Add a New Role Prompt

1. Create `agent-board-core/prompts/<new_role>.md`
2. Update `src/tool-allowlist.mjs` — add tools for role
3. Update `src/dispatch-map.mjs` — define routing (which roles can transition to/from)
4. Update `src/postflight.mjs` — add required comments (if any) for role
5. Test with `npm run typecheck` + live run

### Support a New Agent Provider

1. **Executor:** Extend `AgentRunner` with provider branching (Claude vs Copilot CLI)
   - Provider detection → conditional spawn logic
   - Reuse: cost computation, retry, timeout, MCP config (provider-agnostic)
   
2. **Pricing:** Add provider models to `src/pricing.mjs`

3. **Availability:** Detect provider CLI in `src/config.mjs`

4. **Task Override:** Ensure `task.agent_provider_override` flows through dispatch

5. **UI:** Display provider badge + model per run

### Enable Copilot for a Project

1. Set `project.agent_provider = 'github_copilot'` via UI or API
2. Copilot CLI must be in PATH on server machine
3. First task enqueued will spawn Copilot agent (when implementation complete)

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
- **Node 22 requires `--experimental-sqlite`.** `ensure-server.mjs` passes it; Node ≥24 ignores harmlessly.
- **Copilot CLI not on all machines.** When fully supported, fallback to Claude or show error if Copilot selected but unavailable.
- **Role prompts tuned for Claude.** Copilot inherits same prompts; may need post-launch tuning.

## Current Incoming Work

- ✅ Project-level agent provider selection (schema + UI ready)
- 🔄 Task-level executor override (in planning)
- 🔄 Copilot CLI spawn implementation (in planning)
- 🔄 Copilot cost tracking (in planning)
- ⏳ Copilot agent validation (planned after MVP)

## Further Reading

- **CLAUDE.md** (repo root) — detailed internals, state machine, dispatch rules, security model
- **README.md** — feature tour, quick-start, workflow description
- **plan.md** (session workspace) — full implementation roadmap for Copilot support

## Environment Setup

### Node ≥ 22 or Bun ≥ 1.x

```bash
node --version        # ≥22.x
# or
bun --version         # ≥1.x
```

### Claude Agent SDK

Installed implicitly via `--experimental-sqlite` Node flag + native HTTP/SQLite modules.

### Copilot CLI (When Enabled)

```bash
copilot --version     # Must be in PATH when project.agent_provider='github_copilot'
```

### Authentication

- Claude agents: `ANTHROPIC_API_KEY` env or active Claude CLI OAuth
- Copilot agents: GitHub Copilot CLI authentication (when supported)

## Files You'll Edit Most

| File | Purpose |
|------|---------|
| `src/executor.mjs` | Executor drain loop, run lifecycle, provider resolution |
| `src/agent-runner.mjs` | Claude Agent SDK wrapper (extend for Copilot) |
| `src/repo.mjs` | DB queries, task dispatch, state transitions |
| `src/dispatch-map.mjs` | Workflow routing rules |
| `src/postflight.mjs` | Role-specific finish requirements |
| `agent-board-core/prompts/*.md` | Role system/user prompts |
| `db/schema.sql` | Database schema (idempotent, run on every open) |
| `agent-board-core/ui/src/**` | React UI components |
