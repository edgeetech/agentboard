// plugins/providers/codex/src/runner.ts
import { spawn } from 'node:child_process';
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2 } from 'node:fs';
import { homedir as homedir2 } from 'node:os';
import { dirname, join as join2 } from 'node:path';

// packages/plugin-sdk/src/runtime.ts
var ProviderTimeoutError = class extends Error {
  constructor(ms) {
    super(`Turn timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
};
async function withProviderTurnTimeout(fn, timeoutMs, parentSignal) {
  const controller = new AbortController();
  let timer = null;
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
    clearTimer();
  };
  if (parentSignal?.aborted === true) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }
  timer = setTimeout(() => {
    controller.abort(new ProviderTimeoutError(timeoutMs));
  }, timeoutMs);
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise((_resolve, reject) => {
        const rejectWithReason = () => {
          const reason = controller.signal.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        };
        if (controller.signal.aborted) {
          rejectWithReason();
          return;
        }
        controller.signal.addEventListener('abort', rejectWithReason, {
          once: true,
        });
      }),
    ]);
  } finally {
    clearTimer();
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

// plugins/providers/codex/src/config.ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
function agentboardConfigPath() {
  const dataDir = process.env.AGENTBOARD_DATA_DIR ?? join(homedir(), '.agentboard');
  return join(dataDir, 'config.json');
}
function readAgentboardConfig() {
  try {
    return JSON.parse(readFileSync(agentboardConfigPath(), 'utf8'));
  } catch {
    return {};
  }
}
function stripInlineComment(line) {
  let out = '';
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (ch === '"' && line.charAt(i - 1) !== '\\') inString = !inString;
    if (!inString && ch === '#') break;
    out += ch;
  }
  return out.trim();
}
function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function parseStringArray(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  let match;
  while ((match = re.exec(trimmed)) !== null) out.push(match[1] ?? match[2] ?? '');
  return out;
}
function parseCodexConfigText(text) {
  const parsed = { model: null, mcpServers: {} };
  let section = null;
  let currentName = null;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = stripInlineComment(rawLine);
    if (!line) continue;
    const envMatch = /^\[mcp_servers\.(.+)\.env\]$/.exec(line);
    if (envMatch !== null) {
      currentName = unquote(envMatch[1] ?? '');
      parsed.mcpServers[currentName] ??= { env: {} };
      section = 'mcp-env';
      continue;
    }
    const serverMatch = /^\[mcp_servers\.(.+)\]$/.exec(line);
    if (serverMatch !== null) {
      currentName = unquote(serverMatch[1] ?? '');
      parsed.mcpServers[currentName] ??= { env: {} };
      section = 'mcp';
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (kv === null) continue;
    const [, key, value] = kv;
    if (key === void 0 || value === void 0) continue;
    if (section === null && key === 'model') {
      parsed.model = unquote(value);
      continue;
    }
    if (currentName === null) continue;
    const cur = (parsed.mcpServers[currentName] ??= {
      env: {},
    });
    if (section === 'mcp-env') {
      cur.env[key] = unquote(value);
      continue;
    }
    if (key === 'command' || key === 'url' || key === 'bearer_token_env_var') {
      cur[key] = unquote(value);
    } else if (key === 'args') {
      cur.args = parseStringArray(value);
    }
  }
  return parsed;
}
function readCodexConfigFile(path) {
  try {
    if (!existsSync(path)) return { model: null, mcpServers: {} };
    return parseCodexConfigText(readFileSync(path, 'utf8'));
  } catch {
    return { model: null, mcpServers: {} };
  }
}
function readCodexConfig(projectDir = null) {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const globalCfg = readCodexConfigFile(join(home, 'config.toml'));
  const projectCfg =
    projectDir !== null
      ? readCodexConfigFile(join(projectDir, '.codex', 'config.toml'))
      : { model: null, mcpServers: {} };
  return {
    model: projectCfg.model ?? globalCfg.model ?? null,
    mcpServers: { ...globalCfg.mcpServers, ...projectCfg.mcpServers },
  };
}
function normalizeClaudeServer(s) {
  if (s === null || typeof s !== 'object') return s;
  const raw = s;
  const out = { ...raw };
  const rawArgs = raw.args;
  if (
    rawArgs !== void 0 &&
    rawArgs !== null &&
    !Array.isArray(rawArgs) &&
    typeof rawArgs === 'object'
  ) {
    const argsObj = rawArgs;
    const keys = Object.keys(argsObj)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (keys.length > 0) out.args = keys.map((key) => argsObj[key] ?? '');
  }
  return out;
}
function readClaudeUserMcpServers() {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
    const cfg = raw !== null && typeof raw === 'object' ? raw : {};
    const rawServers = cfg.mcpServers;
    const servers = rawServers !== null && typeof rawServers === 'object' ? rawServers : {};
    const out = {};
    for (const [name, server] of Object.entries(servers)) {
      const normalized = normalizeClaudeServer(server);
      if (normalized !== null && typeof normalized === 'object') {
        out[name] = normalized;
      }
    }
    return out;
  } catch {
    return {};
  }
}
function inheritedUserMcpServers() {
  const mode = readAgentboardConfig().inherit_user_mcps;
  if (mode === void 0 || mode === null || mode === false) return {};
  const all = readClaudeUserMcpServers();
  const out = {};
  const allow = Array.isArray(mode) ? new Set(mode) : null;
  for (const [key, value] of Object.entries(all)) {
    if (key === 'abrun') continue;
    if (allow !== null && !allow.has(key)) continue;
    out[key] = value;
  }
  return out;
}
function inheritedUserMcpKeys() {
  return Object.keys(inheritedUserMcpServers());
}
function codexBridgedClaudeMcps() {
  const mode = readAgentboardConfig().codex_bridge_claude_mcps;
  if (mode === false) return {};
  const all = readClaudeUserMcpServers();
  const allow = Array.isArray(mode) ? new Set(mode) : null;
  const out = {};
  for (const [name, server] of Object.entries(all)) {
    if (name === 'abrun') continue;
    if (allow !== null && !allow.has(name)) continue;
    out[name] = server;
  }
  return out;
}
function codexReferencedEnvKeys(projectDir = null) {
  const cfg = readCodexConfig(projectDir);
  const keys = /* @__PURE__ */ new Set();
  for (const server of Object.values(cfg.mcpServers)) {
    if (server.bearer_token_env_var !== void 0) keys.add(server.bearer_token_env_var);
  }
  return [...keys];
}
function quoteTomlString(value) {
  return JSON.stringify(String(value ?? ''));
}
function quoteTomlPathKey(value) {
  return `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
}

// plugins/providers/codex/src/environment.ts
import { platform } from 'node:os';
var UNIVERSAL = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
var POSIX = ['HOME', 'USER', 'SHELL', 'TMPDIR'];
var WINDOWS = [
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'TEMP',
  'TMP',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'PATHEXT',
  'COMSPEC',
];
var CLAUDE = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CONFIG_DIR',
  'XDG_CONFIG_HOME',
];
var COPILOT = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'COPILOT_TOKEN',
  'COPILOT_CLI',
  'COPILOT_CLI_BINARY_VERSION',
  'COPILOT_RUN_APP',
  'COPILOT_AGENT_SESSION_ID',
];
var CODEX = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT', 'CODEX_HOME'];
function codexChildProcessEnvironmentPolicy(extraKeys = []) {
  return {
    inherit: false,
    allowedKeys: [
      .../* @__PURE__ */ new Set([
        ...UNIVERSAL,
        ...CLAUDE,
        ...COPILOT,
        ...CODEX,
        ...extraKeys,
        ...(platform() === 'win32' ? WINDOWS : POSIX),
      ]),
    ],
  };
}
function buildCodexChildEnv(base = process.env, extraKeys = []) {
  const policy = codexChildProcessEnvironmentPolicy(extraKeys);
  const out = {};
  for (const key of policy.allowedKeys) {
    const value = base[key];
    if (value !== void 0) out[key] = value;
  }
  return out;
}

