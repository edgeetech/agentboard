// Build the environment passed to spawned `claude -p` subprocesses.
// Security: DO NOT spread process.env — that leaks AWS creds, GitHub tokens,
// SSH agent sockets, and any other ambient secrets to agent code that runs
// with --permission-mode acceptEdits and broad Bash access. Whitelist only
// what the Claude CLI actually needs.

import { platform } from 'node:os';

const UNIVERSAL = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
const POSIX     = ['HOME', 'USER', 'SHELL', 'TMPDIR'];
const WINDOWS   = [
  'USERPROFILE', 'USERNAME',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData',
  'SYSTEMROOT', 'SYSTEMDRIVE',
  'TEMP', 'TMP',
  'ProgramFiles', 'ProgramFiles(x86)',
  'PATHEXT', 'COMSPEC',
];
// Anthropic CLI auth — only what `claude` actually reads:
const CLAUDE = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CONFIG_DIR',
  'XDG_CONFIG_HOME',
];

export function buildChildEnv(extra = {}, base = process.env) {
  const keys = [
    ...UNIVERSAL,
    ...CLAUDE,
    ...(platform() === 'win32' ? WINDOWS : POSIX),
  ];
  const out = {};
  for (const k of keys) if (base[k] !== undefined) out[k] = base[k];
  return { ...out, ...extra };
}
