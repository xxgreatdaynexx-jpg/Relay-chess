import { describe, expect, it } from 'vitest';
import { GOODS } from '../shared/mines';
import { frecipe, FOOD_STEP_MARKUP } from '../shared/factory';
import { CROPS, FARM_SELL_MUL, CROP_SEED_MUL } from '../shared/farm';

describe('Sunflower Oil rebalance', () => {
  it('is 1 sunflower per oil at crop x FOOD_STEP_MARKUP', () => {
    expect(GOODS.sunflower_oil.price).toBeCloseTo(GOODS.crop_sunflower.price * FOOD_STEP_MARKUP, 6);
    expect(frecipe('m_oil')!.in).toEqual([['good:crop_sunflower', 1]]);
  });
  it('beats selling the raw sunflower; cocoa uses the same step markup', () => {
    const sun = CROPS.find((c) => c.id === 'sunflower')!;
    expect(GOODS.sunflower_oil.price).toBeGreaterThanOrEqual(sun.sell * FARM_SELL_MUL);
    expect(GOODS.sunflower_oil.price / (sun.seed * CROP_SEED_MUL)).toBeCloseTo(FOOD_STEP_MARKUP, 6);
    expect(GOODS.cocoa.price / (240 * CROP_SEED_MUL)).toBeCloseTo(FOOD_STEP_MARKUP, 6);
  });
});
