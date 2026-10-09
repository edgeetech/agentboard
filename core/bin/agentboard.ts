#!/usr/bin/env node
/* eslint-disable no-console -- printing status is this CLI's job */
// agentboard CLI — the one way to run the AgentBoard runtime. Host plugins
// (Claude Code, Codex, Copilot) locate this file and call it; the server it
// starts is detached, so it keeps running when a host session ends.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';

import {
  CORE_ROOT,
  ensureCoreDeps,
  ensureRunning,
  findRunning,
  LauncherError,
  readConfig,
  runtimeVersion,
  stopServer,
} from '../src/launcher.ts';

const say =
  (quiet: boolean) =>
  (line: string): void => {
    if (!quiet) console.log(line);
  };

// A fresh runtime checkout has no node_modules yet; install before loading
// any dependency. launcher.ts itself only uses Node built-ins.
try {
  ensureCoreDeps(say(process.argv.includes('--quiet') || process.argv.includes('-q')));
} catch (e) {
  if (e instanceof LauncherError) {
    console.error(`agentboard: ${e.message}`);
    process.exit(e.exitCode);
  }
  throw e;
}
const { Command } = await import('commander');

const program = new Command();
program.name('agentboard').description('AgentBoard local runtime').version(runtimeVersion());

program
  .command('start')
  .description('Start the server in the background, or reuse the running one')
  .option('-p, --port <port>', 'Port to listen on (default: last used, else 5501)')
  .option('-q, --quiet', 'Print nothing on success')
  .option('--foreground', 'Run the server in this terminal instead of detaching')
  .action(async (opts: { port?: string; quiet?: boolean; foreground?: boolean }): Promise<void> => {
    if (opts.foreground) {
      const args = ['--experimental-sqlite', '--experimental-strip-types', '--no-warnings', join(CORE_ROOT, 'server.ts')];
      if (opts.port) args.push('--port', opts.port);
      ensureCoreDeps(say(false));
      const res = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: CORE_ROOT });
      process.exitCode = res.status ?? 1;
      return;
    }
    await ensureRunning({ ...(opts.port ? { port: Number(opts.port) } : {}), log: say(opts.quiet ?? false) });
  });

program
  .command('stop')
  .description('Stop the running server')
  .action(async (): Promise<void> => {
    await stopServer(say(false));
  });

program
  .command('restart')
  .description('Stop and start the server')
  .action(async (): Promise<void> => {
    await stopServer(say(true));
    await ensureRunning({ log: say(false) });
  });

program
  .command('status')
  .description('Show whether the server is running')
  .option('--json', 'Print machine-readable status')
  .action(async (opts: { json?: boolean }): Promise<void> => {
    const running = await findRunning();
    const bootError = readConfig().boot_error;
    if (opts.json) {
      console.log(JSON.stringify({ running: running !== null, ...running, runtime: CORE_ROOT, boot_error: bootError ?? null }));
    } else if (running) {
      console.log(`agentboard ${running.version} running at ${running.url} (pid ${String(running.pid)})`);
    } else {
      console.log(`agentboard is not running${bootError ? ` — last start failed: ${bootError}` : ''}`);
    }
    if (!running) process.exitCode = 1;
  });

program
  .command('open')
  .description('Start the server if needed and open the board in a browser')
  .action(async (): Promise<void> => {
    const running = await ensureRunning({ log: say(false) });
    openBrowser(running.url);
  });

program
  .command('update')
  .description('Pull the latest runtime from git, reinstall dependencies and restart')
  .action(async (): Promise<void> => {
    const repo = resolve(CORE_ROOT, '..');
    if (!existsSync(join(repo, '.git'))) {
      throw new LauncherError(`${repo} is not a git checkout; update it the way you installed it`, 5);
    }
    const before = runtimeVersion();
    const pull = spawnSync('git', ['-C', repo, 'pull', '--ff-only'], { stdio: 'inherit' });
    if (pull.status !== 0) throw new LauncherError('git pull failed', 5);
    ensureCoreDeps(say(false), true);
    const after = runtimeVersion();
    console.log(before === after ? `agentboard: already at ${after}` : `agentboard: updated ${before} → ${after}`);
    // ensureRunning restarts a server whose version differs from the runtime on disk.
    if (await findRunning()) await ensureRunning({ log: say(false) });
  });

program
  .command('path')
  .description('Print the runtime directory')
  .action((): void => {
    console.log(CORE_ROOT);
  });

function openBrowser(url: string): void {
  const os = platform();
  const [cmd, args] =
    os === 'win32' ? ['cmd', ['/c', 'start', '', url]] : os === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof LauncherError) {
    console.error(`agentboard: ${e.message}`);
    process.exit(e.exitCode);
  }
  throw e;
}
