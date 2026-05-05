// agent-board local server. 127.0.0.1 only, auto-port, Bearer-auth.
// Launched by `/agent-board open` skill in the Claude Code plugin.

import { randomUUID, randomBytes } from 'node:crypto';
import {
  readFileSync,
  existsSync,
  statSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { extname, resolve, sep, join } from 'node:path';

// Redirect stdout/stderr to a log file so console.log/error survives parent
// exit (ensure-server.ts spawns us detached). Without this, logs vanish
// when the launching shell closes its pipes.
try {
  const logDir = join(process.env.AGENTBOARD_DATA_DIR ?? join(homedir(), '.agentboard'), 'logs');
  mkdirSync(logDir, { recursive: true });
  const logStream = createWriteStream(join(logDir, 'server.log'), { flags: 'a' });
  type WriteFn = (chunk: string | Uint8Array, cb?: (err?: Error | null) => void) => boolean;
  const origLog = process.stdout.write.bind(process.stdout) as WriteFn;
  const origErr = process.stderr.write.bind(process.stderr) as WriteFn;
  process.stdout.write = ((
    chunk: string | Uint8Array,
    cb?: (err?: Error | null) => void,
  ): boolean => {
    try {
      logStream.write(chunk);
    } catch {
      /* best-effort */
    }
    return origLog(chunk, cb);
  }) as typeof process.stdout.write;
  process.stderr.write = ((
    chunk: string | Uint8Array,
    cb?: (err?: Error | null) => void,
  ): boolean => {
    try {
      logStream.write(chunk);
    } catch {
      /* best-effort */
    }
    return origErr(chunk, cb);
  }) as typeof process.stderr.write;
} catch {
  /* logging is best-effort — never fail startup */
}

import { handleActivity } from './src/api-activity.ts';
import { handleCosts } from './src/api-costs.ts';
import { handleLogs } from './src/api-logs.ts';
import { handleMcp } from './src/api-mcp.ts';
import { handleProjects } from './src/api-projects.ts';
import { handlePrompts } from './src/api-prompts.ts';
import { handleSessions } from './src/api-sessions.ts';
import { handleSkills } from './src/api-skills.ts';
import { handleTasks } from './src/api-tasks.ts';
import { generateServerToken } from './src/auth.ts';
import { readConfig, writeConfig } from './src/config.ts';
import { startExecutor } from './src/executor.ts';
import { json } from './src/http-util.ts';
import { ensureDirs } from './src/paths.ts';
import { getActiveDb } from './src/project-registry.ts';
import {
  startAllSkillScanWorkers,
  stopAllSkillScanWorkers,
} from './src/skill-scan-runtime.ts';

// Debug: Check Copilot auth env vars at server startup
console.warn('[SERVER STARTUP] Checking Copilot auth environment:');
for (const v of ['GITHUB_TOKEN', 'COPILOT_TOKEN', 'COPILOT_CLI', 'COPILOT_CLI_BINARY_VERSION']) {
  console.warn(`  ${v}: ${process.env[v] ? 'SET' : 'NOT SET'}`);
}

const SERVER_BOOT_ID = randomUUID();
const UI_DIST = new URL('./ui/dist/', import.meta.url);
const PLUGIN_VERSION = process.env.AGENTBOARD_PLUGIN_VERSION ?? '0.1.0';

const startedAt = Date.now();
let lastApiHitMs = Date.now();

interface ParsedArgs {
  port: number;
  serverId: string | undefined;
}

const args = parseArgs();
ensureDirs();

const token = getOrCreateServerToken();
writeConfig({
  server_id: SERVER_BOOT_ID,
  token,
  started_at: new Date().toISOString(),
  plugin_version: PLUGIN_VERSION,
});

function requestHandler(req: IncomingMessage, res: ServerResponse): void {
  void handleRequest(req, res);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const p = url.pathname;

    const addr = server.address();
    const port = addr !== null && typeof addr === 'object' ? addr.port : 0;
    if (!checkHost(req, port)) {
      json(res, 421, { error: 'host not allowed' });
      return;
    }

    // CORS headers + preflight
    const origin = req.headers.origin;
    if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Credentials', 'false');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Unauth endpoints
    if (p === '/alive') {
      json(res, 200, {
        ok: true,
        server_id: SERVER_BOOT_ID,
        plugin_version: PLUGIN_VERSION,
      });
      return;
    }

    // UI: /index.html injects token (needs no Bearer — delivery channel itself)
    if (p === '/' || p === '/index.html') {
      serveIndex(res, token, port);
      return;
    }
    if (p.startsWith('/assets/') || p === '/favicon.ico' || p === '/favicon.svg') {
      serveStatic(res, p);
      return;
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
      serveIndex(res, token, port);
      return;
    }

    // Authenticated from here. Accept Bearer header OR ab_token cookie
    // (cookie path is for `<a href="/api/logs/..">` links the browser opens directly.)
    const authHeader = req.headers.authorization ?? '';
    const bearer = /^Bearer\s+(.+)$/.exec(authHeader)?.[1];
    const cookieTok = parseCookie(req.headers.cookie ?? '').ab_token;
    if (bearer !== token && cookieTok !== token) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }

    lastApiHitMs = Date.now();

    if (p === '/healthz') {
      const active = await getActiveDb();
      json(res, 200, {
        ok: true,
        server_id: SERVER_BOOT_ID,
        plugin_version: PLUGIN_VERSION,
        uptime_ms: Date.now() - startedAt,
        active_project: active ? active.code : null,
      });
      return;
    }

    // MCP endpoint (used by spawned headless runs)
    const mcp = await handleMcp(req, res, url);
    if (mcp) return;

    // Activity feed (SSE + history) — must run before catch-all so EventSource
    // reaches the streaming branch instead of 404.
    const act = await handleActivity(req, res, url);
    if (act) return;
    if (res.headersSent) return;

    // REST routers (first non-null handler wins)
    const handlers = [
      handleProjects,
      handleTasks,
      handleCosts,
      handleLogs,
      handleSessions,
      handlePrompts,
      handleSkills,
    ];
    for (const h of handlers) {
      const done = await h(req, res, url);
      if (done !== null && done !== undefined && done !== false) return;
    }

    json(res, 404, { error: 'not found', path: p });
  } catch (e) {
    console.error('[server] request failed:', e);
    if (!res.headersSent)
      json(res, 500, { error: String((e instanceof Error ? e.message : null) ?? e) });
  }
}

