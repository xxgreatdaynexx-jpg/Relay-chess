import { describe, expect, it } from 'vitest';
import { GOODS, ORES } from '../shared/mines';
import { hasItemIcon, itemIconSvg, itemIconUri, itemIconUriKey } from '../shared/itemIcons';

describe('item icons', () => {
  it('every ore and every good has a crafted icon', () => {
    for (const id of Object.keys(ORES)) expect(hasItemIcon('ore', id), id).toBe(true);
    for (const g of Object.values(GOODS)) expect(hasItemIcon(g.type, g.id), g.id).toBe(true);
  });
  it('icons are valid, distinct svg', () => {
    const all = [...Object.keys(ORES).map((i) => itemIconSvg('ore', i)), ...Object.values(GOODS).map((g) => itemIconSvg(g.type, g.id))];
    for (const s of all) expect(s).toMatch(/^<svg [^>]*viewBox="0 0 24 24">.*<\/svg>$/s);
    expect(new Set(all).size).toBe(all.length);
  });
  it('unknown ids get the fallback crate, keys and aliases resolve', () => {
    expect(itemIconSvg('good', 'nope_xyz')).toContain('?</text>');
    expect(itemIconUriKey('ore:gold')).toBe(itemIconUri('ore', 'gold'));
    expect(itemIconSvg('ore', 'crystal')).toBe(itemIconSvg('ore', 'gem'));
  });
});
