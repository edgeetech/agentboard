import type { TFunction } from 'i18next';

/** Localised relative time ("5m ago") using Intl, falling back to '—'. */
export function timeAgo(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const s = Math.round((ms - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86_400 * 30) return rtf.format(Math.round(s / 86_400), 'day');
  if (abs < 86_400 * 365) return rtf.format(Math.round(s / (86_400 * 30)), 'month');
  return rtf.format(Math.round(s / (86_400 * 365)), 'year');
}

export function durationMinutes(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 60_000));
}

export function formatDuration(t: TFunction, a: string | null, b: string | null): string {
  if (!a || !b) return '—';
  const ms = Date.parse(b) - Date.parse(a);
  if (Number.isNaN(ms)) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h) return t('sessions.dur_hm', '{{h}}h {{m}}m', { h, m });
  if (m) return t('sessions.dur_m', '{{m}}m', { m });
  return t('sessions.dur_s', '{{s}}s', { s: total });
}
