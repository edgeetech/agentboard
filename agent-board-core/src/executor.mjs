// Executor: drains queued runs, spawns headless `claude -p`, parses
// stream-json for cost, reaps orphans.

import { spawn } from 'node:child_process';
import { openSync, writeFileSync, unlinkSync, readFileSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { logsDir, logPath, logErrPath, runConfigDir } from './paths.mjs';
import { restrictPerms } from './config.mjs';
import { allowlistFor } from './tool-allowlist.mjs';
import { computeCost, PRICING_VERSION } from './pricing.mjs';
import {
  listQueuedRunsForProject, runningCount, getRun, setRunCost,
  finishRun, getProject, getTask, listComments, reapOrphans,
  claimRun as claimRunRow,
} from './repo.mjs';
import { getActiveDb } from './project-registry.mjs';
import { readConfig } from './config.mjs';
import { isoNow } from './time.mjs';

const REAPER_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_REAPER_TIMEOUT_MS || '900000', 10);
const REAPER_SWEEP_MS   = parseInt(process.env.AGENTBOARD_REAPER_SWEEP_MS   || '60000',  10);

let started = false;

export function startExecutor({ port, serverToken }) {
  if (started) return;
  started = true;
  setInterval(() => drain({ port, serverToken }).catch(logErr), 1000).unref?.();
  setInterval(() => reap().catch(logErr), REAPER_SWEEP_MS).unref?.();
  console.log('[executor] started (reaper timeout', REAPER_TIMEOUT_MS, 'ms)');
}

async function reap() {
  const active = await getActiveDb();
  if (!active) return;
  const orphaned = reapOrphans(active.db, REAPER_TIMEOUT_MS);
  if (orphaned.length) console.log('[reaper] marked', orphaned.length, 'runs as failed');
}

async function drain({ port, serverToken }) {
  const active = await getActiveDb();
  if (!active) return;
  const { db } = active;
  const project = getProject(db);
  if (!project) return;

  const running = runningCount(db);
  const budget = project.max_parallel - running;
  if (budget <= 0) return;

  const queued = listQueuedRunsForProject(db).slice(0, budget);
  for (const q of queued) {
    await tryClaimAndSpawn(db, project, q, { port, serverToken });
  }
}

