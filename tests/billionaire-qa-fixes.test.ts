import { afterEach, describe, expect, it } from 'vitest';
import { Estate } from '../server/estateProjects';
import { setRealEstateForTest, type RealEstate } from '../server/realEstate';
import { getBank } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import {
  DIGITAL_DAILY_BASE, ESTATE_BUILDS, GPU_RIG, PLANT_COAL_PER_HOUR,
  estateProjectValue, estateStages, partKey,
} from '../shared/estateProjects';
import { assessedTaxBasis, ORDINARY_LAND_PER_AREA, propertyById, taxOf } from '../shared/realEstate';
import { PLASTICS_RECIPES } from '../shared/plasticsPlant';

function fakeRE(map: Record<string, string>): RealEstate {
  return {
    ownerOf: async (id: string) => {
      const name = map[id];
      return name ? { key: name.toLowerCase(), name } : null;
    },
    owned: async () => Object.entries(map).map(([id, name]) => ({ id, owner: name, key: name.toLowerCase() })),
  } as unknown as RealEstate;
}

function fund(name: string, chips: number) {
  const b = getBank();
  b.transfer(name, chips - b.account(name).chips, { game: 'test' });
}
function chipsOf(name: string) { return getBank().account(name).chips; }
function give(name: string, type: 'good' | 'ore' | 'bar' | 'food', id: string, qty: number) {
  const ok = getMines().adjustStacks(name, [{ type, id, delta: qty }]);
  if (!ok) throw new Error(`give ${id} failed`);
}
function qty(name: string, type: 'good' | 'ore' | 'bar' | 'food', id: string) {
  return getMines().stackQty(name, type, id);
}

async function finish(e: Estate, name: string, lotId: string, build: keyof typeof ESTATE_BUILDS) {
  await e.choose(name, lotId, build);
  const stages = estateStages(ESTATE_BUILDS[build]);
  for (const st of stages) {
    if (st.chips > 0) await e.contribute(name, lotId, 'chips', st.chips);
    for (const g of st.goods) await e.contribute(name, lotId, partKey(g), g.qty);
  }
  const v = e.siteByLot(lotId);
  expect(v?.stage).toBe(stages.length);
}

const ecoOf = (e: Estate, name: string) => (e as unknown as { ecoOf(n: string): { digitalPaid: number; gridOff: boolean; gridBill: number; plantFuelUntil: number; gridMw: number } }).ecoOf(name);

describe('East Estates property tax', () => {
  it('assesses Lot 7 at ordinary land value, 238 chips/day, not 57,125', () => {
    const p = propertyById('lot:estate:7');
    expect(p).toMatchObject({ type: 'estate_lot', w: 34, d: 28, price: 11_425_000 });
    expect(taxOf(p!.price)).toBe(57_125); // list-price tax, no longer used for these lots
    const basis = assessedTaxBasis(p!.price, p!.price, p);
    expect(basis).toBe(Math.max(500, Math.round((34 * 28 * ORDINARY_LAND_PER_AREA) / 500) * 500));
    expect(basis).toBe(47_500);
    expect(taxOf(basis)).toBe(238);
    // existing owners who paid the list still get the land assessment
    expect(assessedTaxBasis(11_425_000, 11_425_000, p)).toBe(47_500);
    // ordinary houses are unchanged
    expect(assessedTaxBasis(10_000, 10_000, { type: 'house', w: 10, d: 10 })).toBe(10_000);
    expect(taxOf(10_000)).toBe(50);
  });

  it('catalog totals equal what players actually pay for monument, mansion, highrise and power plant', () => {
    for (const id of ['monument', 'mansion', 'highrise', 'power_plant'] as const) {
      expect(ESTATE_BUILDS[id].total).toBe(estateProjectValue(ESTATE_BUILDS[id]));
    }
    expect(ESTATE_BUILDS.monument.total).toBe(729_640);
    expect(ESTATE_BUILDS.mansion.total).toBe(1_919_240);
    expect(ESTATE_BUILDS.highrise.total).toBe(3_258_340);
    expect(ESTATE_BUILDS.power_plant.total).toBe(2_462_496);
  });
});

