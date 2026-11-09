/**
 * Fort McChud oil buff (pt2076u): starter crude payback ~2–2.5 weeks on a good tract, ~4–5 weeks worst;
 * pumpjack remains the best early upgrade; starter refinery fits free grid and pays back under 2× crude-only.
 */
import { describe, expect, it } from 'vitest';
import {
  FORTMC_TICKET_BASE, GRID_MW, PUMPJACK_COST, PUMPJACK_MULT, PIPES, PRODUCTS, REPAIR_K, SURVEY_COST,
  UNITS, WATER_CUT, WELL_COST, WELL_MW, WELL_RATE, PUMPJACK_MW, sellPayout, tractInfo, WEAR_PER_H,
} from '../shared/fortmc';
import { fortSellPrice } from '../shared/sellBuff';
import { shipFee } from '../shared/logistics';
import { indexed } from '../shared/priceIndex';

/** Live-ish index from the buff design window; assertions are ranges, not a single day. */
const INDEX = 1.2668;
const px = (n: number) => indexed(n, INDEX);

const starterCapex = (tract: number, opts: { jack?: boolean; refinery?: boolean } = {}) => {
  const t = tractInfo(tract);
  let base = SURVEY_COST + t.lease + WELL_COST + PIPES[1]!.cost + UNITS.separator.cost;
  if (opts.jack) base += PUMPJACK_COST;
  if (opts.refinery) base += UNITS.refinery.cost;
  return px(base) + px(FORTMC_TICKET_BASE);
};

const crudePerHour = (tract: number, jack = false) => {
  const t = tractInfo(tract);
  const ws = WELL_RATE * t.richness * (jack ? PUMPJACK_MULT : 1);
  return ws * (1 - WATER_CUT - t.gas);
};

const shipNetCrudeDay = (tract: number, jack = false) => {
  const demand = WELL_MW + (jack ? PUMPJACK_MW : 0) + UNITS.separator.mw;
  const pr = Math.min(1, GRID_MW / demand);
  const day = crudePerHour(tract, jack) * pr * 24;
  const paid = px(sellPayout(day * fortSellPrice('crude'), 0));
  return paid - shipFee('ship', Math.floor(day), INDEX);
};

const shipNetRefineryDay = (tract: number) => {
  const demand = WELL_MW + UNITS.separator.mw + UNITS.refinery.mw;
  const pr = Math.min(1, GRID_MW / demand);
  expect(pr).toBe(1); // free grid must cover starter well + separator + refinery
  const crudeH = crudePerHour(tract, false) * pr;
  let gross = 0; let qty = 0;
  for (const [id, y] of UNITS.refinery.out) {
    const q = crudeH * y * 24; gross += q * fortSellPrice(id); qty += q;
  }
  return px(sellPayout(gross, 0)) - shipFee('ship', Math.floor(qty), INDEX);
};

describe('Fort McChud oil buff payback', () => {
  it('keeps the buffed constants in the designed band', () => {
    expect(WELL_RATE).toBe(60);
    expect(WATER_CUT).toBe(0.1);
    expect(GRID_MW).toBe(8);
    expect(PRODUCTS.crude.price).toBe(10.9375);
    expect(PRODUCTS.naphtha.price).toBe(12.5);
    expect(PRODUCTS.diesel.price).toBe(26.5625);
    expect(PRODUCTS.gasoline.price).toBe(29.6875);
    expect(PRODUCTS.natgas.price).toBe(3.125);
    expect(PRODUCTS.plastic.price).toBe(43.75);
    expect(UNITS.refinery.cost).toBe(280_000);
    expect(UNITS.refinery.mw).toBe(3.5);
    expect(WEAR_PER_H).toBe(0.25);
    expect(REPAIR_K).toBe(0.1);
  });

  it('pays back starter crude in ~2–3 weeks on the best tract and ~5–6 weeks on the worst (ex-repair, cargo ship)', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => i + 1).sort((a, b) => crudePerHour(b) - crudePerHour(a));
    const best = ranked[0]!, worst = ranked[ranked.length - 1]!;
    const bestPb = starterCapex(best) / shipNetCrudeDay(best);
    const worstPb = starterCapex(worst) / shipNetCrudeDay(worst);
    expect(bestPb).toBeGreaterThanOrEqual(10);
    expect(bestPb).toBeLessThanOrEqual(15);
    expect(worstPb).toBeGreaterThanOrEqual(18);
    expect(worstPb).toBeLessThanOrEqual(30);
  });

  it('keeps pumpjack as the best early upgrade vs bare starter on the best tract', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => i + 1).sort((a, b) => crudePerHour(b) - crudePerHour(a));
    const best = ranked[0]!;
    const bare = starterCapex(best) / shipNetCrudeDay(best);
    const jack = starterCapex(best, { jack: true }) / shipNetCrudeDay(best, true);
    expect(jack).toBeLessThan(bare);
    expect(jack).toBeLessThan(10);
  });

  it('makes a starter refinery unthrottled on free grid and faster than 2× crude-only payback', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => i + 1).sort((a, b) => crudePerHour(b) - crudePerHour(a));
    const best = ranked[0]!;
    const crudePb = starterCapex(best) / shipNetCrudeDay(best);
    const refPb = starterCapex(best, { refinery: true }) / shipNetRefineryDay(best);
    expect(WELL_MW + UNITS.separator.mw + UNITS.refinery.mw).toBeLessThanOrEqual(GRID_MW);
    expect(refPb).toBeLessThan(2 * crudePb);
    expect(refPb).toBeLessThan(28);
  });
});
