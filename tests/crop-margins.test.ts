import { describe, it, expect } from 'vitest';
import { CROPS, FARM_SELL_MUL, CROP_SEED_MUL, cropProfit, cropSellValue } from '../shared/farm';
import { TROPICAL_CROPS } from '../shared/resort';
import { GOODS, priceOf } from '../shared/mines';
import { FRECIPES, FOOD_STEP_MARKUP, applyFarmFishFoodPrices, farmFishFoodRecipes, madeBy, recipeIn } from '../shared/factory';
import { sellBuffOf, houseSellPrice } from '../shared/sellBuff';

// Raw farm output = seed x CROP_SEED_MUL (1.35); each farm/fish factory step adds FOOD_STEP_MARKUP (1.08).
const ALL = [...CROPS, ...TROPICAL_CROPS];
const seedOf = new Map(ALL.map((c) => [`good:crop_${c.id}`, c.seed]));

describe('Crop margins: raw 35% over seed, factory +8% per step', () => {
  it('raw harvest profit is 35% of the seed for every crop (after FARM_SELL_MUL)', () => {
    for (const c of ALL) expect(cropProfit(c)).toBeCloseTo((CROP_SEED_MUL - 1) * c.seed, 1);
    expect(FARM_SELL_MUL).toBe(0.95);
    expect(CROP_SEED_MUL).toBe(1.35);
  });
  it('crop reference prices (recipe value) = seed x 1.35', () => {
    for (const c of ALL) expect(GOODS[`crop_${c.id}`].price).toBeCloseTo(CROP_SEED_MUL * c.seed, 2);
  });
  it('cropSellValue matches seed x 1.35', () => {
    for (const c of ALL) expect(cropSellValue(c)).toBeCloseTo(CROP_SEED_MUL * c.seed, 1);
  });
  it('every farm/fish food craft output equals (input sum / out qty) x FOOD_STEP_MARKUP', () => {
    applyFarmFishFoodPrices(); // idempotent
    const recs = farmFishFoodRecipes();
    expect(recs.length).toBeGreaterThanOrEqual(29);
    for (const r of recs) {
      const id = r.out[0].split(':')[1]!;
      const expectP = (recipeIn(r) / r.out[1]) * FOOD_STEP_MARKUP;
      expect(GOODS[id].price, r.id).toBeCloseTo(expectP, 6);
    }
  });
  it('multi-output food recipes divide by out qty before the markup', () => {
    for (const id of ['k_chocolate', 'k_canned', 'k_soup']) {
      const r = FRECIPES.find((x) => x.id === id)!;
      expect(r.out[1]).toBeGreaterThan(1);
      expect(GOODS[r.out[0].split(':')[1]!].price).toBeCloseTo((recipeIn(r) / r.out[1]) * FOOD_STEP_MARKUP, 6);
    }
  });
  it('wine is 2 grapes x FOOD_STEP_MARKUP (no special case)', () => {
    expect(GOODS.wine.price).toBeCloseTo(2 * GOODS.crop_grapes.price * FOOD_STEP_MARKUP, 6);
  });
  it('banquet beats selling wine + bread alone (fish portions monetized)', () => {
    expect(GOODS.banquet.price).toBeGreaterThan(GOODS.wine.price + GOODS.bread.price);
  });
  it('farm goods get no factory depth buff', () => {
    for (const r of farmFishFoodRecipes()) expect(sellBuffOf(r.out[0]), r.out[0]).toBe(0);
  });
  it('ore-chain goods stay on their hardcoded prices (snapshot)', () => {
    expect(GOODS.iron_bar.price).toBe(25);
    expect(GOODS.steel.price).toBe(61);
    expect(GOODS.engine.price).toBe(1250);
    expect(GOODS.fish_fillet.price).toBe(8);
    expect(GOODS.fish_portion.price).toBe(10);
    expect(GOODS.iron_sheet.price).toBe(36);
    expect(GOODS.glass.price).toBe(4);
  });
  it('factory route still beats raw harvest per seed chip on pure crop chains', () => {
    const flour = GOODS.flour.price; // 2 wheat
    expect(flour).toBeGreaterThan(2 * GOODS.crop_wheat.price);
    expect(flour / (2 * 10)).toBeCloseTo(CROP_SEED_MUL * FOOD_STEP_MARKUP, 6);
  });
});