describe('warehouse goods, wine, plastics, coal, grid shutoff', () => {
  afterEach(() => {
    setRealEstateForTest(null);
    resetMines();
  });

  it('consumes warehouse construction goods and falls back to chips when the pack is empty', async () => {
    setRealEstateForTest(fakeRE({ 'lot:estate:7': 'Ann' }));
    fund('Ann', 5_000_000);
    const e = new Estate(null);
    await e.choose('Ann', 'lot:estate:7', 'bitcoin_farm');
    const stages = estateStages(ESTATE_BUILDS.bitcoin_farm);
    const g = stages[0]!.goods[0]!;
    give('Ann', g.type as 'good', g.id, g.qty);
    const before = chipsOf('Ann');
    await e.contribute('Ann', 'lot:estate:7', partKey(g), g.qty);
    expect(qty('Ann', g.type as 'good', g.id)).toBe(0);
    expect(chipsOf('Ann')).toBe(before);
    // second good: no stock, chip fallback
    const g2 = stages[0]!.goods[1]!;
    const mid = chipsOf('Ann');
    await e.contribute('Ann', 'lot:estate:7', partKey(g2), g2.qty);
    expect(chipsOf('Ann')).toBe(mid - g2.price * g2.qty);
  });

  it('consumes GPUs and resin on install and refuses if they are missing', async () => {
    setRealEstateForTest(fakeRE({ 'lot:estate:7': 'Ann' }));
    fund('Ann', 8_000_000);
    const e = new Estate(null);
    await finish(e, 'Ann', 'lot:estate:7', 'bitcoin_farm');
    await expect(e.buyGear('Ann', 'lot:estate:7', 1)).rejects.toThrow(/warehouse/);
    give('Ann', 'good', 'gpu', 1);
    give('Ann', 'good', 'plastic_resin', 2);
    const before = chipsOf('Ann');
    const v = await e.buyGear('Ann', 'lot:estate:7', 1);
    expect(v.gear).toBe(1);
    expect(qty('Ann', 'good', 'gpu')).toBe(0);
    expect(qty('Ann', 'good', 'plastic_resin')).toBe(0);
    expect(chipsOf('Ann')).toBe(before - GPU_RIG.price);
  });

  it('wine press turns warehouse grapes into wine 1:1', async () => {
    setRealEstateForTest(fakeRE({ 'winery:1': 'Ann' }));
    const e = new Estate(null);
    await expect(e.pressWine('Ann', 2)).rejects.toThrow(/grapes/);
    give('Ann', 'good', 'crop_grapes', 5);
    const r = await e.pressWine('Ann', 2);
    expect(r).toMatchObject({ grapes: 2, wine: 2, rate: 1 });
    expect(qty('Ann', 'good', 'crop_grapes')).toBe(3);
    expect(qty('Ann', 'good', 'wine')).toBe(2);
  });

  it('plastics plant consumes inputs and credits real output goods', async () => {
    const e = new Estate(null);
    const rec = PLASTICS_RECIPES.find((r) => r.id === 'resin_from_naphtha')!;
    await expect(e.craftPlastic('Ann', rec.id, 1)).rejects.toThrow(/warehouse/);
    give('Ann', 'good', 'naphtha_drum', 2);
    const r = await e.craftPlastic('Ann', rec.id, 1);
    expect(r).toMatchObject({ recipe: 'resin_from_naphtha', qty: 1, paid: 0, outQty: 3 });
    expect(qty('Ann', 'good', 'naphtha_drum')).toBe(0);
    expect(qty('Ann', 'good', 'plastic_resin')).toBe(3);
  });

  it('power plant burns a day of coal from the warehouse before the chip fuel contract', async () => {
    setRealEstateForTest(fakeRE({ 'lot:estate:17': 'Ann' }));
    fund('Ann', 1_000);
    let now = Date.parse('2026-03-01T00:00:00Z');
    const e = new Estate(null, () => now);
    const site = await e.choose('Ann', 'lot:estate:17', 'power_plant');
    expect(site.complete).toBe(true);
    fund('Ann', 0);
    const coal = PLANT_COAL_PER_HOUR * 24;
    give('Ann', 'ore', 'coal', coal);
    const r = await e.tick('Ann');
    expect(r.plantLive).toBe(true);
    expect(qty('Ann', 'ore', 'coal')).toBe(0);
    expect(ecoOf(e, 'Ann').plantFuelUntil).toBe(now + 86_400_000);
    // Surplus power may sell for a few chips; the wallet was not charged the fuel contract.
  });

  it('shuts off unpaid grid power so digital output that needs the grid stops until the bill is paid', async () => {
    setRealEstateForTest(fakeRE({ 'lot:estate:7': 'Ann' }));
    fund('Ann', 8_000_000);
    let now = Date.parse('2026-04-01T00:00:00Z');
    const e = new Estate(null, () => now);
    await finish(e, 'Ann', 'lot:estate:7', 'bitcoin_farm');
    give('Ann', 'good', 'gpu', 1);
    give('Ann', 'good', 'plastic_resin', 2);
    await e.buyGear('Ann', 'lot:estate:7', 1);
    await e.setGrid('Ann', 10);
    // Cap already collected today, so this period has no income to cover the bill, and the wallet is empty.
    ecoOf(e, 'Ann').digitalPaid = DIGITAL_DAILY_BASE;
    fund('Ann', 0);
    now += 3_600_000;
    const r = await e.tick('Ann');
    expect(r.gridOff).toBe(true);
    expect(r.paid).toBe(0);
    expect(r.supply).toBe(0);
    expect(r.throttle).toBe(0);
    expect(e.powerView('Ann').gridOff).toBe(true);
    expect((e.powerView('Ann').gridBill ?? 0)).toBeGreaterThan(0);
    // Restore fails while broke
    await expect(e.restoreGrid('Ann')).rejects.toThrow(/Not enough chips/);
    // Fund the bill and restore: income is still capped, but the bill itself can be paid.
    const bill = e.powerView('Ann').gridBill ?? 0;
    fund('Ann', bill);
    now += 3_600_000;
    const on = await e.restoreGrid('Ann');
    expect(on.gridOff).toBe(false);
    expect(e.powerView('Ann').gridOff).toBe(false);
    expect(e.powerView('Ann').supply).toBe(10);
  });
});
