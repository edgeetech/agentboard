import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSdkHooks, writeRunSettings } from '../src/run-hooks.ts';

describe('run-hooks', () => {
  it('buildSdkHooks produces a PreToolUse list with editor + Bash matchers', () => {
    const h = buildSdkHooks({ runToken: 't', mcpUrl: 'http://x', serverToken: 's' });
    expect(Array.isArray(h.PreToolUse)).toBe(true);
    const first = h.PreToolUse[0];
    expect(first?.matchers).toEqual(
      expect.arrayContaining(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']),
    );
    expect(typeof first?.hooks[0]).toBe('function');
  });

  it('writeRunSettings emits both settings.json and pretooluse.mjs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-'));
    try {
      const settingsPath = writeRunSettings(dir, {
        runToken: 'rt',
        mcpUrl: 'http://127.0.0.1:1/mcp',
        serverToken: 'st',
      });
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].matcher).toContain('Edit');
      expect(settings.env.AGENTBOARD_RUN_TOKEN).toBe('rt');
      const hookPath = join(dir, 'pretooluse.mjs');
      expect(existsSync(hookPath)).toBe(true);
      const hookSrc = readFileSync(hookPath, 'utf8');
      expect(hookSrc).toContain('record_tool');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
