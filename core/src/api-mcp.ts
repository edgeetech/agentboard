// HTTP MCP endpoint for spawned headless Claude runs (streamable-http / JSON-RPC 2.0).
// Tools: get_task, update_task, add_comment, finish_run, add_heartbeat,
//        get_project, next, advance, record_debt, resolve_debt, use_skill,
//        record_tool.
//
// Auth: every `tools/call` authenticates with `Authorization: Bearer <run_token>`
// of a RUNNING run — NOT the server's own Bearer token. The server token is
// never accepted here (see CLAUDE.md "Security model"); a run_token is minted
// only by the executor's own claimRun() (src/repo.ts), rotates per run, and is
// scoped to that run's single task. Any `run_token` field inside `arguments`
// must match the header token exactly or the call is rejected — this stops an
// agent from acting on a different run than the one it was spawned for.
//
// `list_queue` / `claim_run` are intentionally NOT exposed here: the executor
// claims runs itself (src/executor.ts), so a worker never needs — and must
// never be able — to list the queue or claim another run's token itself.

import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve as pathResolve } from 'node:path';

import { z } from 'zod';

import { emitActivity } from './api-activity.ts';
import { constantTimeEqual } from './auth.ts';
import { sliceFor as concernSliceFor } from './concerns.ts';
import type { DbHandle } from './db.ts';
import { specFor as discoveryModeSpec } from './discovery-modes.ts';
import { cascade as folderRulesCascade } from './folder-rules.ts';
import { readJson } from './http-util.ts';
import { behavioralFor, canAdvance, exitWith, toolPolicy } from './phase-machine.ts';
import {
  getRunPhaseState,
  listOpenDebt,
  recordActivity,
  recordDebt,
  resolveDebt,
  setRunPhase,
} from './phase-repo.ts';
import { checkReassignAudit, evaluateRunCompletion } from './postflight.ts';
import { getDbForRunToken, invalidateRunToken } from './project-registry.ts';
import {
  addComment,
  bumpHeartbeat,
  finishRun as finishRunRow,
  getProject,
  getRunByToken,
  getTask,
  listComments,
  listRuns,
  transitionTask,
} from './repo.ts';
import type { AgentRunRow } from './repo.ts';
import { getSkillByName, listSkills } from './skill-repo.ts';
import { levenshtein } from './string-distance.ts';
import { isoNow } from './time.ts';
import {
  destructiveToolsAllowed,
  evaluateToolPolicy,
  projectDestructiveFlag,
} from './tool-policy.ts';
import type { AssigneeRole, Phase, RunStatus, TaskStatus } from './types.ts';

// ── JSON-RPC types ────────────────────────────────────────────────────────────

interface RpcError {
  code: number;
  message: string;
}

