import { describe, expect, it } from 'vitest';
import { BOARD_PRESETS, cleanSettings, DEFAULT_SETTINGS, themeVars, validateSettings } from '../shared/settings.js';

describe('settings', () => {
  it('fills defaults and drops junk', () => {
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ theme: 'neon', accent: 'red', volume: -2, coords: 'yes', extra: 1 })).toEqual({ ...DEFAULT_SETTINGS, volume: 0 });
    expect(cleanSettings({ theme: 'light', boardDark: '#ABCDEF', reducedMotion: true }).boardDark).toBe('#abcdef');
  });
  it('rejects non-objects and oversized payloads on the server', () => {
    expect(validateSettings('x')).toBeNull();
    expect(validateSettings([1])).toBeNull();
    expect(validateSettings({ a: 'x'.repeat(2500) })).toBeNull();
    expect(validateSettings({ theme: 'contrast' })?.theme).toBe('contrast');
  });
  it('maps to CSS vars for theme, accent and board', () => {
    const p = BOARD_PRESETS[1];
    const v = themeVars({ ...DEFAULT_SETTINGS, theme: 'light', accent: '#6ab0e0', boardLight: p.light, boardDark: p.dark });
    expect(v['--color-brass']).toBe('#6ab0e0');
    expect(v['--color-square-dark']).toBe(p.dark);
    expect(v['--color-felt']).not.toBe(themeVars(DEFAULT_SETTINGS)['--color-felt']);
    expect(themeVars({ ...DEFAULT_SETTINGS, theme: 'contrast' })['--color-cream']).toBe('#ffffff');
  });
});
