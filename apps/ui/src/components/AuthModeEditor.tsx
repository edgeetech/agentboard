import { useTranslation } from 'react-i18next';

import type { AgentProvider, AuthConfig, AuthMode } from '../api';
import { AgentProviderIcon } from './AgentProviderIcon';

const PROVIDERS: { id: AgentProvider; label: string; login: string; keyVars: string }[] = [
  { id: 'claude', label: 'Claude', login: 'claude /login', keyVars: 'ANTHROPIC_API_KEY' },
  { id: 'codex', label: 'Codex', login: 'codex login', keyVars: 'OPENAI_API_KEY' },
  { id: 'github_copilot', label: 'Copilot', login: 'copilot → /login', keyVars: 'GITHUB_TOKEN' },
];

const MODES: AuthMode[] = ['subscription', 'api_key', 'auto'];

interface AuthModeEditorProps {
  value: AuthConfig;
  onChange: (next: AuthConfig) => void;
}

/** Per-provider choice between the user's own subscription login and an API key. */
export function AuthModeEditor({ value, onChange }: AuthModeEditorProps) {
  const { t } = useTranslation();
  const modeLabel: Record<AuthMode, string> = {
    subscription: t('auth.mode_subscription', 'My subscription'),
    api_key: t('auth.mode_api_key', 'API key'),
    auto: t('auth.mode_auto', 'Auto'),
  };

  function setMode(provider: AgentProvider, mode: AuthMode) {
    const next = { ...value };
    if (mode === 'auto') delete next[provider];
    else next[provider] = mode;
    onChange(next);
  }

  return (
    <div className="auth-mode-editor">
      <p className="muted auth-mode-help">
        {t(
          'auth.help',
          'Choose how each agent signs in. "My subscription" uses your Claude Pro/Max, ChatGPT or Copilot login and ignores API keys in the environment. "API key" requires the key variable. "Auto" lets the CLI decide — an API key in the environment wins over your login.',
        )}
      </p>
      {PROVIDERS.map((p) => {
        const current = value[p.id] ?? 'auto';
        return (
          <div key={p.id} className="auth-mode-row">
            <span className="auth-mode-provider">
              <AgentProviderIcon provider={p.id} size="sm" tooltip={false} />
              {p.label}
            </span>
            <div
              className="segmented"
              role="radiogroup"
              aria-label={t('auth.mode_for', 'Sign-in for {{provider}}', { provider: p.label })}
            >
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={current === m}
                  className={current === m ? 'active' : undefined}
                  onClick={() => {
                    setMode(p.id, m);
                  }}
                >
                  {modeLabel[m]}
                </button>
              ))}
            </div>
            <small className="muted mono auth-mode-hint">
              {current === 'subscription'
                ? t('auth.hint_subscription', 'Login once with: {{cmd}}', { cmd: p.login })
                : current === 'api_key'
                  ? t('auth.hint_api_key', 'Needs {{vars}} in the server environment', {
                      vars: p.keyVars,
                    })
                  : t('auth.hint_auto', 'Uses {{vars}} if set, otherwise your login', {
                      vars: p.keyVars,
                    })}
            </small>
          </div>
        );
      })}
    </div>
  );
}
