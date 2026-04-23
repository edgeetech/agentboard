import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
    try {
      const user = process.env.USERNAME || 'Everyone';
      execFileSync('icacls', [p, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore' });
    } catch { /* best effort */ }
  } else {
    try { chmodSync(p, 0o600); } catch { /* best effort */ }
  }
}

export function configExists() { return existsSync(configPath()); }
