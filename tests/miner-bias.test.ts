import { describe, it, expect } from 'vitest';
import { MINER_CAVES, MINER_BIAS, minerTable, minerItemEv, unbiasedItemEv, WORKER_EV_BEFORE, rollOre, JOBS, itemsPerDay, isMinerCave } from '../shared/employment';
import { ORES, isOre, type OreId } from '../shared/mines';

function seeded(s: number) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const share = (c: (typeof MINER_CAVES)[number]) => minerTable(c).filter(([o]) => o in MINER_BIAS[c].ores).reduce((a, [, w]) => a + w, 0);

describe('miner gather bias (pt1350u)', () => {
  it('uses real ore ids and each table sums to 1', () => {
    for (const c of MINER_CAVES) { const t = minerTable(c); for (const [o] of t) expect(isOre(o)).toBe(true); expect(t.reduce((a, [, w]) => a + w, 0)).toBeCloseTo(1, 9); }
  });
  it('biases each mine toward its signature ores', () => {
    expect(Object.keys(MINER_BIAS.magma.ores).sort()).toEqual(['coal', 'copper']);
    expect(Object.keys(MINER_BIAS.frost.ores).sort()).toEqual(['gem', 'silver']);
    expect(Object.keys(MINER_BIAS.mine.ores).sort()).toEqual(['gold', 'iron', 'stone']);
    for (const c of MINER_CAVES) { expect(share(c)).toBeGreaterThanOrEqual(0.8); expect(share(c)).toBeLessThanOrEqual(0.9); }
  });
  it('gold is the lightest of the main Mine bias', () => {
    const b = MINER_BIAS.mine.ores; expect(b.gold!).toBeLessThan(b.iron!); expect(b.gold!).toBeLessThan(b.stone!);
  });
  it('keeps value per hour within 5% of the old mix (pt1357u), items per hour unchanged', () => {
    for (const c of MINER_CAVES) { expect(Math.abs(minerItemEv(c) - WORKER_EV_BEFORE[c]) / WORKER_EV_BEFORE[c]).toBeLessThan(0.05); expect(unbiasedItemEv(c)).toBeGreaterThan(0); }
    for (const j of JOBS.filter((x) => x.kind === 'miner')) expect(itemsPerDay(j)).toBe(144);
  });
  it('rolls match the table', () => {
    for (const c of MINER_CAVES) { const u = seeded(7); const n: Partial<Record<OreId, number>> = {}; const N = 60_000; let v = 0;
      for (let i = 0; i < N; i++) { const o = rollOre(c, u); n[o] = (n[o] ?? 0) + 1; v += ORES[o].price; }
      for (const [o, w] of minerTable(c)) expect(Math.abs((n[o] ?? 0) / N - w)).toBeLessThan(0.01);
      expect(Math.abs(v / N - minerItemEv(c)) / minerItemEv(c)).toBeLessThan(0.05); }
  });
  it('hire cards carry the bias label', () => {
    expect(JOBS.find((j) => j.id === 'miner:magma')!.bias).toBe('Mostly Coal & Copper Ore');
    expect(JOBS.find((j) => j.id === 'miner:frost')!.bias).toBe('Mostly Silver Ore & Crystal');
    expect(JOBS.find((j) => j.id === 'miner:mine')!.bias).toBe('Mostly Iron Ore, Stone & Gold Ore');
    expect(isMinerCave('coral')).toBe(false);
  });
});
