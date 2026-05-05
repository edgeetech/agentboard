// Executor: drains queued runs, executes via Claude Agent SDK or Copilot CLI, reaps orphans.

import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { TokenUsage } from './agent-runner.ts';
import { AgentRunner } from './agent-runner.ts';
import { emitActivity } from './api-activity.ts';
import { CodexRunner } from './codex-runner.ts';
import { CopilotRunner } from './copilot-runner.ts';
import type { DbHandle } from './db.ts';
import { agentboardBus } from './event-bus.ts';
import { logPath } from './paths.ts';
import { recordActivity } from './phase-repo.ts';
import { checkPostflight } from './postflight.ts';
import { computeCost } from './pricing.ts';
import { getDb, listProjectDbs } from './project-registry.ts';
import type { SkillContext } from './prompt-builder.ts';
import { buildRolePrompt, renderSystemPrompt } from './prompt-builder.ts';
import { RateLimitTracker } from './rate-limit-tracker.ts';
import type { AgentRunRow, ProjectRow, TaskRow } from './repo.ts';
import {
  addComment,
  bumpHeartbeat,
  claimRun as claimRunRow,
  finishRun,
  getProject,
  getRun,
  getTask,
  listComments,
  listQueuedRunsForProject,
  reapOrphans,
  runningCount,
  setRunCost,
} from './repo.ts';
import { scheduleRetry } from './retry-manager.ts';
import { buildSdkHooks } from './run-hooks.ts';
import { sessionLogger } from './session-logger.ts';
import { listSkills } from './skill-repo.ts';
import { Supervisor } from './supervisor.ts';
import { allowlistFor } from './tool-allowlist.ts';
import { inheritedUserMcpServers } from './user-mcps.ts';
import { workspaceManager } from './workspace-manager.ts';

/** SDK-style MCP server descriptor (http or stdio). */
interface SdkMcpServer {
  type?: string;
  url?: string;
  command?: string;
  args?: unknown[];
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
  tools?: string[];
  bearer_token_env_var?: string;
}

/** Combined runner options — superset of AgentRunner / CopilotRunner / CodexRunner options. */
export interface RunnerOptions {
  runId: string;
  role: string;
  prompt: string;
  systemPrompt: string;
  cwd: string;
  maxTurns: number;
  allowedTools: string;
  mcpServers: Record<string, SdkMcpServer>;
  hooks?: Record<string, unknown>;
  abortController: AbortController;
  rateLimiter: RateLimitTracker;
  sessionLog: ReturnType<typeof sessionLogger.createSessionLog>;
  serverToken: string;
  serverPort: number;
  onEvent: (eventName: string, detail: Record<string, unknown>) => void;
}

/** Parameters for startExecutor. */
export interface ExecutorParams {
  port: number;
  serverToken: string;
}

// Shared rate limiter across all runs in this process
const rateLimiter = new RateLimitTracker();

const REAPER_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_REAPER_TIMEOUT_MS ?? '120000', 10);
const REAPER_SWEEP_MS = parseInt(process.env.AGENTBOARD_REAPER_SWEEP_MS ?? '60000', 10);

let started = false;

export function startExecutor({ port, serverToken }: ExecutorParams): void {
  if (started) return;
  started = true;

  // Supervisor wraps the drain loop — if an unexpected exception escapes the
  // inner try/catches, the supervisor restarts the loop instead of silently dying.
  const drainSupervisor = new Supervisor({
    maxRestarts: 5,
    restartWindowMs: 60_000,
    onCrash: (e: unknown, n: number) => {
      console.error(`[executor] drain loop crashed (restart #${n}):`, (e as Error | null)?.message);
    },
  });
  drainSupervisor.start(async () => {
    for (;;) {
      await drain({ port, serverToken }).catch(logErr);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  });

  setInterval(() => {
    void reap().catch(logErr);
  }, REAPER_SWEEP_MS).unref();
}

async function reap(): Promise<void> {
  for (const code of listProjectDbs()) {
    try {
      const db = await getDb(code);
      const orphaned = reapOrphans(db, REAPER_TIMEOUT_MS);
      if (orphaned.length > 0) {
        console.error(`[reaper] ${code} marked ${orphaned.length} runs as failed (timeout)`);
      }
    } catch (e) {
      console.error(`[reaper] error for project ${code}: ${String((e as Error | null)?.message)}`);
      logErr(e);
    }
  }
}

async function drain({ port, serverToken }: ExecutorParams): Promise<void> {
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
        void tryClaimAndRun(db, project, q, { port, serverToken }).catch((e: unknown) => {
          logErr(e);
        });
      }
    } catch (e) {
      logErr(e);
    }
  }
}

