import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSdkHooks, writeRunSettings } from '../src/run-hooks.ts';

describe('run-hooks', () => {
  it('buildSdkHooks produces a PreToolUse list with editor + Bash + Read matchers', () => {
    const h = buildSdkHooks({ runToken: 't', mcpUrl: 'http://x' });
    expect(Array.isArray(h.PreToolUse)).toBe(true);
    const first = h.PreToolUse[0];
    expect(first?.matchers).toEqual(
      expect.arrayContaining(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'Read']),
    );
    expect(typeof first?.hooks[0]).toBe('function');
  });

  it('writeRunSettings emits both settings.json and pretooluse.mjs, never the server token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-'));
    try {
      const settingsPath = writeRunSettings(dir, {
        runToken: 'rt',
        mcpUrl: 'http://127.0.0.1:1/mcp',
      });
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].matcher).toContain('Edit');
      expect(settings.env.AGENTBOARD_RUN_TOKEN).toBe('rt');
      expect(settings.env.AGENTBOARD_SERVER_TOKEN).toBeUndefined();
      const hookPath = join(dir, 'pretooluse.mjs');
      expect(existsSync(hookPath)).toBe(true);
      const hookSrc = readFileSync(hookPath, 'utf8');
      expect(hookSrc).toContain('record_tool');
      expect(hookSrc).not.toContain('AGENTBOARD_SERVER_TOKEN');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hook denies (fails closed) rather than allowing when hook input is unparseable', () => {
    // The settings.json delivery script itself calls process.exit(2) on
    // malformed stdin JSON — verified by source inspection since spawning a
    // node subprocess per-test is slow; the important regression is that the
    // old `catch { process.exit(0); }` (fail-open) pattern is gone.
    const dir = mkdtempSync(join(tmpdir(), 'rh-'));
    try {
      writeRunSettings(dir, { runToken: 'rt', mcpUrl: 'http://127.0.0.1:1/mcp' });
      const hookSrc = readFileSync(join(dir, 'pretooluse.mjs'), 'utf8');
      expect(hookSrc).not.toMatch(/catch\s*\{\s*process\.exit\(0\)/);
      expect(hookSrc).toContain("deny('malformed hook input JSON");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
