import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { hasApiKeyEnvVar, parseAgentConfig, parseAuthConfig, resolveAuthMode } from './agent-config.ts';
import { resolveCodexLaunch } from './codex-runner.ts';
import type { DbHandle } from './db.ts';
import { dataDir } from './paths.ts';
import { claudeDotDir } from './provider-registry.ts';
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
  probeAuthStatus?: (provider: string, timeoutMs: number) => Promise<AuthStatusResult>;
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

export interface AuthStatusResult {
  /** 'ok' = confirmed logged in / usable; 'warning' = probe ran but state looks off; 'unknown' = probe failed/unavailable/timed out. */
  status: 'ok' | 'warning' | 'unknown';
  detail: string;
  /** Best-effort auth source label, e.g. 'oauth', 'api_key', 'gh-cli' — used for the auto-mode override warning. */
  source?: 'subscription' | 'api_key' | 'unknown';
}

const CLI_CACHE_TTL_MS = 30_000;
const cliCache = new Map<string, { until: number; result: ProbeResult }>();
const AUTH_PROBE_TIMEOUT_MS = 2_000;

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const probe = options.probeCommand ?? probeCommand;
  const probeAuth = options.probeAuthStatus ?? probeAuthStatus;
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
    checks.push(...(await checkProviderCli(db, probe, probeAuth)));
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

/** Providers actually in play for this project: legacy default, per-role config, and recent run history. */
function relevantProviders(db: DbHandle): Set<string> {
  const project = getProject(db);
  const providers = new Set<string>();
  if (project?.agent_provider) providers.add(project.agent_provider);
  const cfg = parseAgentConfig(project?.agent_config_json ?? null);
  if (cfg !== null) {
    for (const roleCfg of [cfg.pm, cfg.worker, cfg.reviewer]) {
      if (roleCfg === undefined) continue;
      if (roleCfg.type === 'single') providers.add(roleCfg.provider);
      else for (const member of roleCfg.members) providers.add(member);
    }
  }
  const rows = db
    .prepare(
      `SELECT DISTINCT COALESCE(session_provider_override, session_provider) AS provider
       FROM agent_run
       WHERE COALESCE(session_provider_override, session_provider) IS NOT NULL
       LIMIT 10`,
    )
    .all() as { provider: string | null }[];
  for (const row of rows) if (row.provider !== null) providers.add(row.provider);
  return providers;
}

async function checkProviderCli(
  db: DbHandle,
  probe: (cmd: string, args: string[], timeoutMs: number) => Promise<ProbeResult>,
  probeAuth: (provider: string, timeoutMs: number) => Promise<AuthStatusResult>,
): Promise<DoctorCheck[]> {
  const providers = relevantProviders(db);
  const project = getProject(db);
  const authConfig = parseAuthConfig(project?.auth_config_json ?? null);

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

    const authResult = await probeAuth(provider, AUTH_PROBE_TIMEOUT_MS).catch(
      (e: unknown): AuthStatusResult => ({
        status: 'unknown',
        detail: e instanceof Error ? e.message : String(e),
      }),
    );
    checks.push({
      id: `provider.${provider}.auth`,
      label: `${provider} login state`,
      status: authResult.status,
      detail: authResult.detail,
      ...(authResult.status === 'ok' ? {} : { action: loginActionFor(provider) }),
    });

    // 'auto' preserves current behaviour, but a stray API-key env var silently
    // overrides an interactive login. Warn so users can pin auth_mode explicitly.
    const mode = resolveAuthMode(provider as 'claude' | 'codex' | 'github_copilot', authConfig);
    if (
      mode === 'auto' &&
      authResult.status === 'ok' &&
      authResult.source === 'subscription' &&
      hasApiKeyEnvVar(process.env, provider as 'claude' | 'codex' | 'github_copilot')
    ) {
      checks.push({
        id: `provider.${provider}.auth_override_risk`,
        label: `${provider} auth override risk`,
        status: 'warning',
        detail: `${provider} is logged in via subscription, but an API-key env var is also set and auth_mode is 'auto' — the key may silently override the subscription and bill the API.`,
        action: `Unset the ${provider} API-key env var, or set this project's auth_mode for ${provider} to 'subscription'.`,
      });
    }
  }
  return checks;
}

function loginActionFor(provider: string): string {
  if (provider === 'claude') return 'Run `claude /login` or `claude setup-token`.';
  if (provider === 'codex') return 'Run `codex login`.';
  if (provider === 'github_copilot') return 'Run `copilot`, then `/login`.';
  return `Authenticate ${provider}.`;
}

