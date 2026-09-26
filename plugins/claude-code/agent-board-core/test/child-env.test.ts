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

  it('passes through proxy/CA config on every platform', () => {
    const env = buildChildEnv({
      PATH: '/bin',
      HTTPS_PROXY: 'https://proxy:8443',
      HTTP_PROXY: 'http://proxy:8080',
      NO_PROXY: 'localhost',
      NODE_EXTRA_CA_CERTS: '/etc/ca.pem',
      SSL_CERT_FILE: '/etc/ssl.pem',
    });

    expect(env).toMatchObject({
      HTTPS_PROXY: 'https://proxy:8443',
      HTTP_PROXY: 'http://proxy:8080',
      NO_PROXY: 'localhost',
      NODE_EXTRA_CA_CERTS: '/etc/ca.pem',
      SSL_CERT_FILE: '/etc/ssl.pem',
    });
  });

  it('passes through the new Copilot/Codex auth-adjacent vars', () => {
    const env = buildChildEnv({
      PATH: '/bin',
      COPILOT_GITHUB_TOKEN: 'gh-token',
      COPILOT_HOME: '/home/.copilot',
      CODEX_API_KEY: 'codex-key',
    });

    expect(env).toMatchObject({
      COPILOT_GITHUB_TOKEN: 'gh-token',
      COPILOT_HOME: '/home/.copilot',
      CODEX_API_KEY: 'codex-key',
    });
  });
});
