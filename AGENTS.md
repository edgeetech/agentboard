# Agents: Setup, Workflows & Multi-Agent Orchestration

**AgentBoard** is a multi-agent orchestration platform supporting **Claude Code**, **Copilot CLI**, and future agent providers. This guide covers setup, workflows, and how to mix agents in a single project.

**For Claude Code plugin specifics, see [CLAUDE.md](CLAUDE.md).**
**For platform overview & features, see [README.md](README.md).**

---

## 1. Overview: Agents as Teams

In AgentBoard, an **agent** is a role-driven autonomous executor—Claude Code, Copilot CLI, or any future provider. Agents work as a team to complete kanban tasks across three roles:

| Role | Purpose | Examples |
|------|---------|----------|
| **PM** | Task interpretation, acceptance criteria, enrichment | Claude (default), Copilot CLI |
| **Worker** | Implementation, coding, file changes | Claude (default), Copilot CLI, Docker container |
| **Reviewer** | Code review, testing, approval/rejection | Claude (default), Copilot CLI |
| **Human** | Break tie-breaking, decisions, final approval | Always human |

Each role-assignment can use a different agent—enabling **cost optimization**, **capability targeting**, and **workflow flexibility** within the same project.

### Why Multiple Agents?

- **Cost:** Copilot CLI for routine tasks, Claude for complex reasoning
- **Capability:** Claude for deep analysis, Copilot CLI for speed
- **Availability:** Switch providers if one is overloaded
- **Specialization:** Future agents (GPT, Gemini, local LLM) for domain-specific work

---

## 2. Supported Agents & Status Table

