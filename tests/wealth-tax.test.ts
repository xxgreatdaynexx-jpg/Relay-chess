import { describe, it, expect } from 'vitest';
import { median, planWealthTax, split, taxFor } from '../shared/wealthTax';

const R = (name: string, netWorth: number, chips = netWorth) => ({ name, netWorth, chips });

describe('wealth tax', () => {
  it('median', () => { expect(median([3, 1, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5); expect(median([])).toBe(0); });
  it('1% of the excess, chips only, never below 0', () => {
    expect(taxFor(R('a', 300_000), 100_000)).toBe(2_000);
    expect(taxFor(R('a', 300_000, 500), 100_000)).toBe(500);
    expect(taxFor(R('a', 300_000, -5), 100_000)).toBe(0);
    expect(taxFor(R('a', 90_000), 100_000)).toBe(0);
  });
  it('split conserves the total, remainder to the first recipients', () => {
    expect(split(10, ['a', 'b', 'c'])).toEqual([{ name: 'a', amount: 4 }, { name: 'b', amount: 3 }, { name: 'c', amount: 3 }]);
    expect(split(2, ['a', 'b', 'c']).reduce((x, s) => x + s.amount, 0)).toBe(2);
  });
  it('total debits equal total credits', () => {
    for (let seed = 1; seed < 50; seed++) {
      const rows = Array.from({ length: 3 + (seed % 17) }, (_, i) => R(`p${i}`, ((i * 7919 * seed) % 997) * 1000 + (i === 0 ? 5_000_000 : 0), ((i * 31 * seed) % 400) * 1000));
      const p = planWealthTax(rows);
      expect(p.taxes.reduce((a, t) => a + t.amount, 0)).toBe(p.total);
      expect(p.shares.reduce((a, s) => a + s.amount, 0)).toBe(p.total);
      for (const s of p.shares) expect(rows.find((r) => r.name === s.name)!.netWorth).toBeLessThan(p.threshold);
      for (const t of p.taxes) expect(t.amount).toBeLessThanOrEqual(Math.max(0, rows.find((r) => r.name === t.name)!.chips));
    }
  });
  it('threshold is 2× the median of players at 10K+ only', () => {
    const p = planWealthTax([R('a', 10), R('b', 100), R('c', 20_000), R('d', 40_000), R('e', 1_000_000)]);
    expect(p.median).toBe(40_000); expect(p.threshold).toBe(80_000);
    expect(p.taxes).toEqual([{ name: 'e', amount: 9_200, netWorth: 1_000_000 }]);
    // players below the threshold share, but only at net worth >= 5,000 (a=10 and b=100 get nothing)
    expect(p.shares).toEqual([{ name: 'c', amount: 4_600 }, { name: 'd', amount: 4_600 }]);
  });
  it('nobody at 10K+: no median, no tax', () => {
    const p = planWealthTax([R('a', 10), R('b', 9_999), R('c', 5_000)]);
    expect(p).toEqual({ median: 0, threshold: 0, taxes: [], shares: [], total: 0, treasury: 0 });
  });
  it('players under 10K never pay', () => {
    for (let seed = 1; seed < 30; seed++) {
      const rows = Array.from({ length: 4 + (seed % 9) }, (_, i) => R(`q${i}`, ((i * 104729 * seed) % 30_011) + (i === 0 ? 2_000_000 : 0)));
      const p = planWealthTax(rows);
      for (const t of p.taxes) expect(rows.find((r) => r.name === t.name)!.netWorth).toBeGreaterThanOrEqual(10_000);
      expect(p.shares.reduce((a, x) => a + x.amount, 0)).toBe(p.total);
    }
  });
});
