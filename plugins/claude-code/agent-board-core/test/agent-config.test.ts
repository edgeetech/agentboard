import { describe, expect, it } from 'vitest';

import {
  hasApiKeyEnvVar,
  parseAgentConfig,
  parseAuthConfig,
  resolveAuthMode,
  resolveRoleConfig,
  stringifyAgentConfig,
  stringifyAuthConfig,
  stripApiKeyEnvVars,
  validateAgentConfigInput,
  validateAuthConfigInput,
} from '../src/agent-config.ts';

describe('agent config parsing', () => {
  it('parses valid config JSON and rejects invalid JSON', () => {
    expect(parseAgentConfig('{"worker":{"type":"single","provider":"codex"}}')).toEqual({
      worker: { type: 'single', provider: 'codex' },
    });
    expect(parseAgentConfig('{bad')).toBeNull();
  });

  it('preserves legacy provider allow-list validation', () => {
    expect(
      validateAgentConfigInput({
        worker: { type: 'single', provider: 'gemini' },
      }),
    ).toMatchObject({ ok: false });
  });

  it('stringifies valid config and returns null for empty input', () => {
    expect(
      stringifyAgentConfig({
        reviewer: { type: 'council', members: ['claude', 'codex'] },
      }),
    ).toBe('{"reviewer":{"type":"council","members":["claude","codex"]}}');
    expect(stringifyAgentConfig(null)).toBeNull();
  });
});

describe('agent config resolution', () => {
  it('uses task config before project config and legacy providers', () => {
    expect(
      resolveRoleConfig('worker', {
        taskConfig: { worker: { type: 'single', provider: 'codex' } },
        projectConfig: {
          worker: { type: 'single', provider: 'github_copilot' },
        },
        legacyTaskOverride: 'claude',
        legacyProjectProvider: 'claude',
      }),
    ).toEqual({ type: 'single', provider: 'codex' });
  });

  it('uses project config before legacy task override', () => {
    expect(
      resolveRoleConfig('reviewer', {
        taskConfig: null,
        projectConfig: {
          reviewer: { type: 'council', members: ['claude', 'codex'] },
        },
        legacyTaskOverride: 'github_copilot',
        legacyProjectProvider: 'claude',
      }),
    ).toEqual({ type: 'council', members: ['claude', 'codex'] });
  });

  it('falls back through legacy task override to legacy project provider', () => {
    expect(
      resolveRoleConfig('pm', {
        taskConfig: null,
        projectConfig: null,
        legacyTaskOverride: 'codex',
        legacyProjectProvider: 'claude',
      }),
    ).toEqual({ type: 'single', provider: 'codex' });

    expect(
      resolveRoleConfig('pm', {
        taskConfig: null,
        projectConfig: null,
        legacyTaskOverride: null,
        legacyProjectProvider: 'github_copilot',
      }),
    ).toEqual({ type: 'single', provider: 'github_copilot' });
  });
});

describe('auth config parsing', () => {
  it('parses valid auth config JSON and rejects invalid JSON', () => {
    expect(parseAuthConfig('{"claude":"subscription","codex":"api_key"}')).toEqual({
      claude: 'subscription',
      codex: 'api_key',
    });
    expect(parseAuthConfig('{bad')).toBeNull();
    expect(parseAuthConfig(null)).toBeNull();
  });

  it('rejects unknown providers and unknown auth modes', () => {
    expect(validateAuthConfigInput({ claude: 'bogus' })).toMatchObject({ ok: false });
    expect(validateAuthConfigInput({ gemini: 'subscription' })).toMatchObject({ ok: false });
  });

  it('stringifies valid config and returns null for empty input', () => {
    expect(stringifyAuthConfig({ github_copilot: 'subscription' })).toBe(
      '{"github_copilot":"subscription"}',
    );
    expect(stringifyAuthConfig(null)).toBeNull();
  });

  it('defaults to auto when unset, otherwise uses the per-provider mode', () => {
    expect(resolveAuthMode('claude', null)).toBe('auto');
    expect(resolveAuthMode('claude', { codex: 'api_key' })).toBe('auto');
    expect(resolveAuthMode('claude', { claude: 'subscription' })).toBe('subscription');
  });
});

describe('per-provider API-key env var helpers', () => {
  it('strips only the target provider vars, leaving others untouched', () => {
    const stripped = stripApiKeyEnvVars(
      {
        ANTHROPIC_API_KEY: 'secret',
        ANTHROPIC_AUTH_TOKEN: 'secret2',
        OPENAI_API_KEY: 'other-provider-key',
        PATH: '/bin',
      },
      'claude',
    );
    expect(stripped).toEqual({ OPENAI_API_KEY: 'other-provider-key', PATH: '/bin' });
  });

  it('detects presence of any required key var for a provider', () => {
    expect(hasApiKeyEnvVar({ GH_TOKEN: 'x' }, 'github_copilot')).toBe(true);
    expect(hasApiKeyEnvVar({ SOME_OTHER: 'x' }, 'github_copilot')).toBe(false);
    expect(hasApiKeyEnvVar({ OPENAI_BASE_URL: 'https://x' }, 'codex')).toBe(false);
  });
});
