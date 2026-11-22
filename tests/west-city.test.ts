import { describe, expect, it } from 'vitest';
import {
  WEST, WEST_GROUND, WEST_ROADS, WEST_JUNCTIONS, WEST_CUL_ENDS, WEST_RESERVED, WEST_WAREHOUSES, WEST_PORT, WEST_MARINA,
  GW_TIE, RURAL_SW, westFill, westRoadClearance, onWest,
} from '../shared/westCity';
import { cityFill, landmarks, obbOverlap, obbCorners, roadClearance, type OBB } from '../shared/worldLayout';
import { properties } from '../shared/realEstate';
import { MAP_BOUNDS, MAP_BOUNDS_CORE, MAP_VIEW, MAP_VIEW_CORE } from '../shared/farm';
import { EXP_ROADS } from '../shared/expansionRoads';
import { LAND_FILL, expansionScenery } from '../shared/expansionScenery';
import { AIRPORT, RACETRACK, RUNWAY, RUNWAY2 } from '../shared/venues';
import { SPACE_CENTER } from '../shared/spaceCenter';
import { OCEAN } from '../shared/ocean';
import { RURAL_ROADS } from '../shared/outskirts';

const westIds = () => { const w = westFill(); return new Set([...w.houses.map((h) => `b:${h.type}:${Math.round(h.x * 10)}:${Math.round(h.z * 10)}`), ...w.patches.map((p) => `p:${p.kind}:${Math.round(p.x * 10)}:${Math.round(p.z * 10)}`)]); };

