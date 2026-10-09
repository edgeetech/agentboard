// Tracker factory. Returns the right adapter based on config.kind.

import { GitHubAdapter } from './github.ts';
import { GitLabAdapter } from './gitlab.ts';
import { LinearAdapter } from './linear.ts';
import type { Tracker, TrackerConfig } from './tracker.ts';

/** Shape of a tracker_config DB row (snake_case from SQLite). */
export interface TrackerConfigRow {
  kind: 'linear' | 'github' | 'gitlab';
  api_key_env_var: string;
  project_slug?: string;
  projectSlug?: string;
  endpoint?: string;
  assignee?: string | null;
  active_states?: string;
  terminal_states?: string;
  [key: string]: unknown;
}

/**
 * Create a tracker adapter from a tracker_config row.
 * Resolves api_key_env_var → actual key from process.env.
 */
export function createTracker(config: TrackerConfigRow): Tracker {
  const apiKey = process.env[config.api_key_env_var];
  if (!apiKey) {
    throw new Error(
      `Tracker API key env var "${config.api_key_env_var}" is not set`,
    );
  }

  const activeStates = safeParseJson(config.active_states, [
    'Todo',
    'In Progress',
  ]);

  const projectSlug = config.project_slug ?? config.projectSlug;

  // Build cfg conditionally — exactOptionalPropertyTypes forbids `prop: undefined`
  // in place of a missing optional property, so we spread only present values.
  const cfg: TrackerConfig = {
    kind: config.kind,
    apiKey,
    activeStates,
    ...(config.endpoint !== undefined && { endpoint: config.endpoint }),
    ...(projectSlug !== undefined && { projectSlug }),
    ...(config.assignee !== undefined && { assignee: config.assignee }),
  };

  switch (config.kind) {
    case 'linear':
      return new LinearAdapter(cfg);
    case 'github':
      return new GitHubAdapter(cfg);
    case 'gitlab':
      return new GitLabAdapter(cfg);
    default: {
      // exhaustiveness: config.kind is narrowed to `never` here
      const _exhaustive: never = config.kind;
      throw new Error(`Unknown tracker kind: ${String(_exhaustive)}`);
    }
  }
}

function safeParseJson(
  s: string | undefined,
  fallback: string[],
): string[] {
  if (s === undefined) return fallback;
  try {
    const parsed: unknown = JSON.parse(s);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.map(String);
  } catch {
    return fallback;
  }
}
