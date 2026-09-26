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

// plugins/providers/claude/src/runner.ts
var DEFAULT_TURN_TIMEOUT_MS = parseInt(
  globalThis.process?.env?.AGENTBOARD_TURN_TIMEOUT_MS ?? '900000',
  10,
);
function classifyClaudeRateLimitEvent(msg) {
  if (msg === null || typeof msg !== 'object') return null;
  const obj = msg;
  if (obj.type === 'rate_limit_event') {
    const info = obj.rate_limit_info;
    if (info === null || typeof info !== 'object') return null;
    const infoObj = info;
    if (infoObj.status !== 'rejected') return null;
    const resetsAtMs = typeof infoObj.resetsAt === 'number' ? infoObj.resetsAt : null;
    return {
      resetsAt: resetsAtMs !== null ? new Date(resetsAtMs).toISOString() : null,
      retryAfterMs: resetsAtMs !== null ? Math.max(0, resetsAtMs - Date.now()) : null,
    };
  }
  if (obj.type === 'system' && obj.subtype === 'api_retry') {
    const retryMs = typeof obj.retry_delay_ms === 'number' ? obj.retry_delay_ms : null;
    const status = typeof obj.error_status === 'number' ? obj.error_status : null;
    if (status !== 429 && retryMs === null) return null;
    return { resetsAt: null, retryAfterMs: retryMs ?? 6e4 };
  }
  return null;
}
function classifyClaudeResultError(msg) {
  if (msg === null || typeof msg !== 'object') return null;
  const obj = msg;
  if (obj.type !== 'result' || obj.is_error !== true) return null;
  const text = [obj.result, ...(Array.isArray(obj.errors) ? obj.errors : [])]
    .filter((part) => typeof part === 'string')
    .join(' ');
  const status = typeof obj.api_error_status === 'number' ? obj.api_error_status : null;
  if (!/usage limit|rate limit|try again/i.test(text) && status !== 429) return null;
  const match = /try again(?: at| after)?\s+([^.,;]+)/i.exec(text);
  const resetsAt = match?.[1] !== void 0 ? tryParseFutureDate(match[1]) : null;
  return { resetsAt, retryAfterMs: resetsAt === null ? 6e4 : null };
}
function tryParseFutureDate(text) {
  const parsed = Date.parse(text.trim());
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
var AgentRunner = class {
  opts;
  sessionId = null;
  /** Partial state captured during streaming, surfaced on timeout/abort so cost/usage are not lost. */
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
    const timeoutState = { timedOut: false };
    if (abortController.signal.aborted) {
      return { status: 'cancelled', error: 'Aborted before start' };
    }
    if (this.opts.rateLimiter?.isLimited('claude-api') === true) {
      const info = this.opts.rateLimiter.getInfo('claude-api');
      const waitMs = info.retryAfterMs ?? 5e3;
      this.opts.sessionLog?.info({ waitMs }, 'Rate limited \u2014 waiting');
      await delay(waitMs, abortController.signal);
    }
    try {
      const result = await withProviderTurnTimeout(
        async (turnSignal) => {
          const markTimeout = () => {
            const reason = turnSignal.reason;
            if (reason instanceof Error && reason.name === 'TimeoutError') {
              timeoutState.timedOut = true;
            }
          };
          if (turnSignal.aborted) {
            markTimeout();
          } else {
            turnSignal.addEventListener('abort', markTimeout, { once: true });
          }
          try {
            return await this.executeTurn(turnSignal);
          } finally {
            turnSignal.removeEventListener('abort', markTimeout);
          }
        },
        turnTimeoutMs,
        abortController.signal,
      );
      this.opts.rateLimiter?.recordSuccess('claude-api');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error({ error: error.message }, 'AgentRunner failed');
      const isAborted = checkAborted(abortController.signal);
      const isTimeout =
        timeoutState.timedOut ||
        error.name === 'TimeoutError' ||
        /Turn timed out after \d+ms/.test(error.message);
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
  async executeTurn(turnSignal) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const queryAbortController = new AbortController();
    const abortQuery = () => queryAbortController.abort(turnSignal.reason);
    if (turnSignal.aborted) {
      abortQuery();
    } else {
      turnSignal.addEventListener('abort', abortQuery, { once: true });
    }
    const {
      prompt,
      systemPrompt,
      cwd,
      maxTurns,
      allowedTools,
      mcpServers,
      runId,
      onEvent,
      sessionLog,
    } = this.opts;
    const cleanEnv = { ...this.opts.env };
    delete cleanEnv.CLAUDECODE;
    const claudeExecutablePath =
      this.opts.claudeExecutablePath ?? globalThis.process?.env?.AGENTBOARD_CLAUDE_PATH;
    const queryOptions = {
      cwd,
      maxTurns,
      abortController: queryAbortController,
      permissionMode: 'acceptEdits',
      env: cleanEnv,
      // Left unset unless explicitly configured — hardcoding "claude" here broke
      // npm `claude.cmd` installs on Windows and skipped the SDK's own bundled
      // binary resolution.
      ...(claudeExecutablePath !== void 0 && claudeExecutablePath !== ''
        ? { pathToClaudeCodeExecutable: claudeExecutablePath }
        : {}),
      ...(systemPrompt && { systemPrompt }),
      ...(allowedTools && {
        allowedTools: allowedTools.split(',').map((tool) => tool.trim()),
      }),
      ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
      ...(this.opts.hooks !== void 0 &&
        Object.keys(this.opts.hooks).length > 0 && { hooks: this.opts.hooks }),
      ...(this.sessionId !== null && { resume: this.sessionId }),
    };
    const result = {
      status: 'failed',
      sessionId: null,
      model: null,
      totalCostUsd: null,
    };
    const usage = this.partial.usage;
    let pendingRateLimit = null;
    let q;
    try {
      q = query({ prompt, options: queryOptions });
    } catch (err) {
      turnSignal.removeEventListener('abort', abortQuery);
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Failed to start Claude agent query: ${error.message}`);
    }
    try {
      for await (const msg of q) {
        onEvent?.(msg.type, msg);
        let snippet = null;
        if (msg.type === 'assistant') {
          const content = msg.message.content;
          if (content.length > 0) {
            const parts = [];
            for (const contentBlock of content) {
              if (contentBlock.type === 'text') {
                const text = contentBlock;
                parts.push(`text=${text.text.slice(0, 400)}`);
              } else if (contentBlock.type === 'tool_use') {
                const toolUse = contentBlock;
                parts.push(
                  `tool=${toolUse.name} input=${JSON.stringify(toolUse.input).slice(0, 200)}`,
                );
              }
            }
            if (parts.length > 0) snippet = parts.join(' | ');
          }
        } else if (msg.type === 'user') {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const contentBlock of content) {
              if (contentBlock.type === 'tool_result') {
                const toolResult = contentBlock;
                const text = Array.isArray(toolResult.content)
                  ? toolResult.content.map((part) => part.text ?? '').join('')
                  : String(toolResult.content ?? '');
                snippet = `tool_result is_error=${String(!!toolResult.is_error)} text=${text.slice(0, 300)}`;
                break;
              }
            }
          }
        }
        sessionLog?.info(
          { type: msg.type, runId, ...(snippet !== null ? { snippet } : {}) },
          'Agent event',
        );
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sessionId = msg.session_id;
          result.sessionId = msg.session_id;
          result.model = msg.model;
          this.partial.model = msg.model;
          result.authSource = msg.apiKeySource ?? null;
        }
        if (msg.type === 'assistant') {
          const messageUsage = msg.message.usage;
          if (messageUsage !== void 0) {
            usage.input_tokens += messageUsage.input_tokens ?? 0;
            usage.output_tokens += messageUsage.output_tokens ?? 0;
            usage.cache_creation_tokens +=
              messageUsage.cache_creation_input_tokens ?? messageUsage.cache_creation_tokens ?? 0;
            usage.cache_read_tokens +=
              messageUsage.cache_read_input_tokens ?? messageUsage.cache_read_tokens ?? 0;
          }
          const betaModel = msg.message.model;
          if (betaModel !== void 0 && result.model === null) {
            result.model = betaModel;
            this.partial.model = betaModel;
          }
        }
        const raw = msg;
        if (raw.type === 'error' && raw.status === 429) {
          const retryAfterMs = raw.retry_after_ms ?? 6e4;
          this.opts.rateLimiter?.recordLimit('claude-api', retryAfterMs);
          pendingRateLimit = { resetsAt: null, retryAfterMs };
          sessionLog?.info({ retryAfterMs }, 'Rate limit detected');
          onEvent?.('run.rate-limited', { runId, retryAfterMs });
        }
        const rateLimitEvent = classifyClaudeRateLimitEvent(msg);
        if (rateLimitEvent !== null) {
          this.opts.rateLimiter?.recordLimit('claude-api', rateLimitEvent.retryAfterMs ?? void 0);
          pendingRateLimit = rateLimitEvent;
          sessionLog?.info({ rateLimitEvent }, 'Rate limit signal detected');
          onEvent?.('run.rate-limited', {
            runId,
            retryAfterMs: rateLimitEvent.retryAfterMs,
            resetsAt: rateLimitEvent.resetsAt,
          });
        }
        if (msg.type === 'result') {
          if (msg.is_error) {
            const resultRateLimit = classifyClaudeResultError(msg) ?? pendingRateLimit;
            if (resultRateLimit !== null) {
              result.errorKind = 'rate_limit';
              result.resetsAt = resultRateLimit.resetsAt;
              this.opts.rateLimiter?.recordLimit(
                'claude-api',
                resultRateLimit.retryAfterMs ?? void 0,
              );
            } else {
              result.errorKind = 'error';
            }
            result.status = 'failed';
            result.error =
              typeof msg.result === 'string' ? msg.result : 'claude result reported is_error=true';
          } else {
            result.status = 'completed';
          }
          if (msg.total_cost_usd > 0) {
            result.totalCostUsd = msg.total_cost_usd;
            this.partial.totalCostUsd = msg.total_cost_usd;
          }
          const resultUsage = msg.usage;
          if (resultUsage !== void 0) {
            usage.input_tokens += resultUsage.input_tokens ?? 0;
            usage.output_tokens += resultUsage.output_tokens ?? 0;
            usage.cache_creation_tokens +=
              resultUsage.cache_creation_input_tokens ?? resultUsage.cache_creation_tokens ?? 0;
            usage.cache_read_tokens +=
              resultUsage.cache_read_input_tokens ?? resultUsage.cache_read_tokens ?? 0;
          }
          if (usage.input_tokens === 0) {
            let fallbackCost = 0;
            for (const [key, modelUsage] of Object.entries(msg.modelUsage)) {
              usage.input_tokens += modelUsage.inputTokens;
              usage.output_tokens += modelUsage.outputTokens;
              usage.cache_creation_tokens += modelUsage.cacheCreationInputTokens;
              usage.cache_read_tokens += modelUsage.cacheReadInputTokens;
              fallbackCost += modelUsage.costUSD;
              if (result.model === null) result.model = key;
            }
            if (fallbackCost > 0 && result.totalCostUsd === null) {
              result.totalCostUsd = fallbackCost;
              this.partial.totalCostUsd = fallbackCost;
            }
          }
          sessionLog?.info(
            {
              stopReason: msg.stop_reason,
              numTurns: msg.num_turns,
              costUsd: result.totalCostUsd,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
            },
            'Agent result',
          );
        }
      }
    } catch (streamErr) {
      turnSignal.removeEventListener('abort', abortQuery);
      const err = streamErr instanceof Error ? streamErr : new Error(String(streamErr));
      console.error('[agent-runner] stream error caught:', err.message);
      throw new Error(`Agent stream error: ${err.message}`);
    }
    turnSignal.removeEventListener('abort', abortQuery);
    result.usage = usage;
    return result;
  }
};
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

// plugins/providers/claude/src/index.ts
var claudeProviderManifest = {
  id: 'claude',
  displayName: 'Claude',
  version: '0.1.0',
  runtime: { command: 'claude' },
  capabilities: {
    streamingEvents: true,
    resume: 'interactive',
    usage: 'cost',
    tools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
  },
  enforcement: {
    enforced: [
      'cwd',
      'maxTurns',
      'allowedTools',
      'mcpServerNames',
      'hooksEnabled',
      'abortSignal',
      'rateLimitBackoff',
      'approvalMode',
    ],
    intentionallyIgnored: ['filesystemSandbox'],
    notes: [
      'Legacy Claude runner receives cwd, maxTurns, allowedTools, hooks and abort signal.',
      'Filesystem sandboxing is not enforced until provider execution moves out of the legacy core.',
    ],
  },
};
function createClaudeProviderAdapter(args) {
  return {
    manifest: claudeProviderManifest,
    provider: claudeProviderManifest.id,
    enforcement: claudeProviderManifest.enforcement,
    resume: {
      interactive: true,
      command: (sessionId, repoPath) =>
        args.buildResumeCommand(claudeProviderManifest.id, sessionId, repoPath),
    },
    async run(ctx) {
      const runner = new args.Runner(ctx);
      const result = await runner.run();
      return {
        ...result,
        sessionRef:
          typeof result.sessionId === 'string' && result.sessionId.length > 0
            ? {
                provider: claudeProviderManifest.id,
                sessionId: result.sessionId,
              }
            : null,
      };
    },
  };
}
export { AgentRunner, claudeProviderManifest, createClaudeProviderAdapter };
