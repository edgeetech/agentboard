import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function dataDir() {
  return process.env.AGENTBOARD_DATA_DIR || join(homedir(), '.agentboard');
}

export function projectsDir() { return join(dataDir(), 'projects'); }
export function trashDir()    { return join(dataDir(), 'trash'); }
export function logsDir()     { return join(dataDir(), 'logs'); }
export function runConfigDir(){ return join(dataDir(), 'run-configs'); }
export function configPath()  { return join(dataDir(), 'config.json'); }
export function lockPath()    { return join(dataDir(), 'server.lock'); }

export function projectDbPath(code) {
  return join(projectsDir(), `${code.toLowerCase()}.db`);
}

export function logPath(runId) {
  return join(logsDir(), `${runId}.jsonl`);
}
export function logErrPath(runId) {
  return join(logsDir(), `${runId}.err.log`);
}

export function ensureDirs() {
  for (const d of [dataDir(), projectsDir(), trashDir(), logsDir(), runConfigDir()]) {
    mkdirSync(d, { recursive: true });
  }
}

export const IS_WINDOWS = platform() === 'win32';
