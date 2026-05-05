#!/usr/bin/env node
// bin/agentboard.ts
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

const program = new Command();
program.name('agentboard').description('AgentBoard CLI').version('1.0.0');

program.command('start')
  .description('Start the AgentBoard server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('-h, --host <host>', 'Host to bind to', '127.0.0.1')
  .action((opts: { port: string; host: string }): void => {
    const serverPath = resolve(fileURLToPath(import.meta.url), '../../server.ts');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGENTBOARD_PORT: opts.port,
      AGENTBOARD_HOST: opts.host,
    };
    spawn('node', ['--experimental-sqlite', serverPath], {
      stdio: 'inherit',
      env,
    });
  });

program.command('status')
  .description('Show server status')
  .option('-u, --url <url>', 'Server URL', 'http://127.0.0.1:3000')
  .action(async (opts: { url: string }): Promise<void> => {
    try {
      const res = await fetch(`${opts.url}/alive`);
      const data: unknown = await res.json();
      console.warn('Server is running:', data);
    } catch {
      console.warn('Server is not running');
    }
  });

program.parse();
