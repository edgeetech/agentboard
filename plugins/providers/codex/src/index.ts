import type { ProviderManifest } from "../../../../packages/plugin-sdk/src/provider.ts";

export const codexProviderManifest = {
  id: "codex",
  displayName: "Codex",
  version: "0.1.0",
  runtime: { command: "codex" },
  capabilities: {
    streamingEvents: true,
    resume: "interactive",
    usage: "cost",
    tools: ["Read", "Edit", "Bash", "Grep", "Glob"],
  },
  enforcement: {
    enforced: [
      "cwd",
      "mcpServerNames",
      "abortSignal",
      "rateLimitBackoff",
      "filesystemSandbox",
    ],
    intentionallyIgnored: [
      "maxTurns",
      "allowedTools",
      "hooksEnabled",
      "approvalMode",
    ],
    notes: [
      "Legacy Codex runner launches with workspace-write sandboxing and fixed approve-for-me automation.",
      "Requested approvalMode is intentionally ignored until provider-specific approval mapping is implemented.",
    ],
  },
} as const satisfies ProviderManifest;
