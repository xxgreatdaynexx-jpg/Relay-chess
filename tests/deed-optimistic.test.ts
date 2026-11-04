import { describe, expect, it } from 'vitest';
import { optimisticOwn, sellBackOf } from '../shared/realEstate';
describe('optimistic deed after buy/buyout keeps the sell-back basis (Tess QA #7)', () => {
  it('Factory bought for 600k then bought out at 1.2M: sell-back stays 420k', () => {
    const o = optimisticOwn({ id: 'factory', owner: 'a', price: 600_000, arrears: 0, boughtAt: 0 }, 're_buyout', 'factory', 'b', 1_200_000, 1);
    expect(o.basis).toBe(600_000); expect(sellBackOf(Math.min(o.price, o.basis ?? o.price))).toBe(420_000);
  });
  it('second buyout keeps the original city basis; plain buy has none', () => {
    expect(optimisticOwn({ id: 'f', owner: 'b', price: 1_200_000, basis: 600_000, arrears: 0, boughtAt: 0 }, 're_buyout', 'f', 'c', 2_400_000, 1).basis).toBe(600_000);
    expect(optimisticOwn(undefined, 're_buy', 'f', 'a', 600_000, 1).basis).toBeUndefined();
  });
});
