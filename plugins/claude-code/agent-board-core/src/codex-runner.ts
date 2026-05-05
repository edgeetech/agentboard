import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RunResult, TokenUsage, SessionLog } from './agent-runner.ts';
import { buildChildEnv } from './child-env.ts';
import {
  codexBridgedClaudeMcps,
  codexReferencedEnvKeys,
  quoteTomlPathKey,
  quoteTomlString,
  readCodexConfig,
} from './codex-config.ts';
import { runConfigDir } from './paths.ts';
import type { RateLimitTracker } from './rate-limit-tracker.ts';
import { TurnTimeout } from './turn-timeout.ts';

const DEFAULT_TURN_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_TURN_TIMEOUT_MS ?? '900000', 10);

/** AgentBoard MCP server entry (AgentBoard/Claude SDK style). */
interface McpServerEntry {
  command?: string;
  url?: string;
  args?: unknown[];
  env?: Record<string, string>;
  bearer_token_env_var?: string;
}

export interface CodexRunnerOptions {
  runId: string;
  role: string;
  prompt: string;
  cwd: string;
  abortController: AbortController;
  onEvent?: (eventName: string, detail: Record<string, unknown>) => void;
  sessionLog?: (SessionLog & { warn?: (obj: Record<string, unknown>, msg: string) => void }) | null;
  serverToken: string;
  serverPort: number;
  mcpServers?: Record<string, unknown>;
  rateLimiter?: RateLimitTracker;
  turnTimeoutMs?: number;
}

interface PartialState {
  model: string | null;
  totalCostUsd: number | null;
  usage: TokenUsage;
}

interface ExtractedUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export class CodexRunner {
  private readonly opts: CodexRunnerOptions;
  private sessionId: string | null = null;
  private partial: PartialState = {
    model: null,
    totalCostUsd: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
  };

  constructor(opts: CodexRunnerOptions) {
    this.opts = opts;
  }

  async run(): Promise<RunResult> {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } = this.opts;
    if (abortController.signal.aborted) {
      return { status: 'cancelled', error: 'Aborted before start' };
    }
    if (this.opts.rateLimiter?.isLimited('codex-api') === true) {
      const info = this.opts.rateLimiter.getInfo('codex-api');
      const waitMs = info.retryAfterMs ?? 5000;
      this.opts.sessionLog?.info({ waitMs }, 'Rate limited — waiting');
      await delay(waitMs, abortController.signal);
    }
    try {
      const result = await TurnTimeout.withTimeout(
        () => this.execute(),
        turnTimeoutMs,
        abortController.signal,
      );
      this.opts.rateLimiter?.recordSuccess('codex-api');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error({ error: error.message }, 'CodexRunner failed');
      // Re-read aborted after catch — can become true mid-stream even after entry check.
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

  private async execute(): Promise<RunResult> {
    const {
      prompt,
      cwd,
      abortController,
      runId,
      onEvent,
      sessionLog,
      serverToken,
      serverPort,
      mcpServers,
    } = this.opts;
    const usage = this.partial.usage;
    const result: RunResult = {
      status: 'failed',
      sessionId: null,
      model: null,
      totalCostUsd: null,
    };

    const codexCfg = readCodexConfig(cwd);
    result.model = codexCfg.model;
    this.partial.model = codexCfg.model;

    const outputDir = runConfigDir();
    try {
      mkdirSync(outputDir, { recursive: true });
    } catch {
      /* ignore */
    }
    const lastMessagePath = join(outputDir, `${runId}.codex-last.txt`);

    const childEnvExtras: Record<string, string> = {};
    const configArgs: string[] = [];
    const extraEnvKeys = new Set<string>(codexReferencedEnvKeys(cwd));
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
    const bridged: Record<string, McpServerEntry> = {
      ...codexBridgedClaudeMcps(),
      ...(Object.fromEntries(userMcpEntries) as Record<string, McpServerEntry>),
    };
    for (const [name, server] of Object.entries(bridged)) {
      const pathKey = `mcp_servers.${quoteTomlPathKey(name)}`;
      if (server.command) {
        configArgs.push('-c', `${pathKey}.command=${quoteTomlString(server.command)}`);
        if (Array.isArray(server.args)) {
          const argsValue = `[${server.args.map((arg) => quoteTomlString(arg)).join(', ')}]`;
          configArgs.push('-c', `${pathKey}.args=${argsValue}`);
        }
        if (server.env !== undefined) {
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

    const env: Record<string, string> = {
      ...buildChildEnv(process.env, [...extraEnvKeys]),
      ...childEnvExtras,
    };
    delete env.CLAUDECODE;

    const args = [
      'exec',
      '--json',
      '--output-last-message',
      lastMessagePath,
      '-a',
      'never',
      '-C',
      cwd,
      ...configArgs,
    ];

    const child = spawn('codex', args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.sessionId = `codex:${runId}`;
    result.sessionId = this.sessionId;
    sessionLog?.info({ args }, 'Starting Codex exec');

    abortController.signal.addEventListener(
      'abort',
      () => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      },
      { once: true },
    );

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines)
        this.handleJsonLine(line, result, usage, onEvent, sessionLog, runId);
    });
    child.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk;
      sessionLog?.error({ runId, stderr: chunk.slice(0, 500) }, 'Codex stderr');
    });

