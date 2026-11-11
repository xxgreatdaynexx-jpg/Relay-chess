import { describe, expect, it } from 'vitest';
import { CIGARETTE_BUFF_RATE, CIGARETTE_DAILY_CAP, CIGARETTE_DROP_RATE, CIGARETTE_ITEM, CIGARETTE_PRICE } from '../shared/cigarettes';
import { CROP_SEED_MUL, CROPS, cropSellValue } from '../shared/farm';
import { FRECIPES, FOOD_STEP_MARKUP } from '../shared/factory';
import { GOODS, priceOf, sellable } from '../shared/mines';
import { hasItemIcon } from '../shared/itemIcons';
import { changelogEntry } from './helpers/changelog';

describe('tobacco crop and cigarette factory line', () => {
  const tobacco = CROPS.find((c) => c.id === 'tobacco')!;
  const recipe = FRECIPES.find((r) => r.id === 'm_cigarette')!;

  it('is a city crop between corn and tomato, priced seed + 35%', () => {
    expect(tobacco).toBeTruthy();
    const corn = CROPS.find((c) => c.id === 'corn')!;
    const tomato = CROPS.find((c) => c.id === 'tomato')!;
    expect(CROPS.indexOf(tobacco)).toBe(CROPS.indexOf(corn) + 1);
    expect(tobacco.seed).toBe(30);
    expect(tobacco.seed).toBeGreaterThan(corn.seed);
    expect(tobacco.seed).toBeLessThan(tomato.seed);
    expect(tobacco.grow).toBeGreaterThan(corn.grow);
    expect(tobacco.grow).toBeLessThan(tomato.grow);
    expect(GOODS.crop_tobacco?.raw).toBe(true);
    expect(GOODS.crop_tobacco?.price).toBeCloseTo(30 * CROP_SEED_MUL, 8);
    expect(cropSellValue(tobacco)).toBeCloseTo(30 * CROP_SEED_MUL, 2);
    expect(hasItemIcon('good', 'crop_tobacco')).toBe(true);
    expect(sellable({ type: 'good', id: 'crop_tobacco' })).toBe(false);
  });

  it('mills 1 tobacco into 1 cigarette at +8%, adjusting the house price from 40', () => {
    expect(recipe).toBeTruthy();
    expect(recipe.machine).toBe('mill');
    expect(recipe.in).toEqual([['good:crop_tobacco', 1]]);
    expect(recipe.out).toEqual([CIGARETTE_ITEM, 1]);
    expect(GOODS.cigarette.price).toBeCloseTo(30 * CROP_SEED_MUL * FOOD_STEP_MARKUP, 8);
    expect(GOODS.cigarette.price).toBeCloseTo(43.74, 8);
    expect(CIGARETTE_PRICE).toBeCloseTo(GOODS.cigarette.price, 8);
    expect(priceOf({ type: 'good', id: 'cigarette' })).toBeCloseTo(43.74, 8);
    expect(sellable({ type: 'good', id: 'cigarette' })).toBe(true);
  });

  it('leaves the fishing drop and casino buff unchanged, with the 25k daily bonus cap', () => {
    expect(CIGARETTE_DROP_RATE).toBe(0.015);
    expect(CIGARETTE_BUFF_RATE).toBe(0.10);
    expect(CIGARETTE_DAILY_CAP).toBe(25_000);
  });

  it('is credited to carter2 in the changelog', () => {
    const { entry } = changelogEntry(/tobacco crop and a cigarette factory line/i);
    expect(entry.title).toMatch(/requested by carter2/i);
    expect(entry.bullets.join(' ')).toMatch(/43\.74/);
    expect(entry.bullets.join(' ')).toMatch(/25,000/);
  });
});
