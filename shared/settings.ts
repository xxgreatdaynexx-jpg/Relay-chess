/** Player preferences: one shape shared by the client (localStorage + CSS vars) and the server (validated, saved per account). */
export type Theme = 'dark' | 'light' | 'contrast';
export interface Settings {
  theme: Theme;
  accent: string;
  boardLight: string;
  boardDark: string;
  volume: number;
  muted: boolean;
  turnFlash: boolean;
  coords: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#e0b56a',
  boardLight: '#f0d9b5',
  boardDark: '#b58863',
  volume: 0.4,
  muted: false,
  turnFlash: true,
  coords: false,
  reducedMotion: false,
};

export const BOARD_PRESETS: { id: string; label: string; light: string; dark: string }[] = [
  { id: 'wood', label: 'Wood', light: '#f0d9b5', dark: '#b58863' },
  { id: 'green', label: 'Tournament', light: '#eeeed2', dark: '#769656' },
  { id: 'blue', label: 'Ice', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'slate', label: 'Slate', light: '#c9c9c9', dark: '#5d6670' },
  { id: 'purple', label: 'Royal', light: '#e7dcf2', dark: '#8a6fb0' },
];

export const ACCENTS = ['#e0b56a', '#e07a6a', '#6ab0e0', '#7ad17a', '#c08ae8', '#f0f0f0'];
export const THEMES: Theme[] = ['dark', 'light', 'contrast'];

const HEX = /^#[0-9a-f]{6}$/i;
const color = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Accepts anything; returns a complete, safe Settings (unknown keys dropped, bad values replaced by defaults). */
export function cleanSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const vol = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : d.volume;
  return {
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : d.theme,
    accent: color(r.accent, d.accent),
    boardLight: color(r.boardLight, d.boardLight),
    boardDark: color(r.boardDark, d.boardDark),
    volume: Math.round(vol * 100) / 100,
    muted: bool(r.muted, d.muted),
    turnFlash: bool(r.turnFlash, d.turnFlash),
    coords: bool(r.coords, d.coords),
    reducedMotion: bool(r.reducedMotion, d.reducedMotion),
  };
}

/** Strict server check: rejects payloads that are too big or not objects, then cleans. */
export function validateSettings(raw: unknown): Settings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    if (JSON.stringify(raw).length > 2000) return null;
  } catch {
    return null;
  }
  return cleanSettings(raw);
}

/** CSS custom properties for a theme (Tailwind v4 colour tokens are plain vars, so this re-skins the site live). */
export function themeVars(s: Settings): Record<string, string> {
  const base: Record<Theme, Record<string, string>> = {
    dark: { felt: '#10211a', 'felt-2': '#173328', panel: '#1b3128', cream: '#f4efe4', 'cream-dim': '#cfc6b6', bg: '#10211a' },
    light: { felt: '#e9e4d8', 'felt-2': '#ddd6c6', panel: '#f7f3ea', cream: '#1f2a24', 'cream-dim': '#4a544e', bg: '#efe9dc' },
    contrast: { felt: '#000000', 'felt-2': '#111111', panel: '#0a0a0a', cream: '#ffffff', 'cream-dim': '#f0f0f0', bg: '#000000' },
  };
  const t = base[s.theme];
  return {
    '--color-felt': t.felt,
    '--color-felt-2': t['felt-2'],
    '--color-panel': t.panel,
    '--color-cream': t.cream,
    '--color-cream-dim': t['cream-dim'],
    '--page-bg': t.bg,
    '--color-brass': s.theme === 'contrast' && s.accent === DEFAULT_SETTINGS.accent ? '#ffd400' : s.accent,
    '--color-square-light': s.boardLight,
    '--color-square-dark': s.boardDark,
  };
}
