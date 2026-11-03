import { describe, expect, it } from 'vitest';
import { bonusCrops, farmingYieldBonus, FARMING_MAX_YIELD } from '../shared/skillPerks';
import { cropOutlook, cropById } from '../shared/farm';

describe('farming level bonus yield', () => {
  it('scales 0 at level 1 to +25% at 99', () => { expect(farmingYieldBonus(1)).toBe(0); expect(farmingYieldBonus(99)).toBeCloseTo(FARMING_MAX_YIELD); expect(farmingYieldBonus(50)).toBeCloseTo(0.125); });
  it('rolls the fractional part as a chance', () => {
    expect(bonusCrops(16, 0.25, () => 0.99)).toBe(4);
    expect(bonusCrops(10, 0.125, () => 0.2)).toBe(2); // 1.25 -> 1 + (0.2 < 0.25)
    expect(bonusCrops(10, 0.125, () => 0.3)).toBe(1);
    expect(bonusCrops(5, 0, () => 0)).toBe(0);
  });
  it('profit preview includes the bonus crops', () => {
    const c = cropById('wheat')!; expect(cropOutlook(c, 1, 1, 0).profit).toBe(c.sell - c.seed);
    expect(cropOutlook(c, 1, 1, 0.25).profit).toBe(Math.floor(c.sell * 1.25 - c.seed));
  });
});
