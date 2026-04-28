// Executor: drains queued runs, executes via Claude Agent SDK query(), reaps orphans.

import { readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { logsDir, logPath, logErrPath, runConfigDir } from './paths.mjs';
import { restrictPerms } from './config.mjs';
import { allowlistFor } from './tool-allowlist.mjs';
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
import { AgentRunner } from './agent-runner.mjs';
import { RateLimitTracker } from './rate-limit-tracker.mjs';
import { agentboardBus } from './event-bus.mjs';
import { sessionLogger } from './session-logger.mjs';
import { workspaceManager } from './workspace-manager.mjs';
import { scheduleRetry } from './retry-manager.mjs';
import { Supervisor } from './supervisor.mjs';
import { buildRolePrompt } from './prompt-builder.mjs';

// Debug file logging
const DEBUG_LOG = './debug-crash.log';
function executorDebugLog(msg) {
  try { appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [executor] ${msg}\n`); } catch {}
}

// Shared rate limiter across all runs in this process
const rateLimiter = new RateLimitTracker();

const REAPER_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_REAPER_TIMEOUT_MS || '120000', 10);
const REAPER_SWEEP_MS   = parseInt(process.env.AGENTBOARD_REAPER_SWEEP_MS   || '60000',  10);

let started = false;

export function startExecutor({ port, serverToken }) {
  if (started) return;
  started = true;

  // Supervisor wraps the drain loop — if an unexpected exception escapes the
  // inner try/catches, the supervisor restarts the loop instead of silently dying.
  const drainSupervisor = new Supervisor({
    maxRestarts: 5,
    restartWindowMs: 60_000,
    onCrash: (e, n) => console.error(`[executor] drain loop crashed (restart #${n}):`, e?.message),
  });
  drainSupervisor.start(async () => {
    while (true) {
      await drain({ port, serverToken }).catch(logErr);
      await new Promise(r => setTimeout(r, 1000));
    }
  });

  setInterval(() => reap().catch(logErr), REAPER_SWEEP_MS).unref?.();
  console.log('[executor] started (reaper timeout', REAPER_TIMEOUT_MS, 'ms)');
}

async function reap() {
  executorDebugLog('reap cycle start');
  for (const code of listProjectDbs()) {
    try {
      executorDebugLog(`reaping project ${code}`);
      const db = await getDb(code);
      executorDebugLog(`got db for ${code}`);
      const orphaned = reapOrphans(db, REAPER_TIMEOUT_MS);
      executorDebugLog(`reapOrphans returned ${orphaned.length} runs`);
      if (orphaned.length) {
        const msg = `[reaper] ${code} marked ${orphaned.length} runs as failed`;
        console.log(msg);
        executorDebugLog(msg);
      }
      executorDebugLog(`reap done for ${code}`);
    } catch (e) { 
      const errMsg = `reap error for project ${code}: ${e?.message}`;
      executorDebugLog(errMsg);
      console.error(errMsg, e?.stack);
      logErr(e); 
    }
  }
  executorDebugLog('reap cycle complete');
}

async function drain({ port, serverToken }) {
  executorDebugLog('drain cycle start');
  const projects = listProjectDbs();
  executorDebugLog(`examining ${projects.length} projects`);
  for (const code of projects) {
    try {
      const db = await getDb(code);
      const project = getProject(db);
      if (!project) {
        executorDebugLog(`project ${code} has no data`);
        continue;
      }
      const running = runningCount(db);
      const budget = project.max_parallel - running;
      executorDebugLog(`project ${code}: running=${running}, max=${project.max_parallel}, budget=${budget}`);
      if (budget <= 0) {
        executorDebugLog(`project ${code} at capacity`);
        continue;
      }
      const queued = listQueuedRunsForProject(db).slice(0, budget);
      executorDebugLog(`project ${code} has ${queued.length} queued runs`);
      for (const q of queued) {
        executorDebugLog(`claiming run ${q.id} from project ${code}`);
        // Fire-and-forget: each run is an independent async task so the drain loop
        // is never blocked waiting for an agent (which can take minutes).
        tryClaimAndRun(db, project, q, { port, serverToken }).catch(e => {
          executorDebugLog(`run ${q.id} failed: ${e?.message}`);
          logErr(e);
        });
      }
    } catch (e) { 
      executorDebugLog(`drain error for project ${code}: ${e?.message}`);
      logErr(e); 
    }
  }
}

async function tryClaimAndRun(db, project, run, { port, serverToken }) {
  executorDebugLog(`tryClaimAndRun start for run ${run.id}`);
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

  const run_token = randomBytes(24).toString('hex');
  const claude_session_id = randomUUID();
  const stdoutPath = logPath(run.id);

  // Build SDK-style MCP servers object (abrun HTTP MCP + any user MCPs)
  const userMcps = inheritedUserMcpServers();
  const mcpServers = {
    ...buildSdkMcpServers(userMcps),
    'abrun': {
      type: 'http',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: `Bearer ${serverToken}` },
    },
  };

  const comments = listComments(db, task.id);
  const promptBody = await buildRolePrompt(run.role, task, project, run.id, run_token, comments, task.prompt_template ?? null);
  const systemPrompt = loadRolePromptBody(run.role);

  const ok = claimRunRow(db, run.id, run_token, null, stdoutPath);
  if (!ok) {
    console.warn('[executor] claim lost for', run.id);
    return;
  }

  // Record anticipated session id so UI can display it early
  db.prepare(`UPDATE agent_run SET claude_session_id=? WHERE id=?`)
    .run(claude_session_id, run.id);

  registerWithClaudeHistory({
    sessionId: claude_session_id,
    projectPath: project.repo_path,
    display: `agentboard ${run.role} run — ${task.code}`,
  });

  const abortController = new AbortController();
  const sessionLog = sessionLogger.createSessionLog(run.id);

  // Ensure per-task workspace directory exists and store path on task
  let workspacePath = project.repo_path; // fallback: use repo_path
  try {
    executorDebugLog(`ensuring workspace for task ${task.id}`);
    workspacePath = await workspaceManager.ensureWorkspace(task.id, task.code);
    executorDebugLog(`workspace created: ${workspacePath}`);
    db.prepare(`UPDATE task SET workspace_path=? WHERE id=?`).run(workspacePath, task.id);
    executorDebugLog(`running beforeRun hook for task ${task.id}`);
    await workspaceManager.beforeRun(task.id, task.code);
    executorDebugLog(`beforeRun hook completed for task ${task.id}`);
  } catch (e) {
    executorDebugLog(`workspace setup failed for task ${task.id}: ${e?.message}`);
    console.warn('[executor] workspace setup failed (using repo_path):', e?.message);
  }

  agentboardBus.emit('run.started', { runId: run.id, role: run.role, taskCode: task.code });

  const runner = new AgentRunner({
    runId: run.id,
    role: run.role,
    prompt: promptBody,
    systemPrompt,
    cwd: workspacePath,
    maxTurns: 60,
    allowedTools: allowlistFor(run.role),
    mcpServers,
    abortController,
    rateLimiter,
    sessionLog,
    onEvent: (eventName, detail) => {
      // Capture real session id if SDK emits it
      if (eventName === 'system' && detail?.subtype === 'init' && detail?.session_id) {
        db.prepare(`UPDATE agent_run SET claude_session_id=? WHERE id=?`)
          .run(detail.session_id, run.id);
      }
      // Forward rate-limit stall events to the bus
      if (eventName === 'run.rate-limited') {
        agentboardBus.emit('run.rate-limited', detail);
      }
    },
  });

  try {
    const result = await runner.run();

    const live = getRun(db, run.id);
    if (!live || live.status !== 'running') return; // already reaped

    if (result.status === 'completed') {
      // Record cost/usage from SDK result
      if (result.usage) {
        const { cost_usd, cost_version } = computeCost(result.model, result.usage);
        // Prefer SDK's totalCostUsd only when > 0 (it initialises to 0, so null/0 means unknown)
        const final = (result.totalCostUsd != null && result.totalCostUsd > 0)
          ? result.totalCostUsd
          : cost_usd;
        setRunCost(db, run.id, {
          model: result.model ?? null,
          usage: result.usage,
          cost_usd: final,
          cost_version: result.model ? cost_version : 0,
        });
      }
      finishRun(db, run.id, 'succeeded', null, null);
      agentboardBus.emit('run.completed', { runId: run.id, role: run.role, taskCode: task.code });
    } else if (result.status === 'cancelled') {
      finishRun(db, run.id, 'failed', null, `cancelled: ${result.error}`);
      agentboardBus.emit('run.failed', { runId: run.id, error: result.error });
    } else {
      const err = result.error ?? 'unknown error';
      finishRun(db, run.id, 'failed', null, err);
      const retry = scheduleRetry(db, { runId: run.id, taskId: task.id, role: run.role, attempt: run.attempt ?? 1, error: err });
      if (!retry.scheduled) {
        agentboardBus.emit('run.failed', { runId: run.id, error: err, permanent: true });
      } else {
        agentboardBus.emit('run.failed', { runId: run.id, error: err, retryAt: retry.delayMs });
      }
    }
  } catch (e) {
    logErr(e);
    const live = getRun(db, run.id);
    if (live && live.status === 'running') {
      const err = e?.message ?? String(e);
      finishRun(db, run.id, 'failed', null, err);
      const retry = scheduleRetry(db, { runId: run.id, taskId: task.id, role: run.role, attempt: run.attempt ?? 1, error: err });
      if (!retry.scheduled) {
        agentboardBus.emit('run.failed', { runId: run.id, error: err, permanent: true });
      } else {
        agentboardBus.emit('run.failed', { runId: run.id, error: err, retryAt: retry.delayMs });
      }
    }
  } finally {
    sessionLogger.closeSessionLog(run.id);
    try { await workspaceManager.afterRun(task.id, task.code); } catch {}
  }
}

/**
 * Convert user-style MCP server configs (from inheritedUserMcpServers) to
 * SDK-compatible objects. The SDK accepts plain objects with a type field.
 * @param {Record<string, unknown>} userMcps
 * @returns {Record<string, unknown>}
 */
function buildSdkMcpServers(userMcps) {
  const out = {};
  for (const [name, cfg] of Object.entries(userMcps ?? {})) {
    // Pass through as-is — the SDK accepts http/stdio MCP server descriptors
    out[name] = cfg;
  }
  return out;
}

// tail() unused in SDK path but kept for debug tooling

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
