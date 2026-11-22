import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Estate } from '../server/estateProjects';
import { setRealEstateForTest, type RealEstate } from '../server/realEstate';
import { getBank, resetBank } from '../server/casino-store';
import { resetMines } from '../server/mines';
import { setPriceIndexForTest, px } from '../server/price-index';
import { GOODS } from '../shared/mines';
import {
  ESTATE_BUILD_ORDER, ESTATE_BUILDS, estateProjectCost, estateProjectValue, estateStages, partKey,
} from '../shared/estateProjects';
import { buildCashCharge } from '../shared/buildCosts';
import { HYPER_STAGES, hyperProjectCost } from '../shared/hyperFarm';
import { RIG_LAUNCH_FEE, RIG_STAGES, rigLaunchCash, rigProjectCost } from '../shared/offshoreRig';

const fakeRE = (map: Record<string, string>) => ({
  ownerOf: async (id: string) => (map[id] ? { key: map[id]!.toLowerCase(), name: map[id]! } : null),
  owned: async () => Object.entries(map).map(([id, name]) => ({ id, owner: name, key: name.toLowerCase() })),
}) as unknown as RealEstate;

function fund(name: string, chips: number) {
  const b = getBank();
  b.transfer(name, chips - b.account(name).chips, { game: 'test' });
}
const chipsOf = (name: string) => getBank().account(name).chips;
const priceOf = (id: string) => GOODS[id]?.price ?? 0;

const INDICES = [1, 1.37, 1.7521, 2.28];

