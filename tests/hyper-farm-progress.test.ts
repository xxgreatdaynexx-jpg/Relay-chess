import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Estate } from '../server/estateProjects';
import { setRealEstateForTest, type RealEstate } from '../server/realEstate';
import { getBank, resetBank } from '../server/casino-store';
import { HYPER_STAGES, hyperPct, hyperStagePct, hyperStageValue } from '../shared/hyperFarm';
import { GOODS } from '../shared/mines';
import { px } from '../server/price-index';

const fakeRE = (map: Record<string, string>) => ({ ownerOf: async (id: string) => (map[id] ? { key: map[id]!.toLowerCase(), name: map[id]! } : null) }) as unknown as RealEstate;
const price = (id: string) => GOODS[id]?.price ?? 0;

beforeEach(() => { resetBank(); setRealEstateForTest(fakeRE({ 'cf:1005': 'Jay' })); });
afterEach(() => setRealEstateForTest(null));

describe('hyper farm (Dutch glasshouse) conversion', () => {
  it('materials can be added after the chip part of a stage is full, and the stage then advances', async () => {
    const e = new Estate(null); const bank = getBank();
    bank.transfer('Jay', 5_000_000, { game: 'admin' });
    await e.startHyper('Jay', 'cf:1005');
    const st = HYPER_STAGES[0]!;
    let v = await e.contributeHyper('Jay', 'cf:1005', 'chips', st.chips);
    expect(v.stage).toBe(0);
    await expect(e.contributeHyper('Jay', 'cf:1005', 'chips', 10_000)).rejects.toThrow(/already full/);
    // The panel now offers each material part of the current stage.
    expect(v.stages[0]!.parts.map((p) => p.part)).toEqual(['chips', ...st.goods.map(([id]) => `good:${id}`)]);
    const before = bank.account('Jay').chips;
    for (const [id, n] of st.goods) v = await e.contributeHyper('Jay', 'cf:1005', `good:${id}`, n);
    expect(v.stage).toBe(1);
    const cost = st.goods.reduce((a, [id, n]) => a + px(price(id) * n), 0);
    expect(before - bank.account('Jay').chips).toBe(cost); // no warehouse stock: materials bought at the catalog price
    expect(v.stages[0]!.pct).toBe(1);
    expect(v.pct).toBeCloseTo(hyperStageValue(st, price) / HYPER_STAGES.reduce((a, s) => a + hyperStageValue(s, price), 0), 6);
  });

  it('reports a percentage for each stage and the whole conversion, counting chips and materials by value', () => {
    const st = HYPER_STAGES[0]!;
    expect(hyperStagePct(st, {}, price)).toBe(0);
    expect(hyperStagePct(st, { chips: st.chips }, price)).toBeCloseTo(st.chips / hyperStageValue(st, price), 6);
    expect(hyperPct(0, [], price)).toBe(0);
    expect(hyperPct(HYPER_STAGES.length, [], price)).toBe(1);
    const mid = hyperPct(2, [], price); expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1);
  });
});
