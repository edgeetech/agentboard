#!/usr/bin/env node
// Boot or reuse the agent-board core server. Called by:
//   - SessionStart hook (silent)
//   - /agent-board open skill (prints URL)
//
// Algo:
// 1. Acquire server.lock (proper-lockfile-style best-effort).
// 2. If config.port exists AND /alive returns matching server_id AND plugin_version matches → reuse.
// 3. Else spawn detached `node server.ts`; wait for READY line; write config; return port.

import { spawn, spawnSync } from 'node:child_process';
import type { SpawnOptions, SpawnSyncOptions } from 'node:child_process';
import { openSync, writeFileSync, readFileSync, existsSync, mkdirSync, closeSync, unlinkSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const IS_WINDOWS: boolean = platform() === 'win32';
const DATA_DIR: string = process.env['AGENTBOARD_DATA_DIR'] ?? join(homedir(), '.agentboard');
const CFG_PATH: string = join(DATA_DIR, 'config.json');
const LOCK_PATH: string = join(DATA_DIR, 'server.lock');

const PLUGIN_ROOT: string = resolve(fileURLToPath(import.meta.url), '..', '..');
const CORE_ROOT: string = resolve(PLUGIN_ROOT, 'agent-board-core');
const SERVER_JS: string = join(CORE_ROOT, 'server.ts');
const PLUGIN_JSON: Record<string, unknown> | null = readJsonSafe(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
const PLUGIN_VERSION: string = (typeof PLUGIN_JSON?.['version'] === 'string' ? PLUGIN_JSON['version'] : null) ?? '0.1.0';

const silent: boolean = process.argv.includes('--silent');

await main();

interface AliveResponse {
  ok: boolean;
  server_id: string;
  plugin_version: string;
}

interface ServerConfig {
  port?: number;
  pid?: number;
  server_id?: string;
  plugin_version?: string;
  [key: string]: unknown;
}

interface ReadyOk { ok: true; port: number }
interface ReadyErr { ok: false; err: string }
type ReadyResult = ReadyOk | ReadyErr;

async function main(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const lock = await tryLock();
  try {
    const cfg: ServerConfig = (readJsonSafe(CFG_PATH) as ServerConfig | null) ?? {};
    if (cfg.port) {
      const alive = await probeAlive(cfg.port, 1500);
      if (alive && alive.server_id === cfg.server_id && alive.plugin_version === PLUGIN_VERSION) {
        if (!silent) console.log(`agentboard: reusing server http://127.0.0.1:${cfg.port}`);
        return;
      }
      if (alive && alive.plugin_version !== PLUGIN_VERSION) {
        if (!silent) console.log(`agentboard: plugin version changed (${alive.plugin_version} → ${PLUGIN_VERSION}); respawning`);
        // Best-effort stop
        try { if (cfg.pid) process.kill(cfg.pid, 'SIGTERM'); } catch { /* best-effort */ }
        await delay(500);
      }
    }
    await spawnServer();
  } finally {
    if (lock) releaseLock(lock);
  }
}

async function spawnServer(): Promise<void> {
  if (!existsSync(SERVER_JS)) {
    console.error(`agentboard: core server not found at ${SERVER_JS}`);
    process.exit(2);
  }
  ensureCoreDeps();
  // --experimental-sqlite: Node 22 gate for node:sqlite (built-in; no better-sqlite3 install needed).
  //                        Ignored by Node ≥24 (stable there).
  const spawnOpts: SpawnOptions = {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AGENTBOARD_PLUGIN_VERSION: PLUGIN_VERSION },
    windowsHide: true,
    cwd: CORE_ROOT,
  };
  const child = spawn(process.execPath, ['--experimental-sqlite', '--no-warnings', SERVER_JS], spawnOpts);

  child.unref();

  // Wait for READY line on stdout
  const ready = await new Promise<ReadyResult>((resolveReady) => {
    let buf = '';
    const t = setTimeout(() => resolveReady({ ok: false, err: 'timeout' }), 8000);
    (child.stdout as NodeJS.ReadableStream).on('data', (d: Buffer) => {
      buf += d.toString();
      const m = /READY http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
      if (m) { clearTimeout(t); resolveReady({ ok: true, port: parseInt(m[1], 10) }); }
    });
    (child.stderr as NodeJS.ReadableStream).on('data', () => { /* drain stderr */ });
    child.on('exit', (c: number | null) => { clearTimeout(t); resolveReady({ ok: false, err: `exit ${c}` }); });
  });

  if (!ready.ok) {
    console.error('agentboard: server failed to start:', ready.err);
    process.exit(3);
  }
  if (!silent) console.log(`agentboard: started http://127.0.0.1:${ready.port}`);
}

async function probeAlive(port: number, timeoutMs: number): Promise<AliveResponse | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/alive`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await (res.json() as Promise<AliveResponse>);
  } catch { return null; }
}

// Best-effort file lock. Writes PID; on second run if file exists and PID is dead, remove and retry.
async function tryLock(): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      writeFileSync(LOCK_PATH, String(process.pid));
      closeSync(fd);
      return LOCK_PATH;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        const otherPid = parseInt(readFileSafe(LOCK_PATH), 10);
        if (otherPid && !processAlive(otherPid)) { try { unlinkSync(LOCK_PATH); } catch { /* best-effort */ } continue; }
        await delay(200);
        continue;
      }
      throw e;
    }
  }
  return null; // proceed without lock — another instance will reuse our spawn
}

function releaseLock(p: string): void { try { unlinkSync(p); } catch { /* best-effort */ } }

// Plugin marketplace cache copies the source tree without running `npm install`,
// so `agent-board-core/node_modules` may be missing on first run after install or
// upgrade. Install once, in-place, before the server is spawned.
function ensureCoreDeps(): void {
  const nodeModules = join(CORE_ROOT, 'node_modules');
  const pkgJson = join(CORE_ROOT, 'package.json');
  if (existsSync(nodeModules) || !existsSync(pkgJson)) return;

  const useBun = which('bun');
  const cmd = useBun ? 'bun' : (IS_WINDOWS ? 'npm.cmd' : 'npm');
  const args = useBun ? ['install', '--silent'] : ['install', '--no-audit', '--no-fund', '--silent'];

  if (!silent) console.log(`agentboard: installing core deps (first run, ~20s) via ${useBun ? 'bun' : 'npm'}...`);
  const syncOpts: SpawnSyncOptions = { cwd: CORE_ROOT, stdio: silent ? 'ignore' : 'inherit', shell: IS_WINDOWS };
  const res = spawnSync(cmd, args, syncOpts);
  if (res.status !== 0) {
    console.error(`agentboard: failed to install core deps (exit ${res.status}). Run: cd "${CORE_ROOT}" && ${useBun ? 'bun' : 'npm'} install`);
    process.exit(4);
  }
}

function which(bin: string): boolean {
  const exts: string[] = IS_WINDOWS ? ['.cmd', '.exe', '.bat', ''] : [''];
  const paths: string[] = (process.env['PATH'] ?? '').split(IS_WINDOWS ? ';' : ':');
  for (const p of paths) {
    for (const ext of exts) {
      try { if (existsSync(join(p, bin + ext))) return true; } catch { /* skip */ }
    }
  }
  return false;
}

function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
function readJsonSafe(p: string): Record<string, unknown> | null { try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { return null; } }
function readFileSafe(p: string): string { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
