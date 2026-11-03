import { describe, expect, it } from 'vitest';
import { resortLots, resortPlots, resortEstateFarmPrice, resortFarmPrice, RESORT_X0, RESORT_X1, RESORT_TYPES } from '../shared/resort';
import { propertyById } from '../shared/realEstate';

describe('bigger resort map (#10e)', () => {
  it('existing lot and plot ids are unchanged; new ones appended', () => {
    const ids = resortLots().map((l) => l.id);
    expect(ids.slice(0, 22)).toEqual([...[1,2,3,4,5,6,7].map((n) => `r:beachhouse:${n}`), ...[8,9,10,11].map((n) => `r:hotel:${n}`), ...[12,13,14,15].map((n) => `r:condo:${n}`), ...[16,17,18,19,20,21,22].map((n) => `r:villa:${n}`)]);
    expect(ids.filter((i) => /oceanestate|clifftop|skyrise/.test(i))).toHaveLength(10);
    expect(resortPlots().filter((p) => p.estate).map((p) => p.n)).toEqual([7, 8, 9, 10, 11, 12]);
  });
  it('map is wider and the new property is expensive', () => {
    expect(RESORT_X1 - RESORT_X0).toBeGreaterThanOrEqual(400);
    for (const t of ['oceanestate', 'clifftop', 'skyrise']) expect(RESORT_TYPES[t]!.price).toBeGreaterThan(RESORT_TYPES.hotel!.price);
    for (const p of resortPlots().filter((x) => x.estate)) { const pr = propertyById(`rf:${p.n}`)!.price; expect(pr).toBe(resortEstateFarmPrice(p.cols * p.rows)); expect(pr).toBeGreaterThan(resortFarmPrice(p.cols * p.rows) * 2.5); }
  });
});
