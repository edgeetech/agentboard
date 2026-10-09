#!/usr/bin/env node
// Host-side launcher. Finds the AgentBoard runtime (installing it once if
// missing) and forwards to its `agentboard` CLI. The runtime is not part of
// this plugin: plugin updates never restart or replace the server.
//
// This file is shared verbatim by every host plugin (claude-code, codex);
// plugins/hosts/test keeps the copies identical.
//
// Usage: ensure-server.ts [start|stop|restart|status|open|update|path] [--silent]
//   With no command it runs `start`. --silent (SessionStart hooks) returns at
//   once and does any slow first-time install/start in a detached process.
//
// Runtime lookup order:
//   1. AGENTBOARD_RUNTIME — a runtime dir (contains bin/agentboard.ts) or a repo checkout (contains core/)
//   2. the repo checkout this plugin lives in (development; AGENTBOARD_SKIP_CHECKOUT=1 ignores it)
//   3. <data dir>/runtime/core — the managed install, cloned on first use

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_URL = process.env['AGENTBOARD_RUNTIME_REPO'] ?? 'https://github.com/edgeetech/agentboard.git';
const DATA_DIR = process.env['AGENTBOARD_DATA_DIR'] ?? join(homedir(), '.agentboard');
const CFG_PATH = join(DATA_DIR, 'config.json');
const MANAGED_REPO = join(DATA_DIR, 'runtime');
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_REL = join('bin', 'agentboard.ts');

const argv = process.argv.slice(2);
const silent = argv.includes('--silent');
const command = argv.find((a) => !a.startsWith('-')) ?? 'start';
const BOOTSTRAP_CHILD = process.env['AGENTBOARD_BOOTSTRAP_CHILD'] === '1';

process.exitCode = await main();

async function main(): Promise<number> {
  if (command === 'start' && (await serverAlive())) {
    if (!silent) console.log(`agentboard: reusing server http://127.0.0.1:${String(readConfig().port)}`);
    return 0;
  }
  // A SessionStart hook must never wait on a clone, an npm install or a cold
  // start: hand the work to a detached copy of this script and return. The
  // MCP proxy re-reads config.json per call and retries until it is up.
  if (silent && !BOOTSTRAP_CHILD) {
    spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...argv], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AGENTBOARD_BOOTSTRAP_CHILD: '1' },
      windowsHide: true,
    }).unref();
    return 0;
  }

  const runtime = locateRuntime() ?? installRuntime();
  if (runtime === null) return 6;
  const passthrough = argv.filter((a) => a !== '--silent' && a !== command);
  const args = ['--experimental-strip-types', '--no-warnings', join(runtime, CLI_REL), command, ...passthrough];
  if (silent && command === 'start') args.push('--quiet');
  const res = spawnSync(process.execPath, args, { stdio: silent ? 'ignore' : 'inherit' });
  return res.status ?? 1;
}

function locateRuntime(): string | null {
  const fromEnv = process.env['AGENTBOARD_RUNTIME'];
  const candidates: string[] = [];
  if (fromEnv) candidates.push(fromEnv, join(fromEnv, 'core'));
  // Development: plugins/<host>/ inside a checkout that has core/ beside it.
  const repo = resolve(PLUGIN_ROOT, '..', '..');
  const useCheckout = process.env['AGENTBOARD_SKIP_CHECKOUT'] !== '1';
  if (useCheckout && existsSync(join(repo, '.claude-plugin', 'marketplace.json'))) candidates.push(join(repo, 'core'));
  candidates.push(join(MANAGED_REPO, 'core'));
  return candidates.find((dir) => existsSync(join(dir, CLI_REL))) ?? null;
}

function installRuntime(): string | null {
  if (!silent) console.log(`agentboard: installing runtime into ${MANAGED_REPO} (first run)...`);
  mkdirSync(DATA_DIR, { recursive: true });
  const res = spawnSync('git', ['clone', '--depth', '1', REPO_URL, MANAGED_REPO], {
    stdio: silent ? 'ignore' : 'inherit',
  });
  const runtime = join(MANAGED_REPO, 'core');
  if (res.status === 0 && existsSync(join(runtime, CLI_REL))) return runtime;
  const msg =
    res.error !== undefined
      ? `git is required to install the AgentBoard runtime (${res.error.message})`
      : `could not clone ${REPO_URL} into ${MANAGED_REPO} (exit ${String(res.status)})`;
  writeBootError(`${msg}. Or set AGENTBOARD_RUNTIME to an existing checkout.`);
  console.error(`agentboard: ${msg}. Or set AGENTBOARD_RUNTIME to an existing checkout.`);
  return null;
}

async function serverAlive(): Promise<boolean> {
  const cfg = readConfig();
  if (typeof cfg.port !== 'number') return false;
  try {
    const res = await fetch(`http://127.0.0.1:${String(cfg.port)}/alive`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { server_id?: unknown };
    return res.ok && body.server_id === cfg.server_id;
  } catch {
    return false;
  }
}

function readConfig(): { port?: unknown; server_id?: unknown; [key: string]: unknown } {
  try {
    return JSON.parse(readFileSync(CFG_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeBootError(msg: string): void {
  try {
    writeFileSync(
      CFG_PATH,
      JSON.stringify({ ...readConfig(), boot_error: msg, boot_error_at: new Date().toISOString() }, null, 2),
    );
  } catch {
    /* best-effort */
  }
}
