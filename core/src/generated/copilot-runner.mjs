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
var ProviderToolDeniedError = class extends Error {
  tool;
  target;
  constructor(attempt, reason) {
    super(
      `tool denied by agentboard policy: ${attempt.tool}${attempt.target ? ` (${attempt.target.slice(0, 200)})` : ''}${reason ? ` \u2014 ${reason}` : ''}`,
    );
    this.name = 'ProviderToolDeniedError';
    this.tool = attempt.tool;
    this.target = attempt.target;
  }
};
async function evaluateProviderToolAttempt(gate, attempt) {
  if (gate === void 0) return { decision: 'allow', reason: null };
  try {
    const result = await gate(attempt);
    if (result.decision === 'block')
      return { decision: 'block', reason: result.reason ?? 'blocked by policy' };
    if (result.decision === 'allow') return { decision: 'allow', reason: null };
    return {
      decision: 'block',
      reason: 'tool gate returned an unrecognised decision \u2014 denying',
    };
  } catch (err) {
    return {
      decision: 'block',
      reason: `tool gate evaluation failed \u2014 denying: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// plugins/providers/copilot/src/runner.ts
var DEFAULT_TURN_TIMEOUT_MS = parseInt(
  globalThis.process?.env?.AGENTBOARD_TURN_TIMEOUT_MS ?? '900000',
  10,
);
var dynamicImport = new Function('specifier', 'return import(specifier)');
async function loadDefaultCopilotSdk() {
  return await dynamicImport('@github/copilot-sdk');
}
var CopilotRunner = class {
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
    const timeoutState = { timedOut: false };
    if (abortController.signal.aborted) {
      return { status: 'cancelled', error: 'Aborted before start' };
    }
    if (this.opts.rateLimiter?.isLimited('copilot-api') === true) {
      const info = this.opts.rateLimiter.getInfo('copilot-api');
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
            return await this.executeSession(turnSignal);
          } finally {
            turnSignal.removeEventListener('abort', markTimeout);
          }
        },
        turnTimeoutMs,
        abortController.signal,
      );
      this.opts.rateLimiter?.recordSuccess('copilot-api');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error({ error: error.message }, 'CopilotRunner failed');
      const isAborted = checkAborted(abortController.signal);
      const isTimeout =
        timeoutState.timedOut ||
        error.name === 'TimeoutError' ||
        /timed out after \d+ms/i.test(error.message);
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
  async executeSession(turnSignal) {
    const { CopilotClient, approveAll } = await (
      this.opts.loadCopilotSdk ?? loadDefaultCopilotSdk
    )();
    const {
      prompt,
      systemPrompt,
      cwd,
      mcpServers,
      abortController,
      runId,
      onEvent,
      sessionLog,
      turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
    } = this.opts;
    const usage = this.partial.usage;
    const result = {
      status: 'failed',
      sessionId: null,
      model: null,
      totalCostUsd: null,
    };
    const copilotMcpServers = normalizeMcpServers(mcpServers);
    const clientOptions = buildCopilotClientOptions(this.opts.env, this.opts.authMode);
    const client = new CopilotClient(clientOptions);
    let session;
    let rateLimitHit = null;
    const onAbort = () => {
      session?.abort().catch(() => {});
    };
    abortController.signal.addEventListener('abort', onAbort);
    turnSignal.addEventListener('abort', onAbort);
    let denial = null;
    const gateChecks = [];
    const enforceToolAttempt = (attempt) => {
      gateChecks.push(
        (async () => {
          if (denial !== null) return;
          const verdict = await evaluateProviderToolAttempt(this.opts.toolGate, attempt);
          if (verdict.decision === 'block' && denial === null) {
            denial = new ProviderToolDeniedError(attempt, verdict.reason);
            sessionLog?.error(
              {
                runId,
                tool: attempt.tool,
                target: attempt.target.slice(0, 200),
                reason: verdict.reason,
              },
              'Copilot tool denied by policy \u2014 aborting run',
            );
            onEvent?.('run.tool-denied', {
              tool: attempt.tool,
              target: attempt.target,
              reason: verdict.reason,
            });
            onAbort();
          }
        })(),
      );
    };
    const permissionHandler = (request, invocation) => {
      if (denial !== null) return { kind: 'reject', feedback: denial.message };
      return approveAll(request, invocation);
    };
    try {
      const sessionConfig = {
        workingDirectory: cwd,
        onPermissionRequest: permissionHandler,
        onEvent: (event) => {
          onEvent?.(event.type, event);
          sessionLog?.info({ type: event.type, runId }, 'Copilot event');
          const attempt = extractCopilotToolAttempt(event);
          if (attempt !== null) enforceToolAttempt(attempt);
          if (isModelChangeEvent(event)) {
            const m = event.data.newModel;
            if (m !== 'auto' && result.model === null) {
              result.model = m;
              this.partial.model = m;
            }
          }
          if (isUsageEvent(event)) {
            const d = event.data;
            result.model = d.model;
            this.partial.model = d.model;
            usage.input_tokens += d.inputTokens ?? 0;
            usage.output_tokens += d.outputTokens ?? 0;
            usage.cache_creation_tokens += d.cacheWriteTokens ?? 0;
            usage.cache_read_tokens += d.cacheReadTokens ?? 0;
          }
          if (isErrorEvent(event)) {
            sessionLog?.error(
              { msg: event.data.message, errorType: event.data.errorType },
              'Copilot session.error',
            );
            const signal = classifyCopilotRateLimit(event);
            if (signal !== null && rateLimitHit === null) {
              rateLimitHit = signal;
              this.opts.rateLimiter?.recordLimit('copilot-api', signal.retryAfterMs ?? void 0);
              onEvent?.('run.rate-limited', {
                runId,
                retryAfterMs: signal.retryAfterMs,
                resetsAt: signal.resetsAt,
              });
              onAbort();
            }
          }
        },
      };
      if (systemPrompt) {
        sessionConfig.systemMessage = {
          mode: 'replace',
          content: systemPrompt,
        };
      }
      if (copilotMcpServers !== void 0 && Object.keys(copilotMcpServers).length > 0) {
        sessionConfig.mcpServers = copilotMcpServers;
      }
      if (this.opts.excludedTools !== void 0 && this.opts.excludedTools.length > 0) {
        sessionConfig.excludedTools = [...this.opts.excludedTools];
      }
      session = await client.createSession(sessionConfig);
      this.sessionId = session.sessionId;
      result.sessionId = session.sessionId;
      try {
        await session.sendAndWait({ prompt }, turnTimeoutMs);
      } catch (err) {
        if (rateLimitHit === null) throw err;
      }
      await Promise.allSettled(gateChecks);
      if (denial !== null) throw denial;
      if (rateLimitHit !== null) {
        const signal = rateLimitHit;
        result.status = 'failed';
        result.errorKind = 'rate_limit';
        result.resetsAt = signal.resetsAt;
        result.error = 'copilot usage limit reached';
      } else {
        result.status = 'completed';
      }
    } finally {
      abortController.signal.removeEventListener('abort', onAbort);
      turnSignal.removeEventListener('abort', onAbort);
      try {
        await session?.disconnect();
      } catch (e) {
        sessionLog?.warn?.(
          { error: e instanceof Error ? e.message : String(e) },
          'session.disconnect failed',
        );
      }
      try {
        await client.stop();
      } catch (e) {
        sessionLog?.warn?.(
          { error: e instanceof Error ? e.message : String(e) },
          'client.stop failed',
        );
      }
    }
    result.usage = usage;
    return result;
  }
};
function buildCopilotClientOptions(env, authMode) {
  const options = {
    ...(env !== void 0 ? { env } : {}),
  };
  if (authMode === 'subscription') {
    options.useLoggedInUser = true;
    return options;
  }
  if (authMode === 'api_key') {
    const token = env?.COPILOT_GITHUB_TOKEN ?? env?.GH_TOKEN ?? env?.GITHUB_TOKEN;
    if (token === void 0 || token === '') {
      throw new Error(
        'copilot auth_mode=api_key requires COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN to be set',
      );
    }
    options.gitHubToken = token;
    options.useLoggedInUser = false;
  }
  return options;
}
function classifyCopilotRateLimit(event) {
  const { message, errorType } = event.data;
  const text = `${message ?? ''} ${errorType ?? ''}`;
  if (!/usage limit|rate limit|rate.?limited|429/i.test(text)) return null;
  const match = /try again(?: at| after)?\s+([^.,;]+)/i.exec(text);
  const parsed = match?.[1] !== void 0 ? Date.parse(match[1].trim()) : NaN;
  const resetsAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  return { resetsAt, retryAfterMs: resetsAt === null ? 6e4 : null };
}
function extractCopilotToolAttempt(event) {
  const type = typeof event.type === 'string' ? event.type : '';
  if (!/tool/i.test(type)) return null;
  const data = typeof event.data === 'object' && event.data !== null ? event.data : event;
  const rawName =
    (typeof data.name === 'string' ? data.name : void 0) ??
    (typeof data.toolName === 'string' ? data.toolName : void 0) ??
    (typeof data.tool === 'string' ? data.tool : void 0);
  if (rawName === void 0) return null;
  const argsRaw = data.arguments ?? data.args ?? data.input ?? data.parameters;
  let args = {};
  if (typeof argsRaw === 'string') {
    try {
      args = JSON.parse(argsRaw);
    } catch {
      args = { command: argsRaw };
    }
  } else if (typeof argsRaw === 'object' && argsRaw !== null) {
    args = argsRaw;
  }
  const commandRaw = args.command ?? args.cmd ?? args.script;
  const command = Array.isArray(commandRaw)
    ? commandRaw.map(String).join(' ')
    : typeof commandRaw === 'string'
      ? commandRaw
      : null;
  if (/^(shell|bash|run_in_terminal|terminal|exec)/i.test(rawName)) {
    return { tool: 'Bash', target: command ?? '' };
  }
  const path =
    (typeof args.path === 'string' ? args.path : void 0) ??
    (typeof args.file_path === 'string' ? args.file_path : void 0) ??
    '';
  if (/^(write|create|edit|str_replace|apply_patch)/i.test(rawName)) {
    return { tool: 'Edit', target: path };
  }
  if (command !== null) return { tool: 'Bash', target: command };
  return { tool: rawName, target: path };
}
function normalizeMcpServers(mcpServers) {
  const out = {};
  for (const [name, rawCfg] of Object.entries(mcpServers)) {
    if (rawCfg === null || rawCfg === void 0 || typeof rawCfg !== 'object') continue;
    const cfg = rawCfg;
    const tools = Array.isArray(cfg.tools) && cfg.tools.length > 0 ? cfg.tools.map(String) : ['*'];
    if (cfg.type === 'http' || cfg.type === 'sse') {
      const url = cfg.url ?? '';
      out[name] = {
        type: 'http',
        url,
        ...(cfg.headers !== void 0 ? { headers: cfg.headers } : {}),
        tools,
      };
    } else if (cfg.command) {
      out[name] = {
        type: 'stdio',
        command: cfg.command,
        args: (cfg.args ?? []).map(String),
        ...(cfg.env !== void 0 ? { env: cfg.env } : {}),
        ...(cfg.cwd !== void 0 ? { cwd: cfg.cwd } : {}),
        tools,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : void 0;
}
function isModelChangeEvent(event) {
  return event.type === 'session.model_change';
}
function isUsageEvent(event) {
  return event.type === 'assistant.usage';
}
function isErrorEvent(event) {
  return event.type === 'session.error';
}
function checkAborted(signal) {
  return signal.aborted;
}
function delay(ms, signal) {
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

// plugins/providers/copilot/src/index.ts
var copilotProviderManifest = {
  id: 'github_copilot',
  displayName: 'GitHub Copilot',
  version: '0.1.0',
  runtime: { command: 'gh', args: ['copilot'] },
  capabilities: {
    streamingEvents: true,
    resume: 'interactive',
    usage: 'tokens',
    tools: [],
  },
  enforcement: {
    enforced: ['cwd', 'allowedTools', 'mcpServerNames', 'abortSignal', 'rateLimitBackoff'],
    intentionallyIgnored: ['maxTurns', 'hooksEnabled', 'approvalMode', 'filesystemSandbox'],
    notes: [
      'Legacy Copilot runner uses approveAll and does not enforce maxTurns.',
      'Approval mode is intentionally ignored until Copilot-specific approval mapping is implemented.',
      'Tool policy is enforced at the runner boundary: session tool events are checked against the agentboard policy gate (fail-closed), a denial aborts the session, and native excludedTools are passed through when configured.',
    ],
  },
};
function createCopilotProviderAdapter(args) {
  return {
    manifest: copilotProviderManifest,
    provider: copilotProviderManifest.id,
    enforcement: copilotProviderManifest.enforcement,
    resume: {
      interactive: true,
      command: (sessionId, repoPath) =>
        args.buildResumeCommand(copilotProviderManifest.id, sessionId, repoPath),
    },
    async run(ctx) {
      const runner = new args.Runner(ctx);
      const result = await runner.run();
      return {
        ...result,
        sessionRef:
          typeof result.sessionId === 'string' && result.sessionId.length > 0
            ? {
                provider: copilotProviderManifest.id,
                sessionId: result.sessionId,
              }
            : null,
      };
    },
  };
}
export {
  CopilotRunner,
  copilotProviderManifest,
  createCopilotProviderAdapter,
  extractCopilotToolAttempt,
};
