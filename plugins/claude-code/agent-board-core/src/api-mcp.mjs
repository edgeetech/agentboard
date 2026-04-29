// HTTP MCP endpoint for spawned headless Claude runs (streamable-http / JSON-RPC 2.0).
// Tools: list_queue, claim_run, get_task, update_task, add_comment,
//        finish_run, add_heartbeat, get_project.
// Auth: server Bearer (outer) + run_token (per-call for mutations).

import { json, readJson } from './http-util.mjs';
import { getActiveDb, getDb } from './project-registry.mjs';
import { randomBytes } from 'node:crypto';
import {
  getTask, getProject, listComments, listRuns,
  addComment, getRunByToken, claimRun, bumpHeartbeat, finishRun as finishRunRow,
  transitionTask,
} from './repo.mjs';
import { checkPostflight, checkReassignAudit } from './postflight.mjs';
import { isoNow } from './time.mjs';

const TOOL_DEFS = [
  { name: 'list_queue',   description: 'List queued agent runs for the active project',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'claim_run',    description: 'Claim a queued run; returns run_token',
    inputSchema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] } },
  { name: 'get_task',     description: 'Get task + comments + recent runs (uses run_token)',
    inputSchema: { type: 'object', properties: { run_token: { type: 'string' } }, required: ['run_token'] } },
  { name: 'update_task',  description: 'Mutate task fields (status, assignee, description, AC)',
    inputSchema: { type: 'object', properties: {
      run_token: { type: 'string' }, patch: { type: 'object' },
    }, required: ['run_token', 'patch'] } },
  { name: 'add_comment',  description: 'Append a comment to the current task',
    inputSchema: { type: 'object', properties: {
      run_token: { type: 'string' }, body: { type: 'string' },
    }, required: ['run_token', 'body'] } },
  { name: 'finish_run',   description: 'Finish run (succeeded|failed|blocked|cancelled). Triggers postflight on succeeded.',
    inputSchema: { type: 'object', properties: {
      run_token: { type: 'string' }, status: { type: 'string' },
      summary: { type: 'string' }, error: { type: 'string' },
    }, required: ['run_token', 'status'] } },
  { name: 'add_heartbeat', description: 'Bump run heartbeat (usually implicit on other MCP calls)',
    inputSchema: { type: 'object', properties: { run_token: { type: 'string' } }, required: ['run_token'] } },
  { name: 'get_project',  description: 'Get active project info (uses run_token)',
    inputSchema: { type: 'object', properties: { run_token: { type: 'string' } }, required: ['run_token'] } },
];

export async function handleMcp(req, res, url) {
  if (url.pathname !== '/mcp' || req.method !== 'POST') return null;

  const body = await readJson(req);
  if (!body) return sendRpc(res, null, { code: -32700, message: 'parse error' });

  const id = body.id ?? null;
  const method = body.method;

  // Spec-mandated lifecycle
  if (method === 'initialize') {
    return sendRpc(res, id, null, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'abrun', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) {
    // Notifications get no response body per JSON-RPC
    res.writeHead(202); return res.end();
  }
  if (method === 'ping') {
    return sendRpc(res, id, null, {});
  }

  if (method === 'tools/list') {
    return sendRpc(res, id, null, { tools: TOOL_DEFS });
  }

  if (method === 'tools/call') {
    const active = await getActiveDb();
    if (!active) return sendRpc(res, id, { code: -32000, message: 'no active project' });
    const { db } = active;
    const { name, arguments: args = {} } = body.params || {};
    try {
      const out = await callTool(db, name, args);
      return sendRpc(res, id, null, {
        content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }],
        isError: false,
      });
    } catch (e) {
      return sendRpc(res, id, null, {
        content: [{ type: 'text', text: `Error: ${e?.message || e}` }],
        isError: true,
      });
    }
  }

  return sendRpc(res, id, { code: -32601, message: `method not found: ${method}` });
}

function sendRpc(res, id, error, result) {
  const body = error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result };
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

