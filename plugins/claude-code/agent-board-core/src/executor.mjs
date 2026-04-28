// Executor: drains queued runs, spawns headless `claude -p`, parses
// stream-json for cost, reaps orphans.

import { spawn } from 'node:child_process';
import { openSync, writeFileSync, appendFileSync, unlinkSync, readFileSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { logsDir, logPath, logErrPath, runConfigDir } from './paths.mjs';
import { restrictPerms } from './config.mjs';
import { allowlistFor } from './tool-allowlist.mjs';
import { buildChildEnv } from './child-env.mjs';
import { inheritedUserMcpServers } from './user-mcps.mjs';
import { computeCost, PRICING_VERSION } from './pricing.mjs';
import {
  listQueuedRunsForProject, runningCount, getRun, setRunCost,
  finishRun, getProject, getTask, listComments, reapOrphans,
  claimRun as claimRunRow,
} from './repo.mjs';
import { getActiveDb, getDb, listProjectDbs } from './project-registry.mjs';
import { readConfig } from './config.mjs';
import { isoNow } from './time.mjs';
import { ulid } from './ulid.mjs';
import { scheduleRetry } from './retry-manager.mjs';
import { RateLimitTracker } from './rate-limiter.mjs';
import { Workspace } from './workspace.mjs';

const rateLimiter = new RateLimitTracker();

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
  for (const code of listProjectDbs()) {
    try {
      const db = await getDb(code);
      const orphaned = reapOrphans(db, REAPER_TIMEOUT_MS);
      if (orphaned.length) console.log('[reaper]', code, 'marked', orphaned.length, 'runs as failed');
    } catch (e) { logErr(e); }
  }
}

