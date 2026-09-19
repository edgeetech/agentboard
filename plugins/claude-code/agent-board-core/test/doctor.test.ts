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
});