    child.stdin.write(prompt);
    child.stdin.end();

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    if (stdoutBuf.trim())
      this.handleJsonLine(stdoutBuf.trim(), result, usage, onEvent, sessionLog, runId);
    if (exitCode === 0) {
      result.status = 'completed';
    } else {
      throw new Error(stderrBuf.trim() || `codex exited with code ${String(exitCode)}`);
    }
    if (existsSync(lastMessagePath)) {
      try {
        const text = readFileSync(lastMessagePath, 'utf8').trim();
        if (text)
          sessionLog?.info({ runId, lastMessage: text.slice(0, 500) }, 'Codex final message');
      } catch {
        /* ignore */
      }
    }
    result.usage = usage;
    return result;
  }

  private handleJsonLine(
    line: string,
    result: RunResult,
    usage: TokenUsage,
    onEvent: ((eventName: string, detail: Record<string, unknown>) => void) | undefined,
    sessionLog: CodexRunnerOptions['sessionLog'],
    runId: string,
  ): void {
    const trimmed = (line.length > 0 ? line : '').trim();
    if (!trimmed) return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
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
      const u = extractUsage(obj);
      if (u !== null) {
        usage.input_tokens = u.input_tokens;
        usage.output_tokens = u.output_tokens;
        usage.cache_creation_tokens = u.cache_creation_tokens;
        usage.cache_read_tokens = u.cache_read_tokens;
      }
      const totalCost = pickNumber(obj, ['total_cost_usd', 'cost_usd']);
      if (totalCost !== null) {
        result.totalCostUsd = totalCost;
        this.partial.totalCostUsd = totalCost;
      }
    }
  }
}

function looksFinalEvent(obj: Record<string, unknown>): boolean {
  const type = String(obj.type ?? obj.event ?? '').toLowerCase();
  return type.includes('result') || type.includes('completed') || type.includes('final');
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = obj[key];
    if (typeof direct === 'string' && direct.length > 0) return direct;
    const data = obj.data;
    if (data !== null && typeof data === 'object') {
      const nested = (data as Record<string, unknown>)[key];
      if (typeof nested === 'string' && nested.length > 0) return nested;
    }
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const direct = obj[key];
    if (typeof direct === 'number') return direct;
    const data = obj.data;
    if (data !== null && typeof data === 'object') {
      const nested = (data as Record<string, unknown>)[key];
      if (typeof nested === 'number') return nested;
    }
  }
  return null;
}

function extractUsage(obj: Record<string, unknown>): ExtractedUsage | null {
  const data = obj.data;
  const dataObj =
    data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const resultField = obj.result;
  const resultObj =
    resultField !== null && typeof resultField === 'object'
      ? (resultField as Record<string, unknown>)
      : null;
  const responseField = obj.response;
  const responseObj =
    responseField !== null && typeof responseField === 'object'
      ? (responseField as Record<string, unknown>)
      : null;

  const candidate =
    obj.usage ??
    (dataObj !== null ? dataObj.usage : undefined) ??
    (resultObj !== null ? resultObj.usage : undefined) ??
    (responseObj !== null ? responseObj.usage : undefined);

  if (candidate === null || candidate === undefined || typeof candidate !== 'object') return null;
  const u = candidate as Record<string, unknown>;

  const num = (key: string): number => {
    const v = u[key];
    return typeof v === 'number' ? v : 0;
  };

  return {
    input_tokens: num('input_tokens') || num('inputTokens'),
    output_tokens: num('output_tokens') || num('outputTokens'),
    cache_creation_tokens: num('cache_creation_tokens') || num('cacheCreationTokens'),
    cache_read_tokens:
      num('cache_read_tokens') || num('cacheReadTokens') || num('cached_input_tokens'),
  };
}

/** Reads AbortSignal.aborted via an opaque function so TypeScript CFA does not narrow the result. */
function checkAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        },
        { once: true },
      );
    }
  });
}
