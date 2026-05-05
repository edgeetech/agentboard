import { mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function dataDir(): string {
  return process.env.AGENTBOARD_DATA_DIR ?? join(homedir(), '.agentboard');
}

export function projectsDir(): string {
  return join(dataDir(), 'projects');
}
export function trashDir(): string {
  return join(dataDir(), 'trash');
}
export function logsDir(): string {
  return join(dataDir(), 'logs');
}
export function runConfigDir(): string {
  return join(dataDir(), 'run-configs');
}
export function configPath(): string {
  return join(dataDir(), 'config.json');
}
export function lockPath(): string {
  return join(dataDir(), 'server.lock');
}

export function projectDbPath(code: string): string {
  return join(projectsDir(), `${code.toLowerCase()}.db`);
}

export function logPath(runId: string): string {
  return join(logsDir(), `${runId}.jsonl`);
}
export function logErrPath(runId: string): string {
  return join(logsDir(), `${runId}.err.log`);
}

export function ensureDirs(): void {
  for (const d of [dataDir(), projectsDir(), trashDir(), logsDir(), runConfigDir()]) {
    mkdirSync(d, { recursive: true });
  }
}

export const IS_WINDOWS: boolean = platform() === 'win32';
