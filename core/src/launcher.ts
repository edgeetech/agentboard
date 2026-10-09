// Start, stop and inspect the AgentBoard server as a detached background
// process. Shared by the `agentboard` CLI and, through it, by every host
// plugin (Claude Code, Codex, Copilot) — hosts never spawn server.ts
// themselves, so the server outlives any one host session.

import { spawn, spawnSync } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const IS_WINDOWS = platform() === 'win32';

export const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_TS = join(CORE_ROOT, 'server.ts');

export function dataDir(): string {
  return process.env.AGENTBOARD_DATA_DIR ?? join(homedir(), '.agentboard');
}
const cfgPath = (): string => join(dataDir(), 'config.json');
const lockPath = (): string => join(dataDir(), 'server.lock');

export interface ServerConfig {
  port?: number;
  pid?: number;
  server_id?: string;
  plugin_version?: string;
  boot_error?: string;
  [key: string]: unknown;
}

export interface AliveResponse {
  ok: boolean;
  server_id: string;
  plugin_version: string;
}

export interface RunningServer {
  url: string;
  port: number;
  pid: number | undefined;
  version: string;
}

export type Log = (line: string) => void;

export function runtimeVersion(): string {
  const pkg = readJsonSafe(join(CORE_ROOT, 'package.json'));
  return typeof pkg?.version === 'string' ? pkg.version : '0.0.0';
}

export function readConfig(): ServerConfig {
  return readJsonSafe(cfgPath()) ?? {};
}

export async function probeAlive(port: number, timeoutMs: number): Promise<AliveResponse | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/alive`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as AliveResponse;
  } catch {
    return null;
  }
}

/** The server recorded in config.json, if it answers /alive as itself. */
export async function findRunning(timeoutMs = 1500): Promise<RunningServer | null> {
  const cfg = readConfig();
  if (!cfg.port) return null;
  const alive = await probeAlive(cfg.port, timeoutMs);
  if (!alive || alive.server_id !== cfg.server_id) return null;
  return { url: `http://127.0.0.1:${cfg.port}`, port: cfg.port, pid: cfg.pid, version: alive.plugin_version };
}

/**
 * Reuse the running server when it is this runtime's version; otherwise
 * replace it. A version mismatch means the runtime was updated on disk
 * while an older server kept running.
 */
export async function ensureRunning(opts: { port?: number; log: Log }): Promise<RunningServer> {
  mkdirSync(dataDir(), { recursive: true });
  const version = runtimeVersion();
  const lock = await tryLock();
  try {
    const running = await findRunning();
    if (running?.version === version) {
      clearBootError();
      opts.log(`agentboard: reusing server ${running.url}`);
      return running;
    }
    if (running) {
      opts.log(`agentboard: runtime version changed (${running.version} → ${version}); restarting`);
      await stopPid(running.pid, running.port);
    }
    ensureCoreDeps(opts.log);
    // Keep the last port so bookmarks and host MCP configs stay valid.
    const started = await spawnServer(opts.port ?? readConfig().port);
    opts.log(`agentboard: started ${started.url}`);
    return started;
  } finally {
    if (lock) releaseLock(lock);
  }
}

export async function stopServer(log: Log): Promise<boolean> {
  const running = await findRunning();
  if (!running) {
    log('agentboard: server is not running');
    return false;
  }
  await stopPid(running.pid, running.port);
  log('agentboard: stopped');
  return true;
}

