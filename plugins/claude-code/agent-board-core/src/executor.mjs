// Executor: drains queued runs, executes via Claude Agent SDK or Copilot CLI, reaps orphans.

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
  claimRun as claimRunRow, bumpHeartbeat, addComment,
} from './repo.mjs';
import { getActiveDb, getDb, listProjectDbs } from './project-registry.mjs';
import { readConfig } from './config.mjs';
import { isoNow } from './time.mjs';
import { AgentRunner } from './agent-runner.mjs';
import { CopilotRunner } from './copilot-runner.mjs';
import { RateLimitTracker } from './rate-limit-tracker.mjs';
import { agentboardBus } from './event-bus.mjs';
import { sessionLogger } from './session-logger.mjs';
import { workspaceManager } from './workspace-manager.mjs';
import { scheduleRetry } from './retry-manager.mjs';
import { Supervisor } from './supervisor.mjs';
import { buildRolePrompt } from './prompt-builder.mjs';
import { checkPostflight } from './postflight.mjs';

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
}

async function reap() {
  for (const code of listProjectDbs()) {
    try {
      const db = await getDb(code);
      const orphaned = reapOrphans(db, REAPER_TIMEOUT_MS);
      if (orphaned.length) {
        console.error(`[reaper] ${code} marked ${orphaned.length} runs as failed (timeout)`);
      }
    } catch (e) { 
      console.error(`[reaper] error for project ${code}: ${e?.message}`);
      logErr(e); 
    }
  }
}

async function drain({ port, serverToken }) {
  const projects = listProjectDbs();
  for (const code of projects) {
    try {
      const db = await getDb(code);
      const project = getProject(db);
      if (!project) continue;
      const running = runningCount(db);
      const budget = project.max_parallel - running;
      if (budget <= 0) continue;
      const queued = listQueuedRunsForProject(db).slice(0, budget);
      for (const q of queued) {
        // Fire-and-forget: each run is an independent async task so the drain loop
        // is never blocked waiting for an agent (which can take minutes).
        tryClaimAndRun(db, project, q, { port, serverToken }).catch(e => logErr(e));
      }
    } catch (e) {
      logErr(e);
    }
  }
}

