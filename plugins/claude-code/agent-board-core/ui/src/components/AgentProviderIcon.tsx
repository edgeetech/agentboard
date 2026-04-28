/**
 * Agent provider icon component.
 * Displays Claude (starburst) or GitHub Copilot (robot face) official branding.
 */

interface AgentProviderIconProps {
  provider: 'claude' | 'github_copilot';
  size?: 'sm' | 'md' | 'lg';
  tooltip?: boolean;
}

export function AgentProviderIcon({ provider, size = 'md', tooltip = true }: AgentProviderIconProps) {
  const sizes = {
    sm: 16,
    md: 24,
    lg: 32,
  };

  const sz = sizes[size];
  const title = provider === 'claude'
    ? 'Claude (Anthropic SDK)'
    : 'GitHub Copilot';

  if (provider === 'claude') {
    // Claude: Official starburst/pinwheel design (Anthropic official branding)
    // Terra cotta color (#da7756) per official brand guidelines
    return (
      <svg
        width={sz}
        height={sz}
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        title={tooltip ? title : undefined}
        style={{ flexShrink: 0, display: 'inline-block' }}
      >
        {/* Starburst rays radiating outward */}
        <g fill='#da7756'>
          {/* Top ray */}
          <rect x='10' y='2' width='4' height='6' rx='2' />
          {/* Top-right ray */}
          <rect x='16.24' y='4.76' width='4' height='6' rx='2' transform='rotate(45 18.24 7.76)' />
          {/* Right ray */}
          <rect x='16' y='10' width='6' height='4' rx='2' />
          {/* Bottom-right ray */}
          <rect x='16.24' y='13.24' width='4' height='6' rx='2' transform='rotate(45 18.24 16.24)' />
          {/* Bottom ray */}
          <rect x='10' y='16' width='4' height='6' rx='2' />
          {/* Bottom-left ray */}
          <rect x='3.76' y='13.24' width='4' height='6' rx='2' transform='rotate(45 5.76 16.24)' />
          {/* Left ray */}
          <rect x='2' y='10' width='6' height='4' rx='2' />
          {/* Top-left ray */}
          <rect x='3.76' y='4.76' width='4' height='6' rx='2' transform='rotate(45 5.76 7.76)' />
        </g>
        {/* Center circle */}
        <circle cx='12' cy='12' r='3.5' fill='#da7756' />
      </svg>
    );
  }

  if (provider === 'github_copilot') {
    // GitHub Copilot: Official robot face design with circular eyes
    return (
      <svg
        width={sz}
        height={sz}
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        title={tooltip ? title : undefined}
        style={{ flexShrink: 0, display: 'inline-block' }}
      >
        {/* Robot face frame - cyan/teal */}
        <rect x='3' y='4' width='18' height='16' rx='3' fill='#1f2937' />
        
        {/* Left eye - large circular lens */}
        <circle cx='8' cy='11' r='3.5' fill='#06b6d4' />
        <circle cx='8' cy='11' r='2' fill='white' />
        <circle cx='8.5' cy='10.5' r='1' fill='#1f2937' />
        
        {/* Right eye - large circular lens */}
        <circle cx='16' cy='11' r='3.5' fill='#06b6d4' />
        <circle cx='16' cy='11' r='2' fill='white' />
        <circle cx='16.5' cy='10.5' r='1' fill='#1f2937' />
        
        {/* Mouth/indicator line */}
        <path d='M 9 17 Q 12 18 15 17' stroke='#06b6d4' strokeWidth='1.5' strokeLinecap='round' />
      </svg>
    );
  }

  return null;
}
