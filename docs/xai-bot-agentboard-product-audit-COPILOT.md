# xAI Bot / AgentBoard Product Audit for Copilot

Audit date: 2026-08-12

This is a shared coordination file for Copilot and Codex. It compares the current AgentBoard product with public xAI / Grok product patterns and turns that comparison into portable feature recommendations. The xAI side is source-backed where possible; the AgentBoard side is based on repo docs and implementation references in this repository.

## Collaboration Protocol

- Copilot questions live in [xai-bot-agentboard-product-audit-COPILOT-QUESTIONS.md](./xai-bot-agentboard-product-audit-COPILOT-QUESTIONS.md).
- Every Codex pass must read that questions file before editing this plan.
- If Copilot adds or changes a question, Codex should answer it in the questions file and then update this plan so decisions are reflected in the implementation roadmap.
- Do not rely on a long-running watcher for this docs collaboration. The reliable protocol is deterministic re-read and update on each agent pass.
- Copilot should append structured entries with `STATUS: waiting_for_codex`, `REVISION`, `TOPIC`, `TYPE`, `NEEDS_CODEX`, referenced files, and expected Codex action.
- Codex should mark handled entries `STATUS: answered_by_codex` when practical and should not overwrite Copilot's substantive text except for that status transition.

## Source Baseline

External xAI / Grok sources:

