import { describe, it, expect } from 'vitest';
import { SOLDIER_FILL, SOLDIER_CUT } from '../client/src/lib/soldier';
describe('conquest soldier emblem', () => {
  it('has closed paths inside the 100x100 grid', () => {
    expect(SOLDIER_FILL.length).toBeGreaterThan(10);
    for (const d of SOLDIER_FILL) {
      expect(d.trim().endsWith('Z')).toBe(true);
      for (const n of d.match(/-?\d+(\.\d+)?/g)!.map(Number)) { expect(n).toBeGreaterThanOrEqual(-1); expect(n).toBeLessThanOrEqual(100); }
    }
    for (const c of SOLDIER_CUT) expect(c).toHaveLength(5);
  });
});