async function stopPid(pid: number | undefined, port: number): Promise<void> {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 25; i++) {
    if (!(await probeAlive(port, 300))) return;
    await delay(200);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

async function spawnServer(port: number | undefined): Promise<RunningServer> {
  if (!existsSync(SERVER_TS)) fail(`core server not found at ${SERVER_TS}`, 2);
  // --experimental-sqlite gates node:sqlite on Node 22 and is ignored on ≥24.
  const args = ['--experimental-sqlite', '--experimental-strip-types', '--no-warnings', SERVER_TS];
  if (port) args.push('--port', String(port));
  const spawnOpts: SpawnOptions = {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    windowsHide: true,
    cwd: CORE_ROOT,
  };
  const child = spawn(process.execPath, args, spawnOpts);
  child.unref();

  // Cold start (first strip-types parse of src/, node:sqlite init) can take
  // well over 8s on Windows under disk/AV load; a dead child still resolves
  // at once through the 'exit' handler.
  const READY_TIMEOUT_MS = 20_000;
  const ready = await new Promise<{ ok: true; port: number } | { ok: false; err: string }>((_resolve) => {
    let buf = '';
    const t = setTimeout(() => {
      _resolve({ ok: false, err: 'timeout' });
    }, READY_TIMEOUT_MS);
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      const m = /READY http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
      if (m?.[1] !== undefined) {
        clearTimeout(t);
        _resolve({ ok: true, port: Number.parseInt(m[1], 10) });
      }
    });
    child.stderr?.on('data', () => {
      /* drain */
    });
    child.on('exit', (code: number | null) => {
      clearTimeout(t);
      _resolve({ ok: false, err: `exit ${String(code)}` });
    });
  });
  // Stop reading so the detached child is not tied to this process.
  child.stdout?.destroy();
  child.stderr?.destroy();

  if (!ready.ok) {
    // A timeout may only mean the READY line was missed: the child writes
    // config.json in the same tick, so trust /alive before failing.
    if (ready.err === 'timeout') {
      const running = await findRunning(2000);
      if (running) {
        clearBootError();
        return running;
      }
    }
    fail(`server failed to start: ${ready.err}`, 3);
  }
  clearBootError();
  return { url: `http://127.0.0.1:${ready.port}`, port: ready.port, pid: child.pid, version: runtimeVersion() };
}

/** Install runtime dependencies in place when node_modules is missing. */
export function ensureCoreDeps(log: Log, force = false): void {
  if (!force && existsSync(join(CORE_ROOT, 'node_modules'))) return;
  const useBun = which('bun');
  const tool = useBun ? 'bun' : 'npm';
  const cmd = useBun ? 'bun' : IS_WINDOWS ? 'npm.cmd' : 'npm';
  const args = useBun ? ['install', '--silent'] : ['install', '--no-audit', '--no-fund', '--silent'];
  log(`agentboard: installing runtime dependencies via ${tool} (~20s)...`);
  const res = spawnSync(cmd, args, { cwd: CORE_ROOT, stdio: 'ignore', shell: IS_WINDOWS });
  if (res.status !== 0) {
    fail(`failed to install runtime dependencies (exit ${String(res.status)}). Run: cd "${CORE_ROOT}" && ${tool} install`, 4);
  }
}

/** Record why startup failed so doctor and the MCP proxy can show it. */
export function writeBootError(msg: string): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(
      cfgPath(),
      JSON.stringify({ ...readConfig(), boot_error: msg, boot_error_at: new Date().toISOString() }, null, 2),
    );
  } catch {
    /* best-effort */
  }
}

function clearBootError(): void {
  try {
    const cur = readConfig();
    if (cur.boot_error === undefined) return;
    delete cur.boot_error;
    delete cur.boot_error_at;
    writeFileSync(cfgPath(), JSON.stringify(cur, null, 2));
  } catch {
    /* best-effort */
  }
}

export class LauncherError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(msg: string, exitCode: number): never {
  writeBootError(msg);
  throw new LauncherError(msg, exitCode);
}

// Best-effort file lock: holds our PID; a lock left by a dead PID is reclaimed.
async function tryLock(): Promise<string | null> {
  const p = lockPath();
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const fd = openSync(p, 'wx');
      writeFileSync(p, String(process.pid));
      closeSync(fd);
      return p;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const otherPid = Number.parseInt(readFileSafe(p), 10);
      if (otherPid && !processAlive(otherPid)) {
        try {
          unlinkSync(p);
        } catch {
          /* raced */
        }
        continue;
      }
      await delay(200);
    }
  }
  return null; // proceed unlocked; a concurrent starter's server gets reused
}

function releaseLock(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    /* best-effort */
  }
}

function which(bin: string): boolean {
  const exts = IS_WINDOWS ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(IS_WINDOWS ? ';' : ':')) {
    for (const ext of exts) {
      if (dir && existsSync(join(dir, bin + ext))) return true;
    }
  }
  return false;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJsonSafe(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readFileSafe(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
