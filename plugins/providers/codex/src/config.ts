import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CodexMcpServerEntry {
  command?: string;
  url?: string;
  bearer_token_env_var?: string;
  args?: string[];
  env: Record<string, string>;
}

export interface CodexConfig {
  model: string | null;
  mcpServers: Record<string, CodexMcpServerEntry>;
}

type AppConfig = Record<string, unknown>;

function agentboardConfigPath(): string {
  const dataDir =
    process.env.AGENTBOARD_DATA_DIR ?? join(homedir(), ".agentboard");
  return join(dataDir, "config.json");
}

function readAgentboardConfig(): AppConfig {
  try {
    return JSON.parse(
      readFileSync(agentboardConfigPath(), "utf8"),
    ) as AppConfig;
  } catch {
    return {};
  }
}

function stripInlineComment(line: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (ch === '"' && line.charAt(i - 1) !== "\\") inString = !inString;
    if (!inString && ch === "#") break;
    out += ch;
  }
  return out.trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseStringArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null)
    out.push(match[1] ?? match[2] ?? "");
  return out;
}

function parseCodexConfigText(text: unknown): CodexConfig {
  const parsed: CodexConfig = { model: null, mcpServers: {} };
  let section: "mcp" | "mcp-env" | null = null;
  let currentName: string | null = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = stripInlineComment(rawLine);
    if (!line) continue;
    const envMatch = /^\[mcp_servers\.(.+)\.env\]$/.exec(line);
    if (envMatch !== null) {
      currentName = unquote(envMatch[1] ?? "");
      parsed.mcpServers[currentName] ??= { env: {} };
      section = "mcp-env";
      continue;
    }
    const serverMatch = /^\[mcp_servers\.(.+)\]$/.exec(line);
    if (serverMatch !== null) {
      currentName = unquote(serverMatch[1] ?? "");
      parsed.mcpServers[currentName] ??= { env: {} };
      section = "mcp";
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (kv === null) continue;
    const [, key, value] = kv;
    if (key === undefined || value === undefined) continue;
    if (section === null && key === "model") {
      parsed.model = unquote(value);
      continue;
    }
    if (currentName === null) continue;
    const cur: CodexMcpServerEntry = (parsed.mcpServers[currentName] ??= {
      env: {},
    });
    if (section === "mcp-env") {
      cur.env[key] = unquote(value);
      continue;
    }
    if (key === "command" || key === "url" || key === "bearer_token_env_var") {
      cur[key] = unquote(value);
    } else if (key === "args") {
      cur.args = parseStringArray(value);
    }
  }
  return parsed;
}

function readCodexConfigFile(path: string): CodexConfig {
  try {
    if (!existsSync(path)) return { model: null, mcpServers: {} };
    return parseCodexConfigText(readFileSync(path, "utf8"));
  } catch {
    return { model: null, mcpServers: {} };
  }
}

export function readCodexConfig(projectDir: string | null = null): CodexConfig {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const globalCfg = readCodexConfigFile(join(home, "config.toml"));
  const projectCfg =
    projectDir !== null
      ? readCodexConfigFile(join(projectDir, ".codex", "config.toml"))
      : { model: null, mcpServers: {} };
  return {
    model: projectCfg.model ?? globalCfg.model ?? null,
    mcpServers: { ...globalCfg.mcpServers, ...projectCfg.mcpServers },
  };
}

function normalizeClaudeServer(s: unknown): unknown {
  if (s === null || typeof s !== "object") return s;
  const raw = s as Record<string, unknown>;
  const out: Record<string, unknown> = { ...raw };
  const rawArgs = raw.args;
  if (
    rawArgs !== undefined &&
    rawArgs !== null &&
    !Array.isArray(rawArgs) &&
    typeof rawArgs === "object"
  ) {
    const argsObj = rawArgs as Record<string, string>;
    const keys = Object.keys(argsObj)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    if (keys.length > 0) out.args = keys.map((key) => argsObj[key] ?? "");
  }
  return out;
}

export function readClaudeUserMcpServers(): Record<
  string,
  CodexMcpServerEntry
> {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(homedir(), ".claude.json"), "utf8"),
    );
    const cfg =
      raw !== null && typeof raw === "object" ? (raw as AppConfig) : {};
    const rawServers = cfg.mcpServers;
    const servers: Record<string, unknown> =
      rawServers !== null && typeof rawServers === "object"
        ? (rawServers as Record<string, unknown>)
        : {};
    const out: Record<string, CodexMcpServerEntry> = {};
    for (const [name, server] of Object.entries(servers)) {
      const normalized = normalizeClaudeServer(server);
      if (normalized !== null && typeof normalized === "object") {
        out[name] = normalized as CodexMcpServerEntry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function inheritedUserMcpServers(): Record<string, CodexMcpServerEntry> {
  const mode = readAgentboardConfig().inherit_user_mcps;
  if (mode === undefined || mode === null || mode === false) return {};
  const all = readClaudeUserMcpServers();
  const out: Record<string, CodexMcpServerEntry> = {};
  const allow = Array.isArray(mode) ? new Set(mode as string[]) : null;
  for (const [key, value] of Object.entries(all)) {
    if (key === "abrun") continue;
    if (allow !== null && !allow.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function inheritedUserMcpKeys(): string[] {
  return Object.keys(inheritedUserMcpServers());
}

export function codexBridgedClaudeMcps(): Record<string, CodexMcpServerEntry> {
  const mode = readAgentboardConfig().codex_bridge_claude_mcps;
  if (mode === false) return {};
  const all = readClaudeUserMcpServers();
  const allow = Array.isArray(mode) ? new Set(mode as string[]) : null;
  const out: Record<string, CodexMcpServerEntry> = {};
  for (const [name, server] of Object.entries(all)) {
    if (name === "abrun") continue;
    if (allow !== null && !allow.has(name)) continue;
    out[name] = server;
  }
  return out;
}

export function codexReferencedEnvKeys(
  projectDir: string | null = null,
): string[] {
  const cfg = readCodexConfig(projectDir);
  const keys = new Set<string>();
  for (const server of Object.values(cfg.mcpServers)) {
    if (server.bearer_token_env_var !== undefined)
      keys.add(server.bearer_token_env_var);
  }
  return [...keys];
}

export function quoteTomlString(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

export function quoteTomlPathKey(value: unknown): string {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}
