import { describe, expect, it } from 'vitest';
import { PLATE, ROADS, MINE_SITES, MINE_APRON } from '../shared/worldLayout';
import { RURAL_ROADS, RURAL_ROAD_W, DOCK } from '../shared/outskirts';
import { FARM_LANES, FARM_LANE_W } from '../shared/farm';
import { AIRPORT_ROADS, RACETRACK_ROADS, AIRPORT_SLOT, RUNWAY, TRACK, trackDist } from '../shared/venues';

// Outskirts road network: rural roads, venue access roads, farm lanes and mine haul tracks (as drawn in world3d).
type P = [number, number]; type Seg = { id: string; a: P; b: P; w: number; paved: boolean };
const segs: Seg[] = [
  ...RURAL_ROADS.map(([a, b], i) => ({ id: `rural${i}`, a, b, w: RURAL_ROAD_W, paved: true })),
  ...[...AIRPORT_ROADS, ...RACETRACK_ROADS].map(([a, b, w], i) => ({ id: `venue${i}`, a, b, w, paved: true })),
  ...FARM_LANES.map((ln, i) => ({ id: `lane${i}`, a: ln[0], b: ln[ln.length - 1], w: FARM_LANE_W, paved: false })),
  ...Object.entries(MINE_SITES).flatMap(([id, s]) => { const pts: P[] = [...s.track, [s.x, s.z]]; return pts.slice(1).map((b, i) => ({ id: `${id}${i}`, a: pts[i], b, w: 3.6, paved: false })); }),
];
const segD = (p: P, a: P, b: P) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
const cityEnds: P[] = ROADS.flatMap((r) => (r.closed ? [] : [r.pts[0], r.pts[r.pts.length - 1]]));
const destination = (p: P) =>
  Object.values(MINE_SITES).some((s) => Math.abs(p[0] - s.x) <= MINE_APRON / 2 + 0.5 && Math.abs(p[1] - s.z) <= MINE_APRON / 2 + 0.5) // a mine apron
  || Math.abs(trackDist(p[0], p[1]) - TRACK.W / 2) < 0.6 // the speedway's outer edge (not across it)
  || Math.hypot(p[0] - AIRPORT_SLOT[0], p[1] - AIRPORT_SLOT[1]) <= 8.5 || Math.abs(p[0] - (RUNWAY.x + RUNWAY.w / 2)) < 0.5 // terminal / runway
  || Math.hypot(p[0] - DOCK.path[0][0], p[1] - DOCK.path[0][1]) < 0.5 // the Fishing Dock's gravel path
  || (p[0] === -181 && p[1] === -54) // industrial yard, between its warehouses
  || cityEnds.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 1.5 && Math.max(Math.abs(c[0]), Math.abs(c[1])) > PLATE - 1.5); // a city road's edge end

describe('outskirts road network', () => {
  it('every road end is a junction (on another road) or a destination', () => {
    for (const s of segs) for (const p of [s.a, s.b]) {
      const joined = segs.some((o) => o !== s && segD(p, o.a, o.b) < 0.6);
      expect(joined || destination(p), `${s.id} end ${p}`).toBe(true);
    }
  });
  it('no doubled roads: no near-parallel overlapping segments', () => {
    for (const s of segs) for (const o of segs) { if (s.id >= o.id) continue;
      const sx = s.b[0] - s.a[0], sz = s.b[1] - s.a[1], L = Math.hypot(sx, sz), ux = sx / L, uz = sz / L;
      const ox = o.b[0] - o.a[0], oz = o.b[1] - o.a[1], M = Math.hypot(ox, oz); if (Math.abs((ux * ox + uz * oz) / M) < Math.cos((15 * Math.PI) / 180)) continue;
      const proj = (p: P) => (p[0] - s.a[0]) * ux + (p[1] - s.a[1]) * uz; const lo = Math.max(0, Math.min(proj(o.a), proj(o.b))), hi = Math.min(L, Math.max(proj(o.a), proj(o.b)));
      const gap = Math.max(Math.abs((o.a[0] - s.a[0]) * uz - (o.a[1] - s.a[1]) * ux), Math.abs((o.b[0] - s.a[0]) * uz - (o.b[1] - s.a[1]) * ux));
      expect(hi - lo > 1 && gap < (s.w + o.w) / 2 + 12, `${s.id} doubles ${o.id}`).toBe(false);
    }
  });
  it('roads are straight and square (no random diagonals) and none crosses the race track', () => {
    for (const s of segs) {
      expect(s.a[0] === s.b[0] || s.a[1] === s.b[1], `${s.id} diagonal`).toBe(true);
      for (let t = 0.02; t < 0.98; t += 0.01) expect(trackDist(s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t) > TRACK.W / 2, `${s.id} on track`).toBe(true);
    }
  });
  it('crossings only between paved roads (drawn as 4-way junctions); dirt meets paved at a T', () => {
    for (const s of segs) for (const o of segs) { if (s.id >= o.id) continue;
      const den = (s.b[0] - s.a[0]) * (o.b[1] - o.a[1]) - (s.b[1] - s.a[1]) * (o.b[0] - o.a[0]); if (!den) continue;
      const t = ((o.a[0] - s.a[0]) * (o.b[1] - o.a[1]) - (o.a[1] - s.a[1]) * (o.b[0] - o.a[0])) / den, u = ((o.a[0] - s.a[0]) * (s.b[1] - s.a[1]) - (o.a[1] - s.a[1]) * (s.b[0] - s.a[0])) / den;
      if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99) expect(s.paved && o.paved, `${s.id} crosses ${o.id}`).toBe(true);
    }
  });
});
