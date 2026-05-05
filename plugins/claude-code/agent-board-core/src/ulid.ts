// Minimal ULID generator (Crockford Base32, 26 chars: 48-bit time + 80-bit random).
// Public-domain equivalent re-implementation, no external dep.

import { randomBytes } from 'node:crypto';

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(time: number = Date.now()): string {
  return encodeTime(time, 10) + encodeRandom(16);
}

function encodeTime(t: number, len: number): string {
  let s = '';
  for (let i = len - 1; i >= 0; i--) {
    s = (ENC[t % 32] ?? '') + s;
    t = Math.floor(t / 32);
  }
  return s;
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ENC[(bytes[i] ?? 0) % 32] ?? '';
  return s;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export function isUlid(s: string): boolean {
  return typeof s === 'string' && ULID_RE.test(s);
}
