import { describe, expect, it } from 'vitest';
import { FISH_DAILY_MAX, FISH_SPOT_CAP, fishPayout, fishSpotCap } from '../shared/fishing';
import { changelogEntry } from './helpers/changelog';

describe('fishing caps scale with the house-sell cap index', () => {
  it('keeps today\'s flat values as the floor when the index is 1 or below', () => {
    expect(FISH_SPOT_CAP).toEqual({ lake: 115_000, reef: 230_000, deep: 575_000 });
    expect(FISH_DAILY_MAX).toBe(115_000);
    expect(fishSpotCap('lake')).toBe(115_000);
    expect(fishSpotCap('reef', 1)).toBe(230_000);
    expect(fishSpotCap('deep', 0.5)).toBe(575_000);
    expect(fishPayout(1e9, 0, 'lake')).toBe(115_000);
    expect(fishPayout(1e9, 0, 'reef')).toBe(230_000);
    expect(fishPayout(1e9, 0, 'deep')).toBe(575_000);
  });

  it('scales each spot by the live house-cap index (4.7122) and never goes below the floor', () => {
    const idx = 4.7122;
    expect(fishSpotCap('lake', idx)).toBe(541_903);
    expect(fishSpotCap('reef', idx)).toBe(1_083_806);
    expect(fishSpotCap('deep', idx)).toBe(2_709_515);
    expect(fishPayout(1e9, 0, 'lake', idx)).toBe(541_903);
    expect(fishPayout(1e9, 0, 'reef', idx)).toBe(1_083_806);
    expect(fishPayout(1e9, 0, 'deep', idx)).toBe(2_709_515);
    expect(fishPayout(200, 541_803, 'lake', idx)).toBe(100);
    expect(fishPayout(50, 541_903, 'lake', idx)).toBe(0);
  });

  it('is credited to chessguy2 in the changelog', () => {
    const { entry } = changelogEntry(/fishing daily caps now scale with the house-sell cap index/i);
    expect(entry.title).toMatch(/requested by chessguy2/i);
    expect(entry.bullets.join(' ')).toMatch(/115,000/);
  });
});
