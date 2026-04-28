/**
 * Agent provider icon component.
 * Displays Claude or GitHub Copilot branding.
 */

interface AgentProviderIconProps {
  provider: 'claude' | 'github_copilot';
  size?: 'sm' | 'md' | 'lg';
  tooltip?: boolean;
}

export function AgentProviderIcon({ provider, size = 'md', tooltip = true }: AgentProviderIconProps) {
  const sizes = {
    sm: { width: 16, height: 16, fontSize: 10 },
    md: { width: 24, height: 24, fontSize: 12 },
    lg: { width: 32, height: 32, fontSize: 14 },
  };

  const sizeStyle = sizes[size];
  const title = provider === 'claude'
    ? 'Claude (Anthropic SDK)'
    : 'GitHub Copilot';

  if (provider === 'claude') {
    // Claude logo - simple 'C' in orange
    return (
      <span
        title={tooltip ? title : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: sizeStyle.width,
          height: sizeStyle.height,
          borderRadius: '50%',
          backgroundColor: '#d97842',
          color: 'white',
          fontWeight: 'bold',
          fontSize: sizeStyle.fontSize,
          flexShrink: 0,
        }}
      >
        C
      </span>
    );
  }

  if (provider === 'github_copilot') {
    // GitHub Copilot logo - simple 'GP' or icon
    return (
      <span
        title={tooltip ? title : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: sizeStyle.width,
          height: sizeStyle.height,
          borderRadius: '50%',
          backgroundColor: '#1f2937',
          color: 'white',
          fontWeight: 'bold',
          fontSize: sizeStyle.fontSize - 2,
          flexShrink: 0,
        }}
      >
        ◐
      </span>
    );
  }

  return null;
}
