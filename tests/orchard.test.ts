import { describe, expect, it } from 'vitest';
import { CROP_SEED_MUL, FARM_SELL_MUL, ORCHARD_TREES, cropById, cropSellValue, cropUnitSeed, growMs, isOrchardCrop, orchardTree } from '../shared/farm';
import { orchardId, orchardPlots, orchardPrice, orchardOf, ORCHARD_ROADS } from '../shared/orchard';
import { properties, propertyById } from '../shared/realEstate';
import { obbOverlap, type OBB } from '../shared/worldLayout';
import { FOOD_STEP_MARKUP, farmFishFoodRecipes, recipeIn, recipeOut } from '../shared/factory';
import { GOODS } from '../shared/mines';
import { hasItemIcon } from '../shared/itemIcons';
import { estateLots, expansionFarms, wineryPlots } from '../shared/mapExpansion';

const H = 60 * 60_000;
const DAY = 24 * H;

describe('Orchard Ridge', () => {
  it('is eight buyable plots on the expanded east map, with road access', () => {
    const plots = orchardPlots();
    expect(plots).toHaveLength(8);
    expect(new Set(plots.map((p) => orchardId(p.n))).size).toBe(8);
    expect(ORCHARD_ROADS.length).toBeGreaterThanOrEqual(2);
    for (const p of plots) {
      expect(p.price).toBe(orchardPrice(p));
      expect(p.price).toBeGreaterThanOrEqual(80_000);
      expect(propertyById(orchardId(p.n))?.type).toBe('orchard');
      expect(propertyById(orchardId(p.n))?.kind).toBe('farm');
      expect(propertyById(orchardId(p.n))?.tiles).toBe(p.cols * p.rows);
      expect(orchardOf(orchardId(p.n))?.n).toBe(p.n);
    }
  });

  it('does not overlap other east-side lots, farms, wineries or itself', () => {
    const added = [
      ...orchardPlots(),
      ...estateLots(),
      ...expansionFarms(),
      ...wineryPlots(),
    ] as OBB[];
    for (let i = 0; i < added.length; i++) {
      for (let j = i + 1; j < added.length; j++) {
        expect(obbOverlap(added[i]!, added[j]!), `${(added[i] as { label?: string }).label ?? i} vs ${j}`).toBe(false);
      }
    }
    expect(properties().filter((p) => p.id.startsWith('orchard:'))).toHaveLength(8);
  });

  it('plants trees once: multi-day maturity, then a repeating fruit cycle with no wither', () => {
    expect(ORCHARD_TREES.map((t) => t.id)).toEqual(['apple', 'cherry', 'peach', 'orange', 'pear', 'plum']);
    for (const t of ORCHARD_TREES) {
      expect(isOrchardCrop(t.id)).toBe(true);
      expect(cropById(t.id)?.id).toBe(t.id);
      expect(orchardTree(t.id)?.cycle).toBe(t.cycle);
      // After the 30% faster grow scale, first fruit is still several real days out.
      expect(t.grow).toBeGreaterThanOrEqual(growMs(5 * DAY));
      expect(t.grow).toBeLessThanOrEqual(growMs(10 * DAY));
      expect(t.cycle).toBeGreaterThanOrEqual(growMs(18 * H));
      expect(t.cycle).toBeLessThan(t.grow);
      // Raw fruit margin matches the farm nerf: cropSellValue ≈ fruit basis × 1.35 (sell × 0.95).
      const unit = cropUnitSeed(t);
      expect(cropSellValue(t)).toBeCloseTo(unit * CROP_SEED_MUL, 2);
      expect(FARM_SELL_MUL).toBe(0.95);
      expect(CROP_SEED_MUL).toBe(1.35);
      // Sapling is a one-time outlay, larger than a single fruit sale.
      expect(t.seed).toBeGreaterThan(unit);
    }
  });

  it('feeds juice, cider and pie recipes at the +8% food step markup', () => {
    for (const id of ['crop_apple', 'crop_cherry', 'crop_peach', 'crop_orange', 'crop_pear', 'crop_plum', 'apple_juice', 'cider', 'apple_pie', 'cherry_pie', 'peach_jam', 'orange_juice']) {
      expect(GOODS[id], id).toBeTruthy();
      expect(hasItemIcon('good', id), id).toBe(true);
    }
    const ids = ['apple_juice', 'orange_juice', 'cider', 'apple_pie', 'cherry_pie', 'peach_jam'];
    const recs = farmFishFoodRecipes().filter((r) => ids.includes(r.out[0].split(':')[1]!));
    expect(recs.length).toBeGreaterThanOrEqual(6);
    for (const r of recs) {
      expect(recipeOut(r) / recipeIn(r)).toBeCloseTo(FOOD_STEP_MARKUP, 8);
    }
  });
});
