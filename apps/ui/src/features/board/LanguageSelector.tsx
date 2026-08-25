import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Inline SVG flags — 3 locales only. Ships in JS bundle, renders identically
// across Chrome/Edge/Firefox/Safari on all OSes (no font dependency).
const FlagGB = () => (
  <svg viewBox="0 0 60 30" className="lang-flag" aria-hidden="true">
    <clipPath id="fl-gb"><rect width="60" height="30" /></clipPath>
    <rect width="60" height="30" fill="#012169" />
    <g clipPath="url(#fl-gb)">
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </g>
    <rect x="0" y="0" width="60" height="30" fill="none" stroke="#ccc" strokeWidth="0.5" />
  </svg>
);

const FlagTR = () => (
  <svg viewBox="0 0 30 20" className="lang-flag" aria-hidden="true">
    <rect width="30" height="20" fill="#E30A17" />
    <circle cx="11.25" cy="10" r="4" fill="#fff" />
    <circle cx="12.25" cy="10" r="3.2" fill="#E30A17" />
    <polygon
      points="15.5,10 17.8,9.25 16.4,11.2 16.4,8.8 17.8,10.75"
      fill="#fff"
    />
    <rect x="0" y="0" width="30" height="20" fill="none" stroke="#ccc" strokeWidth="0.3" />
  </svg>
);

const FlagES = () => (
  <svg viewBox="0 0 30 20" className="lang-flag" aria-hidden="true">
    <rect width="30" height="20" fill="#AA151B" />
    <rect y="5" width="30" height="10" fill="#F1BF00" />
    <rect x="0" y="0" width="30" height="20" fill="none" stroke="#ccc" strokeWidth="0.3" />
  </svg>
);

interface Language {
  code: string;
  label: string;
  flag: () => JSX.Element;
  flagAlt: string;
}

const LANGUAGES: Language[] = [
  { code: 'en', label: 'EN', flag: FlagGB, flagAlt: 'United Kingdom flag' },
  { code: 'tr', label: 'TR', flag: FlagTR, flagAlt: 'Turkey flag' },
  { code: 'es', label: 'ES', flag: FlagES, flagAlt: 'Spain flag' },
];

export function LanguageSelector() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find(l => l.code === i18n.language) ?? LANGUAGES[0];
  const CurrentFlag = current.flag;

  const change = (code: string) => {
    localStorage.setItem('locale', code);
    i18n.changeLanguage(code);
    setOpen(false);
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="lang-selector" ref={ref}>
      <button
        className="lang-trigger"
        onClick={() => { setOpen(o => !o); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current.flagAlt}
      >
        <CurrentFlag />
        <span className="lang-code">{current.label}</span>
        <span className="lang-chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="lang-dropdown" role="listbox">
          {LANGUAGES.map(l => {
            const F = l.flag;
            return (
              <li
                key={l.code}
                role="option"
                aria-selected={l.code === i18n.language}
                className={`lang-option${l.code === i18n.language ? ' is-active' : ''}`}
                onClick={() => { change(l.code); }}
                tabIndex={0}
              >
                <F />
                <span>{l.label}</span>
                {l.code === i18n.language && <span className="lang-check" aria-hidden="true">✓</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
