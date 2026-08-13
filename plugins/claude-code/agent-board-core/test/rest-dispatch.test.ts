import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it } from 'vitest';

import { dispatchRestHandlers } from '../src/rest-dispatch.ts';

function response(headersSent = false): ServerResponse {
  return { headersSent } as ServerResponse;
}

describe('dispatchRestHandlers', () => {
  it('stops when a legacy handler writes a response without returning true', async () => {
    const calls: string[] = [];
    const res = response();

    const handled = await dispatchRestHandlers(
      [
        () => {
          calls.push('first');
          (res as unknown as { headersSent: boolean }).headersSent = true;
          return undefined;
        },
        () => {
          calls.push('second');
          return true;
        },
      ],
      {} as IncomingMessage,
      res,
      new URL('http://agentboard.local/api/test'),
    );

    expect(handled).toBe(true);
    expect(calls).toEqual(['first']);
  });
});
