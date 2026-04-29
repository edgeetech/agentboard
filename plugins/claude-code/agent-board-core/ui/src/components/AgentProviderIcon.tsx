import claudeLogo from '../assets/claude-logo.svg';
import copilotLogo from '../assets/copilot-logo.svg';

interface AgentProviderIconProps {
  provider: 'claude' | 'github_copilot';
  size?: 'sm' | 'md' | 'lg';
  tooltip?: boolean;
}

export function AgentProviderIcon({ provider, size = 'md', tooltip = true }: AgentProviderIconProps) {
  const sizes = {
    sm: 32,
    md: 48,
    lg: 24,
  };

  const dimensions = sizes[size];
  const logoSrc = provider === 'claude' ? claudeLogo : copilotLogo;
  const title = provider === 'claude'
    ? 'Claude (Anthropic SDK)'
    : 'GitHub Copilot';

  return (
    <img
      src={logoSrc}
      alt={title}
      title={tooltip ? title : undefined}
      style={{
        height: dimensions,
        width: 'auto',
        maxWidth: '100%',
        display: 'block',
        flexShrink: 0,
      }}
    />
  );
}
