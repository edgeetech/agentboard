export const isoNow = () => new Date().toISOString();

export function isoMinusMs(ms) {
  return new Date(Date.now() - ms).toISOString();
}