- [Grok overview](https://docs.x.ai/grok/overview): Grok is a cross-platform assistant with synced conversations, settings, subscriptions, file upload, voice, image/video creation, and connectors.
- [Grok connectors](https://x.ai/news/grok-connectors): Grok connectors expose everyday apps such as Microsoft 365, Google Workspace, Notion, GitHub, Linear, and bring-your-own MCP.
- [Grok skills](https://x.ai/news/grok-skills): skills provide persistent reusable expertise, built-ins, and user-created skills made through conversation or files.
- [Grok automations](https://x.ai/news/grok-automations): automations save named instructions, attach files/connectors/skills, run on schedules or email triggers, and keep a run history.
- [Grok Build agent dashboard](https://x.ai/news/agent-dashboard): dashboard manages many coding sessions, shows working/idle/awaiting states, supports inline questions/approvals, and dispatches new sessions.
- [Grok Build workflows](https://x.ai/news/workflows): workflows fan work out across many agents, verify outputs, save reusable workflows, and expose progress by phase and per-agent tokens.
- [Grok Build permissions](https://docs.x.ai/build/features/permissions): permission modes, allow/deny rules, and approval prompts control tool calls.
- [Grok Business and Enterprise](https://x.ai/news/grok-business): business/enterprise posture includes team sharing, permission-aware company knowledge, SSO/SCIM, and administration.

AgentBoard sources:

- [README.md](../README.md): product overview, local-only architecture, workflows, cost/audit trails, skills, trackers, sessions, security model, and roadmap.
- [AGENTS.md](../AGENTS.md): supported agents, role model, executor lifecycle, MCP surfaces, API endpoints, skills, tracker integration, and multi-provider routing.
- [CLAUDE.md](../CLAUDE.md): implementation notes for MCP names, executor internals, postflight audit, security specifics, council personas, and known gaps.
- Copilot PM/Architect review artifact: `C:\Users\Ahmet Selcuk Ozyurt\.copilot\session-state\a7e962bb-0b92-47ec-9ced-953b02988740\pm-architect-review.md`.

Canonical source-of-truth map for docs drift work:

- Public product overview, install paths, security/privacy claims, and roadmap: [README.md](../README.md).
- Multi-provider roles, workflows, MCP/API concepts, and executor-agnostic behavior: [AGENTS.md](../AGENTS.md).
- Claude plugin internals and implementation warnings: [CLAUDE.md](../CLAUDE.md).
- Role behavior: `plugins/claude-code/agent-board-core/prompts/{pm,worker,reviewer}.md`.
- Exact API behavior: `plugins/claude-code/agent-board-core/src/api-*.ts`.
- Schema: `plugins/claude-code/agent-board-core/db/schema.sql` plus `plugins/claude-code/agent-board-core/src/db.ts` migrations.
- Skills implementation: `src/api-skills.ts`, `src/skill-repo.ts`, and `src/skill-scanner.ts`.
- Executor behavior: `src/executor.ts`, `src/provider-registry.ts`, provider runners, and `src/council-runner.ts`.

## Next Release Product Goal

Product Goal: make AgentBoard's documented local agent-operations claims trustworthy for a solo/local developer by making tracker sync real, agent work exportable, and setup/runtime health visible before adding new durable-agent primitives.

Primary P0 user jobs:

- Connect an issue tracker and see whether it is actually configured, polling, and syncing.
- Prove what happened on a task, including comments, runs, cost, phase/activity history, debt, attachments, and tracker links.
- Diagnose setup and runtime problems without reading logs first.
- Keep docs, UI, API, and implementation aligned as behavior changes.

P0 success metrics:

- Tracker runtime supports `linear`, `github`, and `gitlab` config shape from `db/schema.sql`; env-var-missing and rate-limit states are visible in API/UI.
- Manual tracker sync and scheduled tracker sync are idempotent for duplicate external issues.
- Task audit export has JSON and Markdown formats and redaction tests for tokens/secrets.
- Doctor checks return bounded `ok | warning | error | unknown` statuses and every non-ok check has an actionable remediation.
- README, AGENTS, CLAUDE, and relevant prompt/API docs are updated in the same PR that changes behavior.

Decision rights for this planning file:

- Product priority and acceptance criteria: user / product owner. Copilot and Codex may propose, but unresolved conflicts are surfaced in the questions file.
- Schema/runtime architecture: Senior Software Architect review required before implementation begins on tracker runtime, profiles, routines, or approval enforcement.
- Documentation ownership: the PR changing behavior owns doc updates for the canonical docs listed above.
- Release acceptance: each PR must list schema changes, UI changes, tests, docs touched, rollback/migration notes, and reviewer owner.

P0 release gates from the Copilot PM/Architect review:

- Every P0 PR must pass from `plugins/claude-code/agent-board-core`: `npm run check`, `npm test`, and `npm run build`.
- Every schema PR must include idempotent forward migrations, fresh-DB tests, old-DB upgrade tests, and an explicit rollback note. SQLite rollback can be "restore pre-migration DB backup and downgrade app" when a true down migration is unsafe.
- Every endpoint PR must include route-collision tests when it overlaps an existing URL prefix.
- Every export or connector PR must include secret-redaction tests and missing-credential/error-path tests.
- Every UI PR must include an empty/error/loading state and a focused manual verification path if automated UI tests are not already available.

Architecture decision records to create before or inside the relevant implementation PRs:

- ADR-001: Server-backed bot profiles and project scoping.
- ADR-002: Tracker schema and env-var-only credential policy.
- ADR-003: Audit export fields, size policy, and redaction policy.
- ADR-004: Doctor API status semantics and CLI probing timeouts.
- ADR-005: Profile dispatch precedence once `profile_id` reaches execution.

## xAI / Bot Themes

The public xAI pattern is moving from "single chat" toward durable agent surfaces:

- Durable named jobs: Grok Automations are named, saved instructions that can run repeatedly with current data, connectors, skills, files, and mode settings.
- Persistent run context: automation runs open full conversations, keep run history, and can be resumed or inspected after execution.
- Routines: schedules and email-triggered automations cover recurring work such as briefs, monitoring, reminders, triage, and follow-up.
- Skills: Grok skills let users teach reusable expertise once and apply it across conversations; built-in office/document skills ship by default.
- App and tool access: connectors give Grok scoped access to email, files, calendars, docs, issues, repos, and custom MCP servers.
- Approvals and permissions: Grok Build documents explicit permission modes, allow/deny rules, plan approval, and prompts for actions outside the allowed set.
- Multi-agent operations: Grok Build dashboard and workflows expose many concurrent agents, phases, fan-out, progress, and handoff/response surfaces.
- Team controls: Grok Business/Enterprise emphasizes team sharing, permission-aware company data, SSO/SCIM, and admin management.

"Persistent computer" is treated here as a product theme rather than a single confirmed feature name: durable sessions, saved jobs/workflows, tool/plugin state, and resumable execution environments.

## AgentBoard Current State

AgentBoard already covers a meaningful part of the agent-operations surface:

- Multi-provider board: Claude Code, Codex CLI, and Copilot CLI can fill PM, Worker, and Reviewer roles, with per-project, per-task, per-role, and one-shot run overrides.
- Workflow engine: WF1 and WF2 model PM -> Worker -> Reviewer/Human flows, plus auto and semi-auto dispatch modes.
- Cost and audit trails: run rows capture provider/model/usage/cost, postflight comments enforce role outputs, task history records transitions, and run/activity logs support inspection.
- Skills: project-scoped `.claude/skills` scanning, six built-ins, manual rescan, fuzzy lookup through MCP, and disk-as-source-of-truth editing are already documented.
- Sessions and live activity: per-run session ids, session resume commands, SSE activity streams, phase history, and tool activity create an inspectable execution timeline.
- MCP integration: separate HTTP `abrun` MCP for spawned agents and stdio `agentboard` MCP for the interactive user keep spawned-agent tools isolated.
- External trackers: Linear, GitHub Issues, and GitLab can populate tasks and sync terminal issue states through `tracker_config` and `tracker_issue`.
- Local-only security: binds to `127.0.0.1`, uses bearer plus per-run tokens, whitelists child environment variables, uses CSP/cookies, and sends no telemetry.
- Council personas: roles can run as a 2-5 member provider council with ordered debate and a final synthesizer.

## Caveats Before Calling AgentBoard a Complete Product

AgentBoard is strong as a local multi-agent task board, but it is not yet a complete "durable bot/routine platform":

- No bot profiles: the product has roles and council configurations, but no first-class named bot profile combining purpose, instructions, skills, providers, permissions, and dispatch defaults.
- No routines: there is no saved recurring job model with schedule, trigger, input context, report target, and run history.
- No connector center: trackers exist, and MCP inheritance exists, but there is no unified UI for apps, scopes, credentials, tool status, and permissions.
- No teach/capture flow: skills are scanned and editable, but the product does not guide users from a completed run into "save this behavior as a skill/profile/routine."
- Limited onboarding: setup requirements are documented, but the app could do more in-product validation for Node/Bun, agent CLIs, auth, data dir permissions, pricing freshness, and tracker credentials.
- Persona creation is disabled as a product primitive: council persona docs exist, but user-facing profile creation/editing is not the same thing as bot/persona lifecycle management.
- No team/admin model: AgentBoard is local-only and single-user by design today; there is no workspace membership, shared ownership, SSO/SCIM, role-based permissions, org policy, or team audit export.
- Docs drift risk: README, AGENTS, CLAUDE, code, and UI can diverge because the repo has several canonical-looking sources. This blocks confident external positioning.

## Portable Feature Recommendations

The most portable xAI-style ideas for AgentBoard are:

- Bot profiles: create named profiles that bind provider config, role intent, default skills, allowed MCP/tool scopes, approval policy, and reusable dispatch settings.
- Routine MVP: add saved recurring jobs with manual "run now", simple schedules, trigger source placeholder, linked bot profile, and per-run conversation/audit history.
- Connector/status center: expose tracker configs, inherited MCPs, custom MCPs, CLI availability, auth state, and last error in one place.
- Approval rules: extend current human approval/postflight gates into explicit rules such as "ask before shell", "ask before tracker write", "always deny raw SQL", or "auto-approve read-only tools."
- Audit export: export task, comments, runs, costs, phase history, tool activity, debt items, and tracker links as JSON and Markdown.
- Skill capture: let a user promote a successful run summary, prompt fragment, or file pattern into a project skill draft.
- Health strip: always-visible dashboard status for active project, provider availability, tracker polling, skill scan state, queued/running/awaiting counts, and uncosted runs.
- Handoff threads: preserve PM/Worker/Reviewer/Human reasoning and decisions as first-class threaded artifacts rather than comments only.
- Shared/team mode: eventually add optional remote/shared state, team roles, admin policy, and permission-aware connectors without weakening local-only mode.

## Quick-Win Roadmap

### P0 - Product Confidence and Visibility

P0 is split into release slices so it can ship incrementally:

- P0a preflight bugfix: fix the active-project API mismatch. Prefer adding a server compatibility shim for `POST /api/projects/active/select` that reuses `PATCH /api/projects/active`, then optionally normalize the UI client to the canonical PATCH path later.
- P0b tracker runtime repair: tracker routes must be reachable, schema shape must match `db/schema.sql`, sync must be transactional/idempotent, background polling must reconcile enabled trackers after startup, and tracker health must be persisted.
- P0c tracker status UI: expose enabled/disabled, last poll, last success, last error, credential env-var presence, issue count, next poll, and manual sync outcome.
- P0d audit export: JSON and Markdown only, scoped to a task first and optionally a project later.
- P0e setup validation doctor: add an in-app or command-level doctor path that reports Node/Bun, provider CLIs, auth, data dir, DB schema, pricing, tracker config, and MCP config with timeout-bounded checks.
- P0f dashboard health summary / strip: lightweight runtime aggregation above the board, using tracker persisted status, latest skill scan, task/run counts, provider mix, costs, and uncosted run count.
- P0g docs drift, security, and test gate: use the canonical map above and update README, AGENTS, CLAUDE, prompt docs, or API docs in the same PR that changes behavior; add redaction, migration, and route tests where applicable.

Server-backed bot-profile drafts move out of P0 unless the user explicitly wants visible profile editing before profile-bound dispatch exists. They remain the first P1 durable-agent primitive.

### P1 - Durable Work Units

- Server-backed bot-profile drafts: replace browser-local personas with project-scoped persisted profile drafts, but do not change executor behavior in the same PR.
- Routine MVP: saved instruction, linked profile, manual run, schedule metadata, pause/resume/delete, and run history.
- Profile-bound dispatch: task dispatch can choose a named profile instead of only raw provider/role settings.
- Approval rules: declarative JSON policy at profile level first, with project-level defaults later; enforce deny/allow before building a full interactive approval queue.
- Connector center v1: after tracker status is real, group tracker config, inherited MCP status, CLI availability, and provider auth state into one settings surface.

### P2 - Collaboration and Reuse

- Skill capture from completed runs: turn successful run behavior into a skill draft with suggested name, description, triggers, and source files.
- Handoff threads: structure PM/Worker/Reviewer/Human decisions, rework, and approvals as threaded artifacts with links to runs.
- Shared/team mode: optional workspace sharing, team roles, admin policy, SSO/SCIM-adjacent hooks, shared connectors, and exportable org audit. Keep this P2-only; do not add remote/shared assumptions to P0/P1 schemas.

## Concrete Implementation Plan

This section is grounded in the current code. It is meant to be a build plan, not a positioning plan.

### Current Code Findings

- `server.ts` wires `handleProjects`, `handleTasks`, `handleCosts`, `handleLogs`, `handleSessions`, `handlePrompts`, and `handleSkills`, but it does not import or call `handleTracker` from `src/api-tracker.ts`.
- `server.ts` starts the executor and skill-scan workers, but it does not call `startTrackerPoller()` from `src/tracker-poller.ts`, despite README describing background tracker sync.
- `src/api-tracker.ts` appears to be stale: it reads/writes `provider`, `base_url`, `project_key`, and `api_token`, while `db/schema.sql`, `src/tracker-poller.ts`, and `src/trackers/index.ts` use `kind`, `endpoint`, `api_key_env_var`, `project_slug`, `active_states`, `terminal_states`, `assignee`, `poll_interval_ms`, and `enabled`.
- `ui/src/api.ts` has no tracker methods and `ui/src/pages/ProjectPage.tsx` has no tracker section, so tracker setup/status is not currently product-visible.
- Personas are UI-local: `ui/src/pages/PersonasPage.tsx` and `ui/src/pages/RoleDetailPage.tsx` use `ui/src/data/catalog.ts` / browser storage, while real dispatch configuration lives in `project.agent_config_json`, `task.agent_config_json`, and `src/agent-config.ts`.
- The audit export quick win can be built without new core concepts because `src/api-tasks.ts`, `src/api-costs.ts`, `src/api-activity.ts`, `src/repo.ts`, `task_history`, `comment`, `agent_run`, `agent_activity`, `task_debt`, `task_attachment`, `tracker_issue`, and costs already contain the necessary data.
- `ui/src/api.ts` calls `POST /api/projects/active/select`, but `src/api-projects.ts` implements `PATCH /api/projects/active`. If the picker depends on this path, this is a small existing integration bug to fix while touching product health.
- `src/tracker-poller.ts` owns sync logic privately today. Manual sync and scheduled polling need one shared transactional sync boundary before implementation continues.
- Approval-policy enforcement is not provider-neutral today: Claude SDK hooks can enforce more than Codex/Copilot runners. Any policy-bound run on a provider without equivalent enforcement must fail closed or be marked explicitly unenforced.
- Profile-bound dispatch must cover manual dispatch, auto-dispatch from task transitions, and routine-created tasks. A manual-only `profile_id` path is not enough.
- `plugins/claude-code/agent-board-core/package.json` already exposes the P0 CI gates: `npm run check`, `npm test`, and `npm run build`. Use those names in PR checklists and CI configuration.

### Decisions From Copilot Questions

- Bot profiles must be schema-backed. Do not keep them browser-local.
- Routine MVP is manual run plus schedule metadata only. No email or webhook triggers in the first routine slice.
- Approval rules are declarative JSON rules, stored first on `bot_profile.approval_policy_json`; enforcement starts with allow/deny, while `ask` blocks and leaves a human comment until an approval queue exists.
- Connector credentials stay env-var based for P0. Do not add an encrypted credential store yet.
- Audit export requires JSON and Markdown. No CSV in P0.
- Skill capture should present an editable preview before writing a skill file; the final confirmed create action can write through server-side skill APIs and enqueue a scan.
- Team/shared mode remains P2-only.
- Active-project mismatch fix preference: add the server compatibility shim first, because it is lower risk for any existing clients already calling `POST /api/projects/active/select`.
- Dashboard health summary is P0, not P1, because it is the visible aggregation layer for the tracker/doctor/cost trust work.

### P0.0 - Fix Active-Project API Compatibility

Goal: remove a project-switching integration bug before building more project-scoped health and settings UI.

Preferred remediation:

- Add `POST /api/projects/active/select` as a compatibility shim in `src/api-projects.ts`.
- Reuse the exact same validation and update path as the existing `PATCH /api/projects/active` handler.
- Keep `PATCH /api/projects/active` as the canonical endpoint in docs and new client code.
- Optionally update `ui/src/api.ts` to call the canonical PATCH path after the shim exists; do not require that UI change for compatibility.

Tests:

- API test for `PATCH /api/projects/active`.
- API test for `POST /api/projects/active/select` returning the same response shape.
- Regression check that project switching invalidates/reloads project-scoped UI state.

Why this is the first quick win: it is a tiny, isolated fix that reduces risk before adding more active-project dependent settings.

### P0.1 - Make Tracker Status Real and Visible

Goal: turn existing tracker code into a working connector/status surface before building a broader connector center.

Server changes:

- In `server.ts`, import `handleTracker` from `./src/api-tracker.ts` and add it to the REST handler list before `handleTasks`.
- In `server.ts`, import `startTrackerPoller` from `./src/tracker-poller.ts` and call it in `onReady()` after skill-scan workers start.
- Rewrite `src/api-tracker.ts` to match the current schema:
  - `GET /api/projects/:code/tracker` returns `{ tracker, status }`.
  - `POST /api/projects/:code/tracker` accepts `{ kind, endpoint?, api_key_env_var, project_slug, active_states?, terminal_states?, assignee?, poll_interval_ms?, enabled? }`.
  - `POST /api/projects/:code/tracker/enable`
  - `POST /api/projects/:code/tracker/disable`
  - `POST /api/projects/:code/tracker/sync`
  - `GET /api/projects/:code/tracker/issues`
- Response contract for `status`:
  - `env_present: boolean`
  - `enabled: boolean`
  - `last_poll_at?: string`
  - `last_success_at?: string`
  - `last_error?: string`
  - `last_issue_count: number`
  - `next_poll_at?: string`
  - `issues_count: number`
  - `rate_limited?: boolean`
- Add validation with `zod`, following the style in `src/api-projects.ts` and `src/api-skills.ts`.
- Add mandatory `src/tracker-sync.ts`. Both manual sync and background polling must call this shared module.
- `tracker-sync.ts` must wrap issue sync in a DB transaction and be idempotent for duplicate external issues. It should create/update `tracker_issue` before or atomically with task creation so manual sync and scheduled polling cannot create duplicate tasks.
- Add persisted tracker health. Prefer a separate `tracker_poll_state` table over overloading config:
  - `project_id TEXT PRIMARY KEY REFERENCES project(id)`
  - `last_poll_at TEXT`
  - `last_success_at TEXT`
  - `last_error TEXT`
  - `last_issue_count INTEGER NOT NULL DEFAULT 0`
  - `next_poll_at TEXT`
  - `updated_at TEXT NOT NULL`
- `GET /api/projects/:code/tracker` must filter by `project_id`, not `LIMIT 1`.
- Replace one-shot `startTrackerPoller()` scheduling with a central reconciliation loop or timer registry so trackers enabled after server startup begin polling without a restart.
- Do not add credential storage in P0. Persist only `api_key_env_var`; never persist resolved tokens.
- Add a migration helper in `src/db.ts` that checks `PRAGMA table_info` before `ALTER TABLE ... ADD COLUMN`, so tracker changes are idempotent against existing local databases.

UI changes:

- Add tracker methods to `ui/src/api.ts`: `getTracker`, `saveTracker`, `enableTracker`, `disableTracker`, `syncTracker`, `listTrackerIssues`.
- Add a "Tracker" section to `ui/src/pages/ProjectPage.tsx` under project settings.
- Show kind, slug, env var name, whether the env var is present, enabled state, last sync/poll, issue count, and last error.
- Add buttons for Save, Enable/Disable, and Sync now.

Tests:

- Add API tests for create/update/enable/disable/status shape.
- Add tracker concurrency tests: manual sync during scheduled poll, duplicate external issue, env-var missing, rate limit, and enable-after-start scheduling.
- Add fresh DB and existing DB migration tests for `tracker_poll_state`.
- Add a route-wiring test proving `handleTracker` is reachable through `server.ts`.

Why this is the first quick win: it fixes documented functionality, creates the first connector-style surface, and exposes operational health without inventing a new app model.

### P0.2 - Add Task Audit Export

Goal: provide a portable receipt for what happened, what it cost, what tools ran, and who approved it.

Server changes:

- Add `src/audit-export.ts` with pure builders:
  - `buildTaskAudit(db, taskIdOrCode): TaskAudit`
  - `renderTaskAuditMarkdown(audit): string`
  - optional `buildProjectAudit(db): ProjectAudit`
- Add `src/api-audit.ts`:
  - `GET /api/projects/:code/tasks/:id/export?format=json`
  - `GET /api/projects/:code/tasks/:id/export?format=md`
  - optional `GET /api/projects/:code/export?format=json`
- Wire `handleAudit` into `server.ts` before `handleTasks`, because it overlaps the task URL prefix.
- Include these tables in the task export:
  - `project`
  - `task`
  - `task_history`
  - `comment`
  - `task_attachment`
  - `agent_run`
  - `agent_activity`
  - `task_debt`
  - `tracker_issue`
  - computed per-task cost summary, mirroring `handleTaskCost` in `src/api-tasks.ts`.
- Redact sensitive fields:
  - `agent_run.token`
  - server bearer token
  - tracker credential values. Keep `api_key_env_var`, not the resolved secret.
  - raw environment values
  - any future credential-store values if added later
- Redaction policy:
  - Do not read `process.env` values for export rendering except to compare known request/server secrets for redaction.
  - Recursively replace sensitive key names such as `token`, `api_key`, `apikey`, `password`, `secret`, `authorization`, and `cookie` with `[REDACTED]`.
  - Preserve non-secret identifiers such as provider name, model, session id, MCP server name, tracker kind, and `api_key_env_var`.
- Size policy:
  - P0 task export may build in memory, but must enforce a serialized payload cap and return a clear `413` response with remediation if the export is too large.
  - Do not silently truncate audit activity. Streaming or paginated audit export is a later enhancement if real projects hit the cap.

UI changes:

- Add `api.exportTask(code, format)` in `ui/src/api.ts`.
- Add Export JSON and Export Markdown buttons in `ui/src/features/board/TaskDetailPanel.tsx`.
- Use browser download with `Blob`, naming files like `AGB-12-audit.json` and `AGB-12-audit.md`.
- Do not add CSV in P0. If CSV is requested later, add it as a separate export for run/cost rows only.

Tests:

- Unit test `buildTaskAudit` with a small in-memory DB fixture.
- Snapshot or string-contains test for Markdown sections: task, history, comments, runs, costs, activity, debt, tracker links.
- Route collision test proving export routes are handled before generic `handleTasks`.
- Redaction tests proving no bearer token, run token, API key value, or raw env value appears in JSON or Markdown.
- Markdown escaping/rendering test for untrusted task/comment text.
- Large-export test or builder test proving the size cap returns a controlled error rather than an unbounded response.

Why this is a quick win: it is mostly read-only, reuses existing tables, and immediately strengthens the "cost + audit trail" product claim.

### P0.3 - Add Doctor / Setup Validation API

Goal: make setup failures discoverable inside the product instead of relying only on docs.

Server changes:

- Add `src/doctor.ts` with checks that return `{ id, label, status, detail, action? }`.
- Add `src/api-doctor.ts` with `GET /api/doctor` and `GET /api/projects/:code/doctor`.
- Wire `handleDoctor` into `server.ts`.
- Initial checks:
  - Node version and `process.execPath`.
  - data dir existence and writeability via `paths.ts`.
  - active project DB opens and `meta.schema_version` is `6`.
  - repo path exists and is a directory.
  - UI bundle exists or fallback UI is active.
  - provider auth/CLI availability for configured providers: `claude`, `codex`, and `gh` or Copilot command, using a short timeout.
  - latest skill scan status from `latestScan`.
  - tracker env var presence when tracker is configured.
  - uncosted runs from the existing costs query.
- Keep command checks defensive. Return "unknown" instead of failing the whole doctor request when a CLI probe errors.
- Cache expensive CLI checks for a short TTL and apply per-check timeouts so `/api/doctor` cannot pile up slow subprocess probes.
- Use stable statuses: `ok`, `warning`, `error`, `unknown`. Every non-`ok` result must include an actionable remediation.

UI changes:

- Add `api.doctor()` and `api.projectDoctor(code)` in `ui/src/api.ts`.
- Add a compact "Health" strip in `ui/src/components/AppShell.tsx` or at the top of `ui/src/features/board/Board.tsx`.
- Link each non-ok item to the relevant Project, Skills, Sessions, or tracker section.

Tests:

- Unit test pure doctor check normalization.
- API test that `/api/doctor` returns stable status objects even when no active project exists.
- Timeout/caching test for provider CLI probes.

Why this is a quick win: the plugin already has `/agentboard:doctor`; surfacing the same idea through HTTP/UI closes onboarding gaps with low data-model risk.

### P0.4 - Dashboard Health Summary / Strip

Goal: show system state without making users visit four pages. This is P0 because it turns tracker, setup, skills, costs, and active runs into visible product confidence.

Server changes:

- Add `GET /api/projects/:code/health-summary` in a small `src/api-health-summary.ts` handler or fold it into `api-projects.ts` if preferred.
- Wire the handler into `server.ts` before broad project/task handlers if route overlap exists.
- Return:
  - task counts by status.
  - agent run counts by status.
  - running/queued/awaiting counts.
  - latest skill scan summary.
  - tracker status summary from `tracker_poll_state`, including env-present and last error.
  - cost totals from `src/api-costs.ts` logic.
  - uncosted run count.
  - executor provider mix from recent runs.
- Keep aggregation lightweight. Do not call slow doctor CLI probes from this endpoint; use cached doctor state or omit it.

Response contract:

- `{ tasks, runs, queue, skills, tracker, costs, providers, generated_at }`
- Median local response target: under 200ms on a normal project DB.

UI changes:

- Add `ui/src/components/HealthStrip.tsx`.
- Render it above the board columns in `Board.tsx` and optionally compact in `AppShell`.
- Poll every 10-15 seconds; use existing React Query patterns.
- Link each non-ok item to the relevant Project, Skills, Sessions, or tracker section.

Tests:

- API aggregation test with tasks, runs, costs, skill scan, and tracker state fixtures.
- Test that health-summary does not execute provider CLI probes.
- UI smoke/manual check for empty, healthy, warning, and error states.

Why this is quick: almost every data point is already in existing tables; the work is aggregation and presentation.

### P1a - Replace Local Personas With Bot Profile Drafts

Goal: turn the disabled persona UI into a real server-backed profile catalog, without changing dispatch behavior in the first slice. This must be schema-backed; a UI-only profile layer would preserve the current drift between personas and real dispatch config.

Release placement: this is now P1a, not P0, unless the user explicitly wants a visible profile editor before profiles affect dispatch.

Schema changes:

- Add `bot_profile`:
  - `id TEXT PRIMARY KEY`
  - `project_id TEXT REFERENCES project(id)`
  - `name TEXT NOT NULL`
  - `description TEXT NOT NULL DEFAULT ''`
  - `emblem TEXT NOT NULL DEFAULT ''`
  - `instructions TEXT NOT NULL DEFAULT ''`
  - `agent_config_json TEXT`
  - `skill_ids_json TEXT NOT NULL DEFAULT '[]'`
  - `approval_policy_json TEXT NOT NULL DEFAULT '{}'`
  - `enabled INTEGER NOT NULL DEFAULT 1`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
  - `deleted_at TEXT`
- Add indexes on `(project_id, deleted_at)` and `(name)`.
- Add idempotent migrations in `src/db.ts` and schema in `db/schema.sql`.

Server changes:

- Add `src/profile-repo.ts` for CRUD and validation.
- Add `src/api-profiles.ts`:
  - `GET /api/projects/:code/profiles`
  - `POST /api/projects/:code/profiles`
  - `GET /api/projects/:code/profiles/:id`
  - `PATCH /api/projects/:code/profiles/:id`
  - `DELETE /api/projects/:code/profiles/:id` soft deletes.
- Reuse `validateAgentConfigInput` from `src/agent-config.ts`.
- Validate skills by id against `skill` plus built-ins, but do not require every skill to exist forever; stale skill ids can be returned with a warning so old profiles remain inspectable.

UI changes:

- Change `PersonasPage.tsx` to load profiles from the active/current project instead of `data/catalog.ts`.
- Enable "New persona" as "New profile draft".
- Change `RoleDetailPage.tsx` or create `ProfileDetailPage.tsx` to save to the profile API.
- Keep the current role/council editor style by embedding `AgentConfigEditor`.
- Show selected skills using the existing `/api/skills` query.
- Seed defaults from the static catalog currently represented in UI code, not from browser localStorage. The server cannot inspect a user's browser-local data. A safe first slice is: when `GET /profiles` returns empty, the UI offers "Import default profiles" and posts the static catalog payload to the profile API with deterministic source ids.

Dispatch integration comes in P1.1. This first profile PR only makes personas real, editable, project-scoped, and exportable.

Acceptance criteria:

- Existing static catalog roles can seed default profile drafts on first project use, without duplicating on repeated loads.
- Duplicate profile names are handled deterministically.
- Disabled profiles remain visible but cannot be selected for dispatch after P1.1.
- Stale skill ids are shown as warnings, not fatal read errors.
- Profiles are project-scoped and never leak between project DBs.
- Implementation is blocked until ADR-001 and the idempotent migration patch are reviewed, because this introduces durable schema.

### P1.1 - Profile-Bound Dispatch

Goal: make bot profiles affect execution after P0 profile drafts exist.

Schema changes:

- Add `profile_id TEXT` to `agent_run`.
- Optionally add `default_profile_id TEXT` to `project` later; keep first slice explicit in dispatch.

Server changes:

- Extend `POST /api/tasks/:id/run-agent` in `src/api-tasks.ts` to accept `profile_id`.
- Validate profile belongs to the project and is enabled.
- Store `profile_id` on the new run.
- In `src/executor.ts`, load profile by `run.profile_id`.
- Merge profile config into dispatch resolution:
  - run provider override still wins.
  - task config next.
  - task legacy provider override next.
  - profile `agent_config_json` next.
  - project `agent_config_json` next.
  - project legacy provider last.
- Filter `skillsForPrompt` in `executor.ts` to profile `skill_ids_json` when present.
- Add profile instructions to prompt variables in `src/prompt-builder.ts` and role templates.
- Propagate `profile_id` through manual dispatch, auto-dispatch from task transitions, and routine-created tasks. Manual-only profile dispatch is incomplete.

UI changes:

- Add a profile picker to the dispatch panel in `TaskDetailPanel.tsx`.
- Show selected profile on each run in run history.

Tests:

- Unit test role config precedence with profile config inserted.
- API test dispatch rejects unknown or disabled profile ids.
- Executor prompt-builder test verifies profile instructions and skill filtering.
- Auto-dispatch test proving profile_id is preserved when a task transitions and enqueues the next run.

### P1.2 - Routine MVP

Goal: saved work that can run now and later run on a schedule.

Schema changes:

- Add `routine`:
  - `id`, `project_id`, `name`, `description`, `instructions`, `profile_id`, `schedule_json`, `enabled`, `last_run_at`, `next_run_at`, timestamps, `deleted_at`.
- Add `routine_run`:
  - `id`, `routine_id`, `task_id`, `agent_run_id`, `status`, `started_at`, `ended_at`, `summary`, `error`.

Server changes:

- Add `src/routine-repo.ts`, `src/api-routines.ts`, and `src/routine-scheduler.ts`.
- First slice supports manual run:
  - `POST /api/projects/:code/routines/:id/run` creates a task from routine instructions and dispatches PM or Worker with `profile_id`.
- Second slice supports interval/cron-like schedule:
  - Scheduler scans enabled routines once per minute.
  - No email or webhook triggers in MVP; leave trigger schema extensible.

UI changes:

- Add `RoutinesPage.tsx` and nav item.
- Support list/create/edit/run-now/pause/resume.
- Show recent routine runs and linked task/run.

Tests:

- Repo CRUD tests.
- Manual run creates task and run with expected profile.
- Scheduler does not double-dispatch when tick overlaps.

### P1.3 - Approval Rules

Goal: make "approvals" explicit instead of implicit in role allowlists and human approval states.

Schema changes:

- Reuse `bot_profile.approval_policy_json` and optionally add `project.approval_policy_json`.

Server/runtime changes:

- Define a normalized policy shape:
  - `tool_rules`: array of `{ action: "allow" | "deny" | "ask", tool: string, pattern?: string }`
  - `external_write_policy`: `"deny" | "ask" | "allow"`
  - `shell_policy`: `"deny" | "ask" | "allow_safe"`
- First implementation can only enforce `deny` and `allow`; `ask` records a `tool:blocked` activity and asks the run to stop with a human comment. A true interactive approval queue can come later.
- Feed policy into `run-hooks.ts` and/or `tool-allowlist.ts`.
- Emit policy decisions into `agent_activity`.
- Define provider coverage explicitly. Claude runs can use SDK hooks; Codex/Copilot must either gain equivalent enforcement or policy-bound runs on those providers must fail closed with a clear error. Do not claim provider-neutral approval enforcement until all supported providers are covered.

UI changes:

- Add a simple approval policy editor in profile detail.
- Show denied/blocked tool attempts in task activity.

Tests:

- Approval-policy tests per provider. At minimum, prove unsupported providers reject policy-bound runs or mark policy as unenforced.

### P2 - Later Product Work

- Skill capture should start from an audit export and a completed run: generate a proposed skill body, write it through `api-skills.ts`, then enqueue a skill scan.
- Handoff threads should not replace comments immediately. Add a `handoff_thread` / `handoff_message` schema later and mirror important comments into threads during migration.
- Shared/team mode should be a separate deployment mode. Keep local-only single-user as the default and avoid putting team assumptions into core task/run tables until the local product is stable.

## Recommended First Pull Requests

## Current Consolidated PR Status

Per the 2026-08-13 implementation direction, P0 is being consolidated into one PR instead of six separate PRs. The combined PR should include:

- P0.0 active-project route compatibility.
- P0.1 tracker runtime repair and persisted tracker status.
- P0.2 tracker status UI on the Project page.
- P0.3 task audit export in JSON and Markdown.
- P0.4 setup/runtime doctor API and Project page status.
- P0.5 board health summary strip.
- P0.6 docs drift cleanup plus `npm run check`, `npm test`, and `npm run build` gates.

The separate PR list below remains useful as review slices and acceptance criteria, but the release vehicle is one combined PR unless the user asks to split it again.

0. Active-project route mismatch

Files: `src/api-projects.ts`, API tests; `ui/src/api.ts` only if normalizing the client to the canonical PATCH path in the same PR.

Acceptance criteria:

- `POST /api/projects/active/select` exists as a compatibility shim and delegates to the same implementation as `PATCH /api/projects/active`.
- `PATCH /api/projects/active` remains the documented canonical endpoint.
- Existing project switching still invalidates/reloads project-scoped UI state.
- Regression test covers both endpoint shapes and project selection.
- PR passes `npm run check`, `npm test`, and `npm run build` from `plugins/claude-code/agent-board-core`.

1. Tracker runtime repair

Files: `server.ts`, `src/api-tracker.ts`, `src/tracker-poller.ts`, mandatory `src/tracker-sync.ts`, `db/schema.sql`, `src/db.ts`, tracker runtime/API tests.

Acceptance criteria:

- Tracker routes are reachable.
- Config body matches `db/schema.sql`.
- Missing env var is shown as status, not only as a server log.
- Manual sync and background polling both call `tracker-sync.ts`.
- Manual sync during scheduled poll does not create duplicate tasks.
- Trackers enabled after startup begin polling without server restart.
- Tracker health is persisted and exposes last poll, last success, last error, issue count, and next poll.
- Migration tests cover fresh DB plus existing v5/v6 DBs.
- PR includes ADR-002 or links to it.
- PR includes rollback notes for local SQLite DBs.

2. Tracker status UI

Files: `ui/src/api.ts`, `ui/src/pages/ProjectPage.tsx`, `ui/src/i18n/en.json`, focused UI tests if available.

Acceptance criteria:

- Project page shows tracker kind, slug, env var, env-present state, enabled state, last poll/success/error, issue count, next poll, and manual sync outcome.
- Save, enable/disable, and sync-now actions call the tracker runtime API.
- Empty, disabled, env-missing, rate-limited, and last-error states have clear UI text.

3. Audit export

Files: `src/audit-export.ts`, `src/api-audit.ts`, `server.ts`, `ui/src/api.ts`, `ui/src/features/board/TaskDetailPanel.tsx`, audit tests.

Acceptance criteria:

- A task can be exported as JSON and Markdown.
- Export includes task, comments, history, runs, activity, debt, attachments, tracker links, and costs.
- Secrets/tokens are redacted.
- UI downloads both formats.
- Export routes do not collide with generic task routes.
- Oversized exports fail with a controlled response; they do not silently truncate.
- PR includes ADR-003 or links to it.

4. Doctor API

Files: `src/doctor.ts`, `src/api-doctor.ts`, `server.ts`, `ui/src/api.ts`, doctor tests.

Acceptance criteria:

- `/api/doctor` works with no active project.
- `/api/projects/:code/doctor` includes project-specific checks.
- Failing checks include a short corrective action.
- CLI checks are timeout-bounded and cached.
- PR includes ADR-004 or links to it.

5. Health summary / strip

Files: `src/api-health-summary.ts`, `server.ts`, `ui/src/api.ts`, `ui/src/components/HealthStrip.tsx`, `ui/src/features/board/Board.tsx`.

Acceptance criteria:

- Board shows compact health state.
- Health summary uses tracker persisted status, latest skill scan, cost totals, uncosted run count, task/run counts, and provider mix.
- Polling interval does not hammer expensive doctor checks.
- Median local response target is under 200ms on a normal project DB.

6. Server-backed profile drafts

Files: `db/schema.sql`, `src/db.ts`, `src/profile-repo.ts`, `src/api-profiles.ts`, `server.ts`, `ui/src/api.ts`, `ui/src/pages/PersonasPage.tsx`, `ui/src/pages/RoleDetailPage.tsx` or new `ProfileDetailPage.tsx`.

Acceptance criteria:

- Personas are project-scoped and persisted in SQLite.
- New/edit/delete works.
- Profile drafts can bind agent config and skills.
- Existing local catalog can seed default profiles on first project use.
- No executor behavior changes in this PR.
- PR includes ADR-001 or links to it.
- Migration tests cover fresh DB and existing DB upgrades.

Docs/security/test gate for every P0 PR:

- Update README, AGENTS, CLAUDE, prompt docs, or API docs when behavior changes.
- List tests run and any manual verification.
- Include rollback/migration notes when schema changes.
- Include redaction/error-path tests for exports, trackers, and any credential-adjacent behavior.

## Implementation Ordering Rationale

- The active-project mismatch is a small UX blocker and should be fixed before broader project/health UI work.
- Tracker runtime comes first because there is already code and docs, but route/server wiring, schema shape, sync boundaries, and scheduling do not line up. Fixing it reduces product/documentation drift immediately.
- Tracker UI follows runtime so the UI can depend on a stable status contract.
- Audit export follows because it is read-only, valuable, and uses tables that already exist.
- Doctor and health are split: doctor validates setup; health summary aggregates runtime state and should depend on tracker status after it is real.
- Profiles follow P0 because they introduce schema and UI ownership but no immediate execution value until profile-bound dispatch.
- Routines should wait until profiles exist, because routines need a stable execution identity and skill/provider defaults.

## Risk Register

| Area | Risk | Mitigation |
|---|---|---|
| Tracker runtime | Manual sync and scheduled poll race to create duplicate tasks. | Mandatory transactional `tracker-sync.ts`, duplicate external issue tests, unique `tracker_issue` handling before task creation. |
| Tracker scheduling | Trackers enabled after startup never poll. | Central reconciliation loop or timer registry with enable/disable tests. |
| Tracker health | UI reports misleading state from `updated_at`. | Persist health in `tracker_poll_state` or equivalent status columns. |
| Audit export | Sensitive tokens or secrets leak. | Explicit redaction rules and JSON/Markdown redaction tests. |
| Audit export | Markdown renders untrusted task/comment content unsafely. | Escape/sanitize Markdown-sensitive content in renderer tests. |
| Doctor | CLI probes slow or pile up requests. | Per-check timeout, short TTL cache, `unknown` status on probe failure. |
| Profiles | Schema churn before profiles affect dispatch. | Ship drafts as P1a only; keep executor changes out of profile CRUD PR. |
| Approval rules | Provider-neutral policy claim is false. | Define provider coverage; fail closed for unsupported provider/policy combinations. |
| Docs drift | README/AGENTS/CLAUDE/API docs disagree again. | Treat canonical doc updates as PR Definition of Done. |

## Questions For Copilot

Append entries in this format:

`QUESTION: <short question with file path or product area>`

No entries yet.

## Answers From Codex

Codex should append answers here after re-reading this file and the cited repo sources.

No entries yet.

## Coordination Notes

- Keep this file source-backed. If an assertion comes from xAI, link to the public source. If it comes from AgentBoard, link to the local doc or code file.
- Distinguish documented behavior from inferred product direction.
- Prefer portable product primitives over cloning xAI-specific branding.
