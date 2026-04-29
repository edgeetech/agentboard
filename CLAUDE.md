# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`agentboard` is a Claude Code plugin that runs a local kanban board driven by headless `claude -p` subprocesses. A Node.js server (`agent-board-core/`) holds per-project SQLite DBs, spawns headless runs with role-specific prompts (PM / Worker / Reviewer), and serves a React UI. The plugin itself (`plugins/claude-code/`) is a thin wrapper that boots the server and exposes read/approve tools over stdio MCP for the user's interactive Claude session.

## Commands

All core-dev commands run from `plugins/claude-code/agent-board-core/`:

```bash
# Start server standalone (usually done via /agentboard:open, not directly)
node --experimental-sqlite --no-warnings server.mjs

# Rebuild UI bundle (emits to ui/dist/, which IS committed)
cd ui && npm install && npm run build

# Type-check UI without emit
cd ui && npx tsc --noEmit
```

From the plugin directory:

```bash
# Boot/reuse server (idempotent; reads config.json, respawns on version mismatch)
node plugins/claude-code/bin/ensure-server.mjs

# From inside Claude Code:
/agentboard:open     # boot server + open UI
/agentboard:stop     # SIGTERM the server
/agentboard:doctor   # health checklist
```

### Test / iterate on a live run

```bash
# Fast-reaper mode (override 15min timeout)
AGENTBOARD_REAPER_TIMEOUT_MS=10000 AGENTBOARD_REAPER_SWEEP_MS=2000 \
  node --experimental-sqlite --no-warnings plugins/claude-code/agent-board-core/server.mjs

# Tail a run's stream-json log
cat ~/.agentboard/logs/<run_id>.jsonl | jq .

# Inspect DB directly
sqlite3 ~/.agentboard/projects/<code>.db "SELECT code, status, assignee_role, rework_count FROM task;"
```

## Architecture — the big picture

### Two MCP surfaces with deliberately different names

1. **HTTP MCP key `abrun`** (`plugins/claude-code/agent-board-core/src/api-mcp.mjs`) — consumed by **spawned headless `claude -p` runs** via a per-run tmp `--mcp-config` file. Exposes mutation tools: `claim_run, get_task, update_task, add_comment, finish_run, add_heartbeat`. Requires server Bearer token (outer) AND per-run `run_token` (per-call, rotated on `claim_run`). Speaks JSON-RPC 2.0.

2. **Stdio MCP key `agentboard`** (`plugins/claude-code/mcp/agentboard.mjs`) — consumed by the **user's interactive Claude Code session**. Read-only board inspection + Human-role actions (`approve_task, reject_task, dispatch_task`). Thin REST proxy.

   Keys intentionally differ so `--strict-mcp-config` in the executor filters out the stdio plugin MCP; if both were named `agentboard` they'd shadow each other. **Do not rename `abrun` without also updating `src/tool-allowlist.mjs`, both `prompts/*.md`, and the `mcpServers` key in `executor.mjs`.**

### State machine + auto-dispatch

Task transitions are workflow-aware CAS updates:

- `src/state-machine.mjs` holds the `(WF1|WF2, from_status, to_status, by_role)` allow-list. **Human role can now initiate tasks from Todo → Agent Working**, allowing semi-automated workflows where users drive task dispatch.
- `src/dispatch-map.mjs` resolves `(status, assignee_role)` → role to auto-dispatch. **Triggers on assignee change as well as status change** — this is how Reviewer-reject (status unchanged, assignee flips reviewer→worker) and Worker-NEEDS_PM (worker→pm) routing work.
- `src/repo.mjs::transitionTask` does the CAS, writes `task_history`, and enqueues the next `agent_run` **in the same SQLite transaction**. The executor polls `queued` rows independently, so crash-between-write-and-dispatch is safe.

### Postflight and audit comments

On `finish_run(status='succeeded')` the server enforces role-specific required comments (`src/postflight.mjs`):

- PM: `description` non-empty + AC 1..20 items + `ENRICHMENT_SUMMARY:` comment.
- Worker: `DEV_COMPLETED`, `FILES_CHANGED`, `DIFF_SUMMARY` (literal `NO_CHANGES` / `NOT_A_REPO` allowed).
- Reviewer: `REVIEW_VERDICT:` (approve|reject) + `RATIONALE:` + on reject `REWORK:` (min 10 chars).

Assignee reassigns within `agent_working` also require a prefixed comment (`REWORK:` for reviewer→worker, `NEEDS_PM:` for worker→pm). Enforced in `update_task` before the CAS.

### Executor lifecycle

