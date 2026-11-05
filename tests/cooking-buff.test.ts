import { describe, expect, it } from 'vitest';
import { COOK_DAILY_MAX, COOK_SELL_MUL, RECIPES, cookPayout, cookSellValue, dishValue } from '../shared/cooking';
import { LAUNCH } from '../shared/launchPopup';
import { CHANGELOG } from '../shared/changelog';

describe('cooking +50% buff', () => {
  it('sells every dish for +50% (floored), stored dish value unchanged', () => {
    expect(COOK_SELL_MUL).toBe(1.5);
    for (const r of RECIPES) for (const q of [0, 0.5, 1]) { const v = dishValue(r, q); expect(cookSellValue(v)).toBe(Math.floor(v * 1.5)); }
    expect(dishValue(RECIPES[0]!, 1)).toBe(21); // fried fish, unchanged base
  });
  it('keeps the 100k cap; the buffed gross counts toward it (cap reached in 2/3 the dishes)', () => {
    expect(COOK_DAILY_MAX).toBe(100_000);
    const pie = dishValue(RECIPES.find((r) => r.id === 'pumpkin_pie')!, 0.75);
    expect(Math.ceil(100_000 / cookSellValue(pie))).toBeLessThan(Math.ceil(100_000 / pie));
    expect(cookPayout(cookSellValue(1e6), 0)).toBe(100_000);
    expect(cookPayout(cookSellValue(1000), 0)).toBe(1500);
  });
  it('is in the popup and changelog', () => {
    expect(LAUNCH.items.some((i) => /Cooking pays 50% more/.test(i.title))).toBe(true);
    expect(CHANGELOG.slice(0, 4).some((e) => /Cooking pays 50%/.test(e.title))).toBe(true);
  });
});
