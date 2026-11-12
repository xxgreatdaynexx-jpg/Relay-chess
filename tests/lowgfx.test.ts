import { describe, expect, it } from 'vitest';
import { gfxOverride } from '../client/src/lib/worldTier';
import { LAUNCH } from '../shared/launchPopup';
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
describe('?lowgfx override', () => {
  it('forces low, remembers it, and clears with auto', () => {
    const s = mem();
    expect(gfxOverride('', s)).toBeNull();
    expect(gfxOverride('?lowgfx', s)).toBe('low'); expect(gfxOverride('', s)).toBe('low');
    expect(gfxOverride('?gfx=high', s)).toBe('high'); expect(gfxOverride('?gfx=auto', s)).toBeNull(); expect(gfxOverride('', s)).toBeNull();
    expect(gfxOverride('?lowgfx=1', s)).toBe('low'); expect(gfxOverride('?lowgfx=0', s)).toBeNull();
    expect(gfxOverride('?gfx=ultra', null)).toBeNull();
  });
});
describe('launch popup recipe count', () => it('the Billionaire launch popup does not re-list the Millionaire factory-recipe count', () => expect(JSON.stringify(LAUNCH)).not.toContain('has 115 recipes')));
