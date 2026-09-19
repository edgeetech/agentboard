import type { HostIntegrationManifest } from "../../../../packages/plugin-sdk/src/host.ts";

export const copilotHostManifest = {
  id: "copilot",
  displayName: "GitHub Copilot",
  version: "0.1.0",
  status: "legacy-active",
  legacyPath: "plugins/copilot",
  targetPath: "plugins/hosts/copilot",
  responsibilities: ["expose-commands", "install-hooks", "open-ui"],
  notes: [
    "Current Copilot host installer remains in plugins/copilot until packaging is migrated.",
  ],
} as const satisfies HostIntegrationManifest;