| Provider | Role Support | Status | Setup | Notes |
|----------|--------------|--------|-------|-------|
| **Claude Code** | PM, Worker, Reviewer | ✅ Stable | [CLAUDE.md](CLAUDE.md) | Production ready. Highest reasoning capability. |
| **Copilot CLI** | PM, Worker, Reviewer | ✅ Stable | [Copilot CLI Setup](#copilot-cli-setup) | Production ready. Cost-optimized. |
| **Docker Container** | All roles | 🔄 Planned | TBD | Run custom LLM or task runner in container. |
| **HTTP Webhook** | All roles | 🔄 Planned | TBD | Call external service (Lambda, custom API). |
| **Local LLM** | All roles | 🔄 In Design | TBD | Ollama, LM Studio, or vLLM integration. |

### Copilot CLI Setup

Copilot CLI agent support requires:

1. **Install Copilot CLI:** `npm install -g @github/cli@latest`
2. **Authenticate:** `github copilot alias`
3. **Verify:** Run `copilot --version`
4. **Select in Project:** Use project settings → Agent Provider → `github_copilot`

For advanced per-task override, see [Section 4: Setting Agents Per-Project & Per-Task](#4-setting-agents-per-project--per-task).

---

## 3. Agent-Agnostic Concepts

### Roles & Responsibilities

#### PM (Product Manager)

**Owned by:** Human or AI agent
**Inputs:** Raw task description, user story, ticket  
**Outputs:** Refined acceptance criteria, enriched task scope, estimated complexity

**AI PM responsibility:**
- Parse task intent even when vague
- Propose concrete acceptance criteria (1–20 items)
- Flag blockers (unclear requirements, dependencies)
- Break down large tasks into subtasks
- Enrich task with context (testing strategy, deployment concerns)

**Postflight requirement** (audited per-run):
- `description` non-empty
- Acceptance criteria: 1–20 items
- `ENRICHMENT_SUMMARY:` comment with key decisions

#### Worker

**Owned by:** AI agent (code capability required)
**Inputs:** Refined task + acceptance criteria from PM  
**Outputs:** Code changes, test coverage, deployment ready

**AI Worker responsibility:**
- Implement solution matching acceptance criteria
- Write tests to verify AC
- Commit with meaningful messages
- Flag unmet dependencies or blockers
- Propose rework path if PM guidance unclear

**Postflight requirement** (audited per-run):
- `DEV_COMPLETED` comment (implementation done)
- `FILES_CHANGED` comment (list of modified files or `NO_CHANGES`)
- `DIFF_SUMMARY` comment (high-level changes or `NOT_A_REPO` if needed)

#### Reviewer

**Owned by:** AI agent or human  
**Inputs:** Worker output, AC, design intent (from PM)  
**Outputs:** Approval (merge) or rejection (rework request)

**AI Reviewer responsibility:**
- Verify implementation matches AC
- Check code quality, security, tests
- Identify edge cases
- Approve or reject with rationale

**Postflight requirement** (audited per-run):
- `REVIEW_VERDICT:` comment (`approve` or `reject`)
- `RATIONALE:` comment (why, with detail ≥50 chars)
- If rejecting: `REWORK:` comment (guidance ≥10 chars)

---

### Workflows: WF1 vs WF2

AgentBoard supports two task workflows:

#### WF1: With Reviewer (Default)

```
[PM] → Refined Task → [Worker] → Code → [Reviewer] → {Approve/Reject}
     ↓                                              ↓
   human → rework request                    → rework request ↻
```

**When to use:** Production-grade work, security-sensitive changes, team standards enforcement.

#### WF2: Skip Reviewer

```
[PM] → Refined Task → [Worker] → Code → [Human Approval]
     ↓                       ↓
   human → rework        → rework
```

**When to use:** Low-risk tasks, internal tools, rapid prototyping.

---

### Task Lifecycle States

| State | Allowed From | Meaning | Next States |
|-------|--------------|---------|------------|
| `created` | (start) | Task newly created | `assigned` |
| `assigned` | `created`, `needs_pm`, `needs_worker`, `needs_reviewer` | Assigned to a role | `working` |
| `working` | `assigned` | Agent is actively working | `completed`, `needs_pm`, `blocked` |
| `completed` | `working` | Agent finished; awaiting approval/review | `approved`, `rejected`, `needs_pm`, `blocked` |
| `approved` | `completed` | Task approved, ready for next role (or done if WF2) | `assigned` (next role) or `done` |
| `rejected` | `completed` | Reviewer/human rejected; rework needed | `needs_pm`, `needs_worker`, `assigned` (rework) |
| `needs_pm` | `working`, `completed`, `rejected` | Worker flagged PM for clarification | `assigned` (PM) |
| `needs_worker` | `rejected` | Reviewer rejected; worker needs to rework | `assigned` (Worker) |
| `needs_reviewer` | (WF1 only) | Ready for review | `assigned` (Reviewer) |
| `blocked` | `working`, `completed` | Task blocked (dependency, clarification needed) | `assigned` (same role) |
| `done` | `approved` | Task complete | (terminal) |

---

### Dispatch Modes

#### Auto-Dispatch (Default)

When a task transitions (e.g., Worker → Completed), the system **automatically enqueues** the next role's run if:
- Task is in eligible state (assigned, completed, etc.)
- Next role in workflow is defined
- Project allows auto-dispatch for that role

**Flow:** Task transitions → State machine check → Next role determined → Run auto-enqueued

#### Semi-Automatic (Human-Controlled)

Manual dispatch via UI:
1. Click task → **Dispatch** button
2. Choose role (or accept default)
3. (Optional) Override executor (Copilot instead of Claude, etc.)
4. Click **Run**

Result: Run enqueued with explicit executor choice.

---

## 4. Setting Agents Per-Project & Per-Task

AgentBoard supports **three levels** of agent selection, with clear precedence.

### Project-Level Default

**UI Path:** Project Settings → Agent Provider → `claude` | `github_copilot`

All tasks in the project use the selected provider by default. Applies when no task-level override is specified.

**API:** PATCH `/api/projects/:code`
```json
{
  "agent_provider": "github_copilot"  // or "claude"
}
```

### Task-Level Override

**UI Path:** Task Detail → Dispatch Panel → Agent Override → `project default` | `Override: Claude` | `Override: Copilot`

Override the project default for a single task dispatch. Useful for:
- One task needs Copilot (cost), rest use Claude
- Testing Copilot reliability with a low-risk task
- Copilot unavailable; force Claude fallback

**API:** PATCH `/api/tasks/:id/transition`
```json
{
  "toStatus": "assigned",
  "byRole": "human",
  "executorOverride": "github_copilot"  // or "claude"
}
```

### Resolution Order

When dispatching a task, the system determines which executor to use in this order:

```
1. Task agent_provider_override (if set)
2. Project agent_provider (if set)
3. Default: 'claude'
```

**Example:**
- Project default: Claude
- Task override: Copilot
- **Result:** ✅ Use Copilot (task override wins)

**Example:**
- Project default: Copilot
- Task override: (none)
- **Result:** ✅ Use Copilot (project default applies)

**Example:**
- Project default: (none)
- Task override: (none)
- **Result:** ✅ Use Claude (global default)

---

## 5. Executor Lifecycle

Each time a task is dispatched to a role, the system spawns an **executor** (agent run). This section covers the phases all executors go through, regardless of provider (Claude, Copilot, etc.).

### Executor State Machine

```
queued → running → succeeded/failed/cancelled
         ↓
      (heartbeat every 30s)
```

### Lifecycle Phases

#### Phase 1: Queued
- Task dispatched with target role (PM, Worker, Reviewer)
- Run record created: `status='queued'`, agent-agnostic
- Run waiting in queue (respects `project.max_parallel`, default 1)
- **Duration:** Seconds to minutes (depends on queue depth)

#### Phase 2: Claimed
- Executor daemon claims run (reads task, MCP config, project settings)
- Run reserved: `status='running'`, `claimed_at` timestamp set
- Token issued for MCP communication
- Pre-run validation: repo exists, workspace accessible, agent available
- **Duration:** Milliseconds

#### Phase 3: Agent Spawn & Execution
- Executor spawns agent process:
  - **Claude Code:** `claude --bare -p <session-id> --mcp-config <file> ...`
  - **Copilot CLI:** `copilot --agent <role> --session-id <uuid> --mcp-config <file> ...`
  - (Future agents: adapter-specific spawn command)
- Agent streams output to stdout/stderr
- Output format: **stream-json** (newline-delimited JSON events)
- **Duration:** Minutes to hours (depends on task complexity, max 60 turns)

#### Phase 4: MCP Communication
- Agent calls MCP tools: `get_task`, `update_task`, `add_comment`, `finish_run`
- Each call bumps `last_heartbeat_at` (prevents timeout)
- Executor validates run token, task ownership
- Results logged to `~/.agentboard/logs/<run_id>.jsonl`
- **Duration:** Concurrent with Phase 3

#### Phase 5: Completion & Cost Computation
- Agent calls `finish_run(status='succeeded'|'failed'|'cancelled')`
- Executor parses stream-json for usage (tokens, turns, API calls)
- Cost computed: `computeCost(model, usage)` → USD amount
- Run record updated: `status`, `cost_usd`, `model`, `usage`
- **Duration:** Milliseconds

#### Phase 6: Postflight Audit
- Role-specific required comments checked (PM, Worker, Reviewer)
- If missing: run marked as `succeeded-with-audit-note`, human intervention may be needed
- Comments indexed to task for audit trail
- **Duration:** Seconds

#### Phase 7: Task Transition
- Run status used to determine task next state
- State machine validates transition (e.g., `working` → `completed`)
- Next role determined (if workflow allows)
- If auto-dispatch enabled: next run queued
- **Duration:** Milliseconds

### Monitoring & Heartbeat

- **Heartbeat interval:** Agent MCP calls refresh `last_heartbeat_at`
- **Timeout threshold:** 15 minutes without heartbeat
- **Reaper:** Background process every 60 seconds marks stale runs as `failed`
- **Timeout action:** Run marked `failed`, task state reverted (e.g., `working` → `assigned`)

---

### Retry Logic

Executor automatically retries failed runs with exponential backoff:

| Attempt | Delay | Max Retries |
|---------|-------|------------|
| 1st fail | 5 sec | 3 attempts total |
| 2nd fail | 15 sec | |
| 3rd fail | 30 sec | Marked failed, task needs manual intervention |

**Retry conditions:**
- Network error, timeout, spawn failure
- JSON parsing error (corrupted stream)
- Agent crash (exit code non-zero)

**No retry on:**
- Postflight audit failure (agent succeeded but missing required comment)
- Explicit agent rejection (status='failed' by agent)
- Task already completed by human

---

## 6. MCP: How Agents Talk Back

### Two MCP Surfaces

AgentBoard exposes two MCP endpoints, each with a specific purpose:

#### 1. HTTP MCP (`abrun` key — for spawned agents)

**Consumed by:** Headless agent processes (Claude, Copilot, future)  
**Transport:** HTTP with Bearer token auth  
**Config:** Passed via `--mcp-config` file to agent spawn command  
**Auth:** Server Bearer token (outer) + per-run `run_token` (inner, rotated per claim)  

**Tools available (role-agnostic):**
- `get_task` — Fetch current task, AC, PM notes
- `update_task` — Modify task title, description, status
- `add_comment` — Append audit comment (postflight, rework notes)
- `finish_run` — Signal agent done; report status, model, usage
- `add_heartbeat` — Keep-alive signal (resets 15min timeout)

#### 2. Stdio MCP (`agentboard` key — for user's interactive session)

**Consumed by:** User's interactive Claude Code / Copilot CLI session  
**Transport:** Stdio (JSON-RPC 2.0)  
**Auth:** None (same process, same user)  

**Tools available:**
- `read_board` — Fetch all tasks, runs, projects
- `approve_task` — Mark run as human-approved
- `reject_task` — Mark run as rejected, queue rework
- `dispatch_task` — Manually trigger run for a role
- (Read-only; human actions only)

---

### Allowed Tools Per Role

**Executor allowlist** (CLI permission mode) restricts which tools each role can call. Applies to both Claude Code and Copilot CLI equally.

#### PM Role
```
- get_task (fetch requirements)
- update_task (refine AC, expand description)
- add_comment (post ENRICHMENT_SUMMARY)
- finish_run (report status, usage)
- add_heartbeat (keep-alive)
```

#### Worker Role
```
- get_task (fetch AC, PM notes)
- update_task (implement, test, commit)
- add_comment (post DEV_COMPLETED, FILES_CHANGED, DIFF_SUMMARY)
- finish_run (report status, usage)
- add_heartbeat (keep-alive)
- shell commands (cd, git, npm, tsc, etc. — role-specific allow list)
```

#### Reviewer Role
```
- get_task (fetch AC, worker output, PM intent)
- update_task (mark tested, verified)
- add_comment (post REVIEW_VERDICT, RATIONALE, REWORK if rejecting)
- finish_run (report status, usage)
- add_heartbeat (keep-alive)
```

---

### Custom MCPs & Skills

Both Claude Code and Copilot CLI agents can access:
- **User MCPs:** Any `.mcp/mcp-servers.mjs` configured in project
- **Inherited skills:** From workspace environment (GitHub API, AWS CLI, etc.)

**Whitelisted environment variables** (passed to agents):
- PATH, HOME, USER, LANG, TZ
- Claude auth: `ANTHROPIC_API_KEY`
- GitHub: `GH_TOKEN`
- AWS: `AWS_PROFILE`, `AWS_REGION` (explicit list only, not `AWS_*` wildcard)
- For details, see **Modification Rules** in [CLAUDE.md](CLAUDE.md#security-model-specifics)

---

## 7. Multi-Agent Workflow Examples

### Example 1: Cost Optimization
**Goal:** Reduce API costs without sacrificing quality.

**Project config:**
- Project agent provider: `github_copilot` (default, lower cost)
- Task override(s): None (use Copilot for all)

**Workflow:**
1. Copilot PM: Parse requirements, generate AC (cost: ~$0.05)
2. Copilot Worker: Implement solution (cost: ~$0.10)
3. Human Reviewer: Approve/reject (cost: $0)

**Total:** ~$0.15/task (vs. ~$1.50 if all Claude)

---

### Example 2: Capability Mix
**Goal:** Use specialized agents for different task types.

**Project config:**
- Project agent provider: `claude` (default, high capability)
- Task overrides applied per-task:
  - Complex UI work → Claude (reasoning)
  - Routine refactoring → Copilot (speed, cost)

**Workflow:**
1. Claude PM: Complex task parsing, multi-step AC (cost: ~$0.50)
2. Copilot Worker: Routine refactoring (cost: ~$0.10)
3. Claude Reviewer: Security/design check (cost: ~$0.50)

**Total:** ~$1.10/task (balanced for cost & capability)

---

### Example 3: WF2 with Semi-Automation
**Goal:** Rapid prototyping with human oversight, no review gate.

**Project config:**
- Workflow: WF2 (skip Reviewer)
- Project agent provider: `github_copilot`

**Workflow:**
1. Copilot PM: Parse feature request, generate basic AC
2. Copilot Worker: Prototype implementation
3. Human: Final approval (merge or request rework)

**Result:** Features ship 2x faster, human retains control.

---

### Example 4: Availability Fallback
**Goal:** Handle temporary provider outages.

**Project config:**
- Project agent provider: `github_copilot` (primary)

**On Copilot outage:**
1. Dispatch task → Copilot spawn fails
2. Manual dispatch: Override executor → `claude` (fallback)
3. Claude executes task
4. Resume normal Copilot workflow once available

---

## 8. Troubleshooting & Reference

### Common Questions

#### Q: How do I know which agent ran a task?

**A:** Task detail panel → Run history. Each run shows:
- Agent provider (`claude` or `github_copilot`)
- Model used (e.g., `opus-4.7-20250514`, `copilot-pro`)
- Cost (USD)
- Status & timestamps

You can also query the database:
```sql
SELECT r.provider, r.model, r.cost_usd, r.status 
FROM agent_run r 
WHERE r.task_id = <id> 
ORDER BY r.created_at DESC;
```

---

#### Q: Can I force a task to run with a different agent?

**A:** Yes. Two ways:

1. **UI:** Task detail → Dispatch → Agent Override dropdown → Select agent
2. **API:** `PATCH /api/tasks/:id/transition` with `executorOverride: "github_copilot"` body param

The override persists for the next dispatch only; it doesn't change the project default.

---

#### Q: My agent timed out. What happened?

**A:** Agent runs have a **15-minute heartbeat timeout**. If no MCP call is received for 15 minutes, the executor marks the run as `failed`.

**Common causes:**
- Agent stuck in infinite loop (requires manual termination)
- Network issue (agent can't reach MCP server)
- Workspace too large (I/O bottleneck)
- Long turn (planning phase taking >15 minutes)

**Fix:**
- Manually reject the run → queue rework
- Check agent logs: `~/.agentboard/logs/<run_id>.jsonl`
- Increase complexity limit or break task into smaller pieces

---

#### Q: How do I view agent execution logs?

**A:** Logs stored at `~/.agentboard/logs/<run_id>.jsonl` (newline-delimited JSON events).

**Quick view in UI:**
1. Task detail → Run history
2. Click run → **View Logs** button

**Raw tail (CLI):**
```bash
tail -f ~/.agentboard/logs/<run_id>.jsonl | jq .
```

**Common log events:**
- `system.init` — Agent started, model reported
- `message.start` — Turn begun
- `message.usage` — Token counts
- `tool.call` — MCP tool invoked
- `tool.result` — Tool returned
- `message.stop` — Turn completed

---

#### Q: Can I use multiple agents in the same project?

**A:** Yes! Three ways:

1. **Project default + task overrides:** Set project to Copilot, override specific tasks to Claude
2. **Role-level overrides:** PM=Claude, Worker=Copilot, Reviewer=Claude (requires manual dispatch per task)
3. **Workflow level:** WF1 vs. WF2 affects which roles participate, enabling different agent mixes

---

### Reference: API Endpoints

#### Dispatch Task with Executor Override
```
PATCH /api/tasks/:id/transition
Content-Type: application/json
Authorization: Bearer <token>

{
  "toStatus": "assigned",
  "byRole": "human",
  "executorOverride": "github_copilot"
}
```

**Response:**
```json
{
  "task": {..., "status": "assigned"},
  "run": {"id": "run_123", "status": "queued", "provider": "github_copilot"}
}
```

---

#### Get Task with Execution History
```
GET /api/tasks/:id
Authorization: Bearer <token>
```

**Response includes:**
```json
{
  "task": {...},
  "runs": [
    {"id": "run_1", "provider": "github_copilot", "model": "copilot-pro", "status": "succeeded", "cost_usd": 0.15},
    {"id": "run_2", "provider": "claude", "model": "opus-4.7", "status": "failed", "cost_usd": 0.0},
    ...
  ]
}
```

---

### Concepts & Links

| Concept | Learn More |
|---------|------------|
| Claude Code plugin details | [CLAUDE.md](CLAUDE.md) |
| Platform features & security | [README.md](README.md) |
| Database schema & internals | [src/db.mjs](src/db.mjs), [db/schema.sql](db/schema.sql) |
| Executor implementation | [src/executor.mjs](src/executor.mjs), [src/agent-runner.mjs](src/agent-runner.mjs), [src/copilot-runner.mjs](src/copilot-runner.mjs) |
| MCP tool definitions | [src/api-mcp.mjs](src/api-mcp.mjs) |
| Role prompts | [agent-board-core/prompts/](agent-board-core/prompts/) |

---

## 9. Getting Help

- **Bug report:** [GitHub Issues](https://github.com/edgeetech/agentboard/issues)
- **Discussion/questions:** [GitHub Discussions](https://github.com/edgeetech/agentboard/discussions)
- **Security issue:** See [SECURITY.md](SECURITY.md)

---

## Changelog

### v1.1 (Current)
- ✅ Copilot CLI support (full parity with Claude)
- ✅ Task-level executor override
- ✅ Multi-agent workflows & documentation
- 🔄 Future: Docker, HTTP webhook, local LLM adapters

### v1.0
- ✅ Claude Code plugin support
- ✅ Project-level agent selection
- ✅ MCP server, state machine, postflight audits
