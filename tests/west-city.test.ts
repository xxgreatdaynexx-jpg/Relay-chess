import { describe, expect, it } from 'vitest';
import {
  WEST, WEST_GROUND, WEST_ROADS, WEST_JUNCTIONS, WEST_CUL_ENDS, WEST_RESERVED, WEST_WAREHOUSES, WEST_PORT, WEST_MARINA,
  GW_TIE, RURAL_SW, WEST_DC, WEST_TOWN, WEST_POCKET, WEST_FARMS, WEST_FARM_N0, WEST_HILLS, WEST_LAKES, WEST_CREEK, WEST_INDUSTRIAL_X,
  westFill, westRoadClearance, westDistrict, onWest, lakeClearance, creekClearance, nearWater,
} from '../shared/westCity';
import { ROAD_WIDTH, district, cityFill, landmarks, obbOverlap, obbCorners, roadClearance, type OBB } from '../shared/worldLayout';
import { properties } from '../shared/realEstate';
import { ROADS } from '../shared/worldLayout';
const ROADS_RING = () => ROADS.find((r) => r.id === 'ring')!.pts;
import { MAP_BOUNDS, MAP_BOUNDS_CORE, MAP_VIEW, MAP_VIEW_CORE } from '../shared/farm';
import { EXP_ROADS } from '../shared/expansionRoads';
import { LAND_FILL, expansionScenery } from '../shared/expansionScenery';
import { AIRPORT, RACETRACK, RUNWAY, RUNWAY2 } from '../shared/venues';
import { SPACE_CENTER } from '../shared/spaceCenter';
import { OCEAN } from '../shared/ocean';
import { westScenery } from '../shared/westScenery';
import { westTown } from '../shared/westCity';
import { RURAL_ROADS } from '../shared/outskirts';
import { isWestDeed } from '../shared/realEstate';
import { allFieldPlots, fieldPlotOf, fieldPlotLabel, isExpansionFarmN } from '../shared/fieldFarms';
import { inBridgeSite } from '../shared/coop';

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
    expect(WEST_ROADS.length).toBeGreaterThan(20);
    for (const r of WEST_ROADS) if (!r.closed) expect(r.ends, r.id).toBeDefined();
    const gw = EXP_ROADS.find((r) => r.id === 'gw-west')!;
    expect(Math.min(...gw.pts.map((p) => Math.hypot(p[0] - GW_TIE[0], p[1] - GW_TIE[1])))).toBeLessThan(0.05);
    expect(RURAL_ROADS.some(([a, b]) => [a, b].some((p) => p[0] === RURAL_SW[0] && p[1] === RURAL_SW[1]))).toBe(true);
    const expy = WEST_ROADS.find((r) => r.id === 'w-expy')!, coast = WEST_ROADS.find((r) => r.id === 'w-coast')!;
    expect(expy.pts[0]).toEqual(GW_TIE); expect(coast.pts[0]).toEqual(RURAL_SW);
    // a compact town grid, the Maple Heights pocket and a handful of country roads, not a suburban grid
    expect(WEST_ROADS.length).toBeLessThan(40); expect(WEST_JUNCTIONS.length).toBeGreaterThan(15); expect(WEST_CUL_ENDS.length).toBeGreaterThanOrEqual(4);
    const len = (ids: (id: string) => boolean) => WEST_ROADS.filter((r) => ids(r.id)).reduce((n, r) => n + r.pts.length, 0);
    expect(len((id) => ['w-maple', 'w-cedar', 'w-ridge', 'w-ridgew'].includes(id))).toBeGreaterThan(1500);
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

  it('fills the new land with a town, a suburb pocket and countryside: homes, towers, parks and lots that never overlap or sit on a road or water', () => {
    const { houses, patches } = westFill();
    const old = cityFill(7).houses.length;
    expect(houses.length).toBeGreaterThan(old); expect(houses.length).toBeLessThan(old * 2.2); // about one more old city's worth, mostly in Westgate
    expect(houses.filter((h) => h.type === 'tower').length).toBeGreaterThan(5);
    // outside town the only homes are the farmhouses
    const country = houses.filter((h) => !westTown(h.x, h.z)); expect(country.length).toBeLessThanOrEqual(WEST_FARMS.length); expect(country.every((h) => h.type === 'house')).toBe(true);
    const lots = patches.filter((p) => p.kind === 'lot' && !westTown(p.x, p.z)); expect(lots.length).toBeGreaterThan(30); // empty buildable land along the country roads
    const all: OBB[] = [...houses, ...patches];
    for (const b of all) {
      for (const [x, z] of obbCorners(b)) { expect(onWest(x, z, 1), `${b.x},${b.z}`).toBe(true); expect(z).toBeLessThan(OCEAN.beachZ); expect(nearWater(x, z, 0), `${b.x},${b.z} in water`).toBe(false); }
      expect(westRoadClearance(b.x, b.z)).toBeGreaterThan(0);
      for (const r of [...WEST_RESERVED, ...WEST_WAREHOUSES, ...WEST_FARMS]) expect(obbOverlap(b, r, 0)).toBe(false);
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

  it('follows the old city plan: same road widths, the same axis-aligned 26-unit grid phase, ring and district radii', () => {
    const gw = EXP_ROADS.find((r) => r.id === 'gw-west')!;
    for (const r of WEST_ROADS) {
      if (r.id === 'w-expy') expect(r.width).toBe(gw.width); // carries the Airport Expressway on
      else if (r.id === 'w-coast') expect(r.width).toBe(5); // the countryside collector it leaves from
      else expect(r.width, r.id).toBe(ROAD_WIDTH[r.kind]);
    }
    for (const v of WEST_DC) expect(Math.abs(v % 26)).toBe(0);
    expect([WEST_TOWN.x1 - WEST_TOWN.x0, WEST_TOWN.z1 - WEST_TOWN.z0]).toEqual([232, 232]); // the old plate's size
    // downtown grid streets and boulevards run straight north-south or east-west, like the old ones
    // (ends may snap onto the ring with a short link, as in the old city, so only the middle of each is checked)
    for (const r of WEST_ROADS.filter((o) => o.id.startsWith('w-grid') || o.kind === 'boulevard' && o.id !== 'w-expy')) {
      const mid = r.pts.slice(Math.floor(r.pts.length * 0.15), Math.ceil(r.pts.length * 0.85)); const xs = mid.map((p) => p[0]), zs = mid.map((p) => p[1]); const run = (a: number[]) => Math.max(...a) - Math.min(...a);
      expect(Math.min(run(xs), run(zs)), r.id).toBeLessThan(0.01);
    }
    const ring = WEST_ROADS.find((r) => r.id === 'w-ring')!; const old = ROADS_RING();
    const span = (q: [number, number][]) => Math.max(...q.map((p) => p[0])) - Math.min(...q.map((p) => p[0]));
    expect(Math.abs(span(ring.pts) - span(old))).toBeLessThan(3); // same 78-unit half-width (the old one bulges a little where it meets the waterfront)
    for (const [dx, dz] of [[0, 0], [30, 10], [50, 20], [0, 70], [100, 0]]) expect(westDistrict(WEST_DC[0] + dx, WEST_DC[1] + dz)).toBe(district(dx, dz));
  });

  it('builds every home, row house, apartment and tower at the old city\'s sizes and density', () => {
    const old = cityFill(7).houses; const key = (h: { type: string; w: number; d: number; h: number }) => `${h.type}|${h.w}|${h.d}|${h.h}`;
    const oldKeys = new Set(old.map(key)); const { houses } = westFill();
    for (const h of houses) expect(oldKeys.has(key(h)), key(h)).toBe(true); // each copies an old building's footprint and height
    for (const t of ['house', 'rowhouse', 'apartment', 'tower']) {
      const o = old.filter((h) => h.type === t), w = houses.filter((h) => h.type === t); expect(w.length, t).toBeGreaterThan(5);
      const mean = (a: typeof o, f: (h: typeof o[number]) => number) => a.reduce((s, h) => s + f(h), 0) / a.length;
      for (const f of [(h: typeof o[number]) => h.w, (h: typeof o[number]) => h.d, (h: typeof o[number]) => h.h]) expect(Math.abs(mean(w, f) / mean(o, f) - 1), t).toBeLessThan(0.08);
      expect(Math.max(...w.map((h) => h.h))).toBeLessThanOrEqual(Math.max(...o.map((h) => h.h)));
    }
    // the type mix follows the old district rule: towers only downtown/midtown, detached homes only in the suburbs (plus edge mixing)
    for (const h of houses.filter((b) => b.type === 'tower')) expect(westDistrict(h.x, h.z)).not.toBe('suburb');
    // Westgate is no denser than the old plate (306 buildings on the same 232 x 232 square, plus its civic blocks)
    const inT = houses.filter((h) => h.x > WEST_TOWN.x0 && h.x < WEST_TOWN.x1 && h.z > WEST_TOWN.z0 && h.z < WEST_TOWN.z1).length;
    expect(inT).toBeGreaterThan(old.length * 0.8); expect(inT).toBeLessThan(old.length * 1.5);
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

  it('plants its countryside and woods like the old open land: pine and broadleaf stands off roads, homes and town', () => {
    const s = westScenery(); const trees = s.filter((p) => p.kind === 'pine' || p.kind === 'deciduous');
    expect(trees.length).toBeGreaterThan(2000); expect(s.some((p) => p.kind === 'pine')).toBe(true); expect(s.some((p) => p.kind === 'deciduous')).toBe(true);
    const { houses } = westFill();
    for (const p of s) { expect(westTown(p.x, p.z)).toBe(false); expect(westRoadClearance(p.x, p.z)).toBeGreaterThan(1); expect(onWest(p.x, p.z, 1)).toBe(true); }
    const G = 24; const grid = new Map<string, OBB[]>(); for (const h of houses) { const k = `${Math.floor(h.x / G)},${Math.floor(h.z / G)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(h); }
    for (const p of trees) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const h of grid.get(`${Math.floor(p.x / G) + i},${Math.floor(p.z / G) + j}`) ?? []) expect(obbOverlap(h, { x: p.x, z: p.z, w: 1, d: 1, rot: 0 }, 0)).toBe(false);
  });

  it('has farms on the ordinary farm system, square to the compass, off roads, water and town', () => {
    expect(WEST_FARMS.length).toBeGreaterThanOrEqual(10);
    WEST_FARMS.forEach((f, i) => { expect(f.n).toBe(WEST_FARM_N0 + i); expect(f.rot).toBe(0); expect([f.w, f.d]).toEqual([f.cols * 2 + 2, f.rows * 2 + 2]);
      expect(isExpansionFarmN(f.n)).toBe(false); expect(fieldPlotOf(`cf:${f.n}`)).toMatchObject({ n: f.n, x: f.x, z: f.z }); expect(fieldPlotLabel(f)).toContain('West Chud farm');
      for (const [x, z] of obbCorners(f)) { expect(onWest(x, z, 1)).toBe(true); expect(westTown(x, z)).toBe(false); expect(nearWater(x, z, 0)).toBe(false); expect(x).toBeLessThan(WEST_INDUSTRIAL_X); }
      expect(westRoadClearance(f.x, f.z)).toBeGreaterThan(Math.min(f.w, f.d) / 2);
      for (const o of WEST_FARMS) if (o !== f) expect(obbOverlap(o, f, 0)).toBe(false);
      for (const r of WEST_RESERVED) expect(obbOverlap(r, f, 0)).toBe(false); });
    const ps = new Map(properties().map((p) => [p.id, p]));
    for (const f of WEST_FARMS) { const p = ps.get(`cf:${f.n}`)!; expect(p.kind).toBe('farm'); expect(p.price).toBeGreaterThan(0); expect(isWestDeed(p.id)).toBe(true); }
    expect(allFieldPlots().filter((p) => p.n >= WEST_FARM_N0)).toHaveLength(WEST_FARMS.length);
  });

  it('has lakes, a creek and hills that roads only cross on bridges, and leaves the Fort McChud Bridge approach alone', () => {
    expect(WEST_LAKES.length).toBeGreaterThanOrEqual(2); expect(WEST_HILLS.length).toBeGreaterThan(10);
    for (const r of WEST_ROADS) for (const [x, z] of r.pts) expect(lakeClearance(x, z), `${r.id} in a lake`).toBeGreaterThan(r.width / 2);
    // the creek runs from the north edge to the beach and only a few roads cross it (each crossing gets a bridge)
    expect(WEST_CREEK[0][1]).toBeLessThan(WEST.z0 + 5); expect(WEST_CREEK[WEST_CREEK.length - 1][1]).toBeGreaterThan(OCEAN.beachZ - 5);
    const crossing = WEST_ROADS.filter((r) => r.pts.some(([x, z]) => creekClearance(x, z) < 0)); expect(crossing.length).toBeGreaterThan(0); expect(crossing.length).toBeLessThanOrEqual(5);
    for (const [x, z, rad] of WEST_HILLS) { expect(westRoadClearance(x, z)).toBeGreaterThan(rad); expect(nearWater(x, z, rad)).toBe(false); expect(westTown(x, z)).toBe(false); }
    // the bridge junction: Sunset Coast Road's south edge sits at 172.5 by x -190 and nothing else enters the approach
    const coast = WEST_ROADS.find((r) => r.id === 'w-coast')!; const near = coast.pts.reduce((b, p) => (Math.abs(p[0] + 190) < Math.abs(b[0] + 190) ? p : b));
    expect(Math.abs(near[1] + coast.width / 2 - 172.5)).toBeLessThan(0.5);
    for (const r of WEST_ROADS) if (r.id !== 'w-coast') for (const [x, z] of r.pts) expect(inBridgeSite(x, z, 2), r.id).toBe(false);
  });
});
