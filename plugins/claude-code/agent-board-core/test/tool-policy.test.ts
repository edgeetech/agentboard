import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { allowlistFor, allowlistForRole } from '../src/tool-allowlist.ts';
import {
  DESTRUCTIVE_BASH_PREFIXES,
  destructiveCategoryOf,
  evaluateToolPolicy,
  isGitWriteCommand,
  isInlineEvalCommand,
  projectDestructiveFlag,
  referencesAgentboardDataDir,
} from '../src/tool-policy.ts';

describe('tool-allowlist deny-first defaults', () => {
  for (const role of ['worker', 'reviewer'] as const) {
    it(`omits every destructive category for ${role} by default`, () => {
      const list = allowlistForRole(role);
      for (const prefix of DESTRUCTIVE_BASH_PREFIXES) {
        expect(list).not.toContain(`Bash(${prefix}:*)`);
      }
    });
  }

  it('keeps the tools the worker actually needs', () => {
    const list = allowlistForRole('worker');
    for (const kept of [
      'Bash(npm:*)',
      'Bash(git commit:*)',
      'Bash(git add:*)',
      'Bash(git switch:*)',
    ])
      expect(list).toContain(kept);
  });

  it('restores destructive categories only when opted in', () => {
    const list = allowlistForRole('worker', { allowDestructive: true });
    for (const prefix of DESTRUCTIVE_BASH_PREFIXES) {
      expect(list).toContain(`Bash(${prefix}:*)`);
    }
  });

  it('never grants destructive tools to the read-only pm role', () => {
    const list = allowlistForRole('pm', { allowDestructive: true });
    expect(list.some((t) => t.startsWith('Bash('))).toBe(false);
  });

  it('allowlistFor serialises to a comma list', () => {
    expect(allowlistFor('worker').split(',')).toContain('Bash(npm:*)');
    expect(allowlistFor('worker')).not.toContain('Bash(rm:*)');
  });
});

describe('destructiveCategoryOf', () => {
  it.each([
    ['rm -rf node_modules', 'rm'],
    ['git push origin main', 'git push'],
    ['git  reset --hard HEAD~1', 'git reset'],
    ['git checkout -- src/', 'git checkout'],
    ['git clean -fd', 'git clean'],
    ['gh pr merge 12', 'gh'],
    ['npm test && rm -rf dist', 'rm'],
    ['npm run build; git push', 'git push'],
  ])('flags %s as %s', (cmd, expected) => {
    expect(destructiveCategoryOf(cmd)).toBe(expected);
  });

  it.each([
    'npm install',
    'git status',
    'git switch -c feature',
    'git commit -m "rm things"',
    'cat README.md',
    '',
  ])('does not flag %s', (cmd) => {
    expect(destructiveCategoryOf(cmd)).toBeNull();
  });

  // Compound-command / flag-tolerant evasions the old anchored regex missed.
  it.each([
    ['git -C . push', 'git push'],
    ['ls && git commit', null], // commit isn't a destructive category (git-write only)
    ['echo hi | xargs rm', 'rm'],
    ['find . -name "*.log" -delete', 'find -delete'],
    ['find . -exec rm {} \\;', 'find -delete'],
    ['npm test\ngit push', 'git push'],
    ['sudo rm -rf /', 'rm'],
  ] as const)('flags %s as %s', (cmd, expected) => {
    expect(destructiveCategoryOf(cmd)).toBe(expected);
  });
});

describe('isGitWriteCommand (compound-command aware)', () => {
  it.each(['git -C . push', 'ls && git commit', 'find . -delete; git push', 'git\tpush'])(
    'flags %s',
    (cmd) => {
      expect(isGitWriteCommand(cmd)).toBe(true);
    },
  );

  it.each(['git status', 'npm test', 'git switch -c x'])('does not flag %s', (cmd) => {
    expect(isGitWriteCommand(cmd)).toBe(false);
  });
});

describe('isInlineEvalCommand', () => {
  it.each([
    'node -e "require(\'fs\').readFileSync(process.env.HOME)"',
    'node --eval "1+1"',
    'node -p "1+1"',
    'python -c "import os"',
    'python3 -c "print(1)"',
    'echo hi && node -e "evil()"',
  ])('flags %s', (cmd) => {
    expect(isInlineEvalCommand(cmd)).toBe(true);
  });

  it.each(['node script.js', 'npm test', 'npx vitest run', 'node --test', 'python script.py'])(
    'does not flag %s',
    (cmd) => {
      expect(isInlineEvalCommand(cmd)).toBe(false);
    },
  );
});

describe('referencesAgentboardDataDir', () => {
  it.each([
    '~/.agentboard/config.json',
    '%USERPROFILE%\\.agentboard\\config.json',
    '$HOME/.agentboard/config.json',
    '$env:USERPROFILE\\.agentboard\\projects\\foo.db',
  ])('flags %s', (target) => {
    expect(referencesAgentboardDataDir(target)).toBe(true);
  });

  it('flags the resolved absolute data dir', () => {
    const abs = join(homedir(), '.agentboard', 'config.json');
    expect(referencesAgentboardDataDir(abs)).toBe(true);
  });

  it.each(['src/index.ts', 'README.md', ''])('does not flag %s', (target) => {
    expect(referencesAgentboardDataDir(target)).toBe(false);
  });
});

describe('evaluateToolPolicy', () => {
  it('blocks a phase-forbidden tool', () => {
    const d = evaluateToolPolicy({ tool: 'Edit', blockedTools: ['Edit'], phase: 'DISCOVERY' });
    expect(d.decision).toBe('block');
    expect(d.reason).toContain('DISCOVERY');
  });

  it('blocks destructive bash when not opted in', () => {
    const d = evaluateToolPolicy({ tool: 'Bash', target: 'rm -rf /tmp/x', allowGit: true });
    expect(d.decision).toBe('block');
    expect(d.reason).toContain('allow_destructive_tools');
  });

  it('allows destructive bash when opted in and git is allowed', () => {
    const d = evaluateToolPolicy({
      tool: 'Bash',
      target: 'git push origin main',
      allowGit: true,
      allowDestructive: true,
    });
    expect(d).toEqual({ decision: 'allow', reason: null });
  });

  it('still blocks git writes without allow_git even when destructive is opted in', () => {
    const d = evaluateToolPolicy({
      tool: 'Bash',
      target: 'git commit -m wip',
      allowDestructive: true,
    });
    expect(d.decision).toBe('block');
    expect(d.reason).toContain('allow_git');
  });

  it('allows ordinary tools', () => {
    expect(evaluateToolPolicy({ tool: 'Read', target: 'src/a.ts' }).decision).toBe('allow');
    expect(evaluateToolPolicy({ tool: 'Bash', target: 'npm test' }).decision).toBe('allow');
  });
});

describe('projectDestructiveFlag', () => {
  it('reads the flag out of agent_config_json', () => {
    expect(projectDestructiveFlag('{"allow_destructive_tools":true}')).toBe(true);
    expect(projectDestructiveFlag('{"allow_destructive_tools":false}')).toBe(false);
  });

  it('returns null when unset or unparseable', () => {
    expect(projectDestructiveFlag('{}')).toBeNull();
    expect(projectDestructiveFlag('not json')).toBeNull();
    expect(projectDestructiveFlag(null)).toBeNull();
    expect(projectDestructiveFlag(undefined)).toBeNull();
  });
});
