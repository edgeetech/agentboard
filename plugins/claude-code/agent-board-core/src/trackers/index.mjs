// Tracker factory. Returns the right adapter based on config.kind.
import { LinearAdapter } from './linear.mjs';
import { GitHubAdapter } from './github.mjs';
import { GitLabAdapter } from './gitlab.mjs';

/**
 * Create a tracker adapter from a tracker_config row.
 * Resolves api_key_env_var → actual key from process.env.
 */
export function createTracker(config) {
  const apiKey = process.env[config.api_key_env_var];
  if (!apiKey) throw new Error(`Tracker API key env var "${config.api_key_env_var}" is not set`);

  const activeStates = safeParseJson(config.active_states, ['Todo', 'In Progress']);
  const terminalStates = safeParseJson(config.terminal_states, ['Done', 'Cancelled']);

  const cfg = { ...config, apiKey, activeStates, terminalStates,
    // Normalize snake_case to camelCase for adapter constructors
    projectSlug: config.project_slug ?? config.projectSlug,
  };

  switch (config.kind) {
    case 'linear': return new LinearAdapter(cfg);
    case 'github': return new GitHubAdapter(cfg);
    case 'gitlab': return new GitLabAdapter(cfg);
    default: throw new Error(`Unknown tracker kind: ${config.kind}`);
  }
}

function safeParseJson(s, fallback = []) {
  try {
    const parsed = JSON.parse(s);
    // Ensure parsed value is an array; if not, use fallback
    if (Array.isArray(parsed)) {
      return parsed.map((value) => String(value));
    }
    return fallback;
  } catch {
    return fallback;
  }
}
