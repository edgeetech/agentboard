<div align="center">

# 🎛️ AgentBoard

### Multi-agent orchestration platform: Run Claude, Codex, Copilot, and future AI agents like a kanban team — locally, with full cost + audit trails.

[![Version](https://img.shields.io/badge/version-0.1.86-3b82f6?style=for-the-badge)](./plugins/claude-code/.claude-plugin/plugin.json)
[![License](https://img.shields.io/badge/license-Elastic--2.0-f59e0b?style=for-the-badge)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-22c55e?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d946ef?style=for-the-badge)](https://docs.claude.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex%20CLI-supported-10a37f?style=for-the-badge)](AGENTS.md#supported-agents--status-table)
[![Copilot CLI](https://img.shields.io/badge/Copilot%20CLI-supported-0d9488?style=for-the-badge)](AGENTS.md#copilot-cli-setup)
[![Local-only](https://img.shields.io/badge/cloud-zero-ef4444?style=for-the-badge)]()

**🟦 PM** → **🟧 Worker** → **🟪 Reviewer** → **🟩 Human** — a real workflow, not a chat window.

**Agents:** [Claude Code](CLAUDE.md) · [Codex CLI](AGENTS.md#supported-agents--status-table) · [Copilot CLI](AGENTS.md#copilot-cli-setup) · [More coming](AGENTS.md#supported-agents--status-table)

</div>

---

## 🚀 Which setup is for you?

AgentBoard works as a **Claude Code plugin** or **standalone server** supporting Claude Code, Copilot CLI, and future agents.

### 🔷 Claude Code User? → Claude Code Plugin

Install the plugin inside any Claude Code session:

```bash
/plugin marketplace add edgeetech/agentboard
/plugin install agentboard@agent-board-local
/reload-plugins
/agentboard:open      # boots local server + opens UI in your browser
```

**Requires:** Node ≥ 22 *or* Bun ≥ 1.x · `npm` (or `bun`) on `PATH` · `claude` CLI ≥ 2.0.0 · `ANTHROPIC_API_KEY` env or active OAuth (`claude /login`) · Windows / macOS / Linux.

> **First run installs core deps automatically.** The plugin marketplace ships only source — on the first `/agentboard:open` (or session-start hook) after install/upgrade, AgentBoard runs `npm install` (prefers `bun install` if present) inside the cached `agent-board-core/` directory. Expect a one-time ~20 s pause. If install fails (no `npm`/`bun` on `PATH`, no network), the server exits with code 4 and prints the manual command to run.

### 🔶 Copilot CLI User? → See [AGENTS.md § Copilot CLI Setup](AGENTS.md#copilot-cli-setup)

Or run standalone server:

```bash
git clone https://github.com/edgeetech/agentboard.git
cd plugins/claude-code/agent-board-core
npm install
node --experimental-sqlite --experimental-strip-types --no-warnings server.ts
# Open http://localhost:3000
```

### 🤔 Not sure? → See [AGENTS.md § 2. Supported Agents](AGENTS.md#2-supported-agents--status-table)

---

<div align="center">

[![AgentBoard — kanban board + task detail](./docs/images/collage-hero.png)](./docs/images/collage-hero.png)

<sub>The board on the left, a task detail with runs + cost + acceptance criteria on the right. <a href="./docs/images/collage-hero.png">Click to enlarge.</a></sub>

</div>

---

## ⚡ Why AgentBoard?

Multi-agent AI is powerful, but the day-to-day is messy:

- 💸 No idea what each run **cost** until the bill arrives.
- 🕵️ Can't see **why** an agent did what it did — logs scattered.
- 🔁 "Just one more retry" turns into runaway loop.
- ☁️ Only options are cloud SaaS dashboards that ship your prompts off-box.

**AgentBoard fixes that.** Local kanban board, one SQLite per project, real-time cost per run, hard ceiling on rework loops, human approval gate before anything ships.

---

## ✨ What's inside

| | |
|---|---|
| 🟦🟧🟪🟩 **Four roles, one flow** | PM enriches → Worker codes → Reviewer verifies → Human approves. Pick **WF1** (full loop) or **WF2** (skip Reviewer). |
| 🕹️ **Auto *or* semi-auto mode** | **Auto** — agents drive transitions end-to-end. **Semi** — you drive status changes, agents only annotate (comments + ACs). Switch per project, any time. |
| 🧾 **Acceptance Criteria, enforced** | PM writes 3–7 testable ACs. Reviewer must check them. Server rejects finishes that skip the audit. |
| 💰 **Real-time cost per run** | Every run parses SDK usage events and stamps `cost_usd` from latest Opus / Sonnet / Haiku pricing. Project header shows all-time, 7d, 30d totals. |
| 🤖 **Multi-agent execution** | Run tasks with **Claude agents** (default), **Codex CLI**, or **Copilot CLI** (for capability mix). Set per-project or override per-task. |
| 🧭 **Inner phase machine** | Each run drives an FSM: `DISCOVERY → REFINEMENT → PLANNING → EXECUTING → VERIFICATION → DONE` (plus `cancel|wontfix|revisit` exits). Discovery modes — `full | validate | technical-depth | ship-fast | explore` — tune the loop per task. Live phase + tool activity streamed over SSE. |
| 🪪 **Project-scoped skills** | Server scans `<repo>/**/.claude/skills/*` (folder skills with `SKILL.md` and flat `<name>.md`) on project create / repo change / manual rescan. Disk is source of truth; UI edits write back. 6 read-only built-ins (code-review, unit-tests, tech-spec, refactor, api-client, release-notes) merged into the same catalog. Agents resolve by name via `mcp__abrun__use_skill` with fuzzy suggestions on miss. |
| 🎯 **Concern packs** | Pluggable concern lists steer PM/Worker/Reviewer prompts. Built-in packs: `well-engineered`, `beautiful-product`, `long-lived`. Custom packs per project via `concerns_json`. |
| 🔁 **Bounded rework loop** | Max 3 reviewer rejects per task. After that, task stalls with "Retry from Worker" button — no runaway agents. |
| 🔄 **Automatic retry with backoff** | Failed runs automatically re-enqueue with exponential backoff (1s → 2s → 4s, capped at 5min, max 3 attempts). Retry history logged in `retry_state` per run. Configurable via `max_retry_attempts` / `max_retry_backoff_ms`. |
| 🔗 **External tracker sync** | Connect Linear, GitHub Issues, or GitLab to a project. Background poller creates agentboard tasks from incoming issues, marks tasks done when issues hit terminal state. Config via `tracker_config` table; REST API at `/api/projects/{code}/tracker`. |
| 🛡️ **Workspace path safety** | Per-task workspaces validated against path traversal (`../`) and symlink attacks before creation. Artifact caches (`.cache`, `node_modules/.cache`, `.vite`, `.turbo`, etc.) cleaned between runs. Shell lifecycle hooks (`afterCreate`, `beforeRun`, `afterRun`, `beforeRemove`) with 30s timeout. |
| 🔒 **Local-only by design** | Binds `127.0.0.1`, DNS-rebind guard, Bearer + per-run rotated tokens, whitelisted child env. AWS / GitHub / SSH secrets in your shell are **not** passed to spawned agents. |
| 🪝 **Step into any run** | Each run gets `--session-id`. One click copies `claude --resume <id>` so you can jump into the live transcript from your terminal. |
| 🎨 **9 themes, light + dark** | AgentBoard, EdgeeTech, Primer, Monochrome, Neon, Warm Tones, Muted Pastels, Deep Jewel, Vibrant. |

**Server:** Node ≥ 22, vanilla `node:http`, `node:sqlite` (built-in). The HTTP server uses only Node.js standard library; the overall plugin package includes a small set of production dependencies (Claude SDK, Commander, LiquidJS, Pino) for agent execution and background services.

---

## 🖼️ Product tour

Nine screens in one image — board, task creation, run detail with cost + ACs, comment audit trail, roles, skills, themes, sessions index, session timeline.

<div align="center">

[![Product tour: board, tasks, runs, comments, roles, skills, themes, sessions](./docs/images/collage-tour.png)](./docs/images/collage-tour.png)

<sub><a href="./docs/images/collage-tour.png">Click to enlarge</a> — or browse individual screenshots in <a href="./docs/images/">docs/images/</a>.</sub>

</div>

---

## 🧠 How it works

AgentBoard routes tasks to the right **executor** — Claude SDK, Codex CLI, Copilot CLI, or future agents — based on project/task configuration. See [AGENTS.md § Executor Lifecycle](AGENTS.md#5-executor-lifecycle) for full details.

```
   Your AI agent platform
             │  (stdio MCP — read-only board + approve/reject)
             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  AgentBoard core server  (Node, 127.0.0.1)                   │
    │  • REST + JSON-RPC HTTP MCP (abrun — for agents)             │
   │  • Per-project SQLite (WAL, schema v5)                       │
    │  • Multi-executor routing: Claude SDK + Codex + Copilot     │
   │  • Inner phase machine (DISCOVERY→…→DONE) per run            │
   │  • Skill scanner: <repo>/**/.claude/skills/* + 6 built-ins   │
   │  • RetryManager: exponential backoff, max 3 attempts         │
   │  • TrackerPoller: Linear / GitHub / GitLab background sync   │
   │  • Reaper: 15min heartbeat timeout                           │
   └──────────┬───────────────────────────────────────────────────┘
              │
   ┌──────────┴────────────┐
   ▼                       ▼
  PM agent            Worker agent       (and Reviewer in WF1)
  └─ writes ACs       └─ edits files
                        no commits, no branches
```

**State machine:**

```
  todo ─▶ agent_working ─▶ agent_review ─▶ human_approval ─▶ done
                            └─── rework loop, max 3 ────┘
```

**Two workflows, picked per project at creation:**

- **WF1** — `Todo → Working → Review → Approval → Done` (full loop with Reviewer). See [AGENTS.md § Workflows](AGENTS.md#workflows-wf1-vs-wf2)
- **WF2** — `Todo → Working → Approval → Done` (skip Reviewer step)

**Two dispatch modes, switchable any time:**

- 🤖 **Auto** *(default)* — agents claim runs, change status, hand off. You only step in at Human Approval.
- 🕹️ **Semi** — you stay in the driver's seat. Agents are blocked from status/assignee changes; they may only add comments and acceptance criteria. Server returns `semi-automated mode: agents may not change status/assignee — add comments only; user drives transitions` if a run tries.

---

## 🛠️ Claude Code Plugin Commands

**If using AgentBoard as a Claude Code plugin, these slash commands are available:**

| Command | Does |
|---|---|
| `/agentboard:open` | Boots (or reuses) local server, opens UI in default browser. |
| `/agentboard:stop` | SIGTERMs the server. Children in flight finish on their own. |
| `/agentboard:doctor` | Health checklist: Node/Bun version, claude CLI, auth, data dir, DB schema, pricing freshness, available updates. |
| `/agentboard:update` | Checks GitHub `main` for newer plugin version, prints upgrade commands. |
| `/agentboard:delete-project` | Interactive: pick project → confirm → DB moved to `~/.agentboard/trash/` (manual restore possible). |

**Using Copilot CLI or standalone server?** See [AGENTS.md § Getting Help](AGENTS.md#9-getting-help) for how to interact with AgentBoard.

---

## 🔒 Security & privacy

- **127.0.0.1 only.** Server refuses any `Host` header that isn't `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebind guard, returns 421).
- **Bearer + per-run tokens.** 32-byte hex token in `~/.agentboard/config.json` (0600 on Unix, ACL'd on Windows). Each run gets a `run_token` issued exactly once at `claim_run`.
- **Whitelisted child env.** Spawned agents receive only `PATH`, `HOME`, `USER`, `LANG`, `TZ`, Claude auth vars, and Windows OS basics. AWS, GitHub, SSH, GCP, cloud-SDK secrets dropped.
- **CSP nonce + HttpOnly cookie** on the UI. No inline scripts without nonce.
- **No telemetry.** Nothing leaves your machine. Logs at `~/.agentboard/logs/<run_id>.ndjson` are full Claude transcripts — treat data dir as sensitive.

---

## 📂 Where data lives

Outside the repo, untouched by plugin upgrades:

```
~/.agentboard/                  (%USERPROFILE%\.agentboard on Windows)
  projects/<code>.db            one SQLite per project (WAL, schema v5)
  logs/<run_id>.ndjson           Claude SDK structured events
  logs/<run_id>.err.log         captured stderr
  run-configs/<id>.json         tmp MCP config per run (deleted on exit)
  trash/<code>-<timestamp>.db   deleted projects (manual restore possible)
  config.json                   port, pid, token, server_id, active project
  server.lock                   single-instance lock
```

**Per-project DB tables (schema v5):**

| Table | Purpose |
|---|---|
| `project` | Project config — workflow, repo path, agent provider, `concerns_json`, `scan_ignore_json`, `allow_git` |
| `task` | Tasks with status, assignees, acceptance criteria, `discovery_mode` |
| `task_history` | Full audit trail of every status transition |
| `task_attachment` | Files or URLs attached to a task |
| `task_debt` | Per-task debt items recorded during a run (tech debt, follow-ups) |
| `agent_run` | Agent runs with cost, session-id, attempt count, `phase`, `phase_state_json`, `phase_history_json` |
| `agent_activity` | Live event log (phase transitions, tool calls) — backs the SSE stream |
| `retry_state` | Retry history per run (backoff delay, error, next attempt) |
| `tracker_config` | External tracker connections per project |
| `tracker_issue` | Synced issues from external trackers |
| `skill` | Skills discovered in `<repo>/**/.claude/skills/*` (folder + flat) |
| `skill_scan` | Scan run history (status, started/finished, errors) |
| `meta` | DB schema version (currently `5`) |

---

## 🧰 Tech stack

| Layer | Stack |
|---|---|
| **Server** | Node ≥ 22, vanilla `node:http`, `node:sqlite` (built-in). TypeScript executed directly via `--experimental-strip-types` (no JS emit). Production deps: `commander` · `liquidjs` · `pino` · `zod`. |
| **Agent runners** | **Claude SDK** (`@anthropic-ai/claude-agent-sdk`) — in-process, streaming. **Codex CLI** — subprocess. **Copilot SDK** (`@github/copilot-sdk`) — in-process, mirrors Claude runner contract. Multi-executor routing based on project/task configuration. |
| **UI** | React 18 · Vite · TanStack Query · Zustand · @dnd-kit · react-i18next |
| **MCP** | Two surfaces — `abrun` (HTTP, for spawned agents) and `agentboard` (stdio, for your interactive session). Names differ deliberately so `--strict-mcp-config` filters cleanly. |
| **Pricing** | Opus 4.7 / Sonnet 4.6 / Haiku 4.5 + Copilot Pro, versioned. Unknown model → `$0` + `uncosted` flag — never silently wrong numbers. See [AGENTS.md § Supported Agents](AGENTS.md#2-supported-agents--status-table) for per-agent pricing. |
| **Tests** | Vitest · 231 tests across 27 files (state machine, phase machine, phase repo, postflight phase gate, retry, tracker, workspace safety/manager, supervisor, turn timeout, rate limiter, prompt builder, event bus, executor resolution, cost computation, skill repo, skill scanner, skill scan worker, api-skills, api-mcp use_skill, concerns, discovery modes, codex config, copilot runner, run hooks, folder rules, string distance, project triggers). Run via `npm test`. Quality gate: `npm run check` (`typecheck && lint && format:check`). |

---

## 🔗 External tracker sync

Connect a Linear, GitHub Issues, or GitLab project to auto-populate agentboard tasks:

```bash
# POST /api/projects/{code}/tracker
{
  "kind": "github",
  "api_key_env_var": "GITHUB_TOKEN",
  "project_slug": "owner/repo",
  "active_states": ["open"],
  "terminal_states": ["closed", "merged"],
  "poll_interval_ms": 300000
}

# Enable / disable polling
POST /api/projects/{code}/tracker/enable
POST /api/projects/{code}/tracker/disable

# Force an immediate sync
POST /api/projects/{code}/tracker/sync

# List synced issues
GET /api/projects/{code}/tracker/issues
```

The background `TrackerPoller` starts 5 s after boot, checks each configured project on its own schedule, and syncs new/updated issues as agentboard tasks. Deleted or terminal issues are resolved automatically.

---

## 🔄 Automatic retry with backoff

Failed agent runs (non-`completed` status or unhandled exception) are automatically retried with exponential backoff:

| Attempt | Delay |
|---|---|
| 1 → 2 | 1 s |
| 2 → 3 | 2 s |
| 3 (max) | permanent failure |

Configure per-project in the project config or via env:

```json
{ "max_retry_attempts": 3, "max_retry_backoff_ms": 300000 }
```

Each retry creates a new `agent_run` row with an incremented `attempt` counter, and a `retry_state` row recording the delay and error message. The `run.failed` SSE event carries `{ permanent: true }` on the last attempt.

---



Spawned agents run with `--strict-mcp-config`, so only the per-run `abrun` HTTP MCP is loaded by default. Two opt-in knobs:

1. **Inherit `~/.claude.json` MCPs** — set `"inherit_user_mcps": true` in `~/.agentboard/config.json` (or scope it: `["mcp-atlassian"]`).
2. **Custom MCPs** — drop a `mcpServers` block in `~/.agentboard/mcps.json`, merged into the per-run config.

The `Skill` tool is in every role's allowlist, so agents can invoke your installed skills (caveman, ctx-*, etc.) via `Skill(name)`.

---

## 🪝 Stepping into a running agent

Each run is spawned with `--session-id <uuid>`. The task detail panel has an **Open in CLI** button per run that copies:

```
claude --resume <session-id>
```

Paste in a terminal at the project repo and you're inside the agent's session. If the run is still live, the button reads **Join in CLI** and warns you that resume may fork the session.

---

## 🗺️ Roadmap

- 🛡️ Per-run rate limiting on MCP mutations
- 💱 `/agentboard reprice` skill — recompute historical run costs when Anthropic prices change
- 🔍 Auto-discover plugin-registered MCPs (today, mirror them into `~/.claude.json` or `mcps.json`)
- 🌳 Skill-scan UI tree view (deferred — table view ships today)

---

## 🤝 Contributing

Issues, PRs, feedback welcome at [github.com/edgeetech/agentboard](https://github.com/edgeetech/agentboard).

For internals — state machine rules, dispatch logic, sharp edges — see [CLAUDE.md](./CLAUDE.md).

---

## 📄 License

[Elastic License 2.0](./LICENSE). You may self-host and modify freely. You may **not** offer AgentBoard as a managed service to third parties.

---

<div align="center">

Crafted at **EdgeeTech Limited** · [github.com/edgeetech/agentboard](https://github.com/edgeetech/agentboard)

⭐ If AgentBoard helps you ship cleaner agent workflows, drop a star — helps others find it.

</div>