// plugins/providers/codex/src/runner.ts
var DEFAULT_TURN_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_TURN_TIMEOUT_MS ?? '900000', 10);
var CodexRunner = class {
  opts;
  sessionId = null;
  partial = {
    model: null,
    totalCostUsd: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    },
  };
  constructor(opts) {
    this.opts = opts;
  }
  async run() {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } = this.opts;
    if (abortController.signal.aborted) {
      return { status: 'cancelled', error: 'Aborted before start' };
    }
    if (this.opts.rateLimiter?.isLimited('codex-api') === true) {
      const info = this.opts.rateLimiter.getInfo('codex-api');
      const waitMs = info.retryAfterMs ?? 5e3;
      this.opts.sessionLog?.info({ waitMs }, 'Rate limited \u2014 waiting');
      await delay(waitMs, abortController.signal);
    }
    try {
      const result = await withProviderTurnTimeout(
        async (turnSignal) => this.execute(turnSignal),
        turnTimeoutMs,
        abortController.signal,
      );
      this.opts.rateLimiter?.recordSuccess('codex-api');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error({ error: error.message }, 'CodexRunner failed');
      const isAborted = checkAborted(abortController.signal);
      const isTimeout =
        error.name === 'TimeoutError' || /timed out after \d+ms/i.test(error.message);
      return {
        status: isAborted && !isTimeout ? 'cancelled' : 'failed',
        error: error.message,
        errorKind: isTimeout ? 'timeout' : 'error',
        sessionId: this.sessionId,
        model: this.partial.model,
        totalCostUsd: this.partial.totalCostUsd,
        usage: this.partial.usage,
      };
    }
  }
  async execute(turnSignal) {
    const {
      prompt,
      systemPrompt,
      cwd,
      abortController,
      runId,
      onEvent,
      sessionLog,
      serverToken,
      serverPort,
      mcpServers,
      sandbox,
    } = this.opts;
    const usage = this.partial.usage;
    const result = {
      status: 'failed',
      sessionId: null,
      model: null,
      totalCostUsd: null,
    };
    const codexCfg = readCodexConfig(cwd);
    result.model = codexCfg.model;
    this.partial.model = codexCfg.model;
    const outputDir = this.opts.runConfigDir?.() ?? defaultRunConfigDir();
    try {
      mkdirSync(outputDir, { recursive: true });
    } catch {}
    const lastMessagePath = join2(outputDir, `${runId}.codex-last.txt`);
    const childEnvExtras = {};
    const configArgs = [];
    const extraEnvKeys = new Set(codexReferencedEnvKeys(cwd));
    childEnvExtras.AGENTBOARD_RUN_BEARER = serverToken;
    configArgs.push(
      '-c',
      `mcp_servers.${quoteTomlPathKey('abrun')}.url=${quoteTomlString(`http://127.0.0.1:${serverPort}/mcp`)}`,
    );
    configArgs.push(
      '-c',
      `mcp_servers.${quoteTomlPathKey('abrun')}.bearer_token_env_var=${quoteTomlString('AGENTBOARD_RUN_BEARER')}`,
    );
    const userMcpEntries = Object.entries(mcpServers ?? {}).filter(([name]) => name !== 'abrun');
    const bridged = {
      ...codexBridgedClaudeMcps(),
      ...Object.fromEntries(userMcpEntries),
    };
    for (const [name, server] of Object.entries(bridged)) {
      const pathKey = `mcp_servers.${quoteTomlPathKey(name)}`;
      if (server.command) {
        configArgs.push('-c', `${pathKey}.command=${quoteTomlString(server.command)}`);
        if (Array.isArray(server.args)) {
          const argsValue = `[${server.args.map((arg) => quoteTomlString(arg)).join(', ')}]`;
          configArgs.push('-c', `${pathKey}.args=${argsValue}`);
        }
        if (server.env !== void 0) {
          for (const [envKey, envValue] of Object.entries(server.env)) {
            childEnvExtras[envKey] = envValue;
            extraEnvKeys.add(envKey);
          }
        }
      } else if (server.url) {
        configArgs.push('-c', `${pathKey}.url=${quoteTomlString(server.url)}`);
        if (server.bearer_token_env_var) {
          configArgs.push(
            '-c',
            `${pathKey}.bearer_token_env_var=${quoteTomlString(server.bearer_token_env_var)}`,
          );
          extraEnvKeys.add(server.bearer_token_env_var);
        }
      }
    }
    const env = {
      ...buildCodexChildEnv(process.env, [...extraEnvKeys]),
      ...childEnvExtras,
    };
    delete env.CLAUDECODE;
    const args = buildCodexExecArgs({
      lastMessagePath,
      cwd,
      configArgs,
      ...(sandbox !== void 0 ? { sandbox } : {}),
    });
    const fullPrompt =
      systemPrompt.trim().length > 0
        ? `${systemPrompt}

---

${prompt}`
        : prompt;
    const launch = resolveCodexLaunch(env, args);
    const child = spawn(launch.command, launch.args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.sessionId = `codex:${runId}`;
    result.sessionId = this.sessionId;
    sessionLog?.info({ args }, 'Starting Codex exec');
    const killChild = () => {
      try {
        child.kill();
      } catch {}
    };
    abortController.signal.addEventListener('abort', killChild, { once: true });
    turnSignal.addEventListener('abort', killChild, { once: true });
    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines)
        this.handleJsonLine(line, result, usage, onEvent, sessionLog, runId);
    });
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk;
      sessionLog?.error({ runId, stderr: chunk.slice(0, 500) }, 'Codex stderr');
    });
    child.stdin.write(fullPrompt);
    child.stdin.end();
    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    abortController.signal.removeEventListener('abort', killChild);
    turnSignal.removeEventListener('abort', killChild);
    if (stdoutBuf.trim())
      this.handleJsonLine(stdoutBuf.trim(), result, usage, onEvent, sessionLog, runId);
    if (exitCode === 0) result.status = 'completed';
    else throw new Error(stderrBuf.trim() || `codex exited with code ${String(exitCode)}`);
    if (existsSync2(lastMessagePath)) {
      try {
        const text = readFileSync2(lastMessagePath, 'utf8').trim();
        if (text)
          sessionLog?.info({ runId, lastMessage: text.slice(0, 500) }, 'Codex final message');
      } catch {}
    }
    result.usage = usage;
    return result;
  }
  handleJsonLine(line, result, usage, onEvent, sessionLog, runId) {
    const trimmed = (line.length > 0 ? line : '').trim();
    if (!trimmed) return;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      sessionLog?.info({ runId, line: trimmed.slice(0, 500) }, 'Codex stdout');
      return;
    }
    const typeVal = typeof obj.type === 'string' ? obj.type : null;
    const eventVal = typeof obj.event === 'string' ? obj.event : null;
    const eventName = typeVal ?? eventVal ?? 'codex.event';
    onEvent?.(eventName, obj);
    sessionLog?.info({ runId, type: eventName }, 'Codex event');
    const sessionIdCandidate =
      typeof obj.session_id === 'string' && obj.session_id.length > 0
        ? obj.session_id
        : typeof obj.thread_id === 'string' && obj.thread_id.length > 0
          ? obj.thread_id
          : null;
    if (sessionIdCandidate !== null) {
      this.sessionId = sessionIdCandidate;
      result.sessionId = sessionIdCandidate;
    }
    const model = pickString(obj, ['model', 'model_name']);
    if (model !== null) {
      result.model = model;
      this.partial.model = model;
    }
    if (looksFinalEvent(obj)) {
      const extractedUsage = extractUsage(obj);
      if (extractedUsage !== null) {
        usage.input_tokens = extractedUsage.input_tokens;
        usage.output_tokens = extractedUsage.output_tokens;
        usage.cache_creation_tokens = extractedUsage.cache_creation_tokens;
        usage.cache_read_tokens = extractedUsage.cache_read_tokens;
      }
      const totalCost = pickNumber(obj, ['total_cost_usd', 'cost_usd']);
      if (totalCost !== null) {
        result.totalCostUsd = totalCost;
        this.partial.totalCostUsd = totalCost;
      }
    }
  }
};
function buildCodexExecArgs(args) {
  return [
    'exec',
    '--json',
    '--output-last-message',
    args.lastMessagePath,
    ...codexSandboxArgs(args.sandbox),
    '-C',
    args.cwd,
    ...(args.configArgs ?? []),
  ];
}
function codexSandboxArgs(sandbox) {
  if (sandbox?.restrictToWorkspace === false)
    throw new Error('Codex provider requires workspace-restricted sandbox execution');
  return ['--sandbox', 'workspace-write', '--approve-for-me'];
}
function defaultRunConfigDir() {
  const dataDir = process.env.AGENTBOARD_DATA_DIR ?? join2(homedir2(), '.agentboard');
  return join2(dataDir, 'run-configs');
}
function resolveCodexLaunch(env, args) {
  if (process.platform !== 'win32') return { command: 'codex', args };
  const appData = env.APPDATA ?? join2(homedir2(), 'AppData', 'Roaming');
  const npmDir = join2(appData, 'npm');
  const cmdShim = join2(npmDir, 'codex.cmd');
  if (existsSync2(cmdShim)) {
    const codexJs = join2(npmDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (existsSync2(codexJs)) {
      const bundledNode = join2(dirname(cmdShim), 'node.exe');
      return {
        command: existsSync2(bundledNode) ? bundledNode : process.execPath,
        args: [codexJs, ...args],
      };
    }
  }
  const exeShim = join2(appData, 'npm', 'codex.exe');
  if (existsSync2(exeShim)) return { command: exeShim, args };
  return { command: 'codex', args };
}
function looksFinalEvent(obj) {
  const type = String(obj.type ?? obj.event ?? '').toLowerCase();
  return type.includes('result') || type.includes('completed') || type.includes('final');
}
function pickString(obj, keys) {
  for (const key of keys) {
    const direct = obj[key];
    if (typeof direct === 'string' && direct.length > 0) return direct;
    const data = obj.data;
    if (data !== null && typeof data === 'object') {
      const nested = data[key];
      if (typeof nested === 'string' && nested.length > 0) return nested;
    }
  }
  return null;
}
function pickNumber(obj, keys) {
  for (const key of keys) {
    const direct = obj[key];
    if (typeof direct === 'number') return direct;
    const data = obj.data;
    if (data !== null && typeof data === 'object') {
      const nested = data[key];
      if (typeof nested === 'number') return nested;
    }
  }
  return null;
}
function extractUsage(obj) {
  const data = obj.data;
  const dataObj = data !== null && typeof data === 'object' ? data : null;
  const resultField = obj.result;
  const resultObj = resultField !== null && typeof resultField === 'object' ? resultField : null;
  const responseField = obj.response;
  const responseObj =
    responseField !== null && typeof responseField === 'object' ? responseField : null;
  const candidate =
    obj.usage ??
    (dataObj !== null ? dataObj.usage : void 0) ??
    (resultObj !== null ? resultObj.usage : void 0) ??
    (responseObj !== null ? responseObj.usage : void 0);
  if (candidate === null || candidate === void 0 || typeof candidate !== 'object') return null;
  const usage = candidate;
  const num = (key) => (typeof usage[key] === 'number' ? usage[key] : 0);
  return {
    input_tokens: num('input_tokens') || num('inputTokens'),
    output_tokens: num('output_tokens') || num('outputTokens'),
    cache_creation_tokens: num('cache_creation_tokens') || num('cacheCreationTokens'),
    cache_read_tokens:
      num('cache_read_tokens') || num('cacheReadTokens') || num('cached_input_tokens'),
  };
}
function checkAborted(signal) {
  return signal.aborted;
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      },
      { once: true },
    );
  });
}

