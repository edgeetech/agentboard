import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { migratePalette } from './palettes';
import type { Palette } from './palettes';

export type { Palette } from './palettes';
export type Scheme = 'light' | 'dark';

interface Ctx {
  scheme: Scheme;
  palette: Palette;
  setScheme: (s: Scheme) => void;
  setPalette: (p: Palette) => void;
  toggle: () => void;
}

const ThemeContext = createContext<Ctx | null>(null);
const KEY_SCHEME = 'ab.theme';
const KEY_PALETTE = 'ab.palette';

function initialScheme(): Scheme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return 'light';
}
function initialPalette(): Palette {
  try {
    return migratePalette(localStorage.getItem(KEY_PALETTE));
  } catch {
    return 'edgeetech';
  }
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

  const toggle = useCallback(() => { setScheme(s => (s === 'dark' ? 'light' : 'dark')); }, []);

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
