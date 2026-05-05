import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';

import { configPath, IS_WINDOWS } from './paths.ts';

export function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeConfig(patch: Record<string, unknown>): Record<string, unknown> {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  writeFileSync(configPath(), JSON.stringify(next, null, 2));
  restrictPerms(configPath());
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
