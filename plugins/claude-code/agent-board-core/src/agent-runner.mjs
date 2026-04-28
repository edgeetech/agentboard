// Ported from hatice src/agent-runner.ts — Claude Agent SDK query() wrapper.
// agentboard-specific: integrates with run/task model, not hatice issue model.

import { TurnTimeout } from './turn-timeout.mjs';
import { RateLimitTracker } from './rate-limit-tracker.mjs';

const DEFAULT_TURN_TIMEOUT_MS = parseInt(process.env.AGENTBOARD_TURN_TIMEOUT_MS || '300000', 10); // 5 min

/**
 * @typedef {Object} AgentRunnerOptions
 * @property {string} runId
 * @property {string} role
 * @property {string} prompt           - full rendered user prompt
 * @property {string} systemPrompt     - role system prompt body
 * @property {string} cwd              - repo_path (or workspace path)
 * @property {number} maxTurns
 * @property {string} allowedTools     - comma-separated tool list
 * @property {Record<string,unknown>} mcpServers - SDK-style MCP servers object
 * @property {AbortController} abortController
 * @property {number} [turnTimeoutMs]
 * @property {RateLimitTracker} [rateLimiter]
 * @property {{info:Function, error:Function}|null} [sessionLog]
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
 */

export class AgentRunner {
  /** @type {AgentRunnerOptions} */
  #opts;
  /** @type {string|null} */
  #sessionId = null;

  /** @param {AgentRunnerOptions} opts */
  constructor(opts) {
    this.#opts = opts;
  }

  /** @returns {Promise<RunResult>} */
  async run() {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } = this.#opts;

    if (abortController.signal.aborted) {
      return { status: 'cancelled', error: 'Aborted before start' };
    }

    // Rate-limit pre-check
    if (this.#opts.rateLimiter?.isLimited('claude-api')) {
      const info = this.#opts.rateLimiter.getInfo('claude-api');
      const waitMs = info.retryAfterMs ?? 5000;
      this.#opts.sessionLog?.info({ waitMs }, 'Rate limited — waiting');
      await delay(waitMs, abortController.signal);
    }

