import { expect, it } from 'vitest';
import { CROPS, cropOutlook } from '../shared/farm';
import { combinedGrowMul } from '../shared/farmUpgrades';
it('crop outlook applies grow multipliers and yield bonus, no price multiplier (#33, #27)', () => {
  const c = CROPS[0]!;
  expect(cropOutlook(c)).toEqual({ grow: c.grow, profit: Math.floor(c.sell * 0.95 - c.seed) }); // farming -5%
  const o = cropOutlook(c, combinedGrowMul(0.8, 2), 1, 0.3);
  expect(o.grow).toBe(Math.round(c.grow * Math.max(0.5, 0.8 * 0.8)));
  expect(o.profit).toBe(Math.floor(c.sell * 0.95 * 1.3 - c.seed));
});
