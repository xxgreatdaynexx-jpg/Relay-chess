import { describe, expect, it } from 'vitest';
import { FRECIPES, nameOfKey } from '../shared/factory';
import { RECIPE_ITEMS, matchScore, recipesOfItem, searchItems } from '../shared/factorySearch';

describe('factory recipe search', () => {
  it('ranks exact > prefix > word > substring > fuzzy, and rejects misses', () => {
    expect(matchScore('copper ore', 'Copper Ore')).toBe(100);
    expect(matchScore('cop', 'Copper Ore')).toBe(80);
    expect(matchScore('ore', 'Copper Ore')).toBe(60);
    expect(matchScore('ppe', 'Copper Ore')).toBe(40);
    expect(matchScore('cpr', 'Copper Ore')).toBe(10);
    expect(matchScore('zzz', 'Copper Ore')).toBe(0);
    expect(matchScore('', 'Copper Ore')).toBe(0);
  });
  it('finds every recipe item by its own name', () => {
    for (const k of RECIPE_ITEMS) expect(searchItems(nameOfKey(k), 50)).toContain(k);
    expect(searchItems('qqqxx')).toEqual([]);
  });
  it('used-in and made-by match the recipe table exactly', () => {
    for (const k of RECIPE_ITEMS) {
      const r = recipesOfItem(k);
      expect(r.usedIn.map((x) => x.id).sort()).toEqual(FRECIPES.filter((x) => x.in.some(([i]) => i === k)).map((x) => x.id).sort());
      expect(r.madeBy.every((x) => x.out[0] === k)).toBe(true);
      expect(r.usedIn.length + r.madeBy.length).toBeGreaterThan(0);
    }
  });
});
