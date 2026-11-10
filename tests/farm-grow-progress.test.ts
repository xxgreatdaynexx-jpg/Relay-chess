import { describe, expect, it } from 'vitest';
import { growProgressPct } from '../shared/farm';

describe('growProgressPct', () => {
  const planted = 1_000;
  const ready = planted + 10_000;
  it('is 0 at plant time and never 100 before readyAt', () => {
    expect(growProgressPct(planted, ready, planted)).toBe(0);
    expect(growProgressPct(planted, ready, ready - 1)).toBe(99);
    expect(growProgressPct(planted, ready, planted + 9_950)).toBe(99);
  });
  it('is 100 only once the crop is ripe', () => {
    expect(growProgressPct(planted, ready, ready)).toBe(100);
    expect(growProgressPct(planted, ready, ready + 5_000)).toBe(100);
  });
  it('treats a due crop as ripe even if readyAt equals plantedAt, and stays at 0 for a broken future span', () => {
    expect(growProgressPct(planted, planted, planted)).toBe(100);
    expect(growProgressPct(2_000, 1_000, 500)).toBe(0);
  });
});
