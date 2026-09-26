import { platform } from "node:os";

const UNIVERSAL = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
] as const;
const POSIX = ["HOME", "USER", "SHELL", "TMPDIR"] as const;
const WINDOWS = [
  "USERPROFILE",
  "USERNAME",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "PATHEXT",
  "COMSPEC",
  "HOMEDRIVE",
  "HOMEPATH",
  "windir",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PSModulePath",
] as const;
const CLAUDE = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
] as const;
const COPILOT = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "COPILOT_TOKEN",
  "COPILOT_GITHUB_TOKEN",
  "COPILOT_CLI",
  "COPILOT_CLI_BINARY_VERSION",
  "COPILOT_RUN_APP",
  "COPILOT_AGENT_SESSION_ID",
  "COPILOT_HOME",
] as const;
const CODEX = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT",
  "CODEX_HOME",
  "CODEX_API_KEY",
] as const;

export interface CodexChildProcessEnvironmentPolicy {
  readonly inherit: false;
  readonly allowedKeys: readonly string[];
}

export function codexChildProcessEnvironmentPolicy(
  extraKeys: readonly string[] = [],
): CodexChildProcessEnvironmentPolicy {
  return {
    inherit: false,
    allowedKeys: [
      ...new Set([
        ...UNIVERSAL,
        ...CLAUDE,
        ...COPILOT,
        ...CODEX,
        ...extraKeys,
        ...(platform() === "win32" ? WINDOWS : POSIX),
      ]),
    ],
  };
}

export function buildCodexChildEnv(
  base: NodeJS.ProcessEnv = process.env,
  extraKeys: readonly string[] = [],
): Record<string, string> {
  const policy = codexChildProcessEnvironmentPolicy(extraKeys);
  const out: Record<string, string> = {};
  for (const key of policy.allowedKeys) {
    const value = base[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
