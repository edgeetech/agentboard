// Single source of truth for the curated palette list — consumed by
// ThemeProvider (validation + localStorage migration) and ThemePage
// (swatch rendering). Keep in sync with the palette blocks in styles.css.
export type Palette = 'default' | 'edgeetech' | 'mono';

export interface PaletteInfo {
  id: Palette;
  name: string;
  tagline: string;
  swatches: string[];
  logo: 'agentboard' | 'edgeetech';
  darkOnly?: boolean;
}

export const PALETTES: readonly PaletteInfo[] = [
  {
    id: 'edgeetech',
    name: 'EdgeeTech',
    tagline: 'Azure blue + signal pink, straight from the brand mark.',
    swatches: ['oklch(0.63 0.16 240)', 'oklch(0.64 0.19 358)', 'oklch(0.22 0.024 255)', 'oklch(0.965 0.006 255)', 'oklch(0.72 0.13 235)'],
    logo: 'edgeetech',
  },
  {
    id: 'default',
    name: 'AgentBoard',
    tagline: 'Warm neutrals, amber + clay — the original home palette.',
    swatches: ['oklch(0.34 0.03 195)', 'oklch(0.63 0.15 45)', 'oklch(0.72 0.14 75)', 'oklch(0.97 0.006 90)', 'oklch(0.22 0.015 55)'],
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
];

export const PALETTE_IDS: readonly Palette[] = PALETTES.map((p) => p.id);

export function isPalette(v: string): v is Palette {
  return (PALETTE_IDS as readonly string[]).includes(v);
}

/** Palettes removed from the curated set — migrate old localStorage values
 *  to `edgeetech` instead of leaving the UI on an undefined data-palette. */
const REMOVED_PALETTES = new Set(['primer', 'neon', 'warm', 'pastel', 'jewel', 'vibrant']);

export function migratePalette(stored: string | null): Palette {
  if (stored && isPalette(stored)) return stored;
  if (stored && REMOVED_PALETTES.has(stored)) return 'edgeetech';
  return 'edgeetech';
}