async function drain({ port, serverToken }) {
  for (const code of listProjectDbs()) {
    try {
      const db = await getDb(code);
      const project = getProject(db);
      if (!project) continue;
      const running = runningCount(db);
      const budget = project.max_parallel - running;
      if (budget <= 0) continue;
      const queued = listQueuedRunsForProject(db).slice(0, budget);
      for (const q of queued) {
        await tryClaimAndSpawn(db, project, q, { port, serverToken });
      }
    } catch (e) { logErr(e); }
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

  // Set up per-task workspace if project has workspace_root configured
  let workspacePath = project.repo_path; // default: use repo_path (current behavior)
  let workspace = null;
  if (project.workspace_root) {
    workspace = new Workspace(project.workspace_root, {
      afterCreate:   project.hooks_after_create ?? null,
      beforeRun:     project.hooks_before_run ?? null,
      afterRun:      project.hooks_after_run ?? null,
      beforeRemove:  project.hooks_before_remove ?? null,
      timeoutMs:     project.hooks_timeout_ms ?? 60_000,
    });
    try {
      workspacePath = await workspace.ensureWorkspace(task.code, {
        taskCode: task.code, taskId: task.id, repoPath: project.repo_path,
      });
      db.prepare(`UPDATE agent_run SET workspace_path=? WHERE id=?`).run(workspacePath, run.id);
    } catch (e) {
      logErr(e);
      finishRun(db, run.id, 'failed', null, `workspace setup failed: ${e.message}`);
      return;
    }
  }

  // Issue run_token for claim; child MCP calls use it
  const run_token = randomBytes(24).toString('hex');
  // Pre-assign Claude session id so the user can later `claude --resume <id>`
  // to jump into this exact session from a terminal.
  const claude_session_id = randomUUID();
  const stdoutPath = logPath(run.id);
  const stderrPath = logErrPath(run.id);
  const stdoutFd = openSync(stdoutPath, 'w', 0o600);
  const stderrFd = openSync(stderrPath, 'w', 0o600);

  // Write per-run MCP config
  const runCfgPath = join(runConfigDir(), `${run.id}.json`);
  const mcpCfg = {
    mcpServers: {
      ...inheritedUserMcpServers(),
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
    '--session-id', claude_session_id, // lets human resume via `claude --resume <id>`
    '--append-system-prompt', systemPrompt,
    '--mcp-config', runCfgPath,
    '--allowedTools', allowlistFor(run.role),
    '--permission-mode', 'acceptEdits',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', '60',
  ];

  const child = spawn(bin, args, {
    cwd: workspacePath,
    // windowsHide intentionally omitted: the server is started without CREATE_NO_WINDOW
    // (see ensure-server.mjs) so it inherits the caller's console. claude inherits that
    // same console here, and its own tool sub-spawns (bash/cmd/node) inherit it too —
    // no new console windows are created and flashing stops.
    stdio: ['ignore', stdoutFd, stderrFd],
    env: buildChildEnv({ AGENTBOARD_REPO_PATH: project.repo_path, AGENTBOARD_WORKSPACE: workspacePath }),
  });

  db.prepare(`UPDATE agent_run SET pid=?, claude_session_id=? WHERE id=?`)
    .run(child.pid, claude_session_id, run.id);

  registerWithClaudeHistory({
    sessionId: claude_session_id,
    projectPath: project.repo_path,
    display: `agentboard ${run.role} run — ${task.code}`,
  });
  child.unref();

  child.on('exit', (exitCode) => {
    try { unlinkSync(runCfgPath); } catch {}
    try { parseAndRecordCost(db, run.id, stdoutPath); } catch (e) { logErr(e); }
    const live = getRun(db, run.id);
    if (live && live.status === 'running') {
      const errTail = tail(stderrPath, 2048);
      const errMsg = `exit ${exitCode}${errTail ? `\n${errTail}` : ''}`;
      try {
        const cfg = readConfig();
        const attempt = live.attempt ?? 1;
        const retryResult = scheduleRetry(db, {
          runId: run.id, taskId: run.task_id, role: run.role,
          attempt, error: errMsg, config: cfg,
        });
        finishRun(db, run.id, 'failed', null, errMsg);
        if (retryResult.scheduled) {
          console.log(`[executor] run ${run.id} failed (attempt ${attempt}), retry in ${retryResult.delayMs}ms`);
        } else {
          console.log(`[executor] run ${run.id} failed permanently: ${retryResult.reason}`);
          try {
            db.prepare(`INSERT INTO comment(id, task_id, author_role, body, created_at) VALUES (?,?,'system',?,?)`)
              .run(ulid(), run.task_id,
                `SYSTEM: run permanently failed after ${attempt} attempt(s). ${retryResult.reason}`,
                isoNow());
          } catch {}
        }
      } catch (e) {
        logErr(e);
        // Fallback: mark failed without retry to avoid leaving run stuck in 'running'
        try { finishRun(db, run.id, 'failed', null, errMsg); } catch {}
      }
    }
    // Workspace afterRun hook (best-effort, async fire-and-forget)
    if (workspace && live?.workspace_path) {
      workspace.afterRun(task.code, { taskCode: task.code, taskId: task.id, repoPath: project.repo_path })
        .catch(logErr);
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

function logErr(e) { console.error('[executor]', e?.stack || e); }

/**
 * Register this run's session in Claude's interactive history index
 * (`~/.claude/history.jsonl`). Headless `-p` mode saves the session JSONL
 * but does NOT write a history entry, so `claude --resume <id>` reports
 * "No conversation found". Writing one line here makes the session
 * appear in the `/resume` picker and work with `--resume`.
 *
 * Best-effort: any error (file missing, permissions, etc.) is logged and
 * swallowed — the agent run itself already succeeded by this point.
 */
function registerWithClaudeHistory({ sessionId, projectPath, display }) {
  try {
    // Claude stores project paths with OS-native separators. Normalize forward
    // slashes back to backslashes on Windows so the picker groups this session
    // under the right project.
    const osPath = process.platform === 'win32'
      ? projectPath.replace(/\//g, '\\')
      : projectPath;
    const entry = JSON.stringify({
      display,
      pastedContents: {},
      timestamp: Date.now(),
      project: osPath,
      sessionId,
    }) + '\n';
    appendFileSync(join(homedir(), '.claude', 'history.jsonl'), entry);
  } catch (e) {
    console.warn('[executor] could not register with claude history:', e?.message || e);
  }
}
