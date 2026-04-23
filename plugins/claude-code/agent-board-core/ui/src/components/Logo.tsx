export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="14" fill="var(--primary)" />
      <rect x="12" y="38" width="10" height="14" rx="2.5" fill="var(--on-primary)" />
      <rect x="27" y="26" width="10" height="26" rx="2.5" fill="var(--accent)" />
      <rect x="42" y="14" width="10" height="38" rx="2.5" fill="var(--on-primary)" />
      <circle cx="47" cy="20" r="2.5" fill="var(--attention)" />
    </svg>
  );
}