describe('displayed construction totals equal the server charge', () => {
  beforeEach(() => {
    resetBank();
    resetMines();
    setPriceIndexForTest(1);
    setRealEstateForTest(fakeRE({
      'lot:estate:1': 'Ann',
      'lot:estate:2': 'Ann',
      'lot:estate:3': 'Ann',
      'lot:estate:4': 'Ann',
      'lot:estate:5': 'Ann',
      'lot:estate:6': 'Ann',
      'cf:1005': 'Ann',
    }));
  });
  afterEach(() => {
    setRealEstateForTest(null);
    resetMines();
    setPriceIndexForTest(1);
  });

  it('base catalog totals still match estateProjectValue (index 1)', () => {
    for (const id of ESTATE_BUILD_ORDER) {
      const p = ESTATE_BUILDS[id];
      expect(estateProjectValue(p)).toBe(p.total);
      expect(estateProjectCost(p, 1).total).toBe(p.total);
    }
    expect(ESTATE_BUILDS.bitcoin_farm.total).toBe(1_317_280);
  });

  it('estateProjectCost uses the same rounding as one contribute per part', () => {
    for (const index of INDICES) {
      for (const id of ESTATE_BUILD_ORDER) {
        const p = ESTATE_BUILDS[id];
        const cost = estateProjectCost(p, index);
        let expected = 0;
        for (const st of estateStages(p)) {
          expected += buildCashCharge(st.chips, index);
          for (const g of st.goods) expected += buildCashCharge(g.qty * g.price, index);
        }
        expect(cost.total, `${id} @ ${index}`).toBe(expected);
        expect(cost.chips + cost.materials).toBe(cost.total);
      }
    }
  });

  it('paying every estate project in chips matches the displayed total at several indices', async () => {
    const lots: Record<(typeof ESTATE_BUILD_ORDER)[number], string> = {
      data_center: 'lot:estate:1',
      bitcoin_farm: 'lot:estate:2',
      monument: 'lot:estate:3',
      mansion: 'lot:estate:4',
      highrise: 'lot:estate:5',
      power_plant: 'lot:estate:6',
    };
    for (const index of INDICES) {
      setPriceIndexForTest(index);
      const e = new Estate(null);
      for (const id of ESTATE_BUILD_ORDER) {
        const lotId = lots[id];
        fund('Ann', 80_000_000);
        await e.choose('Ann', lotId, id);
        const shown = e.siteView(e.siteByLot(lotId)!).plan!.total;
        expect(shown).toBe(estateProjectCost(ESTATE_BUILDS[id], index).total);
        const view = await e.view('Ann');
        const listed = view.builds.find((b: { id: string }) => b.id === id);
        expect(listed).toBeDefined();
        expect(listed!.total).toBe(shown);
        const before = chipsOf('Ann');
        const stages = estateStages(ESTATE_BUILDS[id]);
        for (const st of stages) {
          if (st.chips > 0) await e.contribute('Ann', lotId, 'chips', st.chips);
          for (const g of st.goods) await e.contribute('Ann', lotId, partKey(g), g.qty);
        }
        expect(before - chipsOf('Ann'), `${id} @ ${index}`).toBe(shown);
        expect(e.siteByLot(lotId)!.stage).toBe(stages.length);
      }
    }
  });

  it('a 10,000-chip step on the bitcoin farm bills exactly the quoted step', async () => {
    setPriceIndexForTest(1.7521);
    fund('Ann', 20_000_000);
    const e = new Estate(null);
    await e.choose('Ann', 'lot:estate:2', 'bitcoin_farm');
    const quoted = buildCashCharge(10_000, 1.7521);
    expect(quoted).toBe(px(10_000));
    const before = chipsOf('Ann');
    await e.contribute('Ann', 'lot:estate:2', 'chips', 10_000);
    expect(before - chipsOf('Ann')).toBe(quoted);
  });

  it('bitcoin farm quote at 1.7521 is 2,308,006, not the base 1,317,280', () => {
    const cost = estateProjectCost(ESTATE_BUILDS.bitcoin_farm, 1.7521);
    expect(cost.total).toBe(2_308_006);
    expect(ESTATE_BUILDS.bitcoin_farm.total).toBe(1_317_280);
  });

  it('paying a hyper farm conversion in chips matches the displayed total', async () => {
    for (const index of INDICES) {
      setPriceIndexForTest(index);
      resetBank();
      const e = new Estate(null);
      fund('Ann', 50_000_000);
      await e.startHyper('Ann', 'cf:1005');
      const shown = e.hyperView('Ann', 'cf:1005').total;
      expect(shown).toBe(hyperProjectCost(index, priceOf).total);
      const before = chipsOf('Ann');
      for (const st of HYPER_STAGES) {
        await e.contributeHyper('Ann', 'cf:1005', 'chips', st.chips);
        for (const [id, n] of st.goods) await e.contributeHyper('Ann', 'cf:1005', `good:${id}`, n);
      }
      expect(before - chipsOf('Ann'), `hyper @ ${index}`).toBe(shown);
      // next index needs a new plot or a new eco — reuse is already complete
      break;
    }
    // remaining indices on fresh plots would need more farms; compute via a second start after reset
    for (const index of INDICES.slice(1)) {
      setPriceIndexForTest(index);
      resetBank();
      resetMines();
      const e = new Estate(null);
      fund('Ann', 50_000_000);
      await e.startHyper('Ann', 'cf:1005');
      const shown = e.hyperView('Ann', 'cf:1005').total;
      expect(shown).toBe(hyperProjectCost(index, priceOf).total);
      const before = chipsOf('Ann');
      for (const st of HYPER_STAGES) {
        await e.contributeHyper('Ann', 'cf:1005', 'chips', st.chips);
        for (const [id, n] of st.goods) await e.contributeHyper('Ann', 'cf:1005', `good:${id}`, n);
      }
      expect(before - chipsOf('Ann'), `hyper @ ${index}`).toBe(shown);
    }
  });

  it('paying an offshore rig in chips, plus the launch fee, matches the displayed totals', async () => {
    for (const index of INDICES) {
      setPriceIndexForTest(index);
      resetBank();
      const e = new Estate(null);
      fund('Ann', 80_000_000);
      const started = await e.startRig('Ann');
      const shown = started.total;
      expect(shown).toBe(rigProjectCost(index, priceOf).total);
      expect(started.launchFee).toBe(rigLaunchCash(index));
      const before = chipsOf('Ann');
      for (const st of RIG_STAGES) {
        await e.contributeRig('Ann', started.id, 'chips', st.chips);
        for (const [id, n] of st.goods) await e.contributeRig('Ann', started.id, id, n);
      }
      expect(before - chipsOf('Ann'), `rig @ ${index}`).toBe(shown);
      const mid = chipsOf('Ann');
      await e.launchRig('Ann', started.id);
      expect(mid - chipsOf('Ann')).toBe(rigLaunchCash(index));
    }
  });
});
