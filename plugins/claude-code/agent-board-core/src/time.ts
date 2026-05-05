export const isoNow = (): string => new Date().toISOString();

export function isoMinusMs(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
