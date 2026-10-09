import { describe, expect, it } from 'vitest';

import { buildTaskAudit, redactSecrets, renderTaskAuditMarkdown } from '../src/audit-export.ts';

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
      `INSERT INTO comment(id, task_id, author_role, body, created_at)
       VALUES ('C2', 'TASK1', 'human', 'leaked key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz', '2026-01-01T00:01:30Z')`,
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

    expect(audit.comments).toHaveLength(2);
    expect(audit.history).toHaveLength(1);
    expect(audit.file_paths).toHaveLength(1);
    expect(audit.agent_runs).toHaveLength(1);
    expect(audit.activity).toHaveLength(1);
    expect(audit.debt).toHaveLength(1);
    expect(audit.tracker_links).toHaveLength(1);
    expect(audit.costs.total_usd).toBe(0.25);
    expect(json).not.toContain('abcdefabcdef');
    expect(json).not.toContain('secret-value');
    expect(json).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(markdown).toContain('## Agent Runs');
    expect(markdown).toContain('## Tracker Links');
    expect(markdown).not.toContain('abcdefabcdef');
    expect(markdown).not.toContain('secret-value');
    expect(markdown).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  });
});

describe('redactSecrets pattern coverage', () => {
  // Fixtures are assembled from fragments so no complete token-shaped literal
  // ever lands in the repo — GitHub push protection rejects those on sight.
  const j = (...parts: string[]): string => parts.join('');

  const cases: [string, string][] = [
    [
      'jwt',
      'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    ],
    ['aws access key', j('AKIA', 'IOSFODNN7EXAMPLE')],
    ['aws session key', j('ASIA', 'Y34FZKBOKMUTVV7A')],
    ['aws secret', j('aws_secret_access_key=', 'wJalrXUtnFEMI/K7MDENG/', 'bPxRfiCYEXAMPLEKEY')],
    ['github classic pat', j('ghp', '_', '1234567890abcdefghijklmnopqrstuvwx')],
    ['github oauth', j('gho', '_', '16C7e42F292c6912E7710c838347Ae178B4a')],
    ['github user-to-server', j('ghu', '_', '16C7e42F292c6912E7710c838347Ae178B4a')],
    ['github server-to-server', j('ghs', '_', '16C7e42F292c6912E7710c838347Ae178B4a')],
    ['github refresh', j('ghr', '_', '16C7e42F292c6912E7710c838347Ae178B4a')],
    [
      'github fine-grained pat',
      j('github', '_pat_', '11ABCDEFG0abcdefghijkl', '_1234567890abcdefghijklmnop'),
    ],
    ['slack bot token', j('xox', 'b-', '123456789012-1234567890123-', 'AbCdEfGhIjKlMnOpQrStUvWx')],
    ['slack user token', j('xox', 'p-', '123456789012-1234567890123-', 'AbCdEfGhIjKlMnOpQrStUvWx')],
    ['slack app token', j('xapp', '-1-', 'A012BCDEFGH-1234567890123-', 'abcdefabcdefabcdefabcdef')],
    [
      'slack webhook',
      j(
        'https://hooks.slack.com',
        '/services/',
        'T00000000/B00000000/',
        'XXXXXXXXXXXXXXXXXXXXXXXX',
      ),
    ],
    ['openai key', j('sk', '-proj-', 'abcdefghijklmnopqrstuvwxyz0123456789')],
    ['anthropic key', j('sk', '-ant-api03-', 'abcdefghijklmnopqrstuvwxyz0123456789')],
    ['google api key', j('AIza', 'Sy_1234567890abcdefghijklmnopqrstuv')],
  ];

  it.each(cases)('redacts a %s out of a free-text string', (_name, secret) => {
    const out = redactSecrets(`log line before ${secret} log line after`);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('log line before');
    expect(out).toContain('log line after');
  });

  it.each(cases)('redacts a %s nested in an object', (_name, secret) => {
    const out = redactSecrets({ comments: [{ body: `here: ${secret}` }] });
    expect(JSON.stringify(out)).not.toContain(secret);
  });

  it('keeps the Bearer prefix while redacting a bearer JWT', () => {
    const out = redactSecrets(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij',
    );
    expect(out).toBe('Authorization: Bearer [REDACTED]');
  });

  it('redacts a PEM private key block', () => {
    const out = redactSecrets(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----',
    );
    expect(out).toBe('[REDACTED]');
  });

  it('leaves ordinary prose and code alone', () => {
    for (const benign of [
      'Refactored src/pricing.ts and bumped PRICING_VERSION to 4.',
      'git commit -m "fix: redact tokens"',
      'The AKIA prefix identifies an AWS key.',
      'See https://github.com/edgeetech/agentboard/pull/4',
    ]) {
      expect(redactSecrets(benign)).toBe(benign);
    }
  });
});
