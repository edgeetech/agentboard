import type * as NodeFs from 'node:fs';

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { claudeProviderManifest } from '../../../../plugins/providers/claude/src/index.ts';
import { codexProviderManifest } from '../../../../plugins/providers/codex/src/index.ts';
import { copilotProviderManifest } from '../../../../plugins/providers/copilot/src/index.ts';
import type { AgentProvider } from '../src/types.ts';
import { AGENT_PROVIDERS } from '../src/types.ts';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, appendFileSync: vi.fn() };
});

const { appendFileSync } = await import('node:fs');
const { maybeRegisterInteractiveHistory, providerFor } =
  await import('../src/provider-registry.ts');

const targetProviderManifests = [
  claudeProviderManifest,
  codexProviderManifest,
  copilotProviderManifest,
] as const;

describe('providerFor', () => {
  it('returns adapter with matching provider for each known provider', () => {
    for (const p of AGENT_PROVIDERS) {
      expect(providerFor(p).provider).toBe(p);
    }
  });

  it('each adapter exposes a resume.command function returning a string with the sessionId', () => {
    for (const p of ['claude', 'github_copilot', 'codex'] as AgentProvider[]) {
      const cmd = providerFor(p).resume.command('sess-abc', '/repo');
      expect(typeof cmd).toBe('string');
      expect(cmd).toContain('sess-abc');
    }
  });

  it('declares runtime controls each provider enforces or ignores', () => {
    expect(providerFor('claude').enforcement.enforced).toContain('maxTurns');
    expect(providerFor('claude').enforcement.enforced).toContain('allowedTools');

    expect(providerFor('github_copilot').enforcement.intentionallyIgnored).toContain('maxTurns');
    expect(providerFor('github_copilot').enforcement.notes.join(' ')).toMatch(/approveAll/);

    expect(providerFor('codex').enforcement.enforced).toContain('filesystemSandbox');
    expect(providerFor('codex').enforcement.intentionallyIgnored).toContain('approvalMode');
    expect(providerFor('codex').enforcement.notes.join(' ')).toMatch(/fixed approve-for-me/);
  });

  it('keeps target provider manifests aligned with legacy runtime adapters', () => {
    expect(targetProviderManifests.map((manifest) => manifest.id).sort()).toEqual(
      [...AGENT_PROVIDERS].sort(),
    );

    for (const manifest of targetProviderManifests) {
      const adapter = providerFor(manifest.id);
      expect(adapter.enforcement.enforced).toEqual(manifest.enforcement.enforced);
      expect(adapter.enforcement.intentionallyIgnored).toEqual(
        manifest.enforcement.intentionallyIgnored,
      );
      expect(manifest.capabilities.resume).toBe(
        adapter.resume.interactive ? 'interactive' : 'none',
      );
    }
  });

  it('resume.command omits cd prefix when repoPath is null', () => {
    expect(providerFor('claude').resume.command('sess-1', null)).toBe('claude --resume sess-1');
    expect(providerFor('codex').resume.command('sess-2', null)).toBe('codex resume sess-2');
    expect(providerFor('github_copilot').resume.command('sess-3', null)).toBe(
      'gh copilot -- --resume=sess-3',
    );
  });

  it('resume.command prefixes cd when repoPath is provided', () => {
    expect(providerFor('claude').resume.command('s', '/repo')).toBe(
      'cd "/repo"; claude --resume s',
    );
  });
});

describe('maybeRegisterInteractiveHistory', () => {
  beforeEach(() => {
    vi.mocked(appendFileSync).mockClear();
  });

  it('skips file write for github_copilot', () => {
    maybeRegisterInteractiveHistory('github_copilot', 'sess-1', '/repo', 'task-1');
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('skips file write for codex', () => {
    maybeRegisterInteractiveHistory('codex', 'sess-2', '/repo', 'task-2');
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it('writes one JSON line to history.jsonl for claude', () => {
    maybeRegisterInteractiveHistory('claude', 'sess-xyz', '/my/repo', 'task-display');
    expect(appendFileSync).toHaveBeenCalledOnce();
    const [filePath, content] = vi.mocked(appendFileSync).mock.calls[0] as [string, string];
    expect(filePath).toMatch(/history\.jsonl$/);
    const entry = JSON.parse(content.trim());
    expect(entry.sessionId).toBe('sess-xyz');
    expect(entry.display).toBe('task-display');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('uses OS-native path separators on the project field', () => {
    maybeRegisterInteractiveHistory('claude', 'sess-1', '/unix/path', 'x');
    const [, content] = vi.mocked(appendFileSync).mock.calls[0] as [string, string];
    const entry = JSON.parse(content.trim());
    // On Windows the project field uses backslashes; on POSIX it stays as-is.
    if (process.platform === 'win32') {
      expect(entry.project).toContain('\\');
    } else {
      expect(entry.project).toBe('/unix/path');
    }
  });

  it('swallows appendFileSync errors without throwing', () => {
    vi.mocked(appendFileSync).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });
    expect(() => {
      maybeRegisterInteractiveHistory('claude', 'sess-err', '/repo', 'x');
    }).not.toThrow();
  });
});
