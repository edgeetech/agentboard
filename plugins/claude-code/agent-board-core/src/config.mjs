import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { configPath, IS_WINDOWS } from './paths.mjs';

export function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch { return {}; }
}

export function writeConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  writeFileSync(configPath(), JSON.stringify(next, null, 2));
  restrictPerms(configPath());
  return next;
}

export function restrictPerms(p) {
  if (IS_WINDOWS) {
    // Read the current user from the OS, not from the env — env.USERNAME can
    // be unset or spoofed, which would previously fall back to 'Everyone' and
    // leave the config world-readable.
    const user = userInfo().username;
    if (!user) {
      throw new Error('config perms: could not determine current Windows user (os.userInfo().username empty)');
    }
    try {
      execFileSync('icacls', [p, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore' });
    } catch (e) {
      console.warn('[config] icacls failed:', e?.message || e);
    }
  } else {
    try { chmodSync(p, 0o600); } catch (e) {
      console.warn('[config] chmod failed:', e?.message || e);
    }
  }
}

export function configExists() { return existsSync(configPath()); }
