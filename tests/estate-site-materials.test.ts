import { afterEach, describe, expect, it } from 'vitest';
import { Estate } from '../server/estateProjects';
import { setRealEstateForTest, type RealEstate } from '../server/realEstate';
import { getBank } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import { px } from '../server/price-index';
import { ESTATE_BUILDS, estateStages, partKey } from '../shared/estateProjects';

function fakeRE(map: Record<string, string>): RealEstate {
  return {
    ownerOf: async (id: string) => { const name = map[id]; return name ? { key: name.toLowerCase(), name } : null; },
    owned: async () => Object.entries(map).map(([id, name]) => ({ id, owner: name, key: name.toLowerCase() })),
  } as unknown as RealEstate;
}
function fund(name: string, chips: number) { const b = getBank(); b.transfer(name, chips - b.account(name).chips, { game: 'test' }); }
const chipsOf = (name: string) => getBank().account(name).chips;

describe('private construction sites: materials after the chips part is full', () => {
  afterEach(() => { setRealEstateForTest(null); resetMines(); });

  it('a stage with only chips sits at ~94%; chip steps then buy the missing materials and finish it', async () => {
    setRealEstateForTest(fakeRE({ 'cf:15': 'Cg' }));
    fund('Cg', 20_000_000);
    const e = new Estate(null);
    await e.choose('Cg', 'cf:15', 'monument');
    const st = estateStages(ESTATE_BUILDS.monument)[0]!;
    await e.contribute('Cg', 'cf:15', 'chips', st.chips);
    const v = e.siteView(e.siteByLot('cf:15')!);
    expect(v.stage).toBe(0);
    expect(Math.round(v.stages[0]!.pct * 100)).toBe(94);
    // the panel exposes every part of the stage, not just chips
    expect(v.stages[0]!.parts.map((p) => p.part)).toEqual(['chips', ...st.goods.map(partKey)]);
    // Old behaviour: "That part of this stage is already full." Now each chip step buys material instead.
    let guard = 0;
    while (e.siteByLot('cf:15')!.stage === 0 && guard++ < 50) {
      const before = chipsOf('Cg');
      await e.contribute('Cg', 'cf:15', 'chips', 10_000);
      expect(before - chipsOf('Cg')).toBeLessThanOrEqual(10_000 + Math.max(...st.goods.map((g) => px(g.price))));
      expect(before - chipsOf('Cg')).toBeGreaterThan(0);
    }
    const s = e.siteByLot('cf:15')!;
    expect(s.stage).toBe(1);
    for (const g of st.goods) expect(s.done[0]![partKey(g)]).toBe(g.qty);
    expect(Math.round(e.siteView(s).stages[0]!.pct * 100)).toBe(100);
  });

  it('material parts can be added directly, warehouse first and catalog chips for the rest', async () => {
    setRealEstateForTest(fakeRE({ 'lot:estate:1': 'Cg' }));
    fund('Cg', 20_000_000);
    const e = new Estate(null);
    await e.choose('Cg', 'lot:estate:1', 'data_center');
    const st = estateStages(ESTATE_BUILDS.data_center)[0]!;
    await e.contribute('Cg', 'lot:estate:1', 'chips', st.chips);
    const [concrete, brick] = st.goods as [typeof st.goods[0], typeof st.goods[0]];
    getMines().adjustStacks('Cg', [{ type: concrete.type, id: concrete.id, delta: 100 }]);
    const before = chipsOf('Cg');
    await e.contribute('Cg', 'lot:estate:1', partKey(concrete), concrete.qty);
    expect(getMines().stackQty('Cg', concrete.type, concrete.id)).toBe(0);
    expect(before - chipsOf('Cg')).toBe(px(concrete.price * (concrete.qty - 100)));
    await e.contribute('Cg', 'lot:estate:1', partKey(brick), brick.qty);
    expect(e.siteByLot('lot:estate:1')!.stage).toBe(1);
    await expect(e.contribute('Cg', 'lot:estate:1', partKey(brick), 1)).rejects.toThrow(/does not need/);
  });
});
