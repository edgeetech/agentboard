// Inline SVG icon set — lucide-style paths, 20x20 viewbox, stroke 1.75,
// currentColor. Replaces emoji/glyph icons across the app (nav, file drop
// zone, activity/debt lists, skill detail, task detail).
export type IconName =
  | 'board'
  | 'skills'
  | 'persona'
  | 'sessions'
  | 'project'
  | 'theme'
  | 'file'
  | 'paperclip'
  | 'alert-triangle'
  | 'eye'
  | 'pencil'
  | 'x'
  | 'clock'
  | 'alert-circle'
  | 'check';

const PATHS: Record<IconName, string> = {
  board: 'M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Z M7.5 3v14 M12.5 3v14',
  skills: 'M10 2.5 12 7l5 .7-3.6 3.5.9 5-4.3-2.3-4.3 2.3.9-5L3 7.7 8 7Z',
  persona: 'M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M3.5 17.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6',
  sessions: 'M4 10a6 6 0 1 1 2 4.5 M4 10V6 M4 10h4',
  project: 'M10 3 12 6h5v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6Z',
  theme: 'M10 2v2 M10 16v2 M4.2 4.2l1.4 1.4 M14.4 14.4l1.4 1.4 M2 10h2 M16 10h2 M4.2 15.8l1.4-1.4 M14.4 5.6l1.4-1.4 M10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  file: 'M6 2h6l4 4v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z M12 2v4h4',
  paperclip: 'M14.5 6.5 8.2 12.8a2.5 2.5 0 1 1-3.5-3.5l6-6a4 4 0 1 1 5.6 5.6l-6.3 6.3a1.5 1.5 0 0 1-2.1-2.1l5.6-5.6',
  'alert-triangle': 'M10 3 2 17h16L10 3Z M10 8.5v3.5 M10 14.5h.01',
  eye: 'M2 10s2.7-5.5 8-5.5S18 10 18 10s-2.7 5.5-8 5.5S2 10 2 10Z M10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z',
  pencil: 'M4 16 4.4 12.9 12.9 4.4a1.5 1.5 0 0 1 2.1 0l0.6 0.6a1.5 1.5 0 0 1 0 2.1L7.1 15.6 4 16Z',
  x: 'M5 5l10 10M15 5L5 15',
  clock: 'M10 5.5V10l3 2 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  'alert-circle': 'M10 6.5v4 M10 13.5h.01 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  check: 'M4 10.5 8 14.5 16 5.5',
};

export function Icon({
  name,
  size = 16,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
