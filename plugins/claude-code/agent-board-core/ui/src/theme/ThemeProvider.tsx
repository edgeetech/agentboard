import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

export type Scheme = 'light' | 'dark';
export type Palette =
  | 'default'
  | 'edgeetech'
  | 'primer'    // GitHub Primer (accessibility-forward, both schemes)
  | 'mono'      // monochrome minimalism
  | 'neon'      // neon highlights
  | 'warm'      // warm tones
  | 'pastel'    // muted pastels
  | 'jewel'     // deep jewel tones
  | 'vibrant';  // contrasting vibrancy

const PALETTE_IDS: readonly Palette[] = [
  'default', 'edgeetech', 'primer', 'mono', 'neon', 'warm', 'pastel', 'jewel', 'vibrant',
];

type Ctx = {
  scheme: Scheme;
  palette: Palette;
  setScheme: (s: Scheme) => void;
  setPalette: (p: Palette) => void;
  toggle: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);
const KEY_SCHEME = 'ab.theme';
const KEY_PALETTE = 'ab.palette';

function initialScheme(): Scheme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return 'light';
}
const DEFAULT_PALETTE: Palette = 'edgeetech';

function initialPalette(): Palette {
  try {
    const p = localStorage.getItem(KEY_PALETTE);
    if (p && (PALETTE_IDS as readonly string[]).includes(p)) return p as Palette;
    return DEFAULT_PALETTE;
  } catch { return DEFAULT_PALETTE; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<Scheme>(initialScheme);
  const [palette, setPalette] = useState<Palette>(initialPalette);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', scheme);
    try { localStorage.setItem(KEY_SCHEME, scheme); } catch {}
  }, [scheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette);
    try { localStorage.setItem(KEY_PALETTE, palette); } catch {}
  }, [palette]);

  const toggle = useCallback(() => setScheme(s => (s === 'dark' ? 'light' : 'dark')), []);

  return (
    <ThemeContext.Provider value={{ scheme, palette, setScheme, setPalette, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be inside <ThemeProvider>');
  return ctx;
}
