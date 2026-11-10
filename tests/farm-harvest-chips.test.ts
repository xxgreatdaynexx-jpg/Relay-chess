import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cropById, farmHarvestChips, farmPayout } from '../shared/farm';
import { indexed } from '../shared/priceIndex';

describe('farmHarvestChips', () => {
  const carrot = cropById('carrot')!;
  const index = 1.3048;
  const tiles = 576;
  const seedsBase = carrot.seed * tiles;
  const seedIndexed = tiles * indexed(carrot.seed, index);

  it('matches seed plus indexed profit when the harvest is profitable', () => {
    const profit = farmPayout(7_062, 0);
    const legacy = Math.floor((seedsBase + profit) * index);
    expect(farmHarvestChips(seedsBase, profit, index, seedIndexed)).toBe(legacy);
    expect(legacy).toBeGreaterThan(seedIndexed);
  });

  it('never pays less than the same px seed cost charged at plant, even if profit payout is 0', () => {
    // Live carter2 cf:1007 carrot loops: floor(576×15×1.3048)=11,273 refund vs 576×round(15×1.3048)=11,520 replant.
    expect(Math.floor(seedsBase * index)).toBe(11_273);
    expect(seedIndexed).toBe(11_520);
    expect(farmHarvestChips(seedsBase, 0, index, seedIndexed)).toBe(11_520);
    expect(farmHarvestChips(carrot.seed * 42, 0, index, 42 * indexed(carrot.seed, index))).toBe(840);
  });

  it('at index 1 equals seed + payout (no rounding gap)', () => {
    expect(farmHarvestChips(40, 20, 1, 40)).toBe(60);
  });
});


describe('farm cap UI cleanup', () => {
  it('farm panel and wiki no longer describe a daily farm profit cap', () => {
    const ui = readFileSync('client/src/components/FarmGame.tsx', 'utf8');
    expect(ui).toMatch(/data-testid="farm-today"/);
    expect(ui).toMatch(/no daily farm profit cap/);
    expect(ui).not.toMatch(/FARM_TIERS/);
    expect(ui).not.toMatch(/daily cap ≈/);
    const wiki = readFileSync('shared/wiki.ts', 'utf8');
    expect(wiki).not.toMatch(/Daily farm sell cap/);
    expect(wiki).not.toMatch(/FARM_TIERS/);
  });
});
