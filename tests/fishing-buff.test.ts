import { describe, expect, it } from 'vitest';
import { FISH_DAILY_MAX, FISH_SELL_MUL, fishPayout, fishSellValue } from '../shared/fishing';
import { LAUNCH } from '../shared/launchPopup';
import { CHANGELOG } from '../shared/changelog';

describe('fishing buff (+15%)', () => {
  it('sells fish for 15% more and raises the daily cap 15%', () => {
    expect(FISH_SELL_MUL).toBe(1.15); expect(fishSellValue(100)).toBe(115); expect(fishSellValue(1000)).toBe(1150);
    expect(FISH_DAILY_MAX).toBe(115_000); expect(fishPayout(1e9, 0)).toBe(115_000); expect(fishPayout(10, 115_000)).toBe(0);
  });
  it('is in the popup and changelog', () => {
    expect(LAUNCH.items.some((i) => /Fishing pays 15% more/.test(i.title))).toBe(true);
    expect(CHANGELOG.some((c) => /Fishing pays 15% more/.test(c.title))).toBe(true);
  });
});
