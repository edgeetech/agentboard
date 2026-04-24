import { useTranslation } from 'react-i18next';
import { useTheme, Palette, Scheme } from '../theme/ThemeProvider';
import { EdgeeTechLogo } from '../components/EdgeeTechLogo';
import { Logo } from '../components/Logo';

type Option = {
  id: Palette;
  name: string;
  tagline: string;
  swatches: string[];
  logo: 'agentboard' | 'edgeetech';
  darkOnly?: boolean;
};

const OPTIONS: Option[] = [
  {
    id: 'default',
    name: 'AgentBoard',
    tagline: 'Warm neutrals, amber + clay — the home palette.',
    swatches: ['#1d3a3a', '#d97842', '#e0a93b', '#f7f5f0', '#1a1613'],
    logo: 'agentboard',
  },
  {
    id: 'edgeetech',
    name: 'EdgeeTech',
    tagline: 'Magenta → indigo → sapphire gradient from the brand mark.',
    swatches: ['#ea2e5e', '#7b32c8', '#2c2f4f', '#2a8ced', '#0f1224'],
    logo: 'edgeetech',
  },
  {
    id: 'primer',
    name: 'Primer',
    tagline: 'GitHub Primer tokens — accessibility-first, works in light and dark.',
    swatches: ['#0969da', '#1a7f37', '#9a6700', '#d1242f', '#8250df'],
    logo: 'agentboard',
  },
  {
    id: 'mono',
    name: 'Monochrome',
    tagline: 'Shades of gray, charcoal, and black — minimal, editorial.',
    swatches: ['#121212', '#E0E0E0', '#B0B0B0', '#444444', '#888888'],
    logo: 'agentboard',
    darkOnly: true,
  },
  {
    id: 'neon',
    name: 'Neon',
    tagline: 'Pitch-black canvas with neon green, electric blue, vivid pink.',
    swatches: ['#0D0D0D', '#00FF85', '#1E90FF', '#FF0099', '#FFFFFF'],
    logo: 'agentboard',
    darkOnly: true,
  },
  {
    id: 'warm',
    name: 'Warm Tones',
    tagline: 'Soft black with coral, gold, and burnt orange — cosy, inviting.',
    swatches: ['#1C1C1C', '#F5E8D8', '#FF6F61', '#DAA520', '#FF4500'],
    logo: 'agentboard',
    darkOnly: true,
  },
  {
    id: 'pastel',
    name: 'Muted Pastels',
    tagline: 'Slate grey with light cyan, soft pink, lavender — calm, playful.',
    swatches: ['#2C2C2C', '#A8DADC', '#FFC1CC', '#B39CD0', '#E4E4E4'],
    logo: 'agentboard',
    darkOnly: true,
  },
  {
    id: 'jewel',
    name: 'Deep Jewel',
    tagline: 'Rich black with teal, ruby, forest green — premium, sleek.',
    swatches: ['#1A1A1A', '#004D61', '#822659', '#3E5641', '#F0F0F0'],
    logo: 'agentboard',
    darkOnly: true,
  },
  {
    id: 'vibrant',
    name: 'Vibrant',
    tagline: 'Dark stage with vivid orange, deep purple, bright yellow.',
    swatches: ['#181818', '#FF5722', '#673AB7', '#FFEB3B', '#F7F7F7'],
    logo: 'agentboard',
    darkOnly: true,
  },
];

export function ThemePage() {
  const { t } = useTranslation();
  const { scheme, palette, setScheme, setPalette } = useTheme();

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>{t('theme.title', 'Theme')}</h1>
          <span className="subtitle">
            {t('theme.subtitle', 'Pick a palette and colour scheme. Applied instantly, persisted per browser.')}
          </span>
        </div>
      </div>

      <section className="theme-section">
        <h3>{t('theme.scheme', 'Colour scheme')}</h3>
        <div className="scheme-toggle" role="radiogroup">
          {(['light', 'dark'] as Scheme[]).map(s => (
            <button
              key={s}
              role="radio"
              aria-checked={scheme === s}
              className={'scheme-opt ' + (scheme === s ? 'active' : '')}
              onClick={() => setScheme(s)}
            >
              <span className={'scheme-swatch scheme-' + s} />
              {t(`theme.scheme_${s}`, s === 'light' ? 'Light' : 'Dark')}
            </button>
          ))}
        </div>
      </section>

      <section className="theme-section">
        <h3>{t('theme.palette', 'Palette')}</h3>
        <div className="theme-grid">
          {OPTIONS.map(o => {
            const active = palette === o.id;
            return (
              <button
                key={o.id}
                className={'theme-card ' + (active ? 'active' : '')}
                onClick={() => setPalette(o.id)}
                aria-pressed={active}
              >
                <div className="theme-card-top">
                  {o.logo === 'edgeetech' ? <EdgeeTechLogo size={40} /> : <Logo size={40} />}
                  <div>
                    <h4>
                      {o.name}
                      {o.darkOnly && (
                        <span className="pill dark-only" title={t('theme.dark_only_hint', 'This palette only applies when the Dark colour scheme is selected.')}>
                          {t('theme.dark_only', 'Dark mode only')}
                        </span>
                      )}
                    </h4>
                    <div className="muted">{o.tagline}</div>
                  </div>
                </div>
                <div className="theme-swatches">
                  {o.swatches.map(c => (
                    <span key={c} className="sw" style={{ background: c }} title={c} />
                  ))}
                </div>
                <div className="theme-card-foot">
                  {active ? <span className="pill">{t('theme.active', 'Active')}</span>
                          : <span className="muted">{t('theme.click_apply', 'Click to apply')}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
