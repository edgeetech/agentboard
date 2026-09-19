import type { HostIntegrationManifest } from "../../../../packages/plugin-sdk/src/host.ts";

export const claudeCodeHostManifest = {
  id: "claude-code",
  displayName: "Claude Code",
  version: "0.1.0",
  status: "legacy-active",
  legacyPath: "plugins/claude-code",
  targetPath: "plugins/hosts/claude-code",
  responsibilities: [
    "launch-server",
    "reuse-server",
    "expose-commands",
    "install-hooks",
    "proxy-mcp",
    "open-ui",
  ],
  notes: [
    "Current implementation remains in plugins/claude-code until host packaging is migrated.",
  ],
} as const satisfies HostIntegrationManifest;
