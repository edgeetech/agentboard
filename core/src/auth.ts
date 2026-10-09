import { randomBytes, timingSafeEqual } from 'node:crypto';

export const MIN_CLAUDE_CLI = '2.0.0';

export function generateServerToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time string equality. Used for any secret-token comparison
 * (server token, run_token header-vs-argument) so response timing can't leak
 * how many leading bytes matched. Buffers of differing length still cost a
 * comparison (against itself) before returning false, so the early-return
 * length check doesn't become its own timing oracle.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
