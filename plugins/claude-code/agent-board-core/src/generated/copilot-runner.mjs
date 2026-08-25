// packages/plugin-sdk/src/runtime.ts
var ProviderTimeoutError = class extends Error {
  constructor(ms) {
    super(`Turn timed out after ${ms}ms`);
    this.name = "TimeoutError";
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
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
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
        controller.signal.addEventListener("abort", rejectWithReason, {
          once: true
        });
      })
    ]);
  } finally {
    clearTimer();
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

// plugins/providers/copilot/src/runner.ts
var DEFAULT_TURN_TIMEOUT_MS = parseInt(
  globalThis.process?.env?.AGENTBOARD_TURN_TIMEOUT_MS ?? "900000",
  10
);
var dynamicImport = new Function("specifier", "return import(specifier)");
async function loadDefaultCopilotSdk() {
  return await dynamicImport("@github/copilot-sdk");
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
      cache_read_tokens: 0
    }
  };
  constructor(opts) {
    this.opts = opts;
  }
  async run() {
    const { abortController, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS } = this.opts;
    const timeoutState = { timedOut: false };
    if (abortController.signal.aborted) {
      return { status: "cancelled", error: "Aborted before start" };
    }
    if (this.opts.rateLimiter?.isLimited("copilot-api") === true) {
      const info = this.opts.rateLimiter.getInfo("copilot-api");
      const waitMs = info.retryAfterMs ?? 5e3;
      this.opts.sessionLog?.info({ waitMs }, "Rate limited \u2014 waiting");
      await delay(waitMs, abortController.signal);
    }
    try {
      const result = await withProviderTurnTimeout(
        async (turnSignal) => {
          const markTimeout = () => {
            const reason = turnSignal.reason;
            if (reason instanceof Error && reason.name === "TimeoutError") {
              timeoutState.timedOut = true;
            }
          };
          if (turnSignal.aborted) {
            markTimeout();
          } else {
            turnSignal.addEventListener("abort", markTimeout, { once: true });
          }
          try {
            return await this.executeSession(turnSignal);
          } finally {
            turnSignal.removeEventListener("abort", markTimeout);
          }
        },
        turnTimeoutMs,
        abortController.signal
      );
      this.opts.rateLimiter?.recordSuccess("copilot-api");
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.sessionLog?.error(
        { error: error.message },
        "CopilotRunner failed"
      );
      const isAborted = checkAborted(abortController.signal);
      const isTimeout = timeoutState.timedOut || error.name === "TimeoutError" || /timed out after \d+ms/i.test(error.message);
      return {
        status: isAborted && !isTimeout ? "cancelled" : "failed",
        error: error.message,
        errorKind: isTimeout ? "timeout" : "error",
        sessionId: this.sessionId,
        model: this.partial.model,
        totalCostUsd: this.partial.totalCostUsd,
        usage: this.partial.usage
      };
    }
  }
  async executeSession(turnSignal) {
    const { CopilotClient, approveAll } = await (this.opts.loadCopilotSdk ?? loadDefaultCopilotSdk)();
    const {
      prompt,
      systemPrompt,
      cwd,
      mcpServers,
      abortController,
      runId,
      onEvent,
      sessionLog,
      turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS
    } = this.opts;
    const usage = this.partial.usage;
    const result = {
      status: "failed",
      sessionId: null,
      model: null,
      totalCostUsd: null
    };
    const copilotMcpServers = normalizeMcpServers(mcpServers);
    const client = new CopilotClient();
    let session;
    const onAbort = () => {
      session?.abort().catch(() => {
      });
    };
    abortController.signal.addEventListener("abort", onAbort);
    turnSignal.addEventListener("abort", onAbort);
    try {
      const sessionConfig = {
        workingDirectory: cwd,
        onPermissionRequest: approveAll,
        onEvent: (event) => {
          onEvent?.(event.type, event);
          sessionLog?.info({ type: event.type, runId }, "Copilot event");
          if (isModelChangeEvent(event)) {
            const m = event.data.newModel;
            if (m !== "auto" && result.model === null) {
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
              "Copilot session.error"
            );
          }
        }
      };
      if (systemPrompt) {
        sessionConfig.systemMessage = {
          mode: "replace",
          content: systemPrompt
        };
      }
      if (copilotMcpServers !== void 0 && Object.keys(copilotMcpServers).length > 0) {
        sessionConfig.mcpServers = copilotMcpServers;
      }
      session = await client.createSession(sessionConfig);
      this.sessionId = session.sessionId;
      result.sessionId = session.sessionId;
      await session.sendAndWait({ prompt }, turnTimeoutMs);
      result.status = "completed";
    } finally {
      abortController.signal.removeEventListener("abort", onAbort);
      turnSignal.removeEventListener("abort", onAbort);
      try {
        await session?.disconnect();
      } catch (e) {
        sessionLog?.warn?.(
          { error: e instanceof Error ? e.message : String(e) },
          "session.disconnect failed"
        );
      }
      try {
        await client.stop();
      } catch (e) {
        sessionLog?.warn?.(
          { error: e instanceof Error ? e.message : String(e) },
          "client.stop failed"
        );
      }
    }
    result.usage = usage;
    return result;
  }
};
function normalizeMcpServers(mcpServers) {
  const out = {};
  for (const [name, rawCfg] of Object.entries(mcpServers)) {
    if (rawCfg === null || rawCfg === void 0 || typeof rawCfg !== "object")
      continue;
    const cfg = rawCfg;
    const tools = Array.isArray(cfg.tools) && cfg.tools.length > 0 ? cfg.tools.map(String) : ["*"];
    if (cfg.type === "http" || cfg.type === "sse") {
      const url = cfg.url ?? "";
      out[name] = {
        type: "http",
        url,
        ...cfg.headers !== void 0 ? { headers: cfg.headers } : {},
        tools
      };
    } else if (cfg.command) {
      out[name] = {
        type: "stdio",
        command: cfg.command,
        args: (cfg.args ?? []).map(String),
        ...cfg.env !== void 0 ? { env: cfg.env } : {},
        ...cfg.cwd !== void 0 ? { cwd: cfg.cwd } : {},
        tools
      };
    }
  }
  return Object.keys(out).length > 0 ? out : void 0;
}
function isModelChangeEvent(event) {
  return event.type === "session.model_change";
}
function isUsageEvent(event) {
  return event.type === "assistant.usage";
}
function isErrorEvent(event) {
  return event.type === "session.error";
}
function checkAborted(signal) {
  return signal.aborted;
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        },
        { once: true }
      );
    }
  });
}
export {
  CopilotRunner
};
