import { describe, expect, it } from 'vitest';

import { PROVIDER_RUNTIME_CONTROLS as SDK_PROVIDER_RUNTIME_CONTROLS } from '../../../../packages/plugin-sdk/src/provider.ts';
import {
  buildProviderRuntimePolicy,
  buildResumeCommand,
  PROVIDER_RUNTIME_CONTROLS,
} from '../src/provider-runtime.ts';

describe('provider runtime contract parity', () => {
  it('keeps legacy runtime controls aligned with the plugin SDK', () => {
    expect(PROVIDER_RUNTIME_CONTROLS).toEqual(SDK_PROVIDER_RUNTIME_CONTROLS);
  });
});

describe('buildResumeCommand', () => {
  it('builds claude resume commands', () => {
    expect(buildResumeCommand('claude', 'sess-1', 'C:/repo')).toBe(
      'cd "C:/repo"; claude --resume sess-1',
    );
  });

  it('builds codex resume commands', () => {
    expect(buildResumeCommand('codex', 'sess-2', 'C:/repo')).toBe(
      'cd "C:/repo"; codex resume sess-2',
    );
  });

  it('builds copilot resume commands', () => {
    expect(buildResumeCommand('github_copilot', 'sess-3', 'C:/repo')).toBe(
      'cd "C:/repo"; gh copilot -- --resume=sess-3',
    );
  });
});

describe('buildProviderRuntimePolicy', () => {
  it('normalizes requested runtime limits', () => {
    const policy = buildProviderRuntimePolicy({
      cwd: 'C:/repo/.agentboard/workspaces/t1',
      maxTurns: 12,
      allowedTools: 'Read, Edit, Bash ',
      mcpServers: {
        zed: { url: 'http://127.0.0.1:1/mcp' },
        abrun: { url: 'http://127.0.0.1:2/mcp' },
      },
      hooks: { PreToolUse: [] },
    });

    expect(policy.limits).toEqual({
      cwd: 'C:/repo/.agentboard/workspaces/t1',
      maxTurns: 12,
      allowedTools: ['Read', 'Edit', 'Bash'],
      mcpServerNames: ['abrun', 'zed'],
      hooksEnabled: true,
      abortSignal: true,
      rateLimitBackoff: true,
    });
    expect(policy.sandbox).toMatchObject({
      workspaceCwd: 'C:/repo/.agentboard/workspaces/t1',
      restrictToWorkspace: true,
      allowUserMcpServers: true,
      approvalMode: 'provider-default',
    });
  });

  it('handles empty optional controls', () => {
    const policy = buildProviderRuntimePolicy({
      cwd: '/repo',
      maxTurns: 3,
      allowedTools: '',
      mcpServers: {},
    });

    expect(policy.limits.allowedTools).toEqual([]);
    expect(policy.limits.mcpServerNames).toEqual([]);
    expect(policy.limits.hooksEnabled).toBe(false);
  });
});
