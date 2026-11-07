// pt1966u (Dayne 2026-11-07 "Give mining employees a buff"): Employment Office miners pick every 2 min (was 3): +50% ore and
// profit per worker, same wage and hire fee; fishers unchanged; hired miners get it on their next pick (no backfill, same caps).
import { describe, expect, it } from 'vitest';
import { JOBS, jobById, baseWage, baseHire, dayValue, itemsPerDay, MIN, HOUR, DAY, OFFLINE_CAP_MS } from '../shared/employment';
import { payoutFor } from '../shared/mines';
// Base e7ac6f1 values (3-min cadence) for every job: [perDay, wage, hire, dayValue rounded].
const BEFORE: Record<string, [number, number, number, number]> = { 'miner:mine': [480, 365, 285, 2692], 'miner:frost': [480, 450, 350, 3319], 'miner:magma': [480, 175, 135, 1280], fisher: [480, 305, 235, 13570] };
describe('mining employee buff', () => {
  it('miners: exactly +50% picks and expected ore value per day; wage and hire unchanged; net profit up', () => {
    for (const j of JOBS.filter((x) => x.kind === 'miner')) {
      const [n, w, h, v] = BEFORE[j.id]!;
      expect(j.everyMs).toBe(2 * MIN); expect(itemsPerDay(j)).toBe(n * 1.5); expect(Math.abs(dayValue(j) / 1.5 - v)).toBeLessThan(1);
      expect(dayValue(j) / (n * j.itemEv)).toBeCloseTo(1.5, 10);
      expect(baseWage(j)).toBe(w); expect(baseHire(j)).toBe(h);
      const netBefore = payoutFor(n * j.itemEv, 0) - w, netAfter = payoutFor(dayValue(j), 0) - w;
      expect(netAfter / netBefore).toBeGreaterThan(1.5); // the same wage spread over 50% more ore (house sell tiers not hit at these sizes)
      expect(payoutFor(dayValue(j), 0)).toBeGreaterThan(dayValue(j) - 2);
    }
  });
  it('fishers are unchanged', () => {
    const f = jobById('fisher')!; const [n, w, h, v] = BEFORE.fisher!;
    expect(f.everyMs).toBe(3 * MIN); expect(itemsPerDay(f)).toBe(n); expect(baseWage(f)).toBe(w); expect(baseHire(f)).toBe(h); expect(Math.round(dayValue(f))).toBe(v);
  });
  it('offline cap is unchanged: an away day yields at most 8 h of picks (240 instead of 160)', () => {
    expect(OFFLINE_CAP_MS).toBe(8 * HOUR); expect(OFFLINE_CAP_MS / jobById('miner:mine')!.everyMs).toBe(240); expect(DAY / jobById('miner:mine')!.everyMs).toBe(720);
  });
});
