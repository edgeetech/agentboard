import { useTranslation } from 'react-i18next';

import { EdgeeTechLogo } from '../components/EdgeeTechLogo';
import { Logo } from '../components/Logo';
import { PALETTES } from '../theme/palettes';
import type { Scheme } from '../theme/ThemeProvider';
import { useTheme } from '../theme/ThemeProvider';

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
              onClick={() => { setScheme(s); }}
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
          {PALETTES.map(o => {
            const active = palette === o.id;
            return (
              <button
                key={o.id}
                className={'theme-card ' + (active ? 'active' : '')}
                onClick={() => { setPalette(o.id); }}
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
                    <div className="muted">{t(`theme.palette_${o.id}_tagline`, o.tagline)}</div>
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
