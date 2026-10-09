import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { quoteTomlPathKey, readCodexConfig } from '../src/codex-config.ts';

describe('codex config helpers', () => {
  it('quotes TOML path keys with punctuation', () => {
    expect(quoteTomlPathKey('sample-http')).toBe('"sample-http"');
  });

  it('reads minimal codex config mcp servers and bearer env', () => {
    const root = join(process.cwd(), '.test-workspaces', 'codex-config-test');
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(
      join(root, '.codex', 'config.toml'),
      `
model = "gpt-5.4"

[mcp_servers.abrun]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "AGENTBOARD_RUN_BEARER"

[mcp_servers.bridge]
command = "uvx"
args = ["mcp-atlassian"]

[mcp_servers.bridge.env]
JIRA_URL = "https://example.atlassian.net"
`,
    );
    const cfg = readCodexConfig(root);
    expect(cfg.model).toBe('gpt-5.4');
    expect(cfg.mcpServers.abrun?.url).toBe('http://127.0.0.1:3000/mcp');
    expect(cfg.mcpServers.abrun?.bearer_token_env_var).toBe('AGENTBOARD_RUN_BEARER');
    expect(cfg.mcpServers.bridge?.command).toBe('uvx');
    expect(cfg.mcpServers.bridge?.args).toEqual(['mcp-atlassian']);
    expect(cfg.mcpServers.bridge?.env.JIRA_URL).toBe('https://example.atlassian.net');
  });
});