async function tryClaimAndRun(
  db: DbHandle,
  project: ProjectRow,
  run: AgentRunRow,
  { port, serverToken }: ExecutorParams,
): Promise<void> {
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
  const rawProvider: 'claude' | 'github_copilot' | 'codex' =
    task.agent_provider_override ?? project.agent_provider;
  const effectiveProvider = rawProvider;

  const run_token = randomBytes(24).toString('hex');
  const stdoutPath = logPath(run.id);

  // Build SDK-style MCP servers object (abrun HTTP MCP + any user MCPs)
  const userMcps = inheritedUserMcpServers();
  const mcpServers: Record<string, SdkMcpServer> = {
    ...buildSdkMcpServers(userMcps),
    abrun: {
      type: 'http',
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { Authorization: `Bearer ${serverToken}` },
    },
  };

  const comments = listComments(db, task.id);
  const skillsForPrompt: SkillContext[] = (() => {
    try {
      return listSkills(db, project.code).map((s) => ({
        name: s.name,
        description: s.description,
        emblem: s.emblem,
        relDir: s.relDir,
        relPath: s.relPath,
        tags: s.tags,
      }));
    } catch (e) {
      console.warn(
        `[executor] listSkills failed for ${project.code}: ${(e as Error).message}`,
      );
      return [];
    }
  })();
  const promptBody = await buildRolePrompt(
    run.role,
    task,
    project,
    run.id,
    run_token,
    comments,
    task.prompt_template ?? undefined,
    skillsForPrompt,
  );
  const systemPromptRaw = loadRolePromptBody(run.role);
  const systemPrompt = await renderSystemPrompt(
    systemPromptRaw,
    task,
    project,
    run.id,
    run_token,
    comments,
    skillsForPrompt,
  );

  const ok = claimRunRow(db, run.id, run_token, null, stdoutPath);
  if (!ok) {
    console.warn('[executor] claim lost for', run.id);
    return;
  }

  if (effectiveProvider === 'claude') {
    const claude_session_id = randomUUID();
    db.prepare(`UPDATE agent_run SET claude_session_id=? WHERE id=?`).run(
      claude_session_id,
      run.id,
    );
    registerWithClaudeHistory({
      sessionId: claude_session_id,
      projectPath: project.repo_path,
      display: `agentboard ${run.role} run — ${task.code}`,
    });
  }

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
    console.warn(
      '[executor] workspace setup failed (continuing with repo_path):',
      (e as Error | null)?.message,
    );
  }

  agentboardBus.emit('run.started', { runId: run.id, role: run.role, taskCode: task.code });

  // Emit a typed activity event for the live board feed.
  try {
    const evt = recordActivity(db, {
      run_id: run.id,
      task_id: task.id,
      kind: 'run:started',
      payload: { role: run.role, provider: effectiveProvider, mode: task.discovery_mode },
    });
    emitActivity(db, evt);
  } catch (e) {
    logErr(e);
  }

  // Build noskills PreToolUse hooks (Claude SDK shape). Reports every tool
  // attempt to abrun.record_tool, blocks per phase policy.
  const sdkHooks =
    effectiveProvider === 'claude'
      ? buildSdkHooks({
          runToken: run_token,
          mcpUrl: `http://127.0.0.1:${port}/mcp`,
          serverToken,
        })
      : undefined;

  // Periodic heartbeat ticker. Bumps last_heartbeat_at every 30s while the
  // AgentRunner promise is still pending, so long-running single tools
  // (e.g. /ui-quality-check, npm install, full test suite) don't get reaped
  // just because the SDK emits no events between tool start and finish.
  // Cleared in the finally block — if the node server itself dies, ticker
  // stops with it and the reaper can rightly mark the run as orphaned.
  const heartbeatTicker = setInterval(() => {
    try {
      bumpHeartbeat(db, run.id);
    } catch (e) {
      logErr(e);
    }
  }, 30_000);
  heartbeatTicker.unref();

  const onEvent = (eventName: string, detail: Record<string, unknown>): void => {
    // Liveness: bump heartbeat on every SDK event so long Read/Edit/Bash
    // phases (which don't call abrun MCP) don't get reaped as orphans.
    // Skip the synthetic 'run.rate-limited' event (no agent activity).
    if (eventName !== 'run.rate-limited') {
      try {
        bumpHeartbeat(db, run.id);
      } catch (e) {
        logErr(e);
      }
    }
    // Capture real session id if SDK emits it
    if (
      eventName === 'system' &&
      detail.subtype === 'init' &&
      typeof detail.session_id === 'string'
    ) {
      db.prepare(`UPDATE agent_run SET claude_session_id=? WHERE id=?`).run(
        detail.session_id,
        run.id,
      );
    }
    // Forward rate-limit stall events to the bus
    if (eventName === 'run.rate-limited') {
      agentboardBus.emit('run.rate-limited', detail);
    }
  };

  // Create appropriate runner based on effective provider
  let runner: AgentRunner | CopilotRunner | CodexRunner;

  const baseOpts: RunnerOptions = {
    runId: run.id,
    role: run.role,
    prompt: promptBody,
    systemPrompt,
    cwd: workspacePath,
    maxTurns: 60,
    allowedTools: allowlistFor(run.role),
    mcpServers,
    ...(sdkHooks !== undefined ? { hooks: sdkHooks } : {}),
    abortController,
    rateLimiter,
    sessionLog,
    serverToken,
    serverPort: port,
    onEvent,
  };

  if (effectiveProvider === 'github_copilot') {
    runner = new CopilotRunner(baseOpts);
  } else if (effectiveProvider === 'codex') {
    runner = new CodexRunner(baseOpts);
  } else {
    runner = new AgentRunner(baseOpts);
  }

  try {
    const result = await runner.run();

    // Always record cost/usage when we have it — even if the run row was
    // already moved to 'failed' (e.g. by the reaper). Otherwise an orphaned
    // run that finished anyway loses all its token/cost data.
    if (result.usage !== undefined || result.model !== undefined) {
      const usage: TokenUsage = result.usage ?? {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      };
      const { cost_usd, cost_version } = computeCost(result.model, usage);
      const finalCost =
        result.totalCostUsd !== null && result.totalCostUsd !== undefined && result.totalCostUsd > 0
          ? result.totalCostUsd
          : cost_usd;
      try {
        setRunCost(db, run.id, {
          model: result.model ?? null,
          usage,
          cost_usd: finalCost,
          cost_version: result.model !== undefined && result.model !== null ? cost_version : 0,
        });
      } catch (e) {
        logErr(e);
      }
    }

    const live = getRun(db, run.id);
    if (live?.status !== 'running') return; // already reaped

    if (result.status === 'completed') {
      // Agent ended its SDK turn naturally without calling mcp__abrun__finish_run
      // (otherwise live.status would already be != 'running' and we'd have
      // returned above). The MCP finish_run path enforces postflight server-side;
      // we must enforce it here too, otherwise an agent that just stops talking
      // gets credit for a clean run without producing required comments.
      const freshTask: TaskRow = getTask(db, task.id) ?? task;
      const freshComments = listComments(db, task.id);
      const pfErr = checkPostflight(run.role, freshTask, freshComments);
      if (pfErr !== null) {
        // Postflight failure on natural end_turn (agent forgot to call finish_run
        // and skipped required outputs). Retry once with a hint comment so the
        // next run can self-correct. Permanent failure only when retries exhausted.
        const hintBody =
          `POSTFLIGHT_HINT: previous ${run.role} run ended without completing required outputs — ${pfErr}. ` +
          (run.role === 'pm'
            ? 'Add 3–7 acceptance_criteria items via update_task and post an ENRICHMENT_SUMMARY comment, then call finish_run.'
            : run.role === 'worker'
              ? 'Post DEV_COMPLETED, FILES_CHANGED, and DIFF_SUMMARY comments, then call finish_run.'
              : 'Post REVIEW_VERDICT and RATIONALE comments, then call finish_run.');
        try {
          addComment(db, task.id, 'system', hintBody);
        } catch (e) {
          logErr(e);
        }
        finishRun(db, run.id, 'failed', null, `postflight: ${pfErr} (no finish_run called)`);
        const retry = scheduleRetry(db as unknown as DatabaseSync, {
          runId: run.id,
          taskId: task.id,
          role: run.role,
          attempt: run.attempt,
          error: `postflight: ${pfErr}`,
        });
        if (!retry.scheduled) {
          agentboardBus.emit('run.failed', {
            runId: run.id,
            error: pfErr,
            permanent: true,
            reason: 'postflight',
          });
        } else {
          agentboardBus.emit('run.failed', {
            runId: run.id,
            error: pfErr,
            retryAt: retry.delayMs,
            reason: 'postflight',
          });
        }
      } else {
        finishRun(db, run.id, 'succeeded', null, null);
        agentboardBus.emit('run.completed', { runId: run.id, role: run.role, taskCode: task.code });
      }
    } else if (result.status === 'cancelled') {
      finishRun(db, run.id, 'failed', null, `cancelled: ${result.error ?? ''}`);
      agentboardBus.emit('run.failed', { runId: run.id, error: result.error });
    } else {
      const err = result.error ?? 'unknown error';
      finishRun(db, run.id, 'failed', null, err);
      const isTimeout = result.errorKind === 'timeout' || /Turn timed out after \d+ms/.test(err);
      if (isTimeout) {
        agentboardBus.emit('run.failed', {
          runId: run.id,
          error: err,
          permanent: true,
          reason: 'timeout',
        });
      } else {
        const retry = scheduleRetry(db as unknown as DatabaseSync, {
          runId: run.id,
          taskId: task.id,
          role: run.role,
          attempt: run.attempt,
          error: err,
        });
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
    if (live?.status === 'running') {
      const err = (e as Error | null)?.message ?? String(e);
      finishRun(db, run.id, 'failed', null, err);
      const isTimeout =
        (e as Error | null)?.name === 'TimeoutError' || /Turn timed out after \d+ms/.test(err);
      if (isTimeout) {
        agentboardBus.emit('run.failed', {
          runId: run.id,
          error: err,
          permanent: true,
          reason: 'timeout',
        });
      } else {
        const retry = scheduleRetry(db as unknown as DatabaseSync, {
          runId: run.id,
          taskId: task.id,
          role: run.role,
          attempt: run.attempt,
          error: err,
        });
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
    try {
      await workspaceManager.afterRun(task.id, task.code);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Convert user-style MCP server configs (from inheritedUserMcpServers) to
 * SDK-compatible objects. The SDK accepts plain objects with a type field.
 */
function buildSdkMcpServers(userMcps: Record<string, unknown>): Record<string, SdkMcpServer> {
  const out: Record<string, SdkMcpServer> = {};
  for (const [name, cfg] of Object.entries(userMcps)) {
    // Pass through as-is — the SDK accepts http/stdio MCP server descriptors
    out[name] = cfg as SdkMcpServer;
  }
  return out;
}

function loadRolePromptBody(role: string): string {
  const url = new URL(`../prompts/${role}.md`, import.meta.url);
  return readFileSync(url, 'utf8');
}

function logErr(e: unknown): void {
  console.error('[executor]', (e as Error | null)?.stack ?? e);
}

interface ClaudeHistoryEntry {
  sessionId: string;
  projectPath: string;
  display: string;
}

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
function registerWithClaudeHistory({ sessionId, projectPath, display }: ClaudeHistoryEntry): void {
  try {
    // Claude stores project paths with OS-native separators. Normalize forward
    // slashes back to backslashes on Windows so the picker groups this session
    // under the right project.
    const osPath = process.platform === 'win32' ? projectPath.replace(/\//g, '\\') : projectPath;
    const entry =
      JSON.stringify({
        display,
        pastedContents: {},
        timestamp: Date.now(),
        project: osPath,
        sessionId,
      }) + '\n';
    appendFileSync(join(homedir(), '.claude', 'history.jsonl'), entry);
  } catch (e) {
    console.warn(
      '[executor] could not register with claude history:',
      (e as Error | null)?.message ?? String(e),
    );
  }
}
