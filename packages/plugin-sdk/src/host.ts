export const HOST_INTEGRATION_RESPONSIBILITIES = [
  "launch-server",
  "reuse-server",
  "expose-commands",
  "install-hooks",
  "proxy-mcp",
  "open-ui",
] as const;

export type HostIntegrationResponsibility =
  (typeof HOST_INTEGRATION_RESPONSIBILITIES)[number];

export interface HostIntegrationManifest {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly status: "legacy-active" | "target-scaffold" | "migrated";
  readonly legacyPath?: string;
  readonly targetPath: string;
  readonly responsibilities: readonly HostIntegrationResponsibility[];
  readonly notes: readonly string[];
}

export interface HostIntegrationManifestValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateHostIntegrationManifest(
  manifest: HostIntegrationManifest,
): HostIntegrationManifestValidation {
  const errors: string[] = [];
  if (manifest.id.trim().length === 0) errors.push("manifest.id is required");
  if (manifest.displayName.trim().length === 0) {
    errors.push("manifest.displayName is required");
  }
  if (manifest.version.trim().length === 0) {
    errors.push("manifest.version is required");
  }
  if (manifest.targetPath.trim().length === 0) {
    errors.push("manifest.targetPath is required");
  }
  if (
    manifest.status === "legacy-active" &&
    (manifest.legacyPath === undefined ||
      manifest.legacyPath.trim().length === 0)
  ) {
    errors.push("legacy-active host manifests must declare legacyPath");
  }

  const knownResponsibilities = new Set<string>(
    HOST_INTEGRATION_RESPONSIBILITIES,
  );
  for (const responsibility of manifest.responsibilities) {
    if (!knownResponsibilities.has(responsibility)) {
      errors.push(`unknown host responsibility: ${responsibility}`);
    }
  }
  if (manifest.responsibilities.length === 0) {
    errors.push("manifest.responsibilities must not be empty");
  }

  return { ok: errors.length === 0, errors };
}
