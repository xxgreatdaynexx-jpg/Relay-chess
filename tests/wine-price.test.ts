import { describe, it, expect } from 'vitest';
import { GOODS as ITEMS } from '../shared/mines';
import { CROPS, CROP_SEED_MUL } from '../shared/farm';
import { FOOD_STEP_MARKUP } from '../shared/factory';
import { houseSellPrice } from '../shared/sellBuff';
describe('wine price', () => {
  it('wine is 2 grapes at seed x CROP_SEED_MUL x FOOD_STEP_MARKUP (no special case)', () => {
    const seed = CROPS.find((c) => c.id === 'grapes')!.seed;
    const expectP = 2 * seed * CROP_SEED_MUL * FOOD_STEP_MARKUP;
    expect(ITEMS.wine.price).toBeCloseTo(expectP, 6);
    expect(houseSellPrice({ type: 'good', id: 'wine' })).toBeCloseTo(expectP, 6);
  });
});
