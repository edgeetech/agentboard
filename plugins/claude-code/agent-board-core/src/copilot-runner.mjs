// Copilot SDK agent runner — uses @github/copilot-sdk CopilotClient + createSession.
// Mirrors AgentRunner interface for executor compatibility.

import { TurnTimeout } from './turn-timeout.mjs';
import { RateLimitTracker } from './rate-limit-tracker.mjs';

const DEFAULT_TURN_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_TURN_TIMEOUT_MS || '900000', 10); // 15 min

/**
 * @typedef {Object} CopilotRunnerOptions
 * @property {string} runId
 * @property {string} role
 * @property {string} prompt
 * @property {string} systemPrompt
 * @property {string} cwd
 * @property {number} maxTurns
 * @property {string} allowedTools
 * @property {Record<string,unknown>} mcpServers
 * @property {AbortController} abortController
 * @property {number} [turnTimeoutMs]
 * @property {RateLimitTracker} [rateLimiter]
 * @property {{info:Function, error:Function, warn?:Function}|null} [sessionLog]
 * @property {(eventName:string, detail:object)=>void} [onEvent]
 */

/**
 * @typedef {Object} RunResult
 * @property {'completed'|'failed'|'cancelled'} status
 * @property {string} [sessionId]
 * @property {{input_tokens:number,output_tokens:number,cache_creation_tokens:number,cache_read_tokens:number}} [usage]
 * @property {string|null} [model]
 * @property {number|null} [totalCostUsd]
 * @property {string} [error]
 * @property {'timeout'|'error'} [errorKind]
 */

