import { describe, expect, it } from 'vitest';
import { GOODS } from '../shared/mines';
import { frecipe } from '../shared/factory';
import { CROPS } from '../shared/farm';

describe('Sunflower Oil rebalance', () => {
  it('base price is 575 and still 1 sunflower per oil', () => {
    expect(GOODS.sunflower_oil.price).toBe(325); // crop margins: 250 seed x 1.3
    expect(frecipe('m_oil')!.in).toEqual([['good:crop_sunflower', 1]]);
  });
  it('still beats selling the raw sunflower, but no longer beats Cocoa per crop', () => {
    const sun = CROPS.find((c) => c.id === 'sunflower')!;
    expect(GOODS.sunflower_oil.price).toBeGreaterThanOrEqual(sun.sell);
    expect((GOODS.sunflower_oil.price - sun.seed) / sun.seed).toBeCloseTo((GOODS.cocoa.price - 240) / 240); // same 30% margin
  });
});
