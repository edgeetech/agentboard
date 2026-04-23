// Project code validation + suggestion.

const RESERVED = new Set([
  'CON','PRN','NUL','AUX',
  'COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9',
  'LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9',
]);

const CODE_RE = /^[A-Z0-9]{2,7}$/;

export function validateCode(code) {
  if (typeof code !== 'string') return 'code must be a string';
  if (!CODE_RE.test(code)) return 'code must be 2–7 chars, uppercase A–Z and 0–9';
  if (RESERVED.has(code.toUpperCase())) return `code '${code}' collides with reserved filename`;
  return null;
}

export function suggestCode(name, existing = new Set()) {
  const base = (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PROJ';
  let code = base;
  let n = 2;
  while (existing.has(code.toLowerCase()) || RESERVED.has(code)) {
    const suffix = String(n++);
    const maxBase = 7 - suffix.length;
    code = base.slice(0, maxBase) + suffix;
    if (n > 99) break;
  }
  return code;
}
