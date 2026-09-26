import { describe, expect, it } from 'vitest';

import { checkPhaseGate, checkPostflight, evaluateRunCompletion } from '../src/postflight.ts';

describe('checkPhaseGate', () => {
  it('exempts pm role from phase requirement', () => {
    expect(checkPhaseGate('pm', 'DISCOVERY')).toBeNull();
    expect(checkPhaseGate('pm', undefined)).toBeNull();
  });

  it('worker run must reach DONE', () => {
    expect(checkPhaseGate('worker', 'DONE')).toBeNull();
    const err = checkPhaseGate('worker', 'EXECUTING');
    expect(err).toMatch(/EXECUTING is not DONE/);
  });

  it('reviewer run must reach DONE', () => {
    expect(checkPhaseGate('reviewer', 'DONE')).toBeNull();
    expect(checkPhaseGate('reviewer', 'VERIFICATION')).toMatch(/not DONE/);
  });

  it('null/undefined phase defaults to DISCOVERY in error message', () => {
    expect(checkPhaseGate('worker', null)).toMatch(/DISCOVERY/);
    expect(checkPhaseGate('worker', undefined)).toMatch(/DISCOVERY/);
  });
});

describe('checkPostflight comment scoping (author_role + created_at >= sinceIso)', () => {
  const task = {
    description: 'd',
    acceptance_criteria_json: JSON.stringify([{ text: 'ok' }]),
  };

  it("does not credit a PRIOR run's DEV_COMPLETED comment to a later rework run", () => {
    const comments = [
      {
        author_role: 'worker' as const,
        body: 'DEV_COMPLETED\nfirst pass',
        created_at: '2024-01-01T00:00:00.000Z',
      },
      {
        author_role: 'worker' as const,
        body: 'FILES_CHANGED\na.ts',
        created_at: '2024-01-01T00:00:00.000Z',
      },
      {
        author_role: 'worker' as const,
        body: 'DIFF_SUMMARY\nstat',
        created_at: '2024-01-01T00:00:00.000Z',
      },
    ];
    // Rework run started AFTER those comments — it hasn't posted its own yet.
    const err = checkPostflight('worker', task, comments, '2024-06-01T00:00:00.000Z');
    expect(err).toBe('missing DEV_COMPLETED comment');
  });

  it('does not let a human comment that happens to start with REVIEW_VERDICT satisfy the reviewer gate', () => {
    const comments = [
      {
        author_role: 'human' as const,
        body: 'REVIEW_VERDICT: looks fine to me',
        created_at: '2024-06-02T00:00:00.000Z',
      },
      {
        author_role: 'human' as const,
        body: 'RATIONALE: trust me',
        created_at: '2024-06-02T00:00:00.000Z',
      },
    ];
    const err = checkPostflight('reviewer', task, comments, '2024-06-01T00:00:00.000Z');
    expect(err).toBe('missing REVIEW_VERDICT comment');
  });

  it('does credit comments from this run (right role, at/after sinceIso)', () => {
    const comments = [
      {
        author_role: 'worker' as const,
        body: 'DEV_COMPLETED\nx',
        created_at: '2024-06-01T00:00:00.000Z',
      },
      {
        author_role: 'worker' as const,
        body: 'FILES_CHANGED\na.ts',
        created_at: '2024-06-01T00:00:01.000Z',
      },
      {
        author_role: 'worker' as const,
        body: 'DIFF_SUMMARY\nstat',
        created_at: '2024-06-01T00:00:02.000Z',
      },
    ];
    expect(checkPostflight('worker', task, comments, '2024-06-01T00:00:00.000Z')).toBeNull();
  });

  it('sinceIso=null preserves the old unscoped behavior (back-compat escape hatch)', () => {
    const comments = [
      {
        author_role: 'worker' as const,
        body: 'DEV_COMPLETED\nx',
        created_at: '2020-01-01T00:00:00.000Z',
      },
      {
        author_role: 'worker' as const,
        body: 'FILES_CHANGED\na.ts',
        created_at: '2020-01-01T00:00:00.000Z',
      },
      {
        author_role: 'worker' as const,
        body: 'DIFF_SUMMARY\nstat',
        created_at: '2020-01-01T00:00:00.000Z',
      },
    ];
    expect(checkPostflight('worker', task, comments, null)).toBeNull();
  });
});

describe('evaluateRunCompletion', () => {
  const task = {
    description: 'd',
    acceptance_criteria_json: JSON.stringify([{ text: 'ok' }]),
  };
  const goodWorkerComments = [
    {
      author_role: 'worker' as const,
      body: 'DEV_COMPLETED\nx',
      created_at: '2024-06-01T00:00:01.000Z',
    },
    {
      author_role: 'worker' as const,
      body: 'FILES_CHANGED\na.ts',
      created_at: '2024-06-01T00:00:01.000Z',
    },
    {
      author_role: 'worker' as const,
      body: 'DIFF_SUMMARY\nstat',
      created_at: '2024-06-01T00:00:01.000Z',
    },
  ];
  const since = '2024-06-01T00:00:00.000Z';

  it('fails on phase gate even when required comments are all present (the executor-path bug being fixed)', () => {
    const err = evaluateRunCompletion(
      { role: 'worker' },
      task,
      goodWorkerComments,
      'EXECUTING',
      since,
    );
    expect(err).toMatch(/not DONE/);
  });

  it('passes when comments present and phase is DONE', () => {
    const err = evaluateRunCompletion({ role: 'worker' }, task, goodWorkerComments, 'DONE', since);
    expect(err).toBeNull();
  });

  it('skips all checks for a non-final council member', () => {
    const err = evaluateRunCompletion(
      { role: 'worker', parent_run_id: 'parent-1', member_index: 0, council_size: 3 },
      task,
      [],
      'DISCOVERY',
      since,
    );
    expect(err).toBeNull();
  });

  it('does not skip for the final (synthesizer) council member', () => {
    const err = evaluateRunCompletion(
      { role: 'worker', parent_run_id: 'parent-1', member_index: 2, council_size: 3 },
      task,
      [],
      'DONE',
      since,
    );
    expect(err).toBe('missing DEV_COMPLETED comment');
  });
});
