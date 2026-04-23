// agent-board local server. 127.0.0.1 only, auto-port, Bearer-auth.
// Launched by `/agent-board open` skill in the Claude Code plugin.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { ensureDirs } from './src/paths.mjs';
import { readConfig, writeConfig } from './src/config.mjs';
import { generateServerToken } from './src/auth.mjs';
import { json } from './src/http-util.mjs';
import { handleProjects } from './src/api-projects.mjs';
import { handleTasks } from './src/api-tasks.mjs';
import { handleCosts } from './src/api-costs.mjs';
import { handleLogs } from './src/api-logs.mjs';
import { handleSessions } from './src/api-sessions.mjs';
import { handleMcp } from './src/api-mcp.mjs';
import { startExecutor } from './src/executor.mjs';
import { runningCount } from './src/repo.mjs';
import { getActiveDb } from './src/project-registry.mjs';

const SERVER_BOOT_ID = randomUUID();
const UI_DIST = new URL('./ui/dist/', import.meta.url);
const PLUGIN_VERSION = process.env.AGENTBOARD_PLUGIN_VERSION || '0.1.0';

const startedAt = Date.now();
let lastApiHitMs = Date.now();

const args = parseArgs();
ensureDirs();

const token = getOrCreateServerToken();
writeConfig({
  server_id: SERVER_BOOT_ID,
  token,
  started_at: new Date().toISOString(),
  plugin_version: PLUGIN_VERSION,
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const p = url.pathname;

    const port = server.address()?.port;
    if (!checkHost(req, port)) return json(res, 421, { error: 'host not allowed' });

    // CORS headers + preflight
    const origin = req.headers.origin;
    if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Credentials', 'false');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // Unauth endpoints
    if (p === '/alive') {
      return json(res, 200, {
        ok: true,
        server_id: SERVER_BOOT_ID,
        plugin_version: PLUGIN_VERSION,
      });
    }

    // UI: /index.html injects token (needs no Bearer — delivery channel itself)
    if (p === '/' || p === '/index.html') {
      return serveIndex(res, token, port);
    }
    if (p.startsWith('/assets/') || p === '/favicon.ico' || p === '/favicon.svg') {
      return serveStatic(res, p);
    }

    // SPA fallback: non-API, non-asset GET requests → serve index so client
    // router can handle the route (deep links + refresh work).
    if (
      req.method === 'GET' &&
      !p.startsWith('/api/') &&
      !p.startsWith('/mcp') &&
      p !== '/healthz' &&
      !/\.[a-z0-9]+$/i.test(p)
    ) {
      return serveIndex(res, token, port);
    }

    // Authenticated from here. Accept Bearer header OR ab_token cookie
    // (cookie path is for `<a href="/api/logs/..">` links the browser opens directly.)
    const authHeader = req.headers.authorization || '';
    const bearer = /^Bearer\s+(.+)$/.exec(authHeader)?.[1];
    const cookieTok = parseCookie(req.headers.cookie || '').ab_token;
    if (bearer !== token && cookieTok !== token) {
      return json(res, 401, { error: 'unauthorized' });
    }

    lastApiHitMs = Date.now();

    if (p === '/healthz') {
      const active = await getActiveDb();
      return json(res, 200, {
        ok: true,
        server_id: SERVER_BOOT_ID,
        plugin_version: PLUGIN_VERSION,
        uptime_ms: Date.now() - startedAt,
        active_project: active ? active.code : null,
        running_runs: active ? runningCount(active.db) : 0,
      });
    }

    // MCP endpoint (used by spawned headless runs)
    const mcp = await handleMcp(req, res, url);
    if (mcp) return;

    // REST routers (first non-null handler wins)
    const handlers = [handleProjects, handleTasks, handleCosts, handleLogs, handleSessions];
    for (const h of handlers) {
      const done = await h(req, res, url);
      if (done || res.headersSent) return;
    }

    json(res, 404, { error: 'not found', path: p });
  } catch (e) {
    console.error('[server] request failed:', e);
    if (!res.headersSent) json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(args.port, '127.0.0.1', () => {
  const port = server.address().port;
  writeConfig({ port, pid: process.pid });
  console.log(`READY http://127.0.0.1:${port}`);
  startExecutor({ port, serverToken: token });
});

// Idle shutdown: no API hit 10min AND no running runs AND queue empty
setInterval(async () => {
  const idleFor = Date.now() - lastApiHitMs;
  if (idleFor < 10 * 60_000) return;
  const active = await getActiveDb();
  if (!active) return process.exit(0);
  const running = runningCount(active.db);
  const queued = active.db.prepare(`SELECT COUNT(*) AS n FROM agent_run WHERE status='queued'`).get().n;
  if (running === 0 && queued === 0) {
    console.log('[server] idle shutdown');
    process.exit(0);
  }
}, 30_000).unref?.();

// ────────────── helpers ──────────────

function checkHost(req, port) {
  const h = req.headers.host || '';
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { port: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = parseInt(argv[++i], 10);
    if (argv[i] === '--server-id') out.serverId = argv[++i];
  }
  return out;
}

function getOrCreateServerToken() {
  const cfg = readConfig();
  if (cfg.token && typeof cfg.token === 'string' && cfg.token.length === 64) return cfg.token;
  return generateServerToken();
}

function serveIndex(res, tok, port) {
  const indexUrl = new URL('./index.html', UI_DIST);
  let html;
  try { html = readFileSync(indexUrl, 'utf8'); }
  catch {
    // Fallback placeholder when UI not built yet — never leak any portion of the token.
    html = `<!doctype html><meta charset="utf-8"><title>agentboard</title>
      <style>body{font:14px system-ui;padding:2rem;max-width:600px;margin:auto;color:#222}
      code{background:#f3f3f3;padding:.15rem .4rem;border-radius:3px}</style>
      <h1>agentboard</h1>
      <p>Server is running but the UI bundle is not built yet.</p>
      <p>Run <code>cd plugins/claude-code/agent-board-core/ui &amp;&amp; npm install &amp;&amp; npm run build</code> then reload.</p>
      <p>Healthz: <code>curl -H "Authorization: Bearer &lt;token from ~/.agentboard/config.json&gt;" http://127.0.0.1:${port}/healthz</code></p>`;
  }
  // Per-request nonce authorizes exactly the token-injection script. CSP below
  // refuses any other inline or external script — so UI XSS can't read token.
  const nonce = randomBytes(16).toString('base64');
  // Stamp our own inline <script> tags (pre-paint theme resolver, token injection)
  // with the per-request nonce. Vite-emitted scripts carry attrs (type, src) so the
  // bare <script> match only hits our inline bootstrappers.
  let injected = html.replace(/<script>/g, `<script nonce="${nonce}">`);
  injected = injected.replace(
    /<\/head>/i,
    `<script nonce="${nonce}">window.__AGENTBOARD_TOKEN=${JSON.stringify(tok)};</script></head>`
  );
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // HttpOnly: cookie unreadable from JS. Token still in window.__AGENTBOARD_TOKEN
    // for fetch calls; defense-in-depth — if we later drop the window global,
    // the cookie alone carries auth via browser-auto-attach.
    'Set-Cookie': `ab_token=${tok}; Path=/; SameSite=Strict; HttpOnly`,
  });
  res.end(injected);
}

function parseCookie(header) {
  const out = {};
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}

function serveStatic(res, pathname) {
  const rel = pathname.replace(/^\//, '');
  const abs = resolve(new URL(UI_DIST).pathname.replace(/^\/([A-Za-z]:)/, '$1'), rel);
  const root = resolve(new URL(UI_DIST).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  if (!abs.startsWith(root + sep) && abs !== root) {
    return json(res, 400, { error: 'bad path' });
  }
  if (!existsSync(abs)) return json(res, 404, { error: 'not found' });
  const ct = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
  }[extname(abs)] || 'application/octet-stream';
  const st = statSync(abs);
  res.writeHead(200, { 'Content-Type': ct, 'Content-Length': st.size, 'Cache-Control': 'public, max-age=3600' });
  createReadStream(abs).pipe(res);
}