async function callTool(db, name, args) {
  const requireRunToken = () => {
    const t = args.run_token;
    if (!t) throw new Error('run_token required');
    const run = getRunByToken(db, t);
    if (!run) throw new Error('invalid run_token or run not running');
    bumpHeartbeat(db, run.id);
    return run;
  };

  switch (name) {
    case 'list_queue': {
      const rows = db.prepare(`
        SELECT r.*, t.code AS task_code, t.title AS task_title
        FROM agent_run r JOIN task t ON t.id = r.task_id
        WHERE r.status='queued'
        ORDER BY r.queued_at ASC
      `).all();
      return { queue: rows };
    }

    case 'claim_run': {
      const { run_id } = args;
      if (!run_id) throw new Error('run_id required');
      const existing = db.prepare(`SELECT * FROM agent_run WHERE id=?`).get(run_id);
      if (!existing) throw new Error('run not found');
      // Security: never return an existing run_token. A run is claimed exactly
      // once by the process that wins the queued→running CAS. Any later caller
      // — even holding the server Bearer token — must get an error, otherwise
      // it could impersonate the running agent via update_task / add_comment /
      // finish_run with its run_token.
      if (existing.status !== 'queued') throw new Error(`run not in queued state (status=${existing.status})`);
      const run_token = randomBytes(24).toString('hex');
      const ok = claimRun(db, run_id, run_token, null, null);
      if (!ok) throw new Error('claim CAS failed');
      return { run_token, task_id: existing.task_id };
    }

    case 'get_task': {
      const run = requireRunToken();
      const task = getTask(db, run.task_id);
      return {
        task,
        project: getProject(db),
        comments: listComments(db, task.id),
        runs: listRuns(db, task.id, 5),
      };
    }

    case 'update_task': {
      const run = requireRunToken();
      const { patch = {} } = args;
      const cur = getTask(db, run.task_id);
      if (!cur) throw new Error('task not found');
      const expected = patch.version ?? cur.version;

      const wantsStatus   = 'status' in patch && patch.status !== cur.status;
      const wantsAssignee = 'assignee_role' in patch && patch.assignee_role !== cur.assignee_role;
      if (wantsStatus || wantsAssignee) {
        const recent = listComments(db, run.task_id).slice(-5);
        const auditErr = checkReassignAudit(run.role, patch.assignee_role, recent);
        if (auditErr) throw new Error(auditErr);

        const project = getProject(db);
        const out = transitionTask(db, {
          task_id: run.task_id,
          to_status: patch.status ?? cur.status,
          to_assignee: patch.assignee_role ?? cur.assignee_role,
          by_role: run.role,
          expected_version: expected,
          workflow_type: project.workflow_type,
        });
        if (!out.ok) throw new Error(out.reason);
      }

      const sets = [];
      const vals = [];
      for (const k of ['description', 'acceptance_criteria_json']) {
        if (k in patch) {
          if (k === 'acceptance_criteria_json') validateAc(patch[k]);
          sets.push(`${k}=?`);
          vals.push(typeof patch[k] === 'string' ? patch[k] : JSON.stringify(patch[k]));
        }
      }
      if (sets.length) {
        sets.push('version=version+1', 'updated_at=?');
        vals.push(isoNow(), run.task_id);
        db.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id=?`).run(...vals);
      }

      return { task: getTask(db, run.task_id) };
    }

    case 'add_comment': {
      const run = requireRunToken();
      const body = String(args.body || '');
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
      const status = args.status || 'succeeded';
      if (!['succeeded', 'failed', 'blocked', 'cancelled'].includes(status)) {
        throw new Error('invalid finish status');
      }
      if (status === 'succeeded') {
        const task = getTask(db, run.task_id);
        const comments = listComments(db, run.task_id);
        const err = checkPostflight(run.role, task, comments);
        if (err) throw new Error(`postflight: ${err}`);
      }
      finishRunRow(db, run.id, status, args.summary, args.error);
      return { ok: true };
    }

    case 'get_project': {
      requireRunToken();
      return { project: getProject(db) };
    }

    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function validateAc(raw) {
  let arr;
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new Error('acceptance_criteria_json must be valid JSON'); }
  if (!Array.isArray(arr)) throw new Error('AC must be array');
  if (arr.length > 20) throw new Error('AC has >20 items');
  for (const it of arr) {
    if (!it.text || typeof it.text !== 'string') throw new Error('AC item missing text');
    if (it.text.length > 500) throw new Error('AC item text > 500 chars');
  }
}