const server = createServer(requestHandler);

// Preferred port: 5501. Falls back to OS-chosen port if 5501 is in use.
// Override via --port <n> (0 = always random).
const PREFERRED_PORT = 5501;
const requestedPort = args.port === 0 ? PREFERRED_PORT : args.port;

const onReady = (): void => {
  const addr = server.address();
  const port = addr !== null && typeof addr === 'object' ? addr.port : 0;
  writeConfig({ port, pid: process.pid });
  console.warn(`READY http://127.0.0.1:${port}`);
  startExecutor({ port, serverToken: token });
  // Skill-scan workers: one per project DB. Mirrors executor's per-project
  // iteration but spun up as long-lived per-DB polling loops (see
  // src/skill-scan-runtime.ts). New projects created via POST /api/projects
  // call ensureSkillScanWorker themselves, so we only need a one-shot here.
  void startAllSkillScanWorkers().catch((e: unknown) => {
    console.error(
      '[server] startAllSkillScanWorkers failed:',
      (e as Error | null)?.message ?? String(e),
    );
  });
};

// Best-effort drain of skill-scan workers on graceful shutdown. The idle
// shutdown / signal handlers below call process.exit which skips async
// cleanup, but registering this gives a chance to finish in-flight scans
// when the process is asked nicely (SIGTERM via kill, supervisor restart).
const shutdownScanWorkers = (): void => {
  void stopAllSkillScanWorkers();
};
process.once('SIGINT', shutdownScanWorkers);
process.once('SIGTERM', shutdownScanWorkers);

const onListenError = (err: NodeJS.ErrnoException): void => {
  server.removeListener('error', onListenError);
  if (err.code === 'EADDRINUSE' && requestedPort !== 0) {
    console.warn(`[server] port ${requestedPort} in use; falling back to OS-chosen port`);
    server.listen(0, '127.0.0.1', onReady);
  } else {
    console.error('[server] listen failed:', err);
    process.exit(1);
  }
};

server.once('error', onListenError);
server.listen(requestedPort, '127.0.0.1', () => {
  server.removeListener('error', onListenError);
  onReady();
});

// Idle shutdown: no API hit for 10 minutes → exit.
setInterval((): void => {
  const idleFor = Date.now() - lastApiHitMs;
  if (idleFor < 10 * 60_000) return;
  console.warn('[server] idle shutdown');
  process.exit(0);
}, 30_000).unref();

// ────────────── helpers ──────────────

function checkHost(req: IncomingMessage, port: number): boolean {
  const h = req.headers.host ?? '';
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const out: ParsedArgs = { port: 0, serverId: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = parseInt(argv[++i] ?? '0', 10);
    if (argv[i] === '--server-id') out.serverId = argv[++i];
  }
  return out;
}

function getOrCreateServerToken(): string {
  const cfg = readConfig();
  if (typeof cfg.token === 'string' && cfg.token.length === 64) return cfg.token;
  return generateServerToken();
}

function serveIndex(res: ServerResponse, tok: string, port: number): void {
  const indexUrl = new URL('./index.html', UI_DIST);
  let html: string;
  try {
    html = readFileSync(indexUrl, 'utf8');
  } catch {
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
    `<script nonce="${nonce}">window.__AGENTBOARD_TOKEN=${JSON.stringify(tok)};</script></head>`,
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

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}

function serveStatic(res: ServerResponse, pathname: string): void {
  const rel = pathname.replace(/^\//, '');
  const abs = resolve(new URL(UI_DIST).pathname.replace(/^\/([A-Za-z]:)/, '$1'), rel);
  const root = resolve(new URL(UI_DIST).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  if (!abs.startsWith(root + sep) && abs !== root) {
    json(res, 400, { error: 'bad path' });
    return;
  }
  if (!existsSync(abs)) {
    json(res, 404, { error: 'not found' });
    return;
  }
  const ct =
    (
      {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.ico': 'image/x-icon',
        '.json': 'application/json',
      } as Record<string, string>
    )[extname(abs)] ?? 'application/octet-stream';
  const st = statSync(abs);
  res.writeHead(200, {
    'Content-Type': ct,
    'Content-Length': st.size,
    'Cache-Control': 'public, max-age=3600',
  });
  createReadStream(abs).pipe(res);
}
