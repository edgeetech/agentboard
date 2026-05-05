// Build the environment passed to spawned `claude -p` subprocesses.
// Security: DO NOT spread process.env — that leaks AWS creds, GitHub tokens,
// SSH agent sockets, and any other ambient secrets to agent code that runs
// with --permission-mode acceptEdits and broad Bash access. Whitelist only
// what the Claude CLI actually needs.

import { platform } from 'node:os';

const UNIVERSAL: readonly string[] = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
const POSIX: readonly string[] = ['HOME', 'USER', 'SHELL', 'TMPDIR'];
const WINDOWS: readonly string[] = [
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'TEMP',
  'TMP',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'PATHEXT',
  'COMSPEC',
];
// Anthropic CLI auth — only what `claude` actually reads:
const CLAUDE: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CONFIG_DIR',
  'XDG_CONFIG_HOME',
];
// GitHub Copilot SDK auth — needed for @github/copilot-sdk:
const COPILOT: readonly string[] = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'COPILOT_TOKEN',
  'COPILOT_CLI',
  'COPILOT_CLI_BINARY_VERSION',
  'COPILOT_RUN_APP',
  'COPILOT_AGENT_SESSION_ID',
];
const CODEX: readonly string[] = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT',
  'CODEX_HOME',
];

export function buildChildEnv(
  base: NodeJS.ProcessEnv = process.env,
  extraKeys: readonly string[] = [],
): Record<string, string> {
  const keys = [
    ...UNIVERSAL,
    ...CLAUDE,
    ...COPILOT,
    ...CODEX,
    ...extraKeys,
    ...(platform() === 'win32' ? WINDOWS : POSIX),
  ];
  const out: Record<string, string> = {};
  for (const k of new Set(keys)) {
    const v = base[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