async function tryClaimAndSpawn(db, project, run, { port, serverToken }) {
  // Pre-check repo_path exists
  try {
    if (!statSync(project.repo_path).isDirectory()) throw new Error('not a dir');
  } catch {
    finishRun(db, run.id, 'failed', null, `repo_path gone: ${project.repo_path}`);
    return;
  }

  const task = getTask(db, run.task_id);
  if (!task) {
    finishRun(db, run.id, 'failed', null, 'task missing');
    return;
  }

  // Issue run_token for claim; child MCP calls use it
  const run_token = randomBytes(24).toString('hex');
  const stdoutPath = logPath(run.id);
  const stderrPath = logErrPath(run.id);
  const stdoutFd = openSync(stdoutPath, 'w', 0o600);
  const stderrFd = openSync(stderrPath, 'w', 0o600);

  // Write per-run MCP config
  const runCfgPath = join(runConfigDir(), `${run.id}.json`);
  const mcpCfg = {
    mcpServers: {
      'abrun': {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${serverToken}` },
      },
    },
  };
  writeFileSync(runCfgPath, JSON.stringify(mcpCfg));
  restrictPerms(runCfgPath);

  const comments = listComments(db, task.id);
  const promptBody = renderPrompt(run.role, task, project, run.id, run_token, comments);
  const systemPrompt = loadRolePromptBody(run.role);

  const ok = claimRunRow(db, run.id, run_token, null, stdoutPath);
  if (!ok) {
    console.warn('[executor] claim lost for', run.id);
    return;
  }

  const cfg = readConfig();
  const bin = cfg.claude_bin || 'claude';
  const args = [
    '-p', promptBody,
    // NOTE: intentionally NOT using --bare (would disable OAuth/keychain auth).
    '--strict-mcp-config',             // only our abrun HTTP MCP, ignore user config + plugin MCPs
    '--append-system-prompt', systemPrompt,
    '--mcp-config', runCfgPath,
    '--allowedTools', allowlistFor(run.role),
    '--permission-mode', 'acceptEdits',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', '60',
  ];

  const child = spawn(bin, args, {
    cwd: project.repo_path,
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: true,
    env: buildChildEnv(),
  });

  db.prepare(`UPDATE agent_run SET pid=? WHERE id=?`).run(child.pid, run.id);
  child.unref();

  child.on('exit', (code) => {
    try { unlinkSync(runCfgPath); } catch {}
    // Parse cost from log (best-effort)
    try { parseAndRecordCost(db, run.id, stdoutPath); } catch (e) { logErr(e); }
    const live = getRun(db, run.id);
    if (live && live.status === 'running') {
      const errTail = tail(stderrPath, 2048);
      finishRun(db, run.id, 'failed', null, `exit ${code}${errTail ? `\n${errTail}` : ''}`);
    }
  });
}

function tail(path, bytes) {
  try {
    const st = statSync(path);
    const start = Math.max(0, st.size - bytes);
    const buf = Buffer.alloc(st.size - start);
    const fd = openSync(path, 'r');
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

function parseAndRecordCost(db, runId, logFile) {
  let lines;
  try { lines = readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch { return; }
  let model = null;
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 };
  let cliTotal = null;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init' && ev.model) model = ev.model;
    if (ev.type === 'message' && ev.message && ev.message.usage) {
      const u = ev.message.usage;
      usage.input_tokens          += u.input_tokens          || 0;
      usage.output_tokens         += u.output_tokens         || 0;
      usage.cache_creation_tokens += u.cache_creation_input_tokens || u.cache_creation_tokens || 0;
      usage.cache_read_tokens     += u.cache_read_input_tokens     || u.cache_read_tokens     || 0;
    }
    if (ev.type === 'result' && typeof ev.total_cost_usd === 'number') cliTotal = ev.total_cost_usd;
  }
  const { cost_usd, cost_version } = computeCost(model, usage);
  const final = cliTotal != null ? cliTotal : cost_usd;
  setRunCost(db, runId, { model, usage, cost_usd: final, cost_version: model ? cost_version : 0 });
}

function renderPrompt(role, task, project, runId, runToken, comments) {
  const ac = safeParseAc(task.acceptance_criteria_json);
  const recent = comments.slice(-10).map(c => `[${c.author_role}] ${c.body}`).join('\n');
  return `You are the ${role.toUpperCase()} agent. Follow your system prompt exactly.

run_id: ${runId}
run_token: ${runToken}
task_id: ${task.id}
task_code: ${task.code}
workflow_type: ${project.workflow_type}
repo_path: ${project.repo_path}

Title: ${task.title}

Description:
${task.description || '(empty — you are PM; enrich this)'}

Acceptance criteria (${ac.length}):
${ac.map((a, i) => `${i + 1}. [${a.checked ? 'x' : ' '}] ${a.text}`).join('\n') || '(none yet)'}

Recent comments:
${recent || '(none)'}

Begin. Use mcp__abrun__* tools (list_queue, claim_run, get_task, update_task, add_comment, finish_run, add_heartbeat). Finish with finish_run.`;
}

function safeParseAc(s) { try { return JSON.parse(s || '[]'); } catch { return []; } }

function loadRolePromptBody(role) {
  const url = new URL(`../prompts/${role}.md`, import.meta.url);
  return readFileSync(url, 'utf8');
}

// Keys from the parent env that are safe to pass to headless agent subprocesses.
// Using an explicit allowlist prevents ambient cloud credentials, database passwords,
// and other secrets that may be present in the server's environment from leaking into
// an untrusted subprocess that may exfiltrate them via arbitrary tool calls.
const CHILD_ENV_ALLOWLIST = new Set([
  // Shell / execution environment
  'PATH', 'SHELL', 'TERM', 'COLORTERM', 'LANG',
  'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES',
  // Unix user identity & home dir (required for OAuth keychain auth)
  'HOME', 'USER', 'LOGNAME',
  // Windows equivalents
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMFILES', 'PROGRAMDATA', 'SYSTEMROOT', 'SYSTEMDRIVE',
  'COMSPEC', 'WINDIR', 'TEMP', 'TMP', 'USERNAME',
  // XDG base dirs (Linux config paths used by Claude for auth/cache)
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
  // Anthropic / Claude authentication
  'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY',
  'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  // Node.js (agent may invoke node tooling in the project)
  'NODE_PATH', 'NODE_OPTIONS',
  // npm / package managers
  'NPM_CONFIG_USERCONFIG', 'npm_config_cache',
]);

function buildChildEnv() {
  const env = {};
  for (const k of Object.keys(process.env)) {
    if (CHILD_ENV_ALLOWLIST.has(k)) env[k] = process.env[k];
  }
  return env;
}

function logErr(e) { console.error('[executor]', e?.stack || e); }
