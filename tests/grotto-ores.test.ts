import { describe, expect, it } from 'vitest';
import { CAVES, CAVE_DEFS, GOODS, ORES, oreFor } from '../shared/mines';
import { FRECIPES } from '../shared/factory';
import { hasItemIcon } from '../shared/itemIcons';

describe('Coral Grotto premium ores (#10d)', () => {
  it('Fire Opal and Abyssal Pearl spawn only in the Coral Grotto', () => {
    for (const c of CAVE_DEFS) { const has = CAVES[c.id].nodes.some((n) => n.ore === 'opal' || n.ore === 'pearl'); expect(has, c.id).toBe(c.id === 'coral'); }
    for (let d = 0; d < 4; d++) for (let i = 0; i < 200; i++) expect(['opal', 'pearl']).not.toContain(oreFor(d, i / 200));
    expect(ORES.pearl.price).toBeGreaterThan(ORES.gem.price); expect(ORES.opal.exclusive && ORES.pearl.exclusive).toBe(true);
  });
  it('Grotto is premium: most of its value is gold or better', () => {
    const n = CAVES.coral.nodes; const prem = n.filter((x) => ORES[x.ore].price >= 15).reduce((a, x) => a + ORES[x.ore].price, 0); const all = n.reduce((a, x) => a + ORES[x.ore].price, 0);
    expect(prem / all).toBeGreaterThan(0.75);
  });
  it('new jeweler recipes, goods and icons', () => {
    for (const id of ['j_cut_opal', 'j_pearl_necklace', 'j_tidecrown']) expect(FRECIPES.some((r) => r.id === id), id).toBe(true);
    for (const g of ['cut_opal', 'pearl_necklace', 'tidecrown']) { expect(GOODS[g], g).toBeTruthy(); expect(hasItemIcon('good', g), g).toBe(true); }
    expect(hasItemIcon('ore', 'opal') && hasItemIcon('ore', 'pearl')).toBe(true);
  });
});
