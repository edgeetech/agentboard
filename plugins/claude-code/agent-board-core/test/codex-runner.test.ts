import { describe, expect, it } from 'vitest';

import { buildCodexExecArgs } from '../src/codex-runner.ts';

describe('buildCodexExecArgs', () => {
  it('uses workspace sandboxing instead of bypassing approvals and sandbox', () => {
    const args = buildCodexExecArgs({
      lastMessagePath: '/tmp/last.txt',
      cwd: '/repo',
      configArgs: ['-c', 'model="gpt-5"'],
      sandbox: {
        workspaceCwd: '/repo',
        restrictToWorkspace: true,
        allowUserMcpServers: true,
        approvalMode: 'provider-default',
        notes: [],
      },
    });

    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).toEqual(
      expect.arrayContaining([
        'exec',
        '--json',
        '--sandbox',
        'workspace-write',
        '--approve-for-me',
        '-C',
        '/repo',
      ]),
    );
    expect(args.slice(-2)).toEqual(['-c', 'model="gpt-5"']);
  });

  it('rejects unrestricted Codex sandbox policies', () => {
    expect(() =>
      buildCodexExecArgs({
        lastMessagePath: '/tmp/last.txt',
        cwd: '/repo',
        sandbox: {
          workspaceCwd: '/repo',
          restrictToWorkspace: false,
          allowUserMcpServers: true,
          approvalMode: 'disabled',
          notes: [],
        },
      }),
    ).toThrow('workspace-restricted sandbox');
  });
});
