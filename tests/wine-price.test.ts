import { describe, it, expect } from 'vitest';
import { GOODS as ITEMS } from '../shared/mines';
import { CROPS } from '../shared/farm';
import { houseSellPrice } from '../shared/sellBuff';
describe('wine price', () => {
  it('wine sells for 700; 2 grape seeds (300) give 400 profit', () => {
    expect(ITEMS.wine.price).toBe(700);
    const seed = CROPS.find((c: any) => c.id === 'grapes')!.seed;
    expect(seed * 2).toBe(300);
    expect(ITEMS.wine.price - seed * 2).toBe(400);
    expect(houseSellPrice({ type: 'good', id: 'wine' })).toBe(700);
    expect(houseSellPrice({ type: 'good', id: 'wine' }) - seed * 2).toBe(400);
  });
});