function providerCommand(provider: string): { cmd: string; args: string[] } | null {
  if (provider === 'claude') return { cmd: 'claude', args: ['--version'] };
  if (provider === 'codex') return { cmd: 'codex', args: ['--version'] };
  if (provider === 'github_copilot') return { cmd: 'copilot', args: ['--version'] };
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

/**
 * Spawn a CLI, capture stdout+stderr, and resolve rather than reject/throw —
 * a missing binary, non-zero exit, or timeout all resolve `{ok:false}` so a
 * single bad probe can never break the rest of the doctor report or block
 * the event loop. Codex gets the same Windows npm-shim launch resolution the
 * executor uses (bare "codex" ENOENTs on Windows since child_process.spawn
 * doesn't consult PATHEXT without shell:true); other providers spawn directly.
 */
function spawnCapture(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; exitCode: number | null; output: string }> {
  const launch =
    cmd === 'codex'
      ? resolveCodexLaunch(process.env as Record<string, string>, args)
      : { command: cmd, args };
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(launch.command, launch.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      resolve({ ok: false, exitCode: null, output: e instanceof Error ? e.message : String(e) });
      return;
    }
    let settled = false;
    let output = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, exitCode: null, output: `${cmd} probe timed out after ${timeoutMs}ms` });
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
      resolve({ ok: false, exitCode: null, output: e.message });
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, output: output.trim() });
    });
  });
}

export async function probeCommand(cmd: string, args: string[], timeoutMs: number): Promise<ProbeResult> {
  const result = await spawnCapture(cmd, args, timeoutMs);
  return {
    ok: result.ok,
    detail: result.ok
      ? `${cmd}: ${(result.output.split(/\r?\n/)[0] ?? '').slice(0, 160) || `exit ${String(result.exitCode)}`}`
      : result.output,
  };
}

/**
 * Best-effort login-state probe per provider. Never throws; a timeout or any
 * unexpected shape resolves 'unknown' rather than failing the whole request.
 *
 * - claude: `claude auth status --json` → { loggedIn, authMethod, subscriptionType }.
 *   Falls back to detecting ~/.claude/.credentials.json (or CLAUDE_CONFIG_DIR)
 *   or an explicit token env var when the CLI probe itself is unavailable.
 * - codex: `codex login status` (text) — exit 0 and no "not logged in" text.
 * - github_copilot: no CLI login-status subcommand shipped as of writing;
 *   reports 'unknown' with an actionable hint. (SDK's getAuthStatus() requires
 *   spawning a CLI server, too heavy for a doctor probe.)
 */
export async function probeAuthStatus(provider: string, timeoutMs: number): Promise<AuthStatusResult> {
  if (provider === 'claude') return probeClaudeAuthStatus(timeoutMs);
  if (provider === 'codex') return probeCodexAuthStatus(timeoutMs);
  if (provider === 'github_copilot') {
    return {
      status: 'unknown',
      detail: 'No CLI login-status subcommand available for Copilot CLI.',
    };
  }
  return { status: 'unknown', detail: `No auth probe implemented for ${provider}.` };
}

interface ClaudeAuthStatusJson {
  loggedIn?: boolean;
  authMethod?: string;
  subscriptionType?: string;
}

async function probeClaudeAuthStatus(timeoutMs: number): Promise<AuthStatusResult> {
  const result = await spawnCapture('claude', ['auth', 'status', '--json'], timeoutMs);
  if (result.ok) {
    try {
      const parsed = JSON.parse(result.output) as ClaudeAuthStatusJson;
      if (parsed.loggedIn === true) {
        return {
          status: 'ok',
          detail: `logged in via ${parsed.authMethod ?? 'unknown method'}${
            parsed.subscriptionType ? ` (${parsed.subscriptionType})` : ''
          }`,
          source: 'subscription',
        };
      }
      return { status: 'warning', detail: 'claude auth status reports not logged in.' };
    } catch {
      /* fall through to file-based fallback below */
    }
  }
  // CLI probe unavailable/unparseable — fall back to detecting a credentials
  // file or an explicit token env var so the check still reports something.
  const credentialsPath = join(claudeDotDir(), '.credentials.json');
  if (existsSync(credentialsPath)) {
    return {
      status: 'ok',
      detail: `credentials file found at ${credentialsPath}`,
      source: 'subscription',
    };
  }
  if (
    typeof process.env.CLAUDE_CODE_OAUTH_TOKEN === 'string' &&
    process.env.CLAUDE_CODE_OAUTH_TOKEN !== ''
  ) {
    return { status: 'ok', detail: 'CLAUDE_CODE_OAUTH_TOKEN is set', source: 'subscription' };
  }
  if (typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY !== '') {
    return { status: 'ok', detail: 'ANTHROPIC_API_KEY is set', source: 'api_key' };
  }
  return { status: 'unknown', detail: result.output || 'claude auth status probe unavailable.' };
}

async function probeCodexAuthStatus(timeoutMs: number): Promise<AuthStatusResult> {
  const result = await spawnCapture('codex', ['login', 'status'], timeoutMs);
  if (result.ok) {
    if (/not logged in/i.test(result.output)) {
      return { status: 'warning', detail: result.output };
    }
    return { status: 'ok', detail: result.output, source: 'subscription' };
  }
  if (typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY !== '') {
    return { status: 'ok', detail: 'OPENAI_API_KEY is set', source: 'api_key' };
  }
  return { status: 'unknown', detail: result.output };
}
