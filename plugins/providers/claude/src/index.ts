import type { ProviderManifest } from "../../../../packages/plugin-sdk/src/provider.ts";

export const claudeProviderManifest = {
  id: "claude",
  displayName: "Claude",
  version: "0.1.0",
  runtime: { command: "claude" },
  capabilities: {
    streamingEvents: true,
    resume: "interactive",
    usage: "cost",
    tools: ["Read", "Edit", "Bash", "Grep", "Glob"],
  },
  enforcement: {
    enforced: [
      "cwd",
      "maxTurns",
      "allowedTools",
      "mcpServerNames",
      "hooksEnabled",
      "abortSignal",
      "rateLimitBackoff",
      "approvalMode",
    ],
    intentionallyIgnored: ["filesystemSandbox"],
    notes: [
      "Legacy Claude runner receives cwd, maxTurns, allowedTools, hooks and abort signal.",
      "Filesystem sandboxing is not enforced until provider execution moves out of the legacy core.",
    ],
  },
} as const satisfies ProviderManifest;
