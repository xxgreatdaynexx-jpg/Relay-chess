import { describe, it, expect } from 'vitest';
import { outskirts, placeHillsOffRoads, hillOverlapsRoad, mapRoadSegments, HILL_ROAD_MARGIN, inLake, inJail, RURAL_ROADS, RURAL_ROAD_W, type Hill } from '../shared/outskirts';
import { farmPlots } from '../shared/farm';
import { bigFarms, BIG_ROADS } from '../shared/bigFarms';
import { RESORT_ROADS } from '../shared/resort';
import { ROADS, MINE_SITES, MINE_APRON, OUTSKIRTS } from '../shared/worldLayout';
import { inCivic } from '../shared/city';

function segsFind(segs: ReturnType<typeof mapRoadSegments>, a: [number, number], b: [number, number]) {
  return segs.some(([p, q]) => p[0] === a[0] && p[1] === a[1] && q[0] === b[0] && q[1] === b[1]);
}

describe('decorative hills stay off roads', () => {
  it('the road checker covers city, ring, Big Farm, farm-lane, venue and resort roads', () => {
    const segs = mapRoadSegments();
    for (const r of ROADS) {
      const pts = r.closed ? [...r.pts, r.pts[0]!] : r.pts;
      if (pts.length >= 2) expect(segsFind(segs, pts[0]!, pts[1]!), `city ${r.id}`).toBe(true);
    }
    for (const [a, b] of RURAL_ROADS) expect(segsFind(segs, a, b), 'rural').toBe(true);
    for (const [a, b] of BIG_ROADS) expect(segsFind(segs, a, b), 'big').toBe(true);
    expect(segs.some(([p, q, w]) => RESORT_ROADS.some((r) => (
      (r.w >= r.d && p[0] === r.x - r.w / 2 && q[0] === r.x + r.w / 2 && p[1] === r.z && q[1] === r.z && w === r.d) ||
      (r.w < r.d && p[1] === r.z - r.d / 2 && q[1] === r.z + r.d / 2 && p[0] === r.x && q[0] === r.x && w === r.w)
    )))).toBe(true);
    expect(HILL_ROAD_MARGIN).toBe(1.5);
    expect(RURAL_ROAD_W).toBe(4.5);
  });

  it('every countryside hill stays off every road (radius plus margin)', () => {
    const O = outskirts();
    expect(O.hills.length).toBeGreaterThan(0);
    for (const [x, z, rad] of O.hills) {
      expect(hillOverlapsRoad(x, z, rad), `hill at ${x.toFixed(2)},${z.toFixed(2)} r=${rad.toFixed(2)}`).toBe(false);
    }
  });

  it('hills stay on the ground and off farms, plots, buildings, the quarry and water', () => {
    const O = outskirts();
    const q = MINE_SITES['mine-quarry'];
    for (const [x, z, rad] of O.hills) {
      const onOutskirts = x >= OUTSKIRTS.x0 + rad && x <= OUTSKIRTS.x1 - rad && z >= OUTSKIRTS.z0 + rad && z <= OUTSKIRTS.z1 - rad;
      expect(onOutskirts, `hill ${x.toFixed(2)},${z.toFixed(2)} left the ground`).toBe(true);
      expect(inLake(x, z, 4 + rad)).toBe(false);
      expect(inJail(x, z, rad)).toBe(false);
      expect(inCivic(x, z, rad)).toBe(false);
      if (q) expect(Math.abs(x - q.x) < MINE_APRON / 2 + 2 + rad && Math.abs(z - q.z) < MINE_APRON / 2 + 2 + rad).toBe(false);
      for (const p of farmPlots()) {
        const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
        const cx = Math.max(x0, Math.min(x, x1)), cz = Math.max(z0, Math.min(z, z1));
        expect(Math.hypot(x - cx, z - cz)).toBeGreaterThanOrEqual(rad);
      }
      for (const p of bigFarms()) {
        const cx = Math.max(p.lot.x0, Math.min(x, p.lot.x1)), cz = Math.max(p.lot.z0, Math.min(z, p.lot.z1));
        expect(Math.hypot(x - cx, z - cz)).toBeGreaterThanOrEqual(rad);
      }
      for (const o of [...O.fields, ...O.buildings]) {
        const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
        const cx = Math.max(x0, Math.min(x, x1)), cz = Math.max(z0, Math.min(z, z1));
        expect(Math.hypot(x - cx, z - cz)).toBeGreaterThanOrEqual(rad);
      }
    }
  });

  it('moves a hill that sits on a road to the nearest clear ground', () => {
    const O = outskirts();
    const from: Hill = [198, -187, 7.5, 4];
    expect(hillOverlapsRoad(from[0], from[1], from[2])).toBe(true);
    const out = placeHillsOffRoads([from, ...O.hills.filter((h) => Math.hypot(h[0] - from[0], h[1] - from[1]) > 1)], O.fields, O.buildings);
    const moved = out.find((h) => h[2] === from[2] && h[3] === from[3]);
    expect(moved).toBeTruthy();
    expect(moved![0]).not.toBe(from[0]);
    expect(hillOverlapsRoad(moved![0], moved![1], moved![2])).toBe(false);
    expect(Math.hypot(moved![0] - from[0], moved![1] - from[1])).toBeLessThanOrEqual(56);
  });

  it('drops a hill when no nearby clear ground exists', () => {
    expect(placeHillsOffRoads([[0, 0, 90, 10]])).toEqual([]);
  });
});
