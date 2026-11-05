import { describe, it, expect } from 'vitest';
import { CROPS, FARM_SELL_MUL, cropProfit, cropSellValue } from '../shared/farm';

describe('Farming profit -5%', () => {
  it('sells crops at 95% of their listed value; seed costs unchanged', () => {
    expect(FARM_SELL_MUL).toBe(0.95);
    const w = CROPS.find((c) => c.id === 'wheat')!;
    expect(w.seed).toBe(10);
    expect(cropProfit(w)).toBeCloseTo(2, 1); // crop margins: 20% of seed
    const s = CROPS.find((c) => c.id === 'sunflower')!;
    expect(cropProfit(s)).toBeCloseTo(50, 1);
  });
  it('every crop still sells for more than its seed (never a loss)', () => {
    for (const c of CROPS) { expect(cropSellValue(c)).toBeGreaterThan(c.seed); expect(cropProfit(c)).toBeGreaterThan(0); }
  });
});
