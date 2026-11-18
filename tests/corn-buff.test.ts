import { describe, expect, it } from 'vitest';
import { CORN_SELL_MUL, CROP_SEED_MUL, CROPS, HYPER_CROPS, cropProfit, cropSellValue, hasBuffedSell } from '../shared/farm';
import { foodInfo } from '../shared/cooking';
import { GOODS, isFood, sellable } from '../shared/mines';
import { FOOD_STEP_MARKUP, FRECIPES, applyFarmFishFoodPrices, applyRawCropPrices, recipeIn, recipeOut, usedIn } from '../shared/factory';
import { sellBuffOf } from '../shared/sellBuff';
import { expectChangelogEntry } from './helpers/changelog';

const crop = (id: string) => CROPS.find((c) => c.id === id)!;
const perHour = (id: string) => cropProfit(crop(id)) / (crop(id).grow / 3_600_000);

describe('corn buff', () => {
  it('raises corn harvest value by 25%; seed and grow time unchanged', () => {
    const corn = crop('corn');
    expect(CORN_SELL_MUL).toBe(1.25);
    expect(corn.seed).toBe(25);
    expect(corn.grow).toBe(Math.round(60 * 60_000 * 0.7));
    expect(cropSellValue(corn)).toBeCloseTo(25 * CROP_SEED_MUL * CORN_SELL_MUL, 1); // 33.75 -> ~42.19
    expect(cropProfit(corn)).toBeCloseTo(17.19, 1); // was 8.75
    expect(hasBuffedSell('corn')).toBe(true);
    for (const c of CROPS) if (c.id !== 'corn') expect(hasBuffedSell(c.id), c.id).toBe(false);
  });

  it('puts corn profit/hour above carrots and slower crops, below wheat, strawberries and every glasshouse flower', () => {
    expect(perHour('corn')).toBeGreaterThan(perHour('carrot'));
    expect(perHour('corn')).toBeGreaterThan(perHour('tobacco'));
    expect(perHour('corn')).toBeGreaterThan(perHour('potato'));
    expect(perHour('corn')).toBeLessThan(perHour('wheat'));
    expect(perHour('corn')).toBeLessThan(perHour('strawberry'));
    for (const h of HYPER_CROPS) expect(perHour('corn')).toBeLessThan(cropProfit(h) / (h.grow / 3_600_000));
  });

  it('keeps the factory raw price and pantry value in lockstep with the harvest value', () => {
    applyRawCropPrices(); applyFarmFishFoodPrices();
    expect(GOODS.crop_corn!.price).toBeCloseTo(cropSellValue(crop('corn')), 6);
    expect(foodInfo('corn')!.base).toBe(crop('corn').sell);
    expect(GOODS.cornmeal!.price).toBeCloseTo(GOODS.crop_corn!.price * FOOD_STEP_MARKUP, 6);
    expect(GOODS.sugar!.price).toBeCloseTo(GOODS.crop_corn!.price * FOOD_STEP_MARKUP, 6);
  });

  it('adds corn syrup, kettle corn and corn whiskey, priced as normal farm food steps', () => {
    applyFarmFishFoodPrices();
    for (const [rid, out] of [['m_corn_syrup', 'corn_syrup'], ['k_kettle_corn', 'kettle_corn'], ['k_corn_whiskey', 'corn_whiskey']] as const) {
      const r = FRECIPES.find((x) => x.id === rid)!; expect(r, rid).toBeTruthy();
      expect(r.out[0]).toBe(`good:${out}`);
      expect(GOODS[out]!.price, out).toBeCloseTo((recipeIn(r) / r.out[1]) * FOOD_STEP_MARKUP, 6);
      expect(recipeOut(r) / recipeIn(r)).toBeCloseTo(FOOD_STEP_MARKUP, 6);
      expect(isFood({ type: 'good', id: out })).toBe(true);
      expect(sellable({ type: 'good', id: out })).toBe(true);
      expect(sellBuffOf(`good:${out}`)).toBe(0);
    }
    expect(FRECIPES.find((x) => x.id === 'm_corn_syrup')!.machine).toBe('mill');
    expect(FRECIPES.find((x) => x.id === 'k_kettle_corn')!.machine).toBe('cannery');
    expect(FRECIPES.find((x) => x.id === 'k_corn_whiskey')!.machine).toBe('cannery');
    expect(usedIn('good:crop_corn').map((r) => r.id).sort()).toEqual(['k_kettle_corn', 'm_corn_syrup', 'm_cornmeal', 'm_sugar']);
    expect(usedIn('good:corn_syrup').map((r) => r.id).sort()).toEqual(['k_corn_whiskey', 'k_kettle_corn']);
  });

  it('leaves the other basic crops on the standard margin', () => {
    for (const c of CROPS) if (c.id !== 'corn') expect(cropSellValue(c), c.id).toBeCloseTo(c.seed * CROP_SEED_MUL, 1);
  });

  it('is in the changelog', () => {
    expectChangelogEntry(/Corn buffed: higher harvest value and new corn products/, { from: '2026-11-17T13:10:00-06:00', to: '2026-11-19T00:00:00-06:00' });
  });
});
