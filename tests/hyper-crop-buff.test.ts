import { describe, expect, it } from 'vitest';
import { CROP_SEED_MUL, CROPS, FARM_SELL_MUL, HYPER_CROPS, HYPER_CROP_SELL_MUL, ORCHARD_TREES, cropProfit, cropSellValue, isHyperCrop } from '../shared/farm';
import { TROPICAL_CROPS } from '../shared/resort';
import { GOODS } from '../shared/mines';
import { applyRawCropPrices } from '../shared/factory';
import { expectChangelogEntry } from './helpers/changelog';

const OLD_HARVEST: Record<string, number> = {
  tulips: 567,
  roses: 702,
  orchids: 1053,
  saffron: 1620,
  wasabi: 864,
  vanilla: 1215,
};

describe('glasshouse flower crops +50% buff', () => {
  it('raises harvest value of every hyper farm flower by 50%, seeds unchanged', () => {
    expect(HYPER_CROP_SELL_MUL).toBe(1.5);
    expect(HYPER_CROPS.map((c) => c.id)).toEqual(['tulips', 'roses', 'orchids', 'saffron', 'wasabi', 'vanilla']);
    for (const c of HYPER_CROPS) {
      expect(isHyperCrop(c.id)).toBe(true);
      expect(cropSellValue(c)).toBeCloseTo(OLD_HARVEST[c.id]! * HYPER_CROP_SELL_MUL, 1);
      expect(cropSellValue(c)).toBeCloseTo(c.seed * CROP_SEED_MUL * HYPER_CROP_SELL_MUL, 1);
      expect(cropProfit(c)).toBeCloseTo(cropSellValue(c) - c.seed, 6);
    }
    expect(HYPER_CROPS.map((c) => [c.id, c.seed])).toEqual([
      ['tulips', 420],
      ['roses', 520],
      ['orchids', 780],
      ['saffron', 1_200],
      ['wasabi', 640],
      ['vanilla', 900],
    ]);
  });

  it('keeps factory raw prices in lockstep with the buffed harvest value', () => {
    applyRawCropPrices();
    for (const c of HYPER_CROPS) {
      expect(GOODS[`crop_${c.id}`]!.price).toBeCloseTo(cropSellValue(c), 6);
    }
  });

  it('does not change base, resort, or orchard crop value, or the farm sell/payout multipliers', () => {
    expect(FARM_SELL_MUL).toBe(0.95);
    expect(CROP_SEED_MUL).toBe(1.35);
    for (const c of [...CROPS, ...TROPICAL_CROPS, ...ORCHARD_TREES]) {
      expect(isHyperCrop(c.id)).toBe(false);
      expect(cropSellValue(c)).toBeCloseTo(c.sell * FARM_SELL_MUL, 6);
    }
    const wheat = CROPS.find((c) => c.id === 'wheat')!;
    expect(cropSellValue(wheat)).toBeCloseTo(10 * CROP_SEED_MUL, 1);
    const grapes = CROPS.find((c) => c.id === 'grapes')!;
    expect(cropSellValue(grapes)).toBeCloseTo(150 * CROP_SEED_MUL, 1);
    const tobacco = CROPS.find((c) => c.id === 'tobacco')!;
    expect(cropSellValue(tobacco)).toBeCloseTo(30 * CROP_SEED_MUL, 1);
  });

  it('is in the changelog', () => {
    expectChangelogEntry(/Glasshouse flowers pay 50% more/, { from: '2026-11-17T11:50:00-06:00', to: '2026-11-18T00:00:00-06:00' });
  });
});
