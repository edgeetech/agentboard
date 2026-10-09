import { describe, expect, it } from 'vitest';

import { runDoctor } from '../src/doctor.ts';

import { makeP0Db, seedP0Project } from './p0-support-db.ts';

describe('runDoctor', () => {
  it('returns stable checks without an active project', async () => {
    const result = await runDoctor({ db: null });

    expect(result.checks.some((check) => check.id === 'runtime.node')).toBe(true);
    expect(result.checks.some((check) => check.id === 'project.active')).toBe(true);
  });

  it('reports provider probe failures as unknown instead of throwing', async () => {
    const db = await makeP0Db();
    seedP0Project(db);

    const result = await runDoctor({
      db,
      probeCommand: () => Promise.resolve({ ok: false, detail: 'missing cli' }),
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider.claude',
          status: 'unknown',
          detail: 'missing cli',
        }),
      ]),
    );
  });

  it('reports a failed auth probe as unknown with an actionable fix', async () => {
    const db = await makeP0Db();
    seedP0Project(db);

    const result = await runDoctor({
      db,
      probeCommand: () => Promise.resolve({ ok: true, detail: 'claude 1.0.0' }),
      probeAuthStatus: () => Promise.reject(new Error('probe timed out')),
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider.claude.auth',
          status: 'unknown',
          action: expect.stringContaining('claude /login'),
        }),
      ]),
    );
  });

  it('warns when auto mode + a present API key could override a confirmed subscription login', async () => {
    const db = await makeP0Db();
    seedP0Project(db);
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    try {
      const result = await runDoctor({
        db,
        probeCommand: () => Promise.resolve({ ok: true, detail: 'claude 1.0.0' }),
        probeAuthStatus: () =>
          Promise.resolve({ status: 'ok', detail: 'logged in via claude.ai', source: 'subscription' }),
      });

      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'provider.claude.auth_override_risk',
            status: 'warning',
          }),
        ]),
      );
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('does not warn about auth override when auth_mode is pinned to subscription', async () => {
    const db = await makeP0Db();
    seedP0Project(db);
    db.prepare(`UPDATE project SET auth_config_json=? WHERE id='P1'`).run(
      JSON.stringify({ claude: 'subscription' }),
    );
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    try {
      const result = await runDoctor({
        db,
        probeCommand: () => Promise.resolve({ ok: true, detail: 'claude 1.0.0' }),
        probeAuthStatus: () =>
          Promise.resolve({ status: 'ok', detail: 'logged in via claude.ai', source: 'subscription' }),
      });

      expect(
        result.checks.some((check) => check.id === 'provider.claude.auth_override_risk'),
      ).toBe(false);
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
