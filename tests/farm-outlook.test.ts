import { expect, it } from 'vitest';
import { CROPS, cropOutlook } from '../shared/farm';
import { combinedGrowMul, fertilizerProfitMul } from '../shared/farmUpgrades';
it('crop outlook applies grow + profit multipliers (#33)', () => {
  const c = CROPS[0]!;
  expect(cropOutlook(c)).toEqual({ grow: c.grow, profit: c.sell - c.seed });
  const o = cropOutlook(c, combinedGrowMul(0.8, 2), fertilizerProfitMul(3));
  expect(o.grow).toBe(Math.round(c.grow * Math.max(0.5, 0.8 * 0.8)));
  expect(o.profit).toBe(Math.floor((c.sell - c.seed) * 1.3));
});
