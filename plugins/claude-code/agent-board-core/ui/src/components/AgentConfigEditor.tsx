import { useTranslation } from 'react-i18next';

import type { AgentConfig, AgentProvider, RoleConfig } from '../api';
import { COUNCIL_MAX, COUNCIL_MIN } from '../api';
import { AgentProviderIcon } from './AgentProviderIcon';

const ROLES: Array<{ key: 'pm' | 'worker' | 'reviewer'; label: string }> = [
  { key: 'pm', label: 'PM' },
  { key: 'worker', label: 'Worker' },
  { key: 'reviewer', label: 'Reviewer' },
];

const PROVIDERS: AgentProvider[] = ['claude', 'github_copilot', 'codex'];

const PROVIDER_LABELS: Record<AgentProvider, string> = {
  claude: 'Claude',
  github_copilot: 'Copilot',
  codex: 'Codex',
};

const PROVIDER_TITLES: Record<AgentProvider, string> = {
  claude: 'Claude (Anthropic SDK)',
  github_copilot: 'GitHub Copilot',
  codex: 'Codex CLI',
};

type Mode = AgentProvider | 'council';

function modeOf(cfg: RoleConfig): Mode {
  return cfg.type === 'council' ? 'council' : cfg.provider;
}

interface AgentConfigEditorProps {
  value: AgentConfig;
  onChange: (next: AgentConfig) => void;
  fallbackProvider?: AgentProvider;
}

export function AgentConfigEditor({ value, onChange, fallbackProvider = 'claude' }: AgentConfigEditorProps) {
  const { t } = useTranslation();

  function setRole(roleKey: 'pm' | 'worker' | 'reviewer', cfg: RoleConfig) {
    onChange({ ...value, [roleKey]: cfg });
  }

  return (
    <div className="agent-config-editor">
      <div className="agent-config-grid">
        {ROLES.map((r) => {
          const cfg: RoleConfig = value[r.key] ?? { type: 'single', provider: fallbackProvider };
          return (
            <RoleConfigRow
              key={r.key}
              label={r.label}
              cfg={cfg}
              onChange={(next) => { setRole(r.key, next); }}
            />
          );
        })}
      </div>
      <p className="muted small agent-config-help">
        {t(
          'settings.agent_config_help',
          'Pick a single provider or build a Council of 2–5 ordered members. Council runs round-robin: each member sees prior outputs; the last member synthesises the canonical result.',
        )}
      </p>
    </div>
  );
}

interface RoleConfigRowProps {
  label: string;
  cfg: RoleConfig;
  onChange: (next: RoleConfig) => void;
}

function RoleConfigRow({ label, cfg, onChange }: RoleConfigRowProps) {
  const mode = modeOf(cfg);

  function selectMode(next: Mode) {
    if (next === 'council') {
      if (cfg.type === 'council') return;
      const seed: AgentProvider[] = [cfg.provider, fallbackToOther(cfg.provider)];
      onChange({ type: 'council', members: seed });
      return;
    }
    onChange({ type: 'single', provider: next });
  }

  return (
    <div className="agent-config-row">
      <div className="agent-config-row-label">{label}</div>
      <div className="agent-mode-toggle">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            className={`agent-mode-item ${mode === p ? 'active' : ''}`}
            onClick={() => { selectMode(p); }}
            title={PROVIDER_TITLES[p]}
          >
            <AgentProviderIcon provider={p} size="md" tooltip={false} />
            <span className="agent-mode-label">{PROVIDER_LABELS[p]}</span>
          </button>
        ))}
        <button
          type="button"
          className={`agent-mode-item ${mode === 'council' ? 'active' : ''}`}
          onClick={() => { selectMode('council'); }}
          title="Council — multi-agent round-robin debate"
        >
          <CouncilIcon size={48} />
          <span className="agent-mode-label">Council</span>
        </button>
      </div>
      {cfg.type === 'council' && (
        <div className="agent-config-row-detail">
          <CouncilMemberPicker
            members={cfg.members}
            onChange={(members) => { onChange({ type: 'council', members }); }}
          />
        </div>
      )}
    </div>
  );
}

interface CouncilMemberPickerProps {
  members: AgentProvider[];
  onChange: (next: AgentProvider[]) => void;
}

function CouncilMemberPicker({ members, onChange }: CouncilMemberPickerProps) {
  function add(p: AgentProvider) {
    if (members.length >= COUNCIL_MAX) return;
    onChange([...members, p]);
  }
  function remove(idx: number) {
    if (members.length <= COUNCIL_MIN) return;
    onChange(members.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= members.length) return;
    const next = [...members];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }

  const atMax = members.length >= COUNCIL_MAX;
  const atMin = members.length <= COUNCIL_MIN;

  return (
    <div className="council-editor">
      <div className="council-add-row">
        <span className="council-add-label muted small">Add member:</span>
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            className="council-add-pill"
            onClick={() => { add(p); }}
            disabled={atMax}
            title={`Add ${PROVIDER_TITLES[p]}`}
          >
            <AgentProviderIcon provider={p} size="md" tooltip={false} />
            <span>{PROVIDER_LABELS[p]}</span>
          </button>
        ))}
        <span className="muted small council-counter">
          {members.length}/{COUNCIL_MAX}
        </span>
      </div>

      <ol className="council-member-list">
        {members.map((m, i) => {
          const isSynthesizer = i === members.length - 1;
          return (
            <li
              key={`${i}-${m}`}
              className={`council-member-row ${isSynthesizer ? 'synthesizer' : ''}`}
            >
              <span className="council-member-index">{i + 1}.</span>
              <span className="council-member-icon">
                <AgentProviderIcon provider={m} size="md" tooltip={false} />
              </span>
              <span className="council-member-name">{PROVIDER_LABELS[m]}</span>
              {isSynthesizer && (
                <span className="council-synth-badge" title="Synthesises the council's final output">
                  Synthesiser
                </span>
              )}
              <span className="council-member-controls">
                <button
                  type="button"
                  className="ghost-icon"
                  disabled={i === 0}
                  onClick={() => { move(i, -1); }}
                  title="Move up"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="ghost-icon"
                  disabled={i === members.length - 1}
                  onClick={() => { move(i, 1); }}
                  title="Move down"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="ghost-icon danger"
                  disabled={atMin}
                  onClick={() => { remove(i); }}
                  title="Remove"
                  aria-label="Remove"
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function CouncilIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role="img"
      aria-label="Council"
    >
      <circle cx="24" cy="13" r="7" fill="#6366f1" />
      <circle cx="12" cy="32" r="7" fill="#0ea5e9" />
      <circle cx="36" cy="32" r="7" fill="#f59e0b" />
      <path
        d="M24 20 L12 32 L36 32 Z"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
    </svg>
  );
}

function fallbackToOther(p: AgentProvider): AgentProvider {
  if (p === 'claude') return 'github_copilot';
  if (p === 'github_copilot') return 'codex';
  return 'claude';
}
