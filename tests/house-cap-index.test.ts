import { describe, it, expect } from 'vitest';
import { HOUSE_CAP_PASS_THROUGH, stepHouseCap } from '../server/house-cap-index.js';
import { houseCapBase, payoutFor, HOUSE_DAILY_BASE } from '../shared/mines.js';

describe('house cap index (pt1442u)', () => {
  const t = (o: Record<string, number | null>) => new Map(Object.entries(o));
  it('moves by the % change in total assets between the last two closes', () => {
    expect(stepHouseCap(1.0609, t({ '2026-11-02': 311_350, '2026-11-03': 622_700 }), '2026-11-04').idx).toBeCloseTo(1.3261, 3);
    expect(stepHouseCap(2, t({ '2026-11-02': 100, '2026-11-03': 80 }), '2026-11-04').idx).toBe(1.9);
    expect(HOUSE_CAP_PASS_THROUGH).toBe(0.25);
  });
  it('keeps the cap unchanged when a snapshot is missing, and floors at 1', () => {
    expect(stepHouseCap(1.3, t({ '2026-11-03': 500 }), '2026-11-04')).toEqual({ idx: 1.3, ratio: null });
    expect(stepHouseCap(1.3, t({ '2026-11-02': 500, '2026-11-03': null }), '2026-11-04').idx).toBe(1.3);
    expect(stepHouseCap(1.2, t({ '2026-11-02': 1000, '2026-11-03': 10 }), '2026-11-04').idx).toBe(1);
  });
  it('cap in chips = 100K x cap index regardless of the price index', () => {
    const base = houseCapBase(2, 1.25);
    expect(base * 1.25).toBeCloseTo(200_000);
    expect(payoutFor(300_000, 0, base)).toBe(160_000);
    expect(payoutFor(300_000, 0)).toBe(HOUSE_DAILY_BASE);
  });
});
