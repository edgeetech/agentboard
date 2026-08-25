export function EdgeeTechLogo({ size = 28, withWordmark = false }: { size?: number; withWordmark?: boolean }) {
  const h = size;
  const w = withWordmark ? size * 4.6 : size;
  return (
    <svg width={w} height={h} viewBox={withWordmark ? '0 0 460 100' : '0 0 100 100'} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="etg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ea2e5e" />
          <stop offset="35%" stopColor="#7b32c8" />
          <stop offset="70%" stopColor="#2c2f4f" />
          <stop offset="100%" stopColor="#2a8ced" />
        </linearGradient>
        <linearGradient id="etw" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ea2e5e" />
          <stop offset="100%" stopColor="#2a8ced" />
        </linearGradient>
      </defs>
      {/* chevron hex mark */}
      <g fill="url(#etg)">
        <polygon points="22,16 36,16 42,26 28,26" />
        <polygon points="22,32 52,32 58,42 28,42 22,42" />
        <polygon points="22,48 52,48 58,58 28,58 22,58" />
        <polygon points="22,64 52,64 58,74 28,74 22,74" />
        <polygon points="22,80 42,80 36,88 28,88" />
      </g>
      {withWordmark && (
        <>
          <line x1="82" y1="20" x2="82" y2="80" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" />
          <text x="104" y="54" fontFamily="Mulish, sans-serif" fontWeight="900"
            fontSize="36" letterSpacing="2" fill="url(#etw)">EDGEETECH</text>
          <text x="104" y="78" fontFamily="Mulish, sans-serif" fontWeight="600"
            fontSize="12" letterSpacing="4" fill="currentColor" fillOpacity="0.75">LIMITED COMPANY</text>
        </>
      )}
    </svg>
  );
}
