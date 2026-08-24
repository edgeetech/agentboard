import type { ProviderManifest } from "../../../../packages/plugin-sdk/src/provider.ts";

export const copilotProviderManifest = {
  id: "github_copilot",
  displayName: "GitHub Copilot",
  version: "0.1.0",
  runtime: { command: "gh", args: ["copilot"] },
  capabilities: {
    streamingEvents: true,
    resume: "interactive",
    usage: "tokens",
    tools: [],
  },
  enforcement: {
    enforced: ["cwd", "mcpServerNames", "abortSignal", "rateLimitBackoff"],
    intentionallyIgnored: [
      "maxTurns",
      "allowedTools",
      "hooksEnabled",
      "approvalMode",
      "filesystemSandbox",
    ],
    notes: [
      "Legacy Copilot runner uses approveAll and does not enforce maxTurns or allowedTools.",
      "Approval mode is intentionally ignored until Copilot-specific approval mapping is implemented.",
    ],
  },
} as const satisfies ProviderManifest;
