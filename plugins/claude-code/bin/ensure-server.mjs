#!/usr/bin/env node
// Boot or reuse the agent-board core server. Called by:
//   - SessionStart hook (silent)
//   - /agent-board open skill (prints URL)
//
// Algo:
// 1. Acquire server.lock (proper-lockfile-style best-effort).
// 2. If config.port exists AND /alive returns matching server_id AND plugin_version matches → reuse.
// 3. Else spawn detached `node server.mjs`; wait for READY line; write config; return port.

import { spawn } from 'node:child_process';
import { openSync, writeFileSync, readFileSync, existsSync, mkdirSync, closeSync, unlinkSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const IS_WINDOWS = platform() === 'win32';
const DATA_DIR = process.env.AGENTBOARD_DATA_DIR || join(homedir(), '.agentboard');
const CFG_PATH = join(DATA_DIR, 'config.json');
const LOCK_PATH = join(DATA_DIR, 'server.lock');

const PLUGIN_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const CORE_ROOT = resolve(PLUGIN_ROOT, 'agent-board-core');
const SERVER_JS = join(CORE_ROOT, 'server.mjs');
const PLUGIN_JSON = readJsonSafe(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
const PLUGIN_VERSION = PLUGIN_JSON?.version || '0.1.0';

const silent = process.argv.includes('--silent');

await main();

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const lock = await tryLock();
  try {
    const cfg = readJsonSafe(CFG_PATH) || {};
    if (cfg.port) {
      const alive = await probeAlive(cfg.port, 1500);
      if (alive && alive.server_id === cfg.server_id && alive.plugin_version === PLUGIN_VERSION) {
        if (!silent) console.log(`agentboard: reusing server http://127.0.0.1:${cfg.port}`);
        return;
      }
      if (alive && alive.plugin_version !== PLUGIN_VERSION) {
        if (!silent) console.log(`agentboard: plugin version changed (${alive.plugin_version} → ${PLUGIN_VERSION}); respawning`);
        // Best-effort stop
        try { process.kill(cfg.pid, 'SIGTERM'); } catch {}
        await delay(500);
      }
    }
    await spawnServer();
  } finally {
    if (lock) releaseLock(lock);
  }
}

async function spawnServer() {
  if (!existsSync(SERVER_JS)) {
    console.error(`agentboard: core server not found at ${SERVER_JS}`);
    process.exit(2);
  }
  // --experimental-sqlite: Node 22 gate for node:sqlite (built-in; no better-sqlite3 install needed).
  //                        Ignored by Node ≥24 (stable there).
  const child = spawn(process.execPath, ['--experimental-sqlite', '--no-warnings', SERVER_JS], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AGENTBOARD_PLUGIN_VERSION: PLUGIN_VERSION },
    // windowsHide intentionally omitted: with CREATE_NO_WINDOW the server has no
    // console, so claude sub-processes and their tool spawns (bash/cmd/node) cannot
    // inherit one and Windows creates a new console per spawn → flashing.
    // Without this flag the server inherits the caller's console; everything
    // downstream shares it quietly. CREATE_NEW_PROCESS_GROUP (from detached:true)
    // still isolates the server from Ctrl+C in the parent terminal.
    cwd: CORE_ROOT,
  });
  child.unref();

  // Wait for READY line on stdout
  const ready = await new Promise((resolveReady) => {
    let buf = '';
    const t = setTimeout(() => resolveReady({ ok: false, err: 'timeout' }), 8000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const m = /READY http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
      if (m) { clearTimeout(t); resolveReady({ ok: true, port: parseInt(m[1], 10) }); }
    });
    child.stderr.on('data', () => {});
    child.on('exit', (c) => { clearTimeout(t); resolveReady({ ok: false, err: `exit ${c}` }); });
  });

  if (!ready.ok) {
    console.error('agentboard: server failed to start:', ready.err);
    process.exit(3);
  }
  if (!silent) console.log(`agentboard: started http://127.0.0.1:${ready.port}`);
}

async function probeAlive(port, timeoutMs) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/alive`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Best-effort file lock. Writes PID; on second run if file exists and PID is dead, remove and retry.
async function tryLock() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      writeFileSync(LOCK_PATH, String(process.pid));
      closeSync(fd);
      return LOCK_PATH;
    } catch (e) {
      if (e.code === 'EEXIST') {
        const otherPid = parseInt(readFileSafe(LOCK_PATH), 10);
        if (otherPid && !processAlive(otherPid)) { try { unlinkSync(LOCK_PATH); } catch {} continue; }
        await delay(200);
        continue;
      }
      throw e;
    }
  }
  return null; // proceed without lock — another instance will reuse our spawn
}

function releaseLock(p) { try { unlinkSync(p); } catch {} }

function processAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function readJsonSafe(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function readFileSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
