import { describe, expect, it } from 'vitest';
import { GOODS, isOre } from '../shared/mines';
import { FRECIPES, KINDS, recipeIn, recipeOut, tierOf } from '../shared/factory';

// Millionaire Update: the factory recipe list doubled (55 -> 111). The first 55 are the pre-update recipes.
const BASE = 55; const OLD = FRECIPES.slice(0, BASE); const NEW = FRECIPES.slice(BASE);
const made = new Set(FRECIPES.map((r) => r.out[0]));
const obtainable = (k: string) => { const [t, id] = k.split(':'); return (t === 'ore' && isOre(id)) || made.has(k) || (GOODS[id]?.type === t && !!GOODS[id]?.raw); };
const gainPerSec = (r: (typeof FRECIPES)[number]) => (recipeOut(r) - recipeIn(r)) / r.secs;

describe('mu-factory: doubled recipes stay balanced', () => {
  it('has at least double the recipes, all with unique ids and outputs', () => {
    expect(FRECIPES.length).toBeGreaterThanOrEqual(BASE * 2);
    expect(new Set(FRECIPES.map((r) => r.id)).size).toBe(FRECIPES.length);
    expect(new Set(NEW.map((r) => r.out[0])).size).toBe(NEW.length);
    for (const r of NEW) expect(OLD.some((o) => o.out[0] === r.out[0]), r.id).toBe(false);
  });
  it('every new input is obtainable (ore, a raw import, or another recipe) and the chain has no loops', () => {
    for (const r of NEW) {
      for (const [k] of r.in) expect(obtainable(k), `${r.id} needs ${k}`).toBe(true);
      expect(Number.isFinite(tierOf(r.out[0])), r.id).toBe(true);
      const [t, id] = r.out[0].split(':'); expect(GOODS[id]?.type, r.id).toBe(t); expect(GOODS[id].price, r.id).toBeGreaterThan(0);
      expect(KINDS[r.machine].machine, r.id).toBe(true);
    }
  });
  it('new recipes add 15-80% value (inside the old band) and never out-earn the best old recipe per second', () => {
    const bestOld = Math.max(...OLD.map(gainPerSec));
    for (const r of NEW) {
      const k = recipeOut(r) / recipeIn(r);
      expect(k, r.id).toBeGreaterThanOrEqual(1.15); expect(k, r.id).toBeLessThanOrEqual(1.8);
      expect(gainPerSec(r), r.id).toBeLessThanOrEqual(bestOld);
    }
  });
  it('deeper-tier machines pay more per craft than shallow ones on average (tiers still matter)', () => {
    const avg = (m: string) => { const rs = NEW.filter((r) => r.machine === m); return rs.reduce((a, r) => a + recipeOut(r) - recipeIn(r), 0) / rs.length; };
    expect(avg('fabricator')).toBeGreaterThan(avg('assembler')); expect(avg('assembler')).toBeGreaterThan(avg('smelter'));
  });
});
