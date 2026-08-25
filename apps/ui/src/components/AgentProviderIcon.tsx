import claudeLogo from '../assets/claude-logo.svg';
import codexLogo from '../assets/codex-logo.svg';
import copilotLogo from '../assets/copilot-logo.svg';

interface AgentProviderIconProps {
  provider: 'claude' | 'github_copilot' | 'codex';
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
  const logoSrc = provider === 'claude' ? claudeLogo : provider === 'codex' ? codexLogo : copilotLogo;
  const title = provider === 'claude'
    ? 'Claude (Anthropic SDK)'
    : provider === 'codex'
      ? 'Codex CLI'
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
