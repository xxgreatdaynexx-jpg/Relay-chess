import { describe, expect, it } from 'vitest';
import { REFINERY_MAX, TRACTS, UNITS, WATER_CUT, newFort, step, tractInfo, unitCount, type FortState } from '../shared/fortmc';

describe('Fort McChud refinery cap', () => {
  it('lets enough refineries run to refine a full 6-separator train on the lowest-gas tracts', () => {
    expect(UNITS.separator.max).toBe(6);
    expect(UNITS.refinery.max).toBe(REFINERY_MAX);
    expect(REFINERY_MAX).toBe(9);
    const lowestGas = Math.min(...Array.from({ length: TRACTS }, (_, i) => tractInfo(i + 1).gas));
    const maxCrude = UNITS.separator.max * UNITS.separator.cap * (1 - WATER_CUT - lowestGas);
    expect(UNITS.refinery.max * UNITS.refinery.cap).toBeGreaterThanOrEqual(maxCrude);
    // the old cap of 4 could not keep up (the reported problem)
    expect(4 * UNITS.refinery.cap).toBeLessThan(maxCrude);
    // no more than one spare refinery beyond what the separators can feed
    expect((UNITS.refinery.max - 1) * UNITS.refinery.cap).toBeLessThan(maxCrude);
  });

  it('keeps refinery price, power, throughput and yields unchanged', () => {
    expect(UNITS.refinery).toMatchObject({ cost: 280_000, mw: 3.5, cap: 120 });
    expect(UNITS.refinery.out).toEqual([['naphtha', 0.3], ['diesel', 0.28], ['gasoline', 0.12], ['residue', 0.25]]);
  });

  it('9 powered refineries clear a crude backlog 9 x 120 per hour', () => {
    const s: FortState = newFort(0);
    for (let i = 0; i < REFINERY_MAX; i++) s.units.push({ id: i + 1, k: 'refinery', cond: 100, on: true });
    for (let i = 0; i < 10; i++) s.units.push({ id: 100 + i, k: 'tank', cond: 100, on: true });
    for (let i = 0; i < 8; i++) s.units.push({ id: 200 + i, k: 'turbine', cond: 100, on: true });
    s.stock.crude = 5_000; s.stock.natgas = 5_000;
    expect(unitCount(s, 'refinery')).toBe(9);
    step(s, 1);
    expect(5_000 - (s.stock.crude ?? 0)).toBeCloseTo(9 * 120, 5);
  });
});
