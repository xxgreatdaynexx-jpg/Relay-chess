import { describe, expect, it } from 'vitest';
import { FRECIPES, PRESTIGE_RECIPE_IDS, isPrestigeRecipe, recipeIn, recipeOut } from '../shared/factory';
import { GOODS } from '../shared/mines';

const gainPerSec = (r: (typeof FRECIPES)[number]) => (recipeOut(r) - recipeIn(r)) / r.secs;

describe('prestige factory line', () => {
  it('adds nine unique prestige crafts with obtainable outputs', () => {
    expect(PRESTIGE_RECIPE_IDS.size).toBe(9);
    for (const id of PRESTIGE_RECIPE_IDS) {
      const r = FRECIPES.find((x) => x.id === id)!;
      expect(r, id).toBeTruthy();
      expect(isPrestigeRecipe(id)).toBe(true);
      const outId = r.out[0].split(':')[1]!;
      expect(GOODS[outId]?.price, id).toBeGreaterThan(0);
    }
    expect(new Set(FRECIPES.filter((r) => isPrestigeRecipe(r.id)).map((r) => r.out[0])).size).toBe(9);
  });

  it('marks up about 25% and never out-earns the best pre-Millionaire recipe per second', () => {
    const old = FRECIPES.filter((r) => !['j_cut_opal', 'j_pearl_necklace', 'j_tidecrown'].includes(r.id)).slice(0, 55);
    const bestOld = Math.max(...old.map(gainPerSec));
    for (const r of FRECIPES.filter((x) => isPrestigeRecipe(x.id))) {
      const k = recipeOut(r) / recipeIn(r);
      expect(k, r.id).toBeGreaterThanOrEqual(1.15);
      expect(k, r.id).toBeLessThan(1.4);
      expect(gainPerSec(r), r.id).toBeLessThanOrEqual(bestOld);
    }
  });
});
