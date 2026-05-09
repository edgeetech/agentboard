# Council — multi-agent persona

A **council** is a virtual persona made up of 2–5 ordered agent members, each of which can be a different provider (Claude, Copilot, Codex). The council fills the same role slot as a single agent (PM, Worker, or Reviewer) but produces a single canonical output through round-robin debate.

This file documents the council persona for human readers. The runner injects per-member instructions at runtime — there is no static "council agent" that runs on its own.

---

## How a council runs

1. **Activation.** A council activates when the resolved role configuration for the dispatched role has `type: "council"`. Resolution order:
   `task.agent_config_json[role]` → `project.agent_config_json[role]` → legacy task override → legacy project default.
   Manual dispatch can also force a council via `use_council: true`.

2. **Order matters.** Members run **sequentially** in the configured order. The order is set when the council is defined (in Project Settings → Agent Configuration, or per task) and never changes within a single run.

3. **Each member sees prior outputs.** Member *k* starts with:
   - the standard role prompt (PM / Worker / Reviewer),
   - a prepended `## Council Mode — Member k of N` block identifying its provider and seat,
   - a `## Prior Council Debate` block summarising members 1..k-1 (with full comments visible in task history).

4. **The last member synthesises.** Member *N* is told it is the **synthesiser**. It must produce the canonical role artefacts (`DEV_COMPLETED` / `REVIEW_VERDICT` / `ENRICHMENT_SUMMARY` etc.) and call `finish_run`. Its output is the council's official output.

5. **Intermediate members do not finish.** Members 1..N-1 contribute, prefix every comment with `[COUNCIL k/N <provider>]`, and stop. They must not call `finish_run`. Postflight checks are skipped for them.

6. **Fail-fast.** If any member errors (timeout, provider unavailable, malformed output, non-completed status), the council aborts immediately. The parent run is marked `failed`, a `COUNCIL_FAILED:` system comment is posted, and no further members run. The task stays in its current state — a human can retry or change the configuration.

## Bookkeeping

- The council parent run row records `council_size = N` and `cost_breakdown_json` listing per-member cost.
- Each member is its own `agent_run` row with `parent_run_id` pointing at the parent and `member_index` (0-based) marking the seat.
- Aggregate cost on the parent equals the sum of member costs.
- The parent's `session_provider` and `model` come from the synthesiser (last member).
- Comments tagged `[COUNCIL k/N …]` are visible in the task comment history; `[COUNCIL FINAL]` marks synthesiser commentary.

## When to use a council

A council pays off when the answer benefits from multiple viewpoints or when a final synthesis can outperform any single agent's first attempt. Typical uses:

- **Reviewer council** — different agents catch different issues; the synthesiser writes the final verdict and rationale.
- **Worker council** — first members propose approaches, last member implements and ships.
- **PM council** — agents brainstorm scope and risk; last member writes the canonical description and AC.

It is not free. A 3-member council is roughly 3× the cost and latency of a single run. Use it where breadth matters; stick to single-agent runs where speed and cost dominate.

## Configuration

Set per role on a project:

```jsonc
{
  "reviewer": {
    "type": "council",
    "members": ["claude", "codex", "github_copilot"]
  }
}
```

- `members` is ordered (last seat = synthesiser).
- 2 ≤ length ≤ 5.
- Duplicates are allowed (e.g. `["claude", "claude"]`) for diversity-via-temperature ensembles.

Tasks may override any subset of roles with the same shape; unset roles inherit from the project.

## Manual dispatch

From the task detail panel:

- **Use role default** — runs whatever the resolved role configuration says (single or council).
- **Council (role config)** — forces a council using the role's configured council. Errors with 422 if no council is configured for that role.
- **Claude / Copilot / Codex** — one-shot single-provider override for this dispatch only. Bypasses any council configuration.

A single dispatch can pick exactly one of: a specific provider OR `use_council`. They are mutually exclusive.
