import { describe, it, expect } from 'vitest';

import { createTracker } from '../src/trackers/index.ts';
import type { TrackerConfigRow } from '../src/trackers/index.ts';

// Minimal tracker config factory
function cfg(overrides: Partial<TrackerConfigRow> = {}): TrackerConfigRow {
  return {
    kind: 'linear',
    api_key_env_var: 'TEST_TRACKER_KEY',
    project_slug: 'test-project',
    active_states: '["Todo","In Progress"]',
    terminal_states: '["Done","Cancelled"]',
    ...overrides,
  };
}

describe('createTracker (factory)', () => {
  it('throws when api_key_env_var is not set in environment', () => {
    delete process.env.TEST_TRACKER_KEY;
    expect(() => {
      createTracker(cfg());
    }).toThrow(/TEST_TRACKER_KEY/);
  });

  it('creates LinearAdapter when kind = linear', () => {
    process.env.TEST_TRACKER_KEY = 'fake-key';
    const tracker = createTracker(cfg({ kind: 'linear' }));
    expect(tracker.constructor.name).toBe('LinearAdapter');
    delete process.env.TEST_TRACKER_KEY;
  });

  it('creates GitHubAdapter when kind = github', () => {
    process.env.TEST_TRACKER_KEY = 'fake-key';
    const tracker = createTracker(cfg({ kind: 'github', project_slug: 'owner/repo' }));
    expect(tracker.constructor.name).toBe('GitHubAdapter');
    delete process.env.TEST_TRACKER_KEY;
  });

  it('creates GitLabAdapter when kind = gitlab', () => {
    process.env.TEST_TRACKER_KEY = 'fake-key';
    const tracker = createTracker(cfg({ kind: 'gitlab' }));
    expect(tracker.constructor.name).toBe('GitLabAdapter');
    delete process.env.TEST_TRACKER_KEY;
  });

  it('throws on unknown tracker kind', () => {
    process.env.TEST_TRACKER_KEY = 'fake-key';
    // Cast to test error path for unsupported kind
    expect(() => {
      createTracker(cfg({ kind: 'jira' as TrackerConfigRow['kind'] }));
    }).toThrow(/Unknown tracker kind/);
    delete process.env.TEST_TRACKER_KEY;
  });

  it('parses active_states JSON string', () => {
    process.env.TEST_TRACKER_KEY = 'fake-key';
    // Verify createTracker does not throw with valid JSON active_states
    expect(() => {
      createTracker(cfg({ kind: 'linear', active_states: '["Backlog","Todo"]' }));
    }).not.toThrow();
    delete process.env.TEST_TRACKER_KEY;
  });

  it('parses terminal_states JSON string', () => {
    process.env.TEST_TRACKER_KEY = 'fake-key';
    // Verify createTracker does not throw with valid JSON terminal_states
    expect(() => {
      createTracker(cfg({ kind: 'linear', terminal_states: '["Done","Duplicate"]' }));
    }).not.toThrow();
    delete process.env.TEST_TRACKER_KEY;
  });

  it('falls back gracefully for malformed active_states JSON', () => {
    process.env.TEST_TRACKER_KEY = 'fake-key';
    // safeParseJson returns fallback — should still create adapter without throwing
    expect(() => {
      createTracker(cfg({ kind: 'linear', active_states: 'not-json' }));
    }).not.toThrow();
    delete process.env.TEST_TRACKER_KEY;
  });
});
