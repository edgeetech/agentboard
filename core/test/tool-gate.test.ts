import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildToolGate } from '../src/run-hooks.ts';

const PARAMS = {
  runToken: 'run-token',
  mcpUrl: 'http://127.0.0.1:9999/mcp',
};
const ATTEMPT = { tool: 'Bash', target: 'npm test' };

function mcpReply(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
      }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildToolGate', () => {
  it('allows when the server explicitly allows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(mcpReply({ decision: 'allow', reason: null }))),
    );
    await expect(buildToolGate(PARAMS)(ATTEMPT)).resolves.toEqual({
      decision: 'allow',
      reason: null,
    });
  });

  it('blocks and propagates the server reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(mcpReply({ decision: 'block', reason: 'nope' }))),
    );
    await expect(buildToolGate(PARAMS)(ATTEMPT)).resolves.toEqual({
      decision: 'block',
      reason: 'nope',
    });
  });

  it('denies when the policy server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    const d = await buildToolGate(PARAMS)(ATTEMPT);
    expect(d.decision).toBe('block');
    expect(d.reason).toContain('ECONNREFUSED');
  });

  it('denies on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 503 } as unknown as Response)),
    );
    const d = await buildToolGate(PARAMS)(ATTEMPT);
    expect(d.decision).toBe('block');
    expect(d.reason).toContain('503');
  });

  it('denies when the response carries no decision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ result: { content: [] } }),
        } as unknown as Response),
      ),
    );
    const d = await buildToolGate(PARAMS)(ATTEMPT);
    expect(d.decision).toBe('block');
    expect(d.reason).toContain('no decision');
  });

  it('denies when the decision payload is malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ result: { content: [{ type: 'text', text: '<<not json>>' }] } }),
        } as unknown as Response),
      ),
    );
    const d = await buildToolGate(PARAMS)(ATTEMPT);
    expect(d.decision).toBe('block');
    expect(d.reason).toContain('policy check failed');
  });

  it('denies an unrecognised decision value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(mcpReply({ decision: 'maybe' }))),
    );
    const d = await buildToolGate(PARAMS)(ATTEMPT);
    expect(d.decision).toBe('block');
    expect(d.reason).toContain('unrecognised');
  });
});
