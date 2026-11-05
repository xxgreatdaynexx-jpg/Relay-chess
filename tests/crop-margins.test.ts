import { describe, it, expect } from 'vitest';
import { CROPS, FARM_SELL_MUL, cropProfit } from '../shared/farm';
import { TROPICAL_CROPS } from '../shared/resort';
import { GOODS, priceOf } from '../shared/mines';
import { FRECIPES } from '../shared/factory';
import { sellBuffOf, houseSellPrice } from '../shared/sellBuff';

// Crop economics rule (Dayne, 2026-11-04): raw harvest profit = 20% of seed; seed->factory chains = 30% of the seed consumed
// (non-crop inputs passed through at their house value); Wine fixed at 700.
const ALL = [...CROPS, ...TROPICAL_CROPS];
const seedOf = new Map(ALL.map((c) => [`good:crop_${c.id}`, c.seed]));
const madeBy = (k: string) => FRECIPES.find((r) => r.out[0] === k);
const farmChain = (k: string, seen = new Set<string>()): boolean => { if (seedOf.has(k)) return true; if (seen.has(k)) return false; seen.add(k); const r = madeBy(k); return !!r && r.in.some(([i]) => farmChain(i, seen)); };
function cost(k: string): { seed: number; other: number } {
  if (seedOf.has(k)) return { seed: seedOf.get(k)!, other: 0 };
  if (k === 'good:wine') return { seed: 0, other: 700 };
  const r = madeBy(k);
  if (r && farmChain(k)) { let seed = 0, other = 0; for (const [i, q] of r.in) { const c = cost(i); seed += q * c.seed; other += q * c.other; } return { seed: seed / r.out[1], other: other / r.out[1] }; }
  const [t, id] = k.split(':'); return { seed: 0, other: GOODS[id]?.raw ? priceOf({ type: t as 'good', id }) : houseSellPrice({ type: t, id }) };
}
const farmGoods = [...new Set(FRECIPES.map((r) => r.out[0]))].filter((k) => k.startsWith('good:') && farmChain(k) && k !== 'good:wine');

describe('Crop margins: raw 20%, factory 30%, wine 700', () => {
  it('raw harvest profit is 20% of the seed for every crop (after FARM_SELL_MUL)', () => {
    for (const c of ALL) expect(cropProfit(c)).toBeCloseTo(0.2 * c.seed, 1);
    expect(FARM_SELL_MUL).toBeGreaterThan(0);
  });
  it('crop reference prices (recipe value) = seed x 1.2', () => {
    for (const c of ALL) expect(GOODS[`crop_${c.id}`].price).toBeCloseTo(1.2 * c.seed, 2);
  });
  it('every seed-to-factory chain profits 30% of the seed consumed', () => {
    expect(farmGoods.length).toBeGreaterThanOrEqual(13);
    for (const k of farmGoods) {
      const { seed, other } = cost(k); const sell = houseSellPrice({ type: 'good', id: k.slice(5) });
      expect(seed, k).toBeGreaterThan(0);
      expect(sell - seed - other, k).toBeCloseTo(0.3 * seed, 1);
    }
  });
  it('farm goods get no factory depth buff (buff handled as 1 + buff = 1)', () => {
    for (const k of [...farmGoods, 'good:wine']) expect(sellBuffOf(k), k).toBe(0);
  });
  it('wine stays 700: 2 grapes (300 seed) -> 400 profit', () => {
    expect(GOODS.wine.price).toBe(700);
    expect(GOODS.wine.price - 2 * seedOf.get('good:crop_grapes')!).toBe(400);
  });
  it('factory route is never worse than selling raw (per seed chip)', () => {
    for (const k of farmGoods) { const { seed, other } = cost(k); expect((houseSellPrice({ type: 'good', id: k.slice(5) }) - seed - other) / seed, k).toBeGreaterThanOrEqual(0.2); }
  });
});
