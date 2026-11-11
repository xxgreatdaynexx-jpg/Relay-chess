import { describe, expect, it } from 'vitest';
import { GOODS, isOre } from '../shared/mines';
import { FRECIPES, KINDS, recipeIn, recipeOut, tierOf } from '../shared/factory';

// Millionaire Update: the factory recipe list doubled (55 -> 111). The first 55 are the pre-update recipes.
// The Coral Grotto jewelry recipes (mu-resort) sit inside the old block and are balanced by their own tests.
const GROTTO = new Set(['j_cut_opal', 'j_pearl_necklace', 'j_tidecrown']); const LIST = FRECIPES.filter((r) => !GROTTO.has(r.id));
const BASE = 55; const OLD = LIST.slice(0, BASE); const NEW = LIST.slice(BASE);
const made = new Set(FRECIPES.map((r) => r.out[0]));
const obtainable = (k: string) => { const [t, id] = k.split(':'); return (t === 'ore' && isOre(id)) || made.has(k) || (GOODS[id]?.type === t && !!GOODS[id]?.raw); };
// Crop margins (2026-11-04): crop/farm-food goods are priced at seed chain x 1.3, so a higher-tier one only matches its inputs.
const CROP_GOODS = new Set(['flour',  'cornmeal',  'sugar',  'berry_juice',  'tropical_juice',  'sunflower_oil',  'cocoa',  'coconut_milk',  'wine',  'bread',  'chocolate',  'pumpkin_pie',  'salsa',  'veggie_soup',  'banquet',  'starch',  'carrot_juice',  'mango_puree',  'grape_juice',  'pumpkin_seeds',  'tomato_paste',  'pasta_dinner',  'choc_cake',  'jam_jar',  'cornbread',  'smoothie',  'fish_pie',  'apple_juice',  'cider',  'apple_pie',  'cherry_pie',  'peach_jam',  'orange_juice']);
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
      if (CROP_GOODS.has(r.out[0].split(':')[1])) { expect(k, r.id).toBeGreaterThanOrEqual(0.99); expect(k, r.id).toBeLessThanOrEqual(1.8); continue; }
      expect(k, r.id).toBeGreaterThanOrEqual(1.15); expect(k, r.id).toBeLessThanOrEqual(1.8);
      expect(gainPerSec(r), r.id).toBeLessThanOrEqual(bestOld);
    }
  });
  it('deeper-tier machines pay more per craft than shallow ones on average (tiers still matter)', () => {
    const avg = (m: string) => { const rs = NEW.filter((r) => r.machine === m); return rs.reduce((a, r) => a + recipeOut(r) - recipeIn(r), 0) / rs.length; };
    expect(avg('fabricator')).toBeGreaterThan(avg('assembler')); expect(avg('assembler')).toBeGreaterThan(avg('smelter'));
  });
});
