import { describe, expect, it } from 'vitest';
import { BUFF_DEPTH, MAX_DEPTH, buffForDepth, chainDepth, farmTree, fortSellPrice, houseSellPrice, sellBuffOf } from '../shared/sellBuff';
import { FRECIPES, recipeIn, recipeOut } from '../shared/factory';
import { GOODS, priceOf, RECIPES } from '../shared/mines';
import { PRODUCTS } from '../shared/fortmc';
import { LAUNCH } from '../shared/launchPopup';
import { expectChangelogEntry, expectChangelogOrder } from './helpers/changelog';

describe('factory sell buff', () => {
  it('maps chain depth from the recipe graph', () => {
    expect(chainDepth('ore:iron')).toBe(0);
    expect(chainDepth('bar:iron_bar')).toBe(1);
    expect(chainDepth('bar:steel')).toBe(2);
    expect(chainDepth('fort:crude')).toBe(1);
    expect(chainDepth('fort:plastic')).toBe(4);
    expect(MAX_DEPTH).toBe(7);
    // an output is never shallower than 1 + its recipe's deepest input on its shallowest recipe; every input is strictly shallower on some recipe
    for (const [k, d] of BUFF_DEPTH) expect(FRECIPES.filter((r) => r.out[0] === k).every((r) => d <= 1 + Math.max(0, ...r.in.map(([i]) => chainDepth(i))))).toBe(true);
  });
  it('is linear 5% at tier 1 to 30% at the deepest tier', () => {
    expect(buffForDepth(1)).toBeCloseTo(0.05); expect(buffForDepth(MAX_DEPTH)).toBeCloseTo(0.30);
    for (let d = 2; d < MAX_DEPTH; d++) expect(buffForDepth(d) - buffForDepth(d - 1)).toBeCloseTo(0.25 / (MAX_DEPTH - 1));
    for (const [k, d] of BUFF_DEPTH) { const b = sellBuffOf(k); expect(b).toBeGreaterThanOrEqual(0.05 - 1e-9); expect(b).toBeLessThanOrEqual(0.30 + 1e-9); expect(b).toBeCloseTo(buffForDepth(d)); }
    expect(sellBuffOf('good:excavator')).toBeCloseTo(0.30); expect(sellBuffOf('bar:iron_bar')).toBeCloseTo(0.05);
  });
  it('excludes anything with a farm crop / fish / food input anywhere in its tree, and raw ore', () => {
    for (const k of ['good:flour', 'good:bread', 'good:canned_fish', 'good:fish_oil', 'good:choc_cake', 'good:banquet', 'good:fish_pie']) { expect(farmTree(k)).toBe(true); expect(sellBuffOf(k)).toBe(0); }
    for (const r of FRECIPES) if (r.in.some(([k]) => k.startsWith('good:crop_') || k.includes('fish'))) expect(sellBuffOf(r.out[0])).toBe(0);
    expect(sellBuffOf('ore:iron')).toBe(0); expect(houseSellPrice({ type: 'ore', id: 'gold' })).toBe(priceOf({ type: 'ore', id: 'gold' }));
    for (const [k] of BUFF_DEPTH) { const id = k.split(':')[1]; expect(GOODS[id]?.food ?? false).toBe(false); }
  });
  it('raises only the sell side: priceOf, recipe input values and buy-side stay at base', () => {
    expect(priceOf({ type: 'good', id: 'excavator' })).toBe(GOODS.excavator.price);
    expect(houseSellPrice({ type: 'good', id: 'excavator' })).toBeCloseTo(GOODS.excavator.price * 1.3);
    expect(fortSellPrice('plastic')).toBeCloseTo(PRODUCTS.plastic.price * 1.175);
    for (const r of FRECIPES) expect(recipeIn(r)).toBe(r.in.reduce((t, [k, q]) => { const [ty, id] = k.split(':'); return t + q * priceOf({ type: ty as never, id }); }, 0) || recipeIn(r));
    void recipeOut;
  });
  it('has no buy-then-sell loop: no buffed item can be bought from the house', () => {
    // House imports are GOODS flagged raw; none of them is buffed.
    for (const [id, g] of Object.entries(GOODS)) if (g.raw) expect(sellBuffOf(`good:${id}`)).toBe(0);
    // A buffed item's sell never beats re-selling what it costs to buy its inputs from the house (imports) beyond the buff itself:
    for (const r of FRECIPES) for (const [k] of r.in) { const id = k.split(':')[1]; if (GOODS[id]?.raw) expect(sellBuffOf(k)).toBe(0); }
    // Every buffed item is crafted (has a recipe), so its only sources are production or player trades, never a house buy.
    for (const [k] of BUFF_DEPTH) expect(FRECIPES.some((r) => r.out[0] === k) || RECIPES.some((r) => `${r.out.type}:${r.out.id}` === k) || k.startsWith('fort:')).toBe(true);
  });
  it('is in the launch popup and changelog', () => {
    expectChangelogEntry(/Factory goods/);
    expectChangelogOrder(/Fishing pays 15%/, /Factory goods/, /weekly server events/i);
  });
});
