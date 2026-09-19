import { describe, expect, it } from 'vitest';

import { buildChildEnv, childProcessEnvironmentPolicy } from '../src/child-env.ts';

describe('child process environment policy', () => {
  it('declares a non-inheriting allowlist and deduplicates requested keys', () => {
    const policy = childProcessEnvironmentPolicy(['PATH', 'RUN_TOKEN']);

    expect(policy.inherit).toBe(false);
    expect(policy.allowedKeys).toContain('PATH');
    expect(policy.allowedKeys).toContain('RUN_TOKEN');
    expect(policy.allowedKeys.filter((key) => key === 'PATH')).toHaveLength(1);
  });

  it('passes only allowlisted values and explicit extras', () => {
    const env = buildChildEnv(
      {
        PATH: '/bin',
        ANTHROPIC_API_KEY: 'secret',
        AGENTBOARD_RUN_TOKEN: 'run-token',
        AWS_SECRET_ACCESS_KEY: 'must-not-pass',
      },
      ['AGENTBOARD_RUN_TOKEN'],
    );

    expect(env).toMatchObject({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'secret',
      AGENTBOARD_RUN_TOKEN: 'run-token',
    });
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
  });
});
