import type { HostIntegrationManifest } from "../../../../packages/plugin-sdk/src/host.ts";

export const codexHostManifest = {
  id: "codex",
  displayName: "Codex",
  version: "0.1.0",
  status: "legacy-active",
  legacyPath: "plugins/codex",
  targetPath: "plugins/hosts/codex",
  responsibilities: [
    "launch-server",
    "reuse-server",
    "install-hooks",
    "open-ui",
  ],
  notes: [
    "Current Codex host delegates to the Claude Code shared server bootstrap until packaging is migrated.",
  ],
} as const satisfies HostIntegrationManifest;
