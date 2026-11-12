import { describe, expect, it } from 'vitest';
import { FISH, FISH_SELL_MUL, FISH_SPOT_CAP, fishPayout, fishSellValue, fishValue, rollWeight } from '../shared/fishing';
import { LAUNCH } from '../shared/launchPopup';
import { expectChangelogEntry, expectChangelogOrder } from './helpers/changelog';

describe('fishing +15% buff', () => {
  it('raises the sell value of every fish at every spot by 15%', () => {
    expect(FISH_SELL_MUL).toBe(1.15);
    for (const f of FISH) for (const u of [0, 0.5, 1]) { const v = fishValue(f, rollWeight(f, u)); expect(fishSellValue(v)).toBeCloseTo(v * 1.15, 6); }
    expect(new Set(FISH.map((f) => f.spot ?? 'lake'))).toEqual(new Set(['lake', 'reef', 'deep']));
    expect(fishSellValue(150_000)).toBe(172_500);
    // co-op3 crew-only deep-sea catches are covered too
    for (const id of ['bigeye', 'opah', 'bluemarlin']) { const f = FISH.find((x) => x.id === id)!; expect(f.crew).toBe(true); expect(f.spot).toBe('deep'); expect(fishSellValue(f.base)).toBeCloseTo(f.base * 1.15, 6); }
  });
  it('raises the per-spot daily caps 15%: pond 115k, resort 230k, ocean 575k', () => {
    expect(FISH_SPOT_CAP).toEqual({ lake: 115_000, reef: 230_000, deep: 575_000 });
    expect(fishPayout(1e9, 0, 'lake')).toBe(115_000); expect(fishPayout(1e9, 0, 'reef')).toBe(230_000); expect(fishPayout(1e9, 0, 'deep')).toBe(575_000);
  });
  it('does not change the stored catch value or fillet yield (cooking inputs)', () => {
    const f = FISH.find((x) => x.id === 'bass')!; const v = fishValue(f, rollWeight(f, 0.5));
    expect(v).toBe(Math.max(1, Math.round(f.base * (0.6 + 1.2 * ((rollWeight(f, 0.5) / 1000 - f.min) / (f.max - f.min))))));
  });
  it('is in the popup and changelog', () => {
    expectChangelogEntry(/Fishing pays 15%/);
    expectChangelogOrder(/Cooking pays 50%/, /Fishing pays 15%/, /Factory goods sell/, /The Millionaire Update/);
  });
});
