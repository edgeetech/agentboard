// Executor: drains queued runs, executes via Claude Agent SDK query(), reaps orphans.

import { readFileSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { logPath } from './paths.mjs';
import { allowlistFor } from './tool-allowlist.mjs';
import { inheritedUserMcpServers } from './user-mcps.mjs';
import { computeCost } from './pricing.mjs';
import {
  listQueuedRunsForProject, runningCount, getRun, setRunCost,
  finishRun, getProject, getTask, listComments, reapOrphans,
  claimRun as claimRunRow,
} from './repo.mjs';
import { getDb, listProjectDbs } from './project-registry.mjs';
import { readConfig } from './config.mjs';
import { isoNow } from './time.mjs';
import { ulid } from './ulid.mjs';
import { scheduleRetry } from './retry-manager.mjs';
import { AgentRunner } from './agent-runner.mjs';
import { RateLimitTracker } from './rate-limiter.mjs';
import { agentboardBus } from './event-bus.mjs';
import { sessionLogger } from './session-logger.mjs';
import { workspaceManager } from './workspace-manager.mjs';

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
        // Fire-and-forget: each run is an independent async task so drain never blocks
        tryClaimAndRun(db, project, q, { port, serverToken }).catch(logErr);
      }
    } catch (e) { logErr(e); }
  }
}

async function tryClaimAndRun(db, project, run, { port, serverToken }) {
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
  const mcpServers = {
    ...buildSdkMcpServers(inheritedUserMcpServers()),
    'abrun': {
      type: 'http',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: `Bearer ${serverToken}` },
    },
  };

  const comments = listComments(db, task.id);
  const promptBody = renderPrompt(run.role, task, project, run.id, run_token, comments);
  const systemPrompt = loadRolePromptBody(run.role);

  const ok = claimRunRow(db, run.id, run_token, null, stdoutPath);
  if (!ok) {
    console.warn('[executor] claim lost for', run.id);
    return;
  }

  db.prepare(`UPDATE agent_run SET claude_session_id=? WHERE id=?`)
    .run(claude_session_id, run.id);

  registerWithClaudeHistory({
    sessionId: claude_session_id,
    projectPath: project.repo_path,
    display: `agentboard ${run.role} run — ${task.code}`,
  });

  const abortController = new AbortController();
  const sessionLog = sessionLogger.createSessionLog(run.id);

  // Ensure per-task workspace directory
  let workspacePath = project.repo_path;
  try {
    workspacePath = await workspaceManager.ensureWorkspace(task.id, task.code);
    db.prepare(`UPDATE agent_run SET workspace_path=? WHERE id=?`).run(workspacePath, run.id);
    await workspaceManager.beforeRun(task.id, task.code);
  } catch (e) {
    console.warn('[executor] workspace setup failed (using repo_path):', e?.message);
  }

  agentboardBus.emit('run.started', { runId: run.id, role: run.role, taskCode: task.code });

  const runner = new AgentRunner({
    runId: run.id,
    role: run.role,
    prompt: promptBody,
    systemPrompt,
    cwd: project.repo_path,
    maxTurns: 60,
    allowedTools: allowlistFor(run.role),
    mcpServers,
    abortController,
    rateLimiter,
    sessionLog,
    onEvent: (eventName, detail) => {
      if (eventName === 'system' && detail?.subtype === 'init' && detail?.session_id) {
        db.prepare(`UPDATE agent_run SET claude_session_id=? WHERE id=?`)
          .run(detail.session_id, run.id);
      }
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
      if (result.usage) {
        const { cost_usd, cost_version } = computeCost(result.model, result.usage);
        const final = result.totalCostUsd != null ? result.totalCostUsd : cost_usd;
        setRunCost(db, run.id, {
          model: result.model ?? null,
          usage: result.usage,
          cost_usd: final,
          cost_version: result.model ? cost_version : 0,
        });
      }
      finishRun(db, run.id, 'succeeded', null, null);
      agentboardBus.emit('run.completed', { runId: run.id, role: run.role, taskCode: task.code });
    } else {
      const errMsg = result.error ?? 'unknown error';
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
      agentboardBus.emit('run.failed', { runId: run.id, error: errMsg });
    }
  } catch (e) {
    logErr(e);
    const live = getRun(db, run.id);
    if (live && live.status === 'running') {
      finishRun(db, run.id, 'failed', null, e?.message ?? String(e));
      agentboardBus.emit('run.failed', { runId: run.id, error: e?.message });
    }
  } finally {
    sessionLogger.closeSessionLog(run.id);
    try { await workspaceManager.afterRun(task.id, task.code); } catch {}
  }
}

function buildSdkMcpServers(userMcps) {
  const out = {};
  for (const [name, cfg] of Object.entries(userMcps ?? {})) out[name] = cfg;
  return out;
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
 * (`~/.claude/history.jsonl`) so `claude --resume <id>` finds the session.
 */
function registerWithClaudeHistory({ sessionId, projectPath, display }) {
  try {
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
