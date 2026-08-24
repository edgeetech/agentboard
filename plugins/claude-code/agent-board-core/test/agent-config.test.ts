import { describe, expect, it } from 'vitest';

import {
  parseAgentConfig,
  resolveRoleConfig,
  stringifyAgentConfig,
  validateAgentConfigInput,
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
