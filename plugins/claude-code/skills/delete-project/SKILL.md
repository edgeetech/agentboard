---
name: delete-project
description: Permanently delete an agentboard project. Kills any running agents, cancels queued runs, moves the SQLite DB file to ~/.agentboard/trash/ with a timestamp (manual restore possible). Interactive — asks which project, then confirms before acting.
---

Use this skill when the user wants to delete an agentboard project.

## Steps

1. **Make sure the server is running.** Read `~/.agentboard/config.json` (Windows: `%USERPROFILE%\.agentboard\config.json`); if `port` is missing or `/alive` is unreachable, tell the user to run `/agentboard:open` first and stop.

2. **Fetch the project list** via GET `http://127.0.0.1:<port>/api/projects/list` with header `Authorization: Bearer <token-from-config.json>`. Response shape: `{ projects: [{ id, code, name, description, workflow_type, repo_path, created_at, ... }, ...] }`.

3. **Empty list?** Tell the user "No projects to delete." and stop.

4. **Let the user pick.** Use `AskUserQuestion` with one option per project. Each option's `label` = `<code> — <name>` (truncate name at ~40 chars), `description` = `Workflow <workflow_type>, repo <repo_path>`. Include a final "Cancel" option.

5. **Show the impact.** For the chosen project, hit its DB to get counts:
   - tasks: `SELECT COUNT(*) FROM task WHERE deleted_at IS NULL`
   - runs in flight: `GET /api/tasks` won't help here; instead use SQL via a shell read: `sqlite3 ~/.agentboard/projects/<lower-code>.db "SELECT COUNT(*) FROM agent_run WHERE status IN ('running','queued')"`.

   Report (example):
   > About to delete **DEMO — My Demo Project** (WF1, `C:/tmp/demo-repo`).
   > - 12 tasks (all hidden after delete)
   > - 2 runs will be cancelled (1 running, 1 queued)
   > - DB file moves to `~/.agentboard/trash/demo-<timestamp>.db` (manual restore possible)
   >
   > This is irreversible from the UI.

6. **Confirm.** Use `AskUserQuestion` with a 2-option question — `"Type the code to confirm"` is NOT available (AskUserQuestion is choice-only), so ask: "Delete **DEMO** permanently?" with options `Yes, delete it` and `No, cancel`. Default to cancel.

7. **On confirm**, call DELETE `http://127.0.0.1:<port>/api/projects/<CODE>` with the Bearer header. Expect `{ ok: true, cancelled_runs: N, trashed_path: "..." }`.

8. **Report the result** to the user: number of runs cancelled + trash path. If the deleted project was active, mention that the UI will now show the Setup Wizard until they select another project.

## Safety

- **Never call DELETE without explicit confirmation.** Step 6 is mandatory.
- If the user cancels at any AskUserQuestion, stop and tell them nothing was changed.
- Do not attempt to delete DB files directly with `rm` — always go through the DELETE endpoint so running agents are signaled first.
