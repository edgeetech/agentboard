import { describe, expect, it } from 'vitest';

import { buildTaskAudit, renderTaskAuditMarkdown } from '../src/audit-export.ts';

import { makeP0Db, seedP0Project } from './p0-support-db.ts';

describe('task audit export', () => {
  it('includes task audit tables and redacts secrets in JSON and Markdown', async () => {
    const db = await makeP0Db();
    seedP0Project(db);
    db.prepare(
      `INSERT INTO comment(id, task_id, author_role, body, created_at)
       VALUES ('C1', 'TASK1', 'human', 'Bearer abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef', '2026-01-01T00:01:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO task_history(id, task_id, from_status, to_status, by_role, at)
       VALUES ('H1', 'TASK1', 'todo', 'agent_working', 'human', '2026-01-01T00:02:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO task_attachment(id, task_id, file_path, label, created_at)
       VALUES ('F1', 'TASK1', 'src/app.ts', 'app', '2026-01-01T00:03:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_run(id, task_id, role, status, token, session_provider, model,
                             cost_usd, cost_version, queued_at, prompt_template)
       VALUES ('R1', 'TASK1', 'worker', 'succeeded', 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
               'claude', 'model', 0.25, 1, '2026-01-01T00:04:00Z',
               'Authorization: Bearer abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_activity(id, run_id, task_id, kind, payload, at)
       VALUES ('A1', 'R1', 'TASK1', 'tool:invoked', '{"api_key":"secret-value"}', '2026-01-01T00:05:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO task_debt(id, task_id, run_id, description, created_at)
       VALUES ('D1', 'TASK1', 'R1', 'Follow up', '2026-01-01T00:06:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO tracker_issue(id, project_id, task_id, tracker_kind, external_id,
                                 identifier, title, state, synced_at, created_at)
       VALUES ('TI1', 'P1', 'TASK1', 'github', '1', 'GH-1', 'Issue', 'Open',
               '2026-01-01T00:07:00Z', '2026-01-01T00:07:00Z')`,
    ).run();

    const audit = buildTaskAudit(db, 'TST-1');
    const json = JSON.stringify(audit);
    const markdown = renderTaskAuditMarkdown(audit);

    expect(audit.comments).toHaveLength(1);
    expect(audit.history).toHaveLength(1);
    expect(audit.file_paths).toHaveLength(1);
    expect(audit.agent_runs).toHaveLength(1);
    expect(audit.activity).toHaveLength(1);
    expect(audit.debt).toHaveLength(1);
    expect(audit.tracker_links).toHaveLength(1);
    expect(audit.costs.total_usd).toBe(0.25);
    expect(json).not.toContain('abcdefabcdef');
    expect(json).not.toContain('secret-value');
    expect(markdown).toContain('## Agent Runs');
    expect(markdown).toContain('## Tracker Links');
    expect(markdown).not.toContain('abcdefabcdef');
    expect(markdown).not.toContain('secret-value');
  });
});