`src/executor.mjs`:
1. Drains `queued` runs respecting `project.max_parallel` (default 1, cap 3).
2. For each: pre-check `repo_path` exists → open stdout/stderr log fds → write tmp MCP config with `run_token` Bearer → `spawn` detached `claude -p` with `--strict-mcp-config --allowedTools <per-role> --permission-mode acceptEdits --output-format stream-json --max-turns 60`.
3. On child exit: parse `logs/<run_id>.jsonl` for `model` (system.init event) + `usage` (per message.usage), compute cost via `src/pricing.mjs`, stamp `agent_run.cost_usd` + `cost_version`.
4. Reaper every 60s marks `running` runs as `failed` when `last_heartbeat_at` is older than 15min (each MCP call bumps heartbeat).

### Security model

- Server binds `127.0.0.1` only, rejects requests whose `Host` header isn't `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding guard).
- 32-byte hex token in `~/.agentboard/config.json` (0600 on Unix, `icacls` ACL on Windows).
- Browser UI receives token via inlined `<script>` on `GET /` and via `Set-Cookie: ab_token=...` (so plain `<a href="/api/logs/:id">` links authenticate without JS).
- `/alive` is unauthenticated, returns only `{ok, server_id, plugin_version}` — used by `ensure-server.mjs` to detect stale config / plugin version upgrades.
- `/healthz` requires Bearer.

## Modification rules

- **UI `dist/` IS committed.** Rebuild via `cd agent-board-core/ui && npm run build` after UI changes. `.gitattributes` marks it `linguist-generated` so GitHub collapses it in PR diffs. Users who install the plugin must not need `npm install` — the plugin is a git-clone-and-go artifact.
- **No TypeScript runtime compilation step.** Core is plain `.mjs` with JSDoc where helpful. UI is the only TS — compiled to `ui/dist/` by Vite.
- **Data dir is outside the repo.** `~/.agentboard/` on Unix, `%USERPROFILE%\.agentboard` on Windows. Never write project data into `agent-board-core/` or `plugins/`.
- **Pricing table in `src/pricing.mjs`** has `PRICING_VERSION`. Bump it when Anthropic prices change, so v1.1 `/agentboard reprice` can recompute historical runs.
- **Role prompts in `agent-board-core/prompts/*.md` are the product.** Treat them like code — version them, iterate against real runs. Drift-guards (postflight + required-comment checks) catch structural mistakes, but tone/brevity is prompt-only.

## Security model specifics (reviewer's Q → A)

- **Child env is whitelisted, not inherited.** `src/child-env.mjs::buildChildEnv` ships only PATH/HOME/USER/LANG/TZ + Claude-auth vars (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, etc.) on POSIX; Windows adds USERPROFILE/APPDATA/LOCALAPPDATA/SYSTEM* and friends. AWS, GitHub, SSH, GCP, cloud SDK vars are dropped. If you add a new env var the CLI needs, add it to that module — not `{...process.env}`.
- **`claim_run` returns `run_token` exactly once, to the queued→running CAS winner.** There is no "already-claimed" retry path; a subsequent call on a running run returns an error. This is deliberate; don't add a "convenience" retry.
- **REST `/api/tasks/:id/transition` always writes `by_role='human'`.** Client-supplied `by_role` is ignored. Agent transitions happen through the HTTP MCP endpoint, which is the only place `by_role` is derived from `run.role`.
- **`/alive` is intentionally unauth.** It returns `{ok, server_id, plugin_version}` — used by `ensure-server.mjs` to detect stale config or version mismatch. No token, no secrets. Do not protect it.
- **Log files at `~/.agentboard/logs/<run_id>.jsonl` contain full agent transcripts** (prompts, tool I/O, anything the agent echoed). Served via `/api/logs/:run_id` (Bearer-protected, ULID-gated for traversal). Treat the data dir as sensitive — document for users.
- **No rate limiting yet** — planned for v1.1 (`#security-v1.1`). 127.0.0.1-only binding limits risk to local processes with the token.

## Known sharp edges

- `--allowedTools` only matches single commands. Compound shell (`cd X && npx tsc`) triggers permission prompts that deadlock headless runs. If Worker hits this, extend allowlist or push the command structure into the prompt.
- `claude --bare` disables OAuth auth; do NOT re-add it to the executor.
- Windows argv cap (~32KB) bounds the size of `--append-system-prompt`. If role prompts + rendered task body get huge, switch to passing a tmp file path instead.
- `node:sqlite` requires `--experimental-sqlite` on Node 22; `ensure-server.mjs` passes it on spawn. Node ≥24 ignores the flag harmlessly.

## References

- `.claude/plans/i-need-you-to-sleepy-scroll.md` (in the parent workspace) — full design plan with architecture, data model, dispatch rules, verification steps. Treat as canonical when plan and code disagree; otherwise trust the code.
