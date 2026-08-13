import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';

import type { DbHandle } from './db.ts';
import { dataDir } from './paths.ts';
import { getProject } from './repo.ts';
import { getTrackerConfig } from './tracker-sync.ts';

export type DoctorStatus = 'ok' | 'warning' | 'error' | 'unknown';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  action?: string;
}

export interface DoctorResult {
  generated_at: string;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  db?: DbHandle | null;
  projectCode?: string | null;
  probeCommand?: (cmd: string, args: string[], timeoutMs: number) => Promise<ProbeResult>;
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

const CLI_CACHE_TTL_MS = 30_000;
const cliCache = new Map<string, { until: number; result: ProbeResult }>();

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const probe = options.probeCommand ?? probeCommand;
  const checks: DoctorCheck[] = [];
  checks.push(checkNode());
  checks.push(checkDataDir());

  const db = options.db ?? null;
  if (db === null) {
    checks.push({
      id: 'project.active',
      label: 'Active project',
      status: 'warning',
      detail: 'No project database is active for this doctor request.',
      action: 'Create or select a project.',
    });
  } else {
    checks.push(checkProject(db));
    checks.push(checkSchema(db));
    checks.push(checkTrackerEnv(db));
    checks.push(...(await checkProviderCli(db, probe)));
  }

  return { generated_at: new Date().toISOString(), checks };
}

function checkNode(): DoctorCheck {
  const major = Number(/^v?(\d+)/.exec(process.version)?.[1] ?? 0);
  return {
    id: 'runtime.node',
    label: 'Node runtime',
    status: major >= 22 ? 'ok' : 'error',
    detail: `${process.version} at ${process.execPath}`,
    ...(major >= 22 ? {} : { action: 'Install Node 22 or newer.' }),
  };
}

function checkDataDir(): DoctorCheck {
  const dir = dataDir();
  try {
    accessSync(dir, constants.R_OK | constants.W_OK);
    return { id: 'storage.data_dir', label: 'Data directory', status: 'ok', detail: dir };
  } catch {
    return {
      id: 'storage.data_dir',
      label: 'Data directory',
      status: 'error',
      detail: dir,
      action: 'Create the directory and ensure the current user can read and write it.',
    };
  }
}

function checkProject(db: DbHandle): DoctorCheck {
  const project = getProject(db);
  if (project === undefined) {
    return {
      id: 'project.row',
      label: 'Project row',
      status: 'error',
      detail: 'No live project row found in the database.',
      action: 'Recreate or restore the project database.',
    };
  }
  if (!existsSync(project.repo_path)) {
    return {
      id: 'project.repo_path',
      label: 'Repository path',
      status: 'error',
      detail: project.repo_path,
      action: 'Update the project repo path to an existing directory.',
    };
  }
  const isDir = statSync(project.repo_path).isDirectory();
  return {
    id: 'project.repo_path',
    label: 'Repository path',
    status: isDir ? 'ok' : 'error',
    detail: project.repo_path,
    ...(isDir ? {} : { action: 'Point the project repo path at a directory.' }),
  };
}

function checkSchema(db: DbHandle): DoctorCheck {
  const row = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as
    | { value: string }
    | undefined;
  const version = Number(row?.value ?? 0);
  return {
    id: 'database.schema',
    label: 'Database schema',
    status: version >= 7 ? 'ok' : 'warning',
    detail: `schema_version=${row?.value ?? 'missing'}`,
    ...(version >= 7 ? {} : { action: 'Restart AgentBoard so migrations can run.' }),
  };
}

function checkTrackerEnv(db: DbHandle): DoctorCheck {
  const project = getProject(db);
  const cfg = project === undefined ? null : getTrackerConfig(db, project.id);
  if (cfg === null) {
    return {
      id: 'tracker.config',
      label: 'Tracker config',
      status: 'unknown',
      detail: 'No tracker configured.',
      action: 'Configure a tracker on the Project page if issue sync is needed.',
    };
  }
  const present =
    typeof process.env[cfg.api_key_env_var] === 'string' && process.env[cfg.api_key_env_var] !== '';
  return {
    id: 'tracker.credentials',
    label: 'Tracker credentials',
    status: present ? 'ok' : 'error',
    detail: `${cfg.kind} uses ${cfg.api_key_env_var}`,
    ...(present ? {} : { action: `Set ${cfg.api_key_env_var} before starting AgentBoard.` }),
  };
}

async function checkProviderCli(
  db: DbHandle,
  probe: (cmd: string, args: string[], timeoutMs: number) => Promise<ProbeResult>,
): Promise<DoctorCheck[]> {
  const project = getProject(db);
  const providers = new Set<string>();
  if (project?.agent_provider) providers.add(project.agent_provider);
  const rows = db
    .prepare(
      `SELECT DISTINCT COALESCE(session_provider_override, session_provider) AS provider
       FROM agent_run
       WHERE COALESCE(session_provider_override, session_provider) IS NOT NULL
       LIMIT 10`,
    )
    .all() as { provider: string | null }[];
  for (const row of rows) if (row.provider !== null) providers.add(row.provider);

  const checks: DoctorCheck[] = [];
  for (const provider of providers) {
    const spec = providerCommand(provider);
    if (spec === null) continue;
    const result = await cachedProbe(spec.cmd, spec.args, 1_500, probe);
    checks.push({
      id: `provider.${provider}`,
      label: `${provider} CLI`,
      status: result.ok ? 'ok' : 'unknown',
      detail: result.detail,
      ...(result.ok ? {} : { action: `Install and authenticate ${provider}.` }),
    });
  }
  return checks;
}

function providerCommand(provider: string): { cmd: string; args: string[] } | null {
  if (provider === 'claude') return { cmd: 'claude', args: ['--version'] };
  if (provider === 'codex') return { cmd: 'codex', args: ['--version'] };
  if (provider === 'github_copilot') return { cmd: 'gh', args: ['--version'] };
  return null;
}

async function cachedProbe(
  cmd: string,
  args: string[],
  timeoutMs: number,
  probe: (cmd: string, args: string[], timeoutMs: number) => Promise<ProbeResult>,
): Promise<ProbeResult> {
  const key = [cmd, ...args].join('\0');
  const cached = cliCache.get(key);
  if (cached !== undefined && cached.until > Date.now()) return cached.result;
  const result = await probe(cmd, args, timeoutMs);
  cliCache.set(key, { until: Date.now() + CLI_CACHE_TTL_MS, result });
  return result;
}

export function probeCommand(cmd: string, args: string[], timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let settled = false;
    let output = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, detail: `${cmd} probe timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, detail: e.message });
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        detail: `${cmd}: ${
          (output.trim().split(/\r?\n/)[0] ?? '').slice(0, 160) || `exit ${String(code)}`
        }`,
      });
    });
  });
}