describe('West Chud (western half of the map)', () => {
  it('doubles the map width without moving the old map', () => {
    const core = MAP_BOUNDS_CORE.x1 - MAP_BOUNDS_CORE.x0; const now = MAP_BOUNDS.x1 - MAP_BOUNDS.x0;
    expect(now).toBeGreaterThanOrEqual(core * 2);
    expect(MAP_BOUNDS.x1).toBe(MAP_BOUNDS_CORE.x1); expect(MAP_BOUNDS.z0).toBe(MAP_BOUNDS_CORE.z0); expect(MAP_BOUNDS.z1).toBe(MAP_BOUNDS_CORE.z1);
    expect(MAP_VIEW.x0).toBeLessThanOrEqual(WEST.x0); expect(MAP_VIEW.z1).toBe(MAP_VIEW_CORE.z1);
    // the old land fill (and so the old scenery layout) is unchanged; the west slab meets it exactly
    expect(LAND_FILL.x0).toBe(MAP_VIEW_CORE.x0); expect(WEST_GROUND.x1).toBe(MAP_VIEW_CORE.x0);
    expect(WEST_GROUND.z1).toBe(OCEAN.beachZ); expect(OCEAN.x0).toBeLessThan(WEST_GROUND.x0);
    expect(WEST.x1).toBeLessThan(AIRPORT.x0);
  });

  it('has a connected road network tied into the old roads', () => {
    expect(WEST_ROADS.length).toBeGreaterThan(50);
    for (const r of WEST_ROADS) if (!r.closed) expect(r.ends, r.id).toBeDefined();
    const gw = EXP_ROADS.find((r) => r.id === 'gw-west')!;
    expect(Math.min(...gw.pts.map((p) => Math.hypot(p[0] - GW_TIE[0], p[1] - GW_TIE[1])))).toBeLessThan(0.05);
    expect(RURAL_ROADS.some(([a, b]) => [a, b].some((p) => p[0] === RURAL_SW[0] && p[1] === RURAL_SW[1]))).toBe(true);
    const expy = WEST_ROADS.find((r) => r.id === 'w-expy')!, coast = WEST_ROADS.find((r) => r.id === 'w-coast')!;
    expect(expy.pts[0]).toEqual(GW_TIE); expect(coast.pts[0]).toEqual(RURAL_SW);
    expect(WEST_JUNCTIONS.length).toBeGreaterThan(100); expect(WEST_CUL_ENDS.length).toBeGreaterThan(10);
    // every non-link road stays on the west land
    for (const r of WEST_ROADS) if (r.id !== 'w-expy' && r.id !== 'w-coast') for (const [x, z] of r.pts) expect(onWest(x, z, 0), `${r.id} ${x},${z}`).toBe(true);
  });

  it('link roads miss the airport, Speedway, Space Center and every old deed', () => {
    const avoid: Array<OBB & { id: string }> = [
      ...properties().filter((p) => !p.map && !p.hidden && !westIds().has(p.id)).map((p) => ({ ...p })),
      ...Object.entries(landmarks()).map(([id, b]) => ({ ...b, id: `lm:${id}` })),
      { id: 'runway', x: RUNWAY.x, z: (RUNWAY.z0 + RUNWAY.z1) / 2, w: RUNWAY.w, d: RUNWAY.z1 - RUNWAY.z0, rot: 0 },
      { id: 'runway2', x: RUNWAY2.x, z: (RUNWAY2.z0 + RUNWAY2.z1) / 2, w: RUNWAY2.w, d: RUNWAY2.z1 - RUNWAY2.z0, rot: 0 },
      { id: 'racetrack', x: (RACETRACK.x0 + RACETRACK.x1) / 2, z: (RACETRACK.z0 + RACETRACK.z1) / 2, w: RACETRACK.x1 - RACETRACK.x0, d: RACETRACK.z1 - RACETRACK.z0, rot: 0 },
      { id: 'spacecenter', ...SPACE_CENTER },
    ];
    for (const id of ['w-expy', 'w-coast']) {
      const r = WEST_ROADS.find((o) => o.id === id)!;
      for (let i = 6; i < r.pts.length - 1; i += 2) { const [x, z] = r.pts[i]; if (onWest(x, z, 0)) continue;
        const seg: OBB = { x, z, w: 2, d: r.width + 1, rot: -Math.atan2(r.pts[i + 1][1] - z, r.pts[i + 1][0] - x) };
        for (const a of avoid) expect(obbOverlap(seg, a, 0.2), `${id} at ${x.toFixed(0)},${z.toFixed(0)} hits ${a.id}`).toBe(false); }
    }
    // airport grounds: the coast road runs south of them
    const coast = WEST_ROADS.find((o) => o.id === 'w-coast')!;
    for (const [x, z] of coast.pts) if (x > AIRPORT.x0 && x < AIRPORT.x1) expect(z).toBeGreaterThan(AIRPORT.z1 + 4);
  });

  it('fills the new land with homes, towers, parks and lots that never overlap or sit on a road', () => {
    const { houses, patches } = westFill();
    const old = cityFill(7).houses.length;
    expect(houses.length).toBeGreaterThan(old * 2);
    expect(houses.filter((h) => h.type === 'tower').length).toBeGreaterThan(100);
    expect(patches.length).toBeGreaterThan(30);
    const all: OBB[] = [...houses, ...patches];
    for (const b of all) {
      for (const [x, z] of obbCorners(b)) { expect(onWest(x, z, 1), `${b.x},${b.z}`).toBe(true); expect(z).toBeLessThan(OCEAN.beachZ); }
      expect(westRoadClearance(b.x, b.z)).toBeGreaterThan(0);
      for (const r of [...WEST_RESERVED, ...WEST_WAREHOUSES]) expect(obbOverlap(b, r, 0)).toBe(false);
    }
    const G = 30; const grid = new Map<string, OBB[]>();
    for (const b of all) { const k = `${Math.floor(b.x / G)},${Math.floor(b.z / G)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(b); }
    let pairs = 0;
    for (const b of all) { const gx = Math.floor(b.x / G), gz = Math.floor(b.z / G);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of grid.get(`${gx + i},${gz + j}`) ?? []) if (o !== b) { pairs++; expect(obbOverlap(b, o, 0), `${b.x},${b.z} vs ${o.x},${o.z}`).toBe(false); } }
    expect(pairs).toBeGreaterThan(1000);
    // the old city's road clearance code never sees these (far west of the plate)
    expect(roadClearance(WEST.x0 + 100, 0)).toBe(Infinity);
  });

  it('lists every West Chud building and patch as an ordinary, unique deed and keeps old deeds', () => {
    const ps = properties(); const ids = ps.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const w = westIds(); const byId = new Map(ps.map((p) => [p.id, p]));
    for (const id of w) { const p = byId.get(id); expect(p, id).toBeDefined(); expect(p!.price).toBeGreaterThan(0); expect(p!.map).toBeUndefined(); }
    // every old city deed is still listed at the same spot
    const { houses, patches } = cityFill(7);
    for (const h of houses) expect(byId.has(`b:${h.type}:${Math.round(h.x * 10)}:${Math.round(h.z * 10)}`)).toBe(true);
    for (const p of patches) expect(byId.has(`p:${p.kind}:${Math.round(p.x * 10)}:${Math.round(p.z * 10)}`)).toBe(true);
    // no west deed is on the old map
    for (const id of w) expect(byId.get(id)!.x).toBeLessThan(WEST.x1);
  });

  it('keeps old scenery off the link roads, and the port and marina on the coast', () => {
    for (const s of expansionScenery()) expect(westRoadClearance(s.x, s.z)).toBeGreaterThan(s.kind === 'pond' ? s.s : 1);
    for (const o of [WEST_PORT, WEST_MARINA]) { expect(o.z + o.d / 2).toBeGreaterThan(OCEAN.beachZ); expect(o.x - o.w / 2).toBeGreaterThan(WEST.x0); }
  });
});
