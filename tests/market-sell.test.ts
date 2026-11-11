import { describe, expect, it } from 'vitest';
import { bestRequestTake, listFee, pctQty, receiveFor, requestSellLabel, suggestUnit } from '../shared/marketSell';

describe('resource sell card helpers', () => {
  it('fee is 5%, rounded up, at least 1', () => {
    expect(listFee(10, 100)).toBe(50); expect(listFee(1, 3)).toBe(1); expect(listFee(0, 5)).toBe(0);
    expect(receiveFor(10, 100)).toBe(950); expect(receiveFor(1, 1)).toBe(0);
  });
  it('suggests undercut by 1, else last sale, else above house', () => {
    expect(suggestUnit(40, 30)).toBe(39); expect(suggestUnit(1, 30)).toBe(1);
    expect(suggestUnit(null, 30)).toBe(30); expect(suggestUnit(null, null, 10)).toBe(11); expect(suggestUnit(null, null)).toBe(1);
  });
  it('quick quantities', () => {
    expect(pctQty(100, 0.25)).toBe(25); expect(pctQty(3, 0.25)).toBe(1); expect(pctQty(7, 1)).toBe(7);
  });
  it('request sell label uses the best unit price and the seller\'s net after the 5% fee', () => {
    expect(bestRequestTake([], 5)).toBeNull();
    expect(bestRequestTake([{ unit: 100, qty: 8 }], 0)).toBeNull();
    const one = bestRequestTake([{ unit: 80, qty: 3 }, { unit: 100, qty: 8 }, { unit: 90, qty: 2 }], 1)!;
    expect(one).toMatchObject({ unit: 100, each: 95, fill: 1, total: 95 });
    expect(requestSellLabel([{ unit: 80, qty: 3 }, { unit: 100, qty: 8 }], 1)).toBe('Sell to market request · 🪙95 each');
    expect(requestSellLabel([{ unit: 100, qty: 8 }], 10)).toBe('Sell to market request · 🪙95 each · 🪙760 for 8');
    expect(receiveFor(8, 100)).toBe(760);
  });
});
