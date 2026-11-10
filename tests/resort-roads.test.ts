import { describe, expect, it } from 'vitest';
import {
  RESORT_ROADS, RESORT_SPOTS, overlapsResortRoad, resortAabbHit, resortLots, resortPlots, resortPlotId,
} from '../shared/resort';

describe('resort road clearance (t2118u / t2119u)', () => {
  it('defines the asphalt avenues and cross streets used by resort3d', () => {
    expect(RESORT_ROADS.length).toBe(6);
    expect(RESORT_ROADS.some((r) => r.z === -32 && r.d === 5)).toBe(true);
    expect(RESORT_ROADS.some((r) => r.z === -64 && r.d === 6)).toBe(true);
    expect(RESORT_ROADS.filter((r) => r.w === 5 && r.d === 82).map((r) => r.x).sort((a, b) => a - b)).toEqual([-136, -40, 40, 136]);
  });

  it('keeps every lot, spot and plantation plot off asphalt (owned ids unchanged)', () => {
    const lots = resortLots();
    expect(lots.find((l) => l.id === 'r:condo:13')).toBeTruthy();
    expect(lots.find((l) => l.id === 'r:villa:17')).toBeTruthy();
    for (const l of lots) expect(overlapsResortRoad(l, 1, 0.5), l.id).toBe(false);
    for (const s of RESORT_SPOTS) expect(overlapsResortRoad(s, 1, s.id === 'r-farm' ? 4 : 0.5), s.id).toBe(false);
    for (const p of resortPlots()) expect(overlapsResortRoad(p, 1), resortPlotId(p.n)).toBe(false);
  });

  it('adds new east-grass plantation plots rf:13+ without renumbering 1..12', () => {
    const ns = resortPlots().map((p) => p.n);
    expect(ns.slice(0, 12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(ns.filter((n) => n >= 13).length).toBeGreaterThanOrEqual(8);
    // New plots do not overlap each other or estates
    const all = resortPlots();
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(resortAabbHit(all[i]!, all[j]!, 1), `${resortPlotId(all[i]!.n)} vs ${resortPlotId(all[j]!.n)}`).toBe(false);
      }
    }
  });

  it('moves the plantation barn and grotto off the avenues (same spot ids)', () => {
    const farm = RESORT_SPOTS.find((s) => s.id === 'r-farm')!;
    const mine = RESORT_SPOTS.find((s) => s.id === 'r-mine')!;
    expect(farm.z).toBeLessThan(-36); // was -32 on the avenue
    expect(mine.z).toBeLessThanOrEqual(-78);
    expect(overlapsResortRoad(farm, 1, 4)).toBe(false);
  });
});