    try {
      const result = await TurnTimeout.withTimeout(
        (_signal) => this.#executeTurn(),
        turnTimeoutMs,
        abortController.signal,
      );
      this.#opts.rateLimiter?.recordSuccess('claude-api');
      return result;
    } catch (err) {
      this.#opts.sessionLog?.error({ error: err?.message }, 'AgentRunner failed');
      if (abortController.signal.aborted) {
        return { status: 'cancelled', error: err?.message ?? 'Aborted' };
      }
      return { status: 'failed', error: err?.message ?? String(err) };
    }
  }

  /** @returns {Promise<RunResult>} */
  async #executeTurn() {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const {
      prompt, systemPrompt, cwd, maxTurns, allowedTools, mcpServers,
      abortController, runId, onEvent, sessionLog,
    } = this.#opts;

    // Strip CLAUDECODE env var — allows spawning Claude from inside a Claude session
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const queryOptions = {
      cwd,
      maxTurns,
      abortController,
      permissionMode: 'acceptEdits',
      env: cleanEnv,
      pathToClaudeCodeExecutable: 'claude',  // Explicitly set the Claude CLI path
      ...(systemPrompt && { systemPrompt }),
      ...(allowedTools && { allowedTools: allowedTools.split(',').map(t => t.trim()) }),
      ...(mcpServers && Object.keys(mcpServers).length > 0 && { mcpServers }),
      ...(this.#sessionId && { resume: this.#sessionId }),
    };

    /** @type {RunResult} */
    const result = { status: 'failed', sessionId: null, usage: null, model: null, totalCostUsd: null };

    const usage = {
      input_tokens: 0, output_tokens: 0,
      cache_creation_tokens: 0, cache_read_tokens: 0,
    };

    let q;
    try {
      q = query({ prompt, options: queryOptions });
    } catch (err) {
      throw new Error(`Failed to start Claude agent query: ${err?.message}`);
    }

    try {
      for await (const msg of q) {
        if (msg?.type) {
          onEvent?.(msg.type, msg);
          sessionLog?.info({ type: msg.type, runId }, 'Agent event');
        }

        // Capture session ID from init
        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          this.#sessionId = msg.session_id;
          result.sessionId = msg.session_id;
          if (msg.model) result.model = msg.model;
        }

        // Accumulate usage from assistant message events.
        // Note: the SDK emits type='assistant' (not 'message' — that was the raw Claude CLI
        // stream-json format). The inner message object is the Anthropic API BetaMessage.
        if (msg.type === 'assistant' && msg.message?.usage) {
          const u = msg.message.usage;
          usage.input_tokens          += u.input_tokens ?? 0;
          usage.output_tokens         += u.output_tokens ?? 0;
          usage.cache_creation_tokens += u.cache_creation_input_tokens ?? u.cache_creation_tokens ?? 0;
          usage.cache_read_tokens     += u.cache_read_input_tokens ?? u.cache_read_tokens ?? 0;
        }

        // Capture model from assistant events (BetaMessage carries model field)
        if (msg.type === 'assistant' && msg.message?.model && !result.model) {
          result.model = msg.message.model;
        }

        // Rate-limit detection
        if (msg.type === 'error' && msg.status === 429) {
          const retryAfterMs = msg.retry_after_ms ?? 60_000;
          this.#opts.rateLimiter?.recordLimit('claude-api', retryAfterMs);
          sessionLog?.info({ retryAfterMs }, 'Rate limit detected');
          onEvent?.('run.rate-limited', { runId, retryAfterMs });
        }

        // Final result event
        if (msg.type === 'result') {
          result.status = 'completed';
          // Only trust SDK's total_cost_usd when it's actually non-zero (it initialises to 0).
          if (typeof msg.total_cost_usd === 'number' && msg.total_cost_usd > 0) {
            result.totalCostUsd = msg.total_cost_usd;
          }
          if (msg.usage) {
            const u = msg.usage;
            usage.input_tokens          += u.input_tokens ?? 0;
            usage.output_tokens         += u.output_tokens ?? 0;
            usage.cache_creation_tokens += u.cache_creation_input_tokens ?? u.cache_creation_tokens ?? 0;
            usage.cache_read_tokens     += u.cache_read_input_tokens ?? u.cache_read_tokens ?? 0;
          }
          // Fallback: SDK result.modelUsage has camelCase per-model totals.
          // Use it when usage tokens are still 0 (e.g. subscription billing mode).
          if (usage.input_tokens === 0 && msg.modelUsage && typeof msg.modelUsage === 'object') {
            let fallbackCost = 0;
            for (const mu of Object.values(msg.modelUsage)) {
              usage.input_tokens          += mu.inputTokens ?? 0;
              usage.output_tokens         += mu.outputTokens ?? 0;
              usage.cache_creation_tokens += mu.cacheCreationInputTokens ?? 0;
              usage.cache_read_tokens     += mu.cacheReadInputTokens ?? 0;
              fallbackCost                += mu.costUSD ?? 0;
              // Capture model name from the modelUsage key if not already set
              if (!result.model) result.model = Object.keys(msg.modelUsage)[0] ?? null;
            }
            if (fallbackCost > 0 && result.totalCostUsd == null) result.totalCostUsd = fallbackCost;
          }
          sessionLog?.info({ stopReason: msg.stop_reason, numTurns: msg.num_turns, costUsd: result.totalCostUsd, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }, 'Agent result');
        }
      }
    } catch (streamErr) {
      console.error('[agent-runner] stream error caught:', streamErr?.message);
      throw new Error(`Agent stream error: ${streamErr?.message}`);
    }

    result.usage = usage;
    return result;
  }
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    }, { once: true });
  });
}