async function tryClaimAndRun(db, project, run, { port, serverToken }) {
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

  // Resolve effective executor provider: task override > project default > 'claude'
  const effectiveProvider = task.agent_provider_override ?? project.agent_provider ?? 'claude';
  if (!['claude', 'github_copilot'].includes(effectiveProvider)) {
    finishRun(db, run.id, 'failed', null, `unsupported executor provider: ${effectiveProvider}`);
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

  // Agent runs directly inside repo_path with full access to all files under
  // it. The per-task workspace dir (under ~/.agentboard/workspaces/<task>/)
  // is still ensured so hooks (afterCreate/beforeRun/afterRun) and any
  // out-of-tree scratch files have somewhere to live, but the agent's cwd
  // is the actual repository so reads/edits land on real source files.
  const workspacePath = project.repo_path;
  try {
    const wsDir = await workspaceManager.ensureWorkspace(task.id, task.code);
    db.prepare(`UPDATE task SET workspace_path=? WHERE id=?`).run(wsDir, task.id);
    await workspaceManager.beforeRun(task.id, task.code);
  } catch (e) {
    console.warn('[executor] workspace setup failed (continuing with repo_path):', e?.message);
  }

  agentboardBus.emit('run.started', { runId: run.id, role: run.role, taskCode: task.code });

  // Periodic heartbeat ticker. Bumps last_heartbeat_at every 30s while the
  // AgentRunner promise is still pending, so long-running single tools
  // (e.g. /ui-quality-check, npm install, full test suite) don't get reaped
  // just because the SDK emits no events between tool start and finish.
  // Cleared in the finally block — if the node server itself dies, ticker
  // stops with it and the reaper can rightly mark the run as orphaned.
  const heartbeatTicker = setInterval(() => {
    try { bumpHeartbeat(db, run.id); } catch (e) { logErr(e); }
  }, 30_000);
  heartbeatTicker.unref?.();

  // Create appropriate runner based on effective provider
  let runner;
  const runnerOpts = {
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
      // Liveness: bump heartbeat on every SDK event so long Read/Edit/Bash
      // phases (which don't call abrun MCP) don't get reaped as orphans.
      // Skip the synthetic 'run.rate-limited' event (no agent activity).
      if (eventName !== 'run.rate-limited') {
        try { bumpHeartbeat(db, run.id); } catch (e) { logErr(e); }
      }
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
  };

  runner = effectiveProvider === 'github_copilot'
    ? new CopilotRunner(runnerOpts)
    : new AgentRunner(runnerOpts);

  try {
    const result = await runner.run();

    // Always record cost/usage when we have it — even if the run row was
    // already moved to 'failed' (e.g. by the reaper). Otherwise an orphaned
    // run that finished anyway loses all its token/cost data.
    if (result && (result.usage || result.model)) {
      const usage = result.usage ?? { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 };
      const { cost_usd, cost_version } = computeCost(result.model, usage);
      const final = (result.totalCostUsd != null && result.totalCostUsd > 0)
        ? result.totalCostUsd
        : cost_usd;
      try {
        setRunCost(db, run.id, {
          model: result.model ?? null,
          usage,
          cost_usd: final,
          cost_version: result.model ? cost_version : 0,
        });
      } catch (e) { logErr(e); }
    }

    const live = getRun(db, run.id);
    if (!live || live.status !== 'running') return; // already reaped

    if (result.status === 'completed') {
      // Agent ended its SDK turn naturally without calling mcp__abrun__finish_run
      // (otherwise live.status would already be != 'running' and we'd have
      // returned above). The MCP finish_run path enforces postflight server-side;
      // we must enforce it here too, otherwise an agent that just stops talking
      // gets credit for a clean run without producing required comments.
      const freshTask = getTask(db, task.id) || task;
      const freshComments = listComments(db, task.id);
      const pfErr = checkPostflight(run.role, freshTask, freshComments);
      if (pfErr) {
        // Postflight failure on natural end_turn (agent forgot to call finish_run
        // and skipped required outputs). Retry once with a hint comment so the
        // next run can self-correct. Permanent failure only when retries exhausted.
        const hintBody = `POSTFLIGHT_HINT: previous ${run.role} run ended without completing required outputs — ${pfErr}. ` +
          (run.role === 'pm'
            ? 'Add 3–7 acceptance_criteria items via update_task and post an ENRICHMENT_SUMMARY comment, then call finish_run.'
            : run.role === 'worker'
              ? 'Post DEV_COMPLETED, FILES_CHANGED, and DIFF_SUMMARY comments, then call finish_run.'
              : 'Post REVIEW_VERDICT and RATIONALE comments, then call finish_run.');
        try { addComment(db, task.id, 'system', hintBody); } catch (e) { logErr(e); }
        finishRun(db, run.id, 'failed', null, `postflight: ${pfErr} (no finish_run called)`);
        const retry = scheduleRetry(db, { runId: run.id, taskId: task.id, role: run.role, attempt: run.attempt ?? 1, error: `postflight: ${pfErr}` });
        if (!retry.scheduled) {
          agentboardBus.emit('run.failed', { runId: run.id, error: pfErr, permanent: true, reason: 'postflight' });
        } else {
          agentboardBus.emit('run.failed', { runId: run.id, error: pfErr, retryAt: retry.delayMs, reason: 'postflight' });
        }
      } else {
        finishRun(db, run.id, 'succeeded', null, null);
        agentboardBus.emit('run.completed', { runId: run.id, role: run.role, taskCode: task.code });
      }
    } else if (result.status === 'cancelled') {
      finishRun(db, run.id, 'failed', null, `cancelled: ${result.error}`);
      agentboardBus.emit('run.failed', { runId: run.id, error: result.error });
    } else {
      const err = result.error ?? 'unknown error';
      finishRun(db, run.id, 'failed', null, err);
      const isTimeout = result?.errorKind === 'timeout'
        || /Turn timed out after \d+ms/.test(err);
      if (isTimeout) {
        agentboardBus.emit('run.failed', { runId: run.id, error: err, permanent: true, reason: 'timeout' });
      } else {
        const retry = scheduleRetry(db, { runId: run.id, taskId: task.id, role: run.role, attempt: run.attempt ?? 1, error: err });
        if (!retry.scheduled) {
          agentboardBus.emit('run.failed', { runId: run.id, error: err, permanent: true });
        } else {
          agentboardBus.emit('run.failed', { runId: run.id, error: err, retryAt: retry.delayMs });
        }
      }
    }
  } catch (e) {
    logErr(e);
    const live = getRun(db, run.id);
    if (live && live.status === 'running') {
      const err = e?.message ?? String(e);
      finishRun(db, run.id, 'failed', null, err);
      const isTimeout = e?.name === 'TimeoutError'
        || /Turn timed out after \d+ms/.test(err);
      if (isTimeout) {
        agentboardBus.emit('run.failed', { runId: run.id, error: err, permanent: true, reason: 'timeout' });
      } else {
        const retry = scheduleRetry(db, { runId: run.id, taskId: task.id, role: run.role, attempt: run.attempt ?? 1, error: err });
        if (!retry.scheduled) {
          agentboardBus.emit('run.failed', { runId: run.id, error: err, permanent: true });
        } else {
          agentboardBus.emit('run.failed', { runId: run.id, error: err, retryAt: retry.delayMs });
        }
      }
    }
  } finally {
    clearInterval(heartbeatTicker);
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
