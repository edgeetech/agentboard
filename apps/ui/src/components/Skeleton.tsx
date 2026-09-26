// Lightweight loading placeholder. Shimmer respects prefers-reduced-motion
// (see .skeleton in styles.css — the shimmer keyframe is gated there).
export function Skeleton({
  width,
  height,
  radius,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}) {
  const px = (v: number | string | undefined) => (typeof v === 'number' ? `${v}px` : v);
  return (
    <span
      aria-hidden
      className={'skeleton' + (className ? ` ${className}` : '')}
      style={{
        width: px(width) ?? '100%',
        height: px(height) ?? '1em',
        borderRadius: px(radius) ?? 'var(--radius-sm)',
      }}
    />
  );
}

/** Stack of skeleton lines — convenience for text-block loading states. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={'skeleton-text' + (className ? ` ${className}` : '')} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}
