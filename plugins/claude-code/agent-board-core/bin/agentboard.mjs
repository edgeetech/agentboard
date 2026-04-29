#!/usr/bin/env node
// bin/agentboard.mjs
import { Command } from 'commander';
import { spawn } from 'child_process';
import { resolve } from 'path';

const program = new Command();
program.name('agentboard').description('AgentBoard CLI').version('1.0.0');

program.command('start')
  .description('Start the AgentBoard server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('-h, --host <host>', 'Host to bind to', '127.0.0.1')
  .action((opts) => {
    const serverPath = resolve(import.meta.dirname, '../server.mjs');
    const env = {
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
  .action(async (opts) => {
    try {
      const res = await fetch(`${opts.url}/alive`);
      const data = await res.json();
      console.log('Server is running:', data);
    } catch {
      console.log('Server is not running');
    }
  });

program.parse();
