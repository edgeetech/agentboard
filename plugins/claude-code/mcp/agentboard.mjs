#!/usr/bin/env node
// stdio MCP server for the *user's interactive* Claude Code session.
// Thin REST proxy to the agentboard core server. Uses Bearer from config.json.
// Distinct from the HTTP MCP endpoint used by spawned headless runs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = process.env.AGENTBOARD_DATA_DIR || join(homedir(), '.agentboard');
const CFG = safeJson(join(DATA_DIR, 'config.json')) || {};
const BASE = `http://127.0.0.1:${CFG.port || 0}`;
const AUTH = CFG.token ? `Bearer ${CFG.token}` : '';

const TOOLS = [
  {
    name: 'list_projects',
    description: 'List all agentboard projects.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_board',
    description: 'Get tasks for the active project (columns + summaries).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_task',
    description: 'Get a task by code (e.g. DEMO-3) with comments and recent runs.',
    inputSchema: {
      type: 'object',
      properties: { task_code: { type: 'string' } },
      required: ['task_code'],
    },
  },
  {
    name: 'list_comments',
    description: 'List comments for a task by code.',
    inputSchema: {
      type: 'object',
      properties: { task_code: { type: 'string' } },
      required: ['task_code'],
    },
  },
  {
    name: 'list_runs',
    description: 'List recent agent runs for a task by code.',
    inputSchema: {
      type: 'object',
      properties: { task_code: { type: 'string' } },
      required: ['task_code'],
    },
  },
  {
    name: 'approve_task',
    description: 'Approve a task in human_approval → done.',
    inputSchema: {
      type: 'object',
      properties: { task_code: { type: 'string' } },
      required: ['task_code'],
    },
  },
  {
    name: 'reject_task',
    description: 'Reject a task back to Worker. Comment must be ≥10 chars.',
    inputSchema: {
      type: 'object',
      properties: {
        task_code: { type: 'string' },
        comment:   { type: 'string', minLength: 10 },
      },
      required: ['task_code', 'comment'],
    },
  },
  {
    name: 'dispatch_task',
    description: 'Manually (re-)dispatch a task role: pm|worker|reviewer.',
    inputSchema: {
      type: 'object',
      properties: {
        task_code: { type: 'string' },
        role:      { type: 'string', enum: ['pm', 'worker', 'reviewer'] },
      },
      required: ['task_code', 'role'],
    },
  },
  {
    name: 'server_status',
    description: '/healthz passthrough: server_id, plugin_version, running/queued counts.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ───────── JSON-RPC 2.0 stdio loop ─────────

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    handle(line).catch(err => send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String(err?.message || err) } }));
  }
});

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); }
  catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  const id = msg.id ?? null;

  if (msg.method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'agentboard', version: '0.1.0' },
    }});
  }
  if (msg.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params || {};
    try {
      const out = await callTool(name, args);
      return send({ jsonrpc: '2.0', id, result: {
        content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }],
        isError: false,
      }});
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: {
        content: [{ type: 'text', text: `Error: ${e?.message || e}` }],
        isError: true,
      }});
    }
  }
  if (msg.method === 'notifications/initialized' || msg.method?.startsWith('notifications/')) return;
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${msg.method}` } });
}

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

// ───────── Tool dispatch ─────────

async function callTool(name, args) {
  if (!CFG.port) throw new Error('agentboard server not running — run /agentboard:open first');

  switch (name) {
    case 'list_projects':
      return (await call('GET', '/api/projects/list'));
    case 'get_board':
      return (await call('GET', '/api/tasks'));
    case 'get_task':
      return (await call('GET', `/api/tasks/${enc(args.task_code)}`));
    case 'list_comments':
      return (await call('GET', `/api/tasks/${enc(args.task_code)}`)).comments;
    case 'list_runs':
      return (await call('GET', `/api/tasks/${enc(args.task_code)}`)).runs;
    case 'server_status':
      return (await call('GET', '/healthz'));
    case 'dispatch_task':
      return (await call('POST', `/api/tasks/${enc(args.task_code)}/dispatch`, { role: args.role }));
    case 'approve_task':
      return (await call('POST', `/api/tasks/${enc(args.task_code)}/transition`, {
        to_status: 'done', to_assignee: 'human', by_role: 'human',
      }));
    case 'reject_task':
      if (!args.comment || args.comment.length < 10) throw new Error('comment must be ≥ 10 chars');
      return (await call('POST', `/api/tasks/${enc(args.task_code)}/transition`, {
        to_status: 'agent_working', to_assignee: 'worker', by_role: 'human', reject_comment: args.comment,
      }));
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Authorization': AUTH,
      'Content-Type': body ? 'application/json' : undefined,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  if (!res.ok) throw new Error(`${res.status} ${json?.error || txt}`);
  return json;
}

function enc(s) { return encodeURIComponent(s); }
function safeJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
