import { describe, it, expect } from 'vitest';
import { lootCount, lootCountFor, lootOreDepth, MOB_ORDER, type MobKind } from '../shared/mineCombat';
import { MAX_FLOOR } from '../shared/mineFloors';
import { ORES, oreFor, type OreId } from '../shared/mines';
import { levelOf } from '../shared/mineFloors';

/** Historic curve before Conner's depth scaling (1 + floor/10). */
const oldLootCount = (floor: number) => 1 + Math.floor(Math.min(MAX_FLOOR, floor) / 10);

describe('enemy loot scales with floor depth (Conner)', () => {
  it('is positive, bounded and monotonic across representative floors', () => {
    let prev = 0;
    for (const f of [1, 3, 5, 6, 10, 11, 15, 20, 22, 30, 31, 37, 40]) {
      const n = lootCount(f);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(12);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(lootCount(1)).toBe(1);
    expect(lootCount(3)).toBe(1);
    expect(lootCount(10)).toBe(2);
    expect(lootCount(40)).toBe(8);
  });

  it('does not nerf early floors vs the prior curve; deep floors improve', () => {
    for (const f of [1, 2, 3, 4, 5, 8, 9, 10]) expect(lootCount(f)).toBeGreaterThanOrEqual(oldLootCount(f));
    expect(lootCount(20)).toBeGreaterThan(oldLootCount(20));
    expect(lootCount(30)).toBeGreaterThan(oldLootCount(30));
    expect(lootCount(40)).toBeGreaterThan(oldLootCount(40));
  });

  it('kind bonuses raise golem/wraith/boss without exceeding the soft cap', () => {
    for (const f of [14, 22, 31, 37, 40]) {
      const base = lootCount(f);
      expect(lootCountFor('slime', f)).toBe(base);
      expect(lootCountFor('golem', f)).toBeGreaterThanOrEqual(base);
      expect(lootCountFor('wraith', f)).toBeGreaterThanOrEqual(base);
      expect(lootCountFor('boss', f)).toBeGreaterThanOrEqual(lootCountFor('golem', f));
      for (const k of ['slime', 'bat', 'crab', 'golem', 'wraith', 'boss'] as MobKind[]) {
        expect(lootCountFor(k, f)).toBeLessThanOrEqual(12);
      }
    }
  });

  it('loot ore depth never drops below the historic 3 and rises deeper', () => {
    expect(lootOreDepth(1)).toBe(3);
    expect(lootOreDepth(10)).toBe(3);
    expect(lootOreDepth(11)).toBe(4);
    expect(lootOreDepth(40)).toBeGreaterThanOrEqual(lootOreDepth(20));
  });

  it('expected chip value of kill loot rises with depth in each combat city mine', () => {
    const caves = ['mine', 'frost', 'magma'] as const;
    const price = (id: OreId) => ORES[id].price;
    for (const cave of caves) {
      const ev = (floor: number, kind: MobKind = 'slime') => {
        const lvl = levelOf(cave, floor);
        const n = lootCountFor(kind, floor);
        const depth = lootOreDepth(floor);
        let sum = 0;
        const trials = 2000;
        for (let i = 0; i < trials; i++) {
          // deterministic stream per trial
          let x = (i * 1103515245 + floor * 12345 + cave.charCodeAt(0)) >>> 0;
          for (let k = 0; k < n; k++) {
            x = (x * 1664525 + 1013904223) >>> 0;
            const r = (x >>> 0) / 0x100000000;
            sum += price(oreFor(depth, r, lvl.bias, lvl.anyDepth));
          }
        }
        return sum / trials;
      };
      expect(ev(20)).toBeGreaterThan(ev(3));
      expect(ev(40, 'boss')).toBeGreaterThan(ev(20));
      expect(ev(3)).toBeGreaterThan(0);
    }
  });

  it('MOB_ORDER kinds stay covered by lootCountFor', () => {
    for (const k of MOB_ORDER) expect(lootCountFor(k, 40)).toBeGreaterThan(0);
  });
});
