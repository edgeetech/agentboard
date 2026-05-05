import type { Phase } from '../../api';

const COLOURS: Record<Phase, { bg: string; fg: string; label: string }> = {
  DISCOVERY:    { bg: '#eef4ff', fg: '#1d4ed8', label: 'Discovery' },
  REFINEMENT:   { bg: '#f3e8ff', fg: '#6d28d9', label: 'Refining' },
  PLANNING:     { bg: '#fef3c7', fg: '#a16207', label: 'Planning' },
  EXECUTING:    { bg: '#dcfce7', fg: '#15803d', label: 'Executing' },
  VERIFICATION: { bg: '#ffedd5', fg: '#c2410c', label: 'Verifying' },
  DONE:         { bg: '#e5e7eb', fg: '#374151', label: 'Done' },
};

export function PhaseBadge({
  phase,
  size = 'sm',
}: {
  phase: Phase | null | undefined;
  size?: 'sm' | 'md';
}) {
  if (!phase) return null;
  const c = COLOURS[phase];
  const padding = size === 'md' ? '4px 10px' : '2px 8px';
  const fontSize = size === 'md' ? 12 : 11;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding,
        fontSize,
        lineHeight: 1.4,
        borderRadius: 4,
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
      aria-label={`Phase: ${c.label}`}
    >
      {c.label}
    </span>
  );
}
