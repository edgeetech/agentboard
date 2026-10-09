import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';

import { configPath, IS_WINDOWS } from './paths.ts';

// config.json is read on nearly every request (tool-policy destructiveToolsAllowed,
// /mcp auth path, etc). Cache the parsed contents and only re-read from disk
// when writeConfig() changes it — avoids a sync readFileSync+JSON.parse per call.
// Keyed by path (not just mtime): AGENTBOARD_DATA_DIR can change configPath()
// between calls (tests do this routinely), and a stale cache keyed on mtime
// alone could serve a DIFFERENT file's contents if mtimes ever coincided.
let cached: { path: string; mtimeMs: number; value: Record<string, unknown> } | null = null;

export function readConfig(): Record<string, unknown> {
  try {
    const path = configPath();
    const mtimeMs = statSync(path).mtimeMs;
    if (cached !== null && cached.path === path && cached.mtimeMs === mtimeMs) return cached.value;
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    cached = { path, mtimeMs, value };
    return value;
  } catch {
    cached = null;
    return {};
  }
}

export function writeConfig(patch: Record<string, unknown>): Record<string, unknown> {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  writeFileSync(configPath(), JSON.stringify(next, null, 2));
  restrictPerms(configPath());
  cached = null; // force re-read (and fresh mtime capture) on next readConfig()
  return next;
}

export function restrictPerms(p: string): void {
  if (IS_WINDOWS) {
    const user = userInfo().username;
    if (!user) {
      throw new Error(
        'config perms: could not determine current Windows user (os.userInfo().username empty)',
      );
    }
    try {
      execFileSync('icacls', [p, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore' });
    } catch (e) {
      console.warn('[config] icacls failed:', e instanceof Error ? e.message : e);
    }
  } else {
    try {
      chmodSync(p, 0o600);
    } catch (e) {
      console.warn('[config] chmod failed:', e instanceof Error ? e.message : e);
    }
  }
}

export function configExists(): boolean {
  return existsSync(configPath());
}
