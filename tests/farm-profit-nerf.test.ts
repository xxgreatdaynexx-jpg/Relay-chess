import { describe, it, expect } from 'vitest';
import { CROPS, FARM_SELL_MUL, cropProfit, cropSellValue } from '../shared/farm';

describe('Farming profit -5%', () => {
  it('sells crops at 95% of their listed value; seed costs unchanged', () => {
    expect(FARM_SELL_MUL).toBe(0.9025);
    const w = CROPS.find((c) => c.id === 'wheat')!;
    expect(w.seed).toBe(10); expect(w.sell).toBe(16);
    expect(cropSellValue(w)).toBeCloseTo(14.44); expect(cropProfit(w)).toBeCloseTo(4.44);
    const s = CROPS.find((c) => c.id === 'sunflower')!;
    expect(cropSellValue(s)).toBeCloseTo(491.8625); expect(cropProfit(s)).toBeCloseTo(241.8625);
  });
  it('every crop still sells for more than its seed (never a loss)', () => {
    for (const c of CROPS) { expect(cropSellValue(c)).toBeGreaterThan(c.seed); expect(cropProfit(c)).toBeGreaterThan(0); }
  });
});
