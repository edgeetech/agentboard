/**
 * Project attribution resolver.
 *
 * Given a hook payload + session context, decide which project directory the
 * captured event belongs to, and how confident that decision is. Concept
 * borrowed from context-mode's session attribution work but reimplemented
 * here for agentboard's narrower needs.
 *
 * Source taxonomy (highest confidence → lowest):
 *   - "workspace_root"   The session payload carried an explicit workspace root.
 *   - "input_cwd"        The input event included a `cwd` field (e.g. Bash tool).
 *   - "session_origin"   Resolved from the session_meta row's project_dir.
 *   - "cwd_event"        Process cwd at the time the hook ran.
 *   - "last_seen"        Last project_dir attributed to any event in this session.
 *   - "fallback"         No signal; use process.cwd().
 *
 * Confidence is a float in [0, 1] and is used purely for diagnostics — the
 * source string is the durable anchor.
 */

import { dirname, isAbsolute, resolve as resolvePath } from "node:path";

export const ATTRIBUTION_CONFIDENCE = Object.freeze({
  workspace_root: 0.95,
  input_cwd: 0.85,
  session_origin: 0.7,
  cwd_event: 0.55,
  last_seen: 0.4,
  fallback: 0.1,
} as const);

export type AttributionSource = keyof typeof ATTRIBUTION_CONFIDENCE;

export interface AttributionContext {
  input: Record<string, unknown>;
  sessionOrigin: string | null;
  lastSeen: string | null;
  processCwd: string;
}

export interface Attribution {
  projectDir: string;
  source: AttributionSource;
  confidence: number;
}

/** Pure function: resolve a single attribution. */
export function resolveAttribution(ctx: AttributionContext): Attribution {
  const { input, sessionOrigin, lastSeen, processCwd } = ctx;

  const fromWorkspace = pickWorkspaceRoot(input);
  if (fromWorkspace) {
    return mk("workspace_root", fromWorkspace);
  }

  const fromInputCwd = pickInputCwd(input);
  if (fromInputCwd) {
    return mk("input_cwd", fromInputCwd);
  }

  if (sessionOrigin && isAbsolute(sessionOrigin)) {
    return mk("session_origin", sessionOrigin);
  }

  if (processCwd && isAbsolute(processCwd)) {
    return mk("cwd_event", processCwd);
  }

  if (lastSeen && isAbsolute(lastSeen)) {
    return mk("last_seen", lastSeen);
  }

  return mk("fallback", processCwd || ".");
}

function mk(source: AttributionSource, projectDir: string): Attribution {
  return {
    projectDir: normalize(projectDir),
    source,
    confidence: ATTRIBUTION_CONFIDENCE[source],
  };
}

function normalize(p: string): string {
  if (!p) return p;
  try {
    return resolvePath(p);
  } catch {
    return p;
  }
}

function pickWorkspaceRoot(input: Record<string, unknown>): string | null {
  if (!input || typeof input !== "object") return null;
  const candidates = [input.workspace_root, (input as { workspaceRoot?: unknown }).workspaceRoot];
  for (const c of candidates) {
    if (typeof c === "string" && isAbsolute(c)) return c;
  }
  const wsRoots = (input as { workspace_roots?: unknown }).workspace_roots;
  if (Array.isArray(wsRoots) && wsRoots.length > 0) {
    const first = wsRoots[0];
    if (typeof first === "string" && isAbsolute(first)) return first;
  }
  return null;
}

function pickInputCwd(input: Record<string, unknown>): string | null {
  if (!input || typeof input !== "object") return null;
  const top = typeof input.cwd === "string" ? (input.cwd as string) : null;
  if (top && isAbsolute(top)) return top;

  const ti = input.tool_input as Record<string, unknown> | undefined;
  if (ti && typeof ti === "object") {
    const fromTool = typeof ti.cwd === "string" ? (ti.cwd as string) : null;
    if (fromTool && isAbsolute(fromTool)) return fromTool;
    // Edit / Write / Read tool family: derive cwd from the file_path's parent.
    // No `existsSync` stat — PostToolUse fires constantly, syscall is hot path.
    const filePath = typeof ti.file_path === "string" ? (ti.file_path as string) : null;
    if (filePath && isAbsolute(filePath)) {
      return dirname(filePath);
    }
  }
  return null;
}
