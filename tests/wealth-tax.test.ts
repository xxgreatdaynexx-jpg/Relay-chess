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
  it('threshold is 2× median', () => {
    const p = planWealthTax([R('a', 10), R('b', 100), R('c', 1_000_000)]);
    expect(p.threshold).toBe(200); expect(p.taxes).toEqual([{ name: 'c', amount: 9_998, netWorth: 1_000_000 }]);
    expect(p.shares).toEqual([{ name: 'a', amount: 4_999 }, { name: 'b', amount: 4_999 }]);
  });
});