// plugins/providers/codex/src/index.ts
var codexProviderManifest = {
  id: 'codex',
  displayName: 'Codex',
  version: '0.1.0',
  runtime: { command: 'codex' },
  capabilities: {
    streamingEvents: true,
    resume: 'interactive',
    usage: 'cost',
    tools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
  },
  enforcement: {
    enforced: ['cwd', 'mcpServerNames', 'abortSignal', 'rateLimitBackoff', 'filesystemSandbox'],
    intentionallyIgnored: ['maxTurns', 'allowedTools', 'hooksEnabled', 'approvalMode'],
    notes: [
      'Legacy Codex runner launches with workspace-write sandboxing and fixed approve-for-me automation.',
      'Requested approvalMode is intentionally ignored until provider-specific approval mapping is implemented.',
    ],
  },
};
function createCodexProviderAdapter(args) {
  return {
    manifest: codexProviderManifest,
    provider: codexProviderManifest.id,
    enforcement: codexProviderManifest.enforcement,
    resume: {
      interactive: true,
      command: (sessionId, repoPath) =>
        args.buildResumeCommand(codexProviderManifest.id, sessionId, repoPath),
    },
    async run(ctx) {
      const runner = new args.Runner(ctx);
      const result = await runner.run();
      return {
        ...result,
        sessionRef:
          typeof result.sessionId === 'string' && result.sessionId.length > 0
            ? {
                provider: codexProviderManifest.id,
                sessionId: result.sessionId,
              }
            : null,
      };
    },
  };
}
export {
  CodexRunner,
  buildCodexChildEnv,
  buildCodexExecArgs,
  codexBridgedClaudeMcps,
  codexChildProcessEnvironmentPolicy,
  codexProviderManifest,
  codexReferencedEnvKeys,
  createCodexProviderAdapter,
  inheritedUserMcpKeys,
  inheritedUserMcpServers,
  quoteTomlPathKey,
  quoteTomlString,
  readClaudeUserMcpServers,
  readCodexConfig,
};