export class CopilotRunner {
  /** @type {CopilotRunnerOptions} */
  #opts;
  /** @type {string|null} */
  #sessionId = null;
  #partial = {
    model: null,
    totalCostUsd: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
  };

  /** @param {CopilotRunnerOptions} opts */
  constructor(opts) {
    this.#opts = opts;
  }

  /** @returns {Promise<RunResult>} */
  async run() {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } = this.#opts;

    if (abortController.signal.aborted) {
      return { status: 'cancelled', error: 'Aborted before start' };
    }

    if (this.#opts.rateLimiter?.isLimited('copilot-api')) {
      const info = this.#opts.rateLimiter.getInfo('copilot-api');
      const waitMs = info.retryAfterMs ?? 5000;
      this.#opts.sessionLog?.info({ waitMs }, 'Rate limited — waiting');
      await delay(waitMs, abortController.signal);
    }

    try {
      const result = await TurnTimeout.withTimeout(
        (_signal) => this.#executeSession(),
        turnTimeoutMs,
        abortController.signal,
      );
      this.#opts.rateLimiter?.recordSuccess('copilot-api');
      return result;
    } catch (err) {
      this.#opts.sessionLog?.error({ error: err?.message }, 'CopilotRunner failed');
      const aborted = abortController.signal.aborted;
      const isTimeout = err?.name === 'TimeoutError'
        || /timed out after \d+ms/i.test(err?.message || '');
      return {
        status: aborted && !isTimeout ? 'cancelled' : 'failed',
        error: err?.message ?? String(err),
        errorKind: isTimeout ? 'timeout' : 'error',
        sessionId: this.#sessionId,
        model: this.#partial.model,
        totalCostUsd: this.#partial.totalCostUsd,
        usage: this.#partial.usage,
      };
    }
  }

  /** @returns {Promise<RunResult>} */
  async #executeSession() {
    const { CopilotClient, approveAll } = await import('@github/copilot-sdk');

    const {
      prompt, systemPrompt, cwd, mcpServers,
      abortController, runId, onEvent, sessionLog,
      turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
    } = this.#opts;

    const usage = this.#partial.usage;
    /** @type {RunResult} */
    const result = { status: 'failed', sessionId: null, usage, model: null, totalCostUsd: null };

    const copilotMcpServers = normalizeMcpServers(mcpServers);

    const client = new CopilotClient();
    /** @type {import('@github/copilot-sdk').CopilotSession | undefined} */
    let session;

    const onAbort = () => {
      // Best-effort cancel; do not await inside listener.
      session?.abort().catch(() => {});
    };
    abortController.signal.addEventListener('abort', onAbort);

    try {
      const sessionConfig = {
        workingDirectory: cwd,
        onPermissionRequest: approveAll,
        onEvent: (event) => {
          if (!event?.type) return;
          onEvent?.(event.type, event);
          sessionLog?.info?.({ type: event.type, runId }, 'Copilot event');

          // Initial model hint. Skip "auto" — placeholder for auto-routing,
          // assistant.usage will report the actual model used.
          if (event.type === 'session.model_change') {
            const m = event.data?.newModel;
            if (m && m !== 'auto' && !result.model) {
              result.model = m;
              this.#partial.model = m;
            }
          }

          // Authoritative per-API-call usage. Fires after each model call,
          // delivered while the run is live (unlike session.shutdown which
          // races with disconnect). Always overwrite model — this is the
          // resolved model id even when session was started with "auto".
          if (event.type === 'assistant.usage') {
            const d = event.data ?? {};
            if (d.model) {
              result.model = d.model;
              this.#partial.model = d.model;
            }
            usage.input_tokens          += d.inputTokens ?? 0;
            usage.output_tokens         += d.outputTokens ?? 0;
            usage.cache_creation_tokens += d.cacheWriteTokens ?? 0;
            usage.cache_read_tokens     += d.cacheReadTokens ?? 0;
          }

          if (event.type === 'session.error') {
            sessionLog?.error?.({ msg: event.data?.message, errorType: event.data?.errorType }, 'Copilot session.error');
          }
        },
      };

      if (systemPrompt) {
        sessionConfig.systemMessage = { mode: 'replace', content: systemPrompt };
      }
      if (copilotMcpServers && Object.keys(copilotMcpServers).length > 0) {
        sessionConfig.mcpServers = copilotMcpServers;
      }

      session = await client.createSession(sessionConfig);
      this.#sessionId = session.sessionId;
      result.sessionId = session.sessionId;

      await session.sendAndWait({ prompt }, turnTimeoutMs);
      result.status = 'completed';
    } finally {
      abortController.signal.removeEventListener('abort', onAbort);
      try { await session?.disconnect(); } catch (e) { sessionLog?.warn?.({ error: e?.message }, 'session.disconnect failed'); }
      try { await client.stop(); }      catch (e) { sessionLog?.warn?.({ error: e?.message }, 'client.stop failed'); }
    }

    result.usage = usage;
    return result;
  }
}

/**
 * Translate AgentBoard's MCP server map (Claude SDK style) into Copilot SDK
 * MCPServerConfig shapes. Required field for Copilot: `tools: string[]` —
 * `["*"]` means allow all. Stdio configs need `type:'stdio'`.
 */
function normalizeMcpServers(mcpServers) {
  if (!mcpServers) return undefined;
  const out = {};
  for (const [name, cfg] of Object.entries(mcpServers)) {
    if (!cfg || typeof cfg !== 'object') continue;
    const tools = Array.isArray(cfg.tools) && cfg.tools.length > 0 ? cfg.tools : ['*'];
    if (cfg.type === 'http' || cfg.type === 'sse') {
      out[name] = {
        type: cfg.type,
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers } : {}),
        tools,
      };
    } else if (cfg.command) {
      out[name] = {
        type: 'stdio',
        command: cfg.command,
        args: cfg.args ?? [],
        ...(cfg.env ? { env: cfg.env } : {}),
        ...(cfg.cwd ? { cwd: cfg.cwd } : {}),
        tools,
      };
    }
    // Skip SDK-callable in-process MCPs — Copilot SDK requires command/url.
  }
  return out;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      }, { once: true });
    }
  });
}
