import { describe, expect, it } from 'vitest';

import { buildResumeCommand } from '../src/provider-runtime.ts';

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
