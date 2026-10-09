import { describe, expect, it } from 'vitest';

import { AGENT_PROVIDER_LIST_TEXT, AGENT_PROVIDERS, isAgentProvider } from '../src/types.ts';

describe('agent provider helpers', () => {
  it('validates providers from the shared provider list', () => {
    for (const provider of AGENT_PROVIDERS) {
      expect(isAgentProvider(provider)).toBe(true);
    }
    expect(isAgentProvider('gemini')).toBe(false);
  });

  it('formats provider lists for API validation errors', () => {
    expect(AGENT_PROVIDER_LIST_TEXT).toBe('"claude", "github_copilot", "codex"');
  });
});
