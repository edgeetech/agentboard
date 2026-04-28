// No-op session logger stub. Matches the interface AgentRunner expects.
// Replace with a pino-backed implementation if structured per-run logs are needed.

export const sessionLogger = {
  createSessionLog: (_runId) => null,
  closeSessionLog: (_runId) => {},
};
