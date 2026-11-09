import { describe, it, expect } from 'vitest';
import {
  JOBS, jobById, itemsPerDay, MINER_CAVES, minerPriorityOptions, minerItemEv,
  rollOre, rollWorkerFish, expectedDayHaul, formatExpectedDay, approxQty, fisherCatchTable, FISHER_ITEM_EV,
} from '../shared/employment';
import { ORES, type OreId } from '../shared/mines';

function seeded(s: number) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

describe('expectedDayHaul (pt2088u)', () => {
  it('miner expected counts equal rollOre simulation mean (Balanced + each priority)', () => {
    const N = 60_000;
    for (const c of MINER_CAVES) {
      const job = jobById(`miner:${c}`)!;
      const pris = [null as OreId | null, ...minerPriorityOptions(c)];
      for (const pri of pris) {
        const exp = expectedDayHaul(job, pri);
        expect(exp.picks).toBe(itemsPerDay(job));
        const u = seeded(17 + c.length * 3 + (pri ? pri.charCodeAt(0) : 0));
        const counts: Partial<Record<OreId, number>> = {};
        let v = 0;
        for (let i = 0; i < N; i++) {
          const o = rollOre(c, u, pri);
          counts[o] = (counts[o] ?? 0) + 1;
          v += ORES[o].price;
        }
        for (const item of exp.items) {
          const mean = ((counts[item.id as OreId] ?? 0) / N) * exp.picks;
          // relative to picks: within ~1.2% absolute share → qty within ~0.012 * picks
          expect(Math.abs(mean - item.qty), `${c}/${pri ?? 'balanced'}/${item.id}`).toBeLessThan(exp.picks * 0.015);
        }
        const simValue = (v / N) * exp.picks;
        expect(Math.abs(simValue - exp.value) / Math.max(1, exp.value)).toBeLessThan(0.03);
        if (!pri) expect(exp.value / exp.picks).toBeCloseTo(minerItemEv(c), 6);
      }
    }
  });

  it('fisher expected rarity counts equal rollWorkerFish simulation mean', () => {
    const job = jobById('fisher')!;
    const exp = expectedDayHaul(job);
    expect(exp.picks).toBe(itemsPerDay(job));
    expect(exp.value).toBeCloseTo(itemsPerDay(job) * FISHER_ITEM_EV, 6);
    const table = fisherCatchTable();
    expect(table.reduce((a, x) => a + x.p, 0)).toBeCloseTo(1, 9);
    const N = 80_000;
    const u = seeded(99);
    const counts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const { fish } = rollWorkerFish(u);
      counts[fish.rarity] = (counts[fish.rarity] ?? 0) + 1;
    }
    for (const item of exp.items) {
      const mean = ((counts[item.id] ?? 0) / N) * exp.picks;
      expect(Math.abs(mean - item.qty), `fisher/${item.id}`).toBeLessThan(exp.picks * 0.015);
    }
  });

  it('formatExpectedDay is approximate and covers every producing job', () => {
    for (const j of JOBS) {
      const line = formatExpectedDay(expectedDayHaul(j));
      expect(line).toMatch(/~.+\/day$/);
      expect(line).not.toBe('no deterministic estimate');
    }
    expect(approxQty(346.2)).toBe('346');
    expect(approxQty(0.33)).toBe('0.3');
    // sample Balanced The Mine miner line shape
    const mine = formatExpectedDay(expectedDayHaul(jobById('miner:mine')!));
    expect(mine).toMatch(/~\d+ iron/);
    expect(mine).toMatch(/gold/);
  });
});
