import { describe, expect, it } from 'vitest';
import { listFee, pctQty, receiveFor, suggestUnit } from '../shared/marketSell';

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
});