interface RpcBody {
  jsonrpc?: string;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOL_DEFS: readonly unknown[] = [
  {
    name: 'get_task',
    description: 'Get task + comments + recent runs (uses run_token)',
    inputSchema: {
      type: 'object',
      properties: { run_token: { type: 'string' } },
      required: ['run_token'],
    },
  },
  {
    name: 'update_task',
    description: 'Mutate task fields (status, assignee, description, AC)',
    inputSchema: {
      type: 'object',
      properties: {
        run_token: { type: 'string' },
        patch: { type: 'object' },
      },
      required: ['run_token', 'patch'],
    },
  },
  {
    name: 'add_comment',
    description: 'Append a comment to the current task',
    inputSchema: {
      type: 'object',
      properties: {
        run_token: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['run_token', 'body'],
    },
  },
  {
    name: 'finish_run',
    description:
      'Finish run (succeeded|failed|blocked|cancelled). Triggers postflight on succeeded.',
    inputSchema: {
      type: 'object',
      properties: {
        run_token: { type: 'string' },
        status: { type: 'string' },
        summary: { type: 'string' },
        error: { type: 'string' },
      },
      required: ['run_token', 'status'],
    },
  },
  {
    name: 'add_heartbeat',
    description: 'Bump run heartbeat (usually implicit on other MCP calls)',
    inputSchema: {
      type: 'object',
      properties: { run_token: { type: 'string' } },
      required: ['run_token'],
    },
  },
  {
    name: 'get_project',
    description: 'Get active project info (uses run_token)',
    inputSchema: {
      type: 'object',
      properties: { run_token: { type: 'string' } },
      required: ['run_token'],
    },
  },
  {
    name: 'next',
    description:
      'Get the current phase payload: behavioral rules, concerns slice, folder rules, AC, debt. Pure read.',
    inputSchema: {
      type: 'object',
      properties: { run_token: { type: 'string' } },
      required: ['run_token'],
    },
  },
  {
    name: 'advance',
    description: 'Advance to the next phase. Use to=cancel|wontfix|revisit for exit verbs.',
    inputSchema: {
      type: 'object',
      properties: {
        run_token: { type: 'string' },
        to: { type: 'string' },
        evidence: { type: 'array', items: { type: 'object' } },
        note: { type: 'string' },
      },
      required: ['run_token', 'to'],
    },
  },
  {
    name: 'record_debt',
    description: 'Record a TODO/known-gap as carryforward debt.',
    inputSchema: {
      type: 'object',
      properties: {
        run_token: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['run_token', 'description'],
    },
  },
  {
    name: 'resolve_debt',
    description: 'Mark a debt entry resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        run_token: { type: 'string' },
        debt_id: { type: 'string' },
      },
      required: ['run_token', 'debt_id'],
    },
  },
  {
    name: 'use_skill',
    description:
      'Load a project-scoped skill (.claude/skills/<name>) by name. Returns the SKILL.md body when found; returns suggestions and auto-posts a comment on miss.',
    inputSchema: {
      type: 'object',
      properties: {
        run_token: { type: 'string' },
        name: { type: 'string', minLength: 1, maxLength: 80 },
      },
      required: ['run_token', 'name'],
    },
  },
  {
    name: 'record_tool',
    description: 'PreToolUse hook callback. Returns allow|block per phase policy.',
    inputSchema: {
      type: 'object',
      properties: {
        run_token: { type: 'string' },
        tool: { type: 'string' },
        target: { type: 'string' },
      },
      required: ['run_token', 'tool'],
    },
  },
];

// ── Input schemas (zod) ───────────────────────────────────────────────────────

const USE_SKILL_INPUT = z.object({ name: z.string().min(1).max(80) }).strict();

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function sendRpc(
  res: ServerResponse,
  id: string | number | null,
  error: RpcError | null,
  result?: unknown,
): void {
  const body = error !== null ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result };
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

function parseJsonField<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function validateAc(raw: unknown): void {
  let arr: unknown;
  try {
    arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('acceptance_criteria_json must be valid JSON');
  }
  if (!Array.isArray(arr)) throw new Error('AC must be array');
  if (arr.length > 20) throw new Error('AC has >20 items');
  for (const it of arr as unknown[]) {
    if (!isRecord(it) || typeof it.text !== 'string') throw new Error('AC item missing text');
    if (it.text.length > 500) throw new Error('AC item text > 500 chars');
  }
}

/**
 * Reviewer may only flip `checked` / `checked_by` / `checked_at` on EXISTING
 * acceptance-criteria items — never add, remove, reorder, or edit `text` /
 * `id` / `source` (that authorship is PM-only; see prompts/reviewer.md "AC
 * preflight"). Worker gets no AC write access at all (checked in the caller).
 */
function assertReviewerAcMutation(curRaw: string | null | undefined, nextRaw: unknown): void {
  let cur: unknown[];
  let next: unknown[];
  try {
    cur = JSON.parse(curRaw ?? '[]') as unknown[];
  } catch {
    cur = [];
  }
  try {
    next = (typeof nextRaw === 'string' ? JSON.parse(nextRaw) : nextRaw) as unknown[];
  } catch {
    throw new Error('acceptance_criteria_json must be valid JSON');
  }
  if (!Array.isArray(cur) || !Array.isArray(next)) throw new Error('AC must be array');
  if (cur.length !== next.length) {
    throw new Error('reviewer may not add or remove acceptance criteria items');
  }
  for (let i = 0; i < cur.length; i++) {
    const curItem = cur[i];
    const nextItem = next[i];
    const a: Record<string, unknown> = isRecord(curItem) ? curItem : {};
    const b: Record<string, unknown> = isRecord(nextItem) ? nextItem : {};
    for (const field of ['id', 'text', 'source'] as const) {
      if (a[field] !== b[field]) {
        throw new Error(`reviewer may not edit acceptance criteria '${field}' (item ${i})`);
      }
    }
  }
}

// ── callTool ──────────────────────────────────────────────────────────────────

export function callTool(db: DbHandle, name: string, args: Record<string, unknown>): unknown {
  const requireRunToken = (): AgentRunRow => {
    const t = args.run_token;
    if (typeof t !== 'string' || !t) throw new Error('run_token required');
    const run = getRunByToken(db, t);
    if (run === undefined) throw new Error('invalid run_token or run not running');
    bumpHeartbeat(db, run.id);
    return run;
  };

  switch (name) {
    case 'get_task': {
      const run = requireRunToken();
      const task = getTask(db, run.task_id);
      return {
        task,
        project: getProject(db),
        comments: listComments(db, run.task_id),
        runs: listRuns(db, run.task_id, 5),
      };
    }

    case 'update_task': {
      const run = requireRunToken();
      const patch = asRecord(args.patch);
      const cur = getTask(db, run.task_id);
      if (cur === undefined) throw new Error('task not found');
      const expected = typeof patch.version === 'number' ? patch.version : cur.version;
      if (expected !== cur.version) {
        throw new Error(
          `version mismatch: task is at version ${cur.version}, patch expected ${expected}`,
        );
      }

      // Role permissions: description authorship is PM-only. Acceptance
      // criteria authorship is PM-only too, except reviewer may flip
      // checked/checked_by/checked_at on existing items (see
      // assertReviewerAcMutation) — never add/remove/reorder/retext.
      if ('description' in patch && run.role !== 'pm') {
        throw new Error(`role '${run.role}' may not edit task description — PM-only`);
      }
      if ('acceptance_criteria_json' in patch && run.role !== 'pm') {
        if (run.role === 'worker') {
          throw new Error("role 'worker' may not edit acceptance criteria — PM-only");
        }
        assertReviewerAcMutation(cur.acceptance_criteria_json, patch.acceptance_criteria_json);
      }

      const wantsStatus = 'status' in patch && patch.status !== cur.status;
      const wantsAssignee = 'assignee_role' in patch && patch.assignee_role !== cur.assignee_role;
      let versionAfterTransition = expected;
      if (wantsStatus || wantsAssignee) {
        const recent = listComments(db, run.task_id).slice(-5);
        const assigneeRole =
          typeof patch.assignee_role === 'string' ? (patch.assignee_role as AssigneeRole) : null;
        const auditErr = checkReassignAudit(run.role, assigneeRole, recent);
        if (auditErr !== null) throw new Error(auditErr);

        const project = getProject(db);
        const wfType = (isRecord(project) ? project.workflow_type : undefined) as
          | string
          | undefined;
        const out = transitionTask(db, {
          task_id: run.task_id,
          to_status: (typeof patch.status === 'string' ? patch.status : cur.status) as TaskStatus,
          to_assignee: assigneeRole ?? cur.assignee_role,
          by_role: run.role,
          expected_version: expected,
          workflow_type: (wfType ?? 'WF1') as 'WF1' | 'WF2',
        });
        if (!out.ok) throw new Error(out.reason);
        versionAfterTransition = expected + 1;
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const k of ['description', 'acceptance_criteria_json'] as const) {
        if (k in patch) {
          if (k === 'acceptance_criteria_json') validateAc(patch[k]);
          sets.push(`${k}=?`);
          vals.push(typeof patch[k] === 'string' ? patch[k] : JSON.stringify(patch[k]));
        }
      }
      if (sets.length > 0) {
        sets.push('version=version+1', 'updated_at=?');
        vals.push(isoNow(), run.task_id, versionAfterTransition);
        const info = db
          .prepare(`UPDATE task SET ${sets.join(', ')} WHERE id=? AND version=?`)
          .run(...vals) as { changes: number };
        if (info.changes === 0) {
          throw new Error('version mismatch: task was modified concurrently');
        }
      }

      return { task: getTask(db, run.task_id) };
    }

    case 'add_comment': {
      const run = requireRunToken();
      const body = String(args.body ?? '');
      if (!body.trim()) throw new Error('comment body required');
      const c = addComment(db, run.task_id, run.role, body);
      return { comment: c };
    }

    case 'add_heartbeat': {
      requireRunToken();
      return { ok: true };
    }

    case 'finish_run': {
      const run = requireRunToken();
      const status = String(args.status ?? 'succeeded');
      if (!['succeeded', 'failed', 'blocked', 'cancelled'].includes(status)) {
        throw new Error('invalid finish status');
      }
      if (status === 'succeeded') {
        const task = getTask(db, run.task_id);
        const comments = listComments(db, run.task_id);
        const phaseState = getRunPhaseState(db, run.id);
        const err = evaluateRunCompletion(
          run,
          task ?? {},
          comments,
          phaseState?.phase ?? null,
          run.started_at,
        );
        if (err !== null) throw new Error(`postflight: ${err}`);
      }
      finishRunRow(
        db,
        run.id,
        status as RunStatus,
        typeof args.summary === 'string' ? args.summary : null,
        typeof args.error === 'string' ? args.error : null,
      );
      // Evict the routing cache — the token no longer resolves to a running
      // run, so further calls with it should re-verify from the DB (and fail).
      invalidateRunToken(String(args.run_token ?? ''));
      const evt = recordActivity(db, {
        run_id: run.id,
        task_id: run.task_id,
        kind: 'run:finished',
        payload: { status, summary: typeof args.summary === 'string' ? args.summary : null },
      });
      emitActivity(db, evt);
      return { ok: true };
    }

    case 'get_project': {
      requireRunToken();
      return { project: getProject(db) };
    }

    // ── Inner phase machine ──────────────────────────────────────────────────

    case 'next': {
      const run = requireRunToken();
      const task = getTask(db, run.task_id);
      if (task === undefined) throw new Error('task not found');
      const project = getProject(db);
      const phaseRow = getRunPhaseState(db, run.id) ?? {
        phase: 'DISCOVERY' as Phase,
        state: {},
        history: [],
      };
      const taskRec = task as unknown as Record<string, unknown>;
      const mode = typeof taskRec.discovery_mode === 'string' ? taskRec.discovery_mode : 'full';

      const projRec = project as unknown as Record<string, unknown> | undefined;
      const concerns = parseJsonField<unknown[]>(projRec?.concerns_json, []);
      const concernsSlice = concernSliceFor(
        phaseRow.phase,
        concerns as Parameters<typeof concernSliceFor>[1],
        typeof projRec?.repo_path === 'string' ? projRec.repo_path : undefined,
      );
      const repoPath = typeof projRec?.repo_path === 'string' ? projRec.repo_path : '';
      const workspacePath =
        typeof taskRec.workspace_path === 'string' ? taskRec.workspace_path : undefined;
      const rules = folderRulesCascade(repoPath, workspacePath ?? repoPath);
      const debt = listOpenDebt(db, run.task_id);
      const ac = parseJsonField<unknown[]>(taskRec.acceptance_criteria_json, []);
      const behavioral = behavioralFor(phaseRow.phase);
      const policy = toolPolicy(phaseRow.phase);
      const modeSpec = discoveryModeSpec(mode as Parameters<typeof discoveryModeSpec>[0]);

      return {
        phase: phaseRow.phase,
        mode,
        mode_spec: modeSpec,
        behavioral,
        tool_policy: policy,
        concerns_slice: concernsSlice,
        rules_cascade: rules,
        ac,
        debt,
        history: phaseRow.history,
        state: phaseRow.state,
      };
    }

    case 'advance': {
      const run = requireRunToken();
      const task = getTask(db, run.task_id);
      if (task === undefined) throw new Error('task not found');
      const phaseRow = getRunPhaseState(db, run.id) ?? {
        phase: 'DISCOVERY' as Phase,
        state: {},
        history: [],
      };
      const taskRec = task as unknown as Record<string, unknown>;
      const mode = typeof taskRec.discovery_mode === 'string' ? taskRec.discovery_mode : 'full';
      const to = String(args.to ?? '');

      // Exit verbs: cancel | wontfix | revisit
      if (to === 'cancel' || to === 'wontfix' || to === 'revisit') {
        const nextPhase = exitWith(phaseRow.phase, to);
        if (nextPhase === null) {
          setRunPhase(db, run.id, {
            phase: phaseRow.phase,
            state: { ...phaseRow.state, exit: to, exited_at: isoNow() },
            appendHistoryEntry: { from: phaseRow.phase, to, by: run.role, at: isoNow(), exit: to },
          });
          const evt = recordActivity(db, {
            run_id: run.id,
            task_id: run.task_id,
            kind: 'phase:exit',
            payload: { from: phaseRow.phase, verb: to },
          });
          emitActivity(db, evt);
          return { ok: true, terminated: true, phase: phaseRow.phase };
        }
        setRunPhase(db, run.id, {
          phase: nextPhase,
          state: { ...phaseRow.state, revisited_from: phaseRow.phase, revisited_at: isoNow() },
          appendHistoryEntry: {
            from: phaseRow.phase,
            to: nextPhase,
            by: run.role,
            at: isoNow(),
            exit: 'revisit',
          },
        });
        const advEvt = recordActivity(db, {
          run_id: run.id,
          task_id: run.task_id,
          kind: 'phase:advanced',
          payload: { from: phaseRow.phase, to: nextPhase, exit: 'revisit' },
        });
        emitActivity(db, advEvt);
        return { ok: true, phase: nextPhase };
      }

      const advance = canAdvance(
        phaseRow.phase,
        to as Phase,
        run.role,
        mode as Parameters<typeof canAdvance>[3],
      );
      if (!advance.ok) throw new Error(`phase advance: ${advance.reason ?? 'not allowed'}`);

      // VERIFICATION → DONE requires AC evidence
      if (phaseRow.phase === 'VERIFICATION' && to === 'DONE') {
        const evidence = Array.isArray(args.evidence) ? (args.evidence as unknown[]) : [];
        const ac = parseJsonField<unknown[]>(
          (task as unknown as Record<string, unknown>).acceptance_criteria_json,
          [],
        );
        if (ac.length > 0 && evidence.length < ac.length) {
          throw new Error(
            `VERIFICATION → DONE requires evidence for all ${ac.length} acceptance criteria (got ${evidence.length})`,
          );
        }
        phaseRow.state.evidence = evidence;
      }

      const newState: Record<string, unknown> = { ...phaseRow.state };
      if (typeof args.note === 'string') newState.last_note = args.note.slice(0, 500);
      setRunPhase(db, run.id, {
        phase: to as Phase,
        state: newState,
        appendHistoryEntry: { from: phaseRow.phase, to: to as Phase, by: run.role, at: isoNow() },
      });
      const doneEvt = recordActivity(db, {
        run_id: run.id,
        task_id: run.task_id,
        kind: 'phase:advanced',
        payload: { from: phaseRow.phase, to },
      });
      emitActivity(db, doneEvt);
      return { ok: true, phase: to };
    }

    case 'record_debt': {
      const run = requireRunToken();
      const description = String(args.description ?? '').trim();
      if (!description) throw new Error('description required');
      if (description.length > 1000) throw new Error('description > 1000 chars');
      const row = recordDebt(db, { task_id: run.task_id, run_id: run.id, description });
      const evt = recordActivity(db, {
        run_id: run.id,
        task_id: run.task_id,
        kind: 'debt:recorded',
        payload: { id: row.id, description },
      });
      emitActivity(db, evt);
      return { debt: row };
    }

    case 'resolve_debt': {
      const run = requireRunToken();
      const debt_id = String(args.debt_id ?? '');
      if (!debt_id) throw new Error('debt_id required');
      resolveDebt(db, debt_id);
      const evt = recordActivity(db, {
        run_id: run.id,
        task_id: run.task_id,
        kind: 'debt:resolved',
        payload: { id: debt_id },
      });
      emitActivity(db, evt);
      return { ok: true };
    }

    case 'use_skill': {
      const run = requireRunToken();
      // Validate just the `name` field; run_token is consumed by requireRunToken.
      const parsed = USE_SKILL_INPUT.safeParse({ name: args.name });
      if (!parsed.success)
        throw new Error(`use_skill: ${parsed.error.issues[0]?.message ?? 'invalid input'}`);
      const requested = parsed.data.name.trim();

      const project = getProject(db);
      const projRec = project as unknown as Record<string, unknown> | undefined;
      const projectCode = typeof projRec?.code === 'string' ? projRec.code : '';
      const repoPath = typeof projRec?.repo_path === 'string' ? projRec.repo_path : '';
      if (!projectCode) throw new Error('use_skill: no active project');

      const taskIdSafe = run.task_id;
      const skill = getSkillByName(db, projectCode, requested);

      const tryAddSystemComment = (body: string): void => {
        if (!taskIdSafe) {
          console.warn('[mcp] use_skill: no task_id for run; skipping auto-comment');
          return;
        }
        try {
          addComment(db, taskIdSafe, 'system', body);
        } catch (e) {
          console.warn(`[mcp] use_skill: addComment failed: ${(e as Error).message}`);
        }
      };

      const computeSuggestions = (): string[] => {
        const all = listSkills(db, projectCode);
        const reqLc = requested.toLowerCase();
        const scored = all
          .map((s) => {
            const nameLc = s.name.toLowerCase();
            const substr = nameLc.includes(reqLc) || reqLc.includes(nameLc);
            const dist = levenshtein(reqLc, nameLc);
            return { name: s.name, dist, substr };
          })
          .filter((x) => x.substr || x.dist <= 2)
          .sort((a, b) => {
            if (a.substr !== b.substr) return a.substr ? -1 : 1;
            return a.dist - b.dist;
          })
          .slice(0, 5)
          .map((x) => x.name);
        return scored;
      };

      if (skill === null) {
        const suggestions = computeSuggestions();
        const sentence =
          suggestions.length > 0
            ? `Skill \`${requested}\` not found in project. Available similar: ${suggestions.join(', ')}. Continuing without it.`
            : `Skill \`${requested}\` not found in project. Continuing without it.`;
        tryAddSystemComment(sentence);
        const evt = recordActivity(db, {
          run_id: run.id,
          task_id: run.task_id,
          kind: 'skill:missed',
          payload: { name: requested, suggestions },
        });
        emitActivity(db, evt);
        return { found: false, available: suggestions };
      }

      // Path safety: resolved disk path must be inside repo_path.
      const repoAbs = pathResolve(repoPath);
      const skillAbs = pathResolve(repoPath, skill.relPath);
      const repoNorm = repoAbs.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
      const skillNorm = skillAbs.replaceAll('\\', '/').toLowerCase();
      if (!(skillNorm === repoNorm || skillNorm.startsWith(repoNorm + '/'))) {
        const msg = `Skill \`${requested}\` rejected: path escapes repo (${skill.relPath}).`;
        tryAddSystemComment(msg);
        const evt = recordActivity(db, {
          run_id: run.id,
          task_id: run.task_id,
          kind: 'skill:missed',
          payload: { name: requested, reason: 'path_traversal' },
        });
        emitActivity(db, evt);
        throw new Error('use_skill: skill rel_path escapes repo_path');
      }

      let body: string;
      try {
        body = readFileSync(skillAbs, 'utf8');
      } catch (e) {
        const sentence = `Skill \`${requested}\` is indexed but file unreadable on disk (${(e as Error).message}). Continuing without it.`;
        tryAddSystemComment(sentence);
        const evt = recordActivity(db, {
          run_id: run.id,
          task_id: run.task_id,
          kind: 'skill:missed',
          payload: { name: requested, reason: 'read_failed' },
        });
        emitActivity(db, evt);
        return { found: false, available: [] };
      }

      const evt = recordActivity(db, {
        run_id: run.id,
        task_id: run.task_id,
        kind: 'skill:used',
        payload: { name: skill.name, relPath: skill.relPath },
      });
      emitActivity(db, evt);
      return {
        found: true,
        name: skill.name,
        relPath: skill.relPath,
        body,
        allowedTools: skill.allowedTools,
      };
    }

    case 'record_tool': {
      const run = requireRunToken();
      const tool = String(args.tool ?? '');
      // Evaluate the FULL, untruncated target against tool policy — truncating
      // before the check would let a destructive/data-dir/inline-eval pattern
      // past the gate simply by padding the command past 500 chars first.
      // Only truncate the copy we persist to activity/logs afterwards.
      const fullTarget = typeof args.target === 'string' ? args.target : undefined;
      if (!tool) throw new Error('tool required');
      const phaseRow = getRunPhaseState(db, run.id) ?? {
        phase: 'DISCOVERY' as Phase,
        state: {},
        history: [],
      };
      const policy = toolPolicy(phaseRow.phase);
      const project = getProject(db);
      const projRec = project as unknown as Record<string, unknown> | undefined;
      const { decision, reason } = evaluateToolPolicy({
        tool,
        target: fullTarget,
        blockedTools: policy.blockedTools,
        phase: phaseRow.phase,
        allowGit: projRec?.allow_git === true || projRec?.allow_git === 1,
        allowDestructive: destructiveToolsAllowed(
          typeof projRec?.code === 'string' ? projRec.code : null,
          projectDestructiveFlag(projRec?.agent_config_json),
        ),
      });
      const storedTarget = fullTarget !== undefined ? fullTarget.slice(0, 500) : undefined;
      const evt = recordActivity(db, {
        run_id: run.id,
        task_id: run.task_id,
        kind: decision === 'block' ? 'tool:blocked' : 'tool:invoked',
        payload: { tool, target: storedTarget, phase: phaseRow.phase, reason },
      });
      emitActivity(db, evt);
      return { decision, reason };
    }

    default:
      throw new Error(`unknown tool ${name}`);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean | null | undefined> {
  if (url.pathname !== '/mcp' || req.method !== 'POST') return null;

  const rawBody = await readJson(req);
  if (rawBody === null) {
    sendRpc(res, null, { code: -32700, message: 'parse error' });
    return true;
  }

  const body = rawBody as RpcBody;
  const id = body.id ?? null;
  const method = body.method;

  if (method === 'initialize') {
    sendRpc(res, id, null, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'abrun', version: '0.1.0' },
    });
    return true;
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) {
    res.writeHead(202);
    res.end();
    return true;
  }
  if (method === 'ping') {
    sendRpc(res, id, null, {});
    return true;
  }
  if (method === 'tools/list') {
    sendRpc(res, id, null, { tools: TOOL_DEFS });
    return true;
  }

  if (method === 'tools/call') {
    const params = isRecord(body.params) ? body.params : {};
    const name = typeof params.name === 'string' ? params.name : '';
    const args = isRecord(params.arguments) ? params.arguments : {};

    const argSummary = (() => {
      try {
        const s = JSON.stringify(args);
        return s.length > 200 ? s.slice(0, 200) + '…' : s;
      } catch {
        return '?';
      }
    })();

    // Auth: the caller's own run_token, sent as the Bearer header — never the
    // server token (see module header comment / CLAUDE.md "Security model").
    // Every remaining tool requires run_token, so this single check covers
    // the whole surface; there is no unauthenticated / active-project-fallback
    // path left to resolve a db without one.
    const authHeader = req.headers.authorization ?? '';
    const headerToken = /^Bearer\s+(.+)$/.exec(authHeader)?.[1] ?? '';
    if (!headerToken) {
      sendRpc(res, id, null, {
        content: [{ type: 'text', text: 'Error: unauthorized (missing run_token Bearer header)' }],
        isError: true,
      });
      return true;
    }

    // If the call also carries a `run_token` argument, it must match the
    // header exactly — an agent may not act on behalf of a different run by
    // quoting another run's token in `arguments` while authenticating with
    // its own header (or vice versa).
    const argToken = typeof args.run_token === 'string' ? args.run_token : undefined;
    if (argToken !== undefined && !constantTimeEqual(argToken, headerToken)) {
      sendRpc(res, id, null, {
        content: [{ type: 'text', text: 'Error: run_token argument does not match Bearer header' }],
        isError: true,
      });
      return true;
    }
    args.run_token = headerToken;

    let db: DbHandle | null = null;
    try {
      const r = await getDbForRunToken(headerToken);
      if (r === null) throw new Error('invalid run_token or run not running');
      db = r.db;
    } catch (e) {
      console.error(
        `[mcp] ${name} FAIL args=${argSummary} err="${(e as Error).message}" (db-resolve)`,
      );
      sendRpc(res, id, null, {
        content: [{ type: 'text', text: `Error: ${(e as Error).message}` }],
        isError: true,
      });
      return true;
    }

    try {
      const out = callTool(db, name, args);
      sendRpc(res, id, null, {
        content: [
          { type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) },
        ],
        isError: false,
      });
      return true;
    } catch (e) {
      console.error(`[mcp] ${name} FAIL args=${argSummary} err="${(e as Error).message}"`);
      sendRpc(res, id, null, {
        content: [{ type: 'text', text: `Error: ${(e as Error).message}` }],
        isError: true,
      });
      return true;
    }
  }

  sendRpc(res, id, { code: -32601, message: `method not found: ${String(method)}` });
  return true;
}
