/**
 * West Chud: the city's western half. New land west of the airport doubles the map (x from -1296 to the old
 * west edge at -286, same north/south span down to the beach). Nothing on the old map moves: every existing lot,
 * building, farm and id keeps its place. Two roads tie the districts into the old network: the Westgate Expressway
 * (off the Airport Expressway, north of the Speedway) and Sunset Coast Road (west from the rural south-west corner,
 * between the airport and the beach).
 *
 * Built the same way as the original city (shared/worldLayout.ts): Catmull-Rom roads resampled to ~1 unit, every open
 * end joined to another road or capped with a cul-de-sac, junction caps at joins and crossings, and housing along every
 * street's frontage turned to face it. Districts:
 *   Westgate (downtown inside the ring, a skewed grid with a tall skyline, Westgate Square and Westgate Park)
 *   Sunset Bay (waterfront streets between the ring and the coast), Maple Heights (north suburbs and cul-de-sacs),
 *   Cedar Hills (west suburbs, the West Chud Stadium), Ironworks (industry and the container port, east).
 * Houses and patches use the city's property ids (b:<type>:<pos> / p:<kind>:<pos>), so they are bought, taxed and
 * sold exactly like the old city's.
 *
 * Pure geometry (no three.js): the renderer, real estate catalog and the layout tests read from here.
 */
import { spline, obbOverlap, obbHit, obbCorners, type OBB, type Road, type RoadKind, type RoadEnd, type Junction, type House, type Patch, type PatchKind, type Route } from './worldLayout.js';
import { HOUSING_TYPES, type District } from './housing.js';

type P = [number, number];
/** Buildable west land (inside the ground slab, north of the beach). */
export const WEST = { x0: -1296, x1: -290, z0: -452, z1: 184 } as const;
/** Ground slab for the new land: meets the old map's land fill at x = -286, runs from the north edge down to the beach line. */
export const WEST_GROUND = { x0: -1302, x1: -286, z0: -458, z1: 192 } as const;
/** Where the Westgate Expressway leaves the Airport Expressway (a sample on its centreline). */
export const GW_TIE: P = [-211.15, -236.03];
/** Rural ring's south-west corner (shared/outskirts.ts RURAL_ROADS), where Sunset Coast Road starts. */
export const RURAL_SW: P = [-121, 150];

/** Westgate downtown centre and the grid skew. */
export const WEST_DC: P = [-790, -150];
const ROT = 0.16; const CR = Math.cos(ROT), SR = Math.sin(ROT);
export const toWorld = (u: number, v: number): P => [WEST_DC[0] + u * CR - v * SR, WEST_DC[1] + u * SR + v * CR];
export const toLocal = (x: number, z: number): P => { const dx = x - WEST_DC[0], dz = z - WEST_DC[1]; return [dx * CR + dz * SR, -dx * SR + dz * CR]; };
const RING_A = 200, RING_B = 165;
const inRingL = (u: number, v: number, m = 0) => (Math.abs(u) / (RING_A - m)) ** 4 + (Math.abs(v) / (RING_B - m)) ** 4 < 1;
const inRing = (x: number, z: number, m = 0) => { const [u, v] = toLocal(x, z); return inRingL(u, v, m); };

export const onWest = (x: number, z: number, m = 0) => x > WEST.x0 + m && x < WEST.x1 - m && z > WEST.z0 + m && z < WEST.z1 - m;

/** Reserved ground (no roads cut through, no housing): parks, the square, the stadium, the port, marina, wind farm. */
const lobb = (u: number, v: number, w: number, d: number): OBB => { const [x, z] = toWorld(u, v); return { x, z, w, d, rot: -ROT }; };
export const WESTGATE_PARK: OBB = lobb(0, -90, 112, 52);
const PARK_CUT: OBB = lobb(0, -90, 118, 58);
export const WESTGATE_SQUARE: OBB = lobb(15, 15, 24, 24);
export const WEST_STADIUM: OBB = { x: -1078, z: -22, w: 66, d: 52, rot: 0 };
export const WEST_PORT: OBB = { x: -430, z: 206, w: 200, d: 52, rot: 0 };
export const WEST_MARINA: OBB = { x: -1070, z: 210, w: 110, d: 48, rot: 0 };
export const WEST_LIGHTHOUSE: P = [-1272, 186];
export const WIND_X = -1278;
export const WIND_TURBINES: P[] = [-420, -340, -260, -180, -100, -20, 60].map((z) => [WIND_X, z]);
export const WEST_RESERVED: OBB[] = [WESTGATE_PARK, WESTGATE_SQUARE, WEST_STADIUM];

/* ---------------- roads ---------------- */
const bay1Z = (x: number) => 78 + 5 * Math.sin(x / 41);
const bay2Z = (x: number) => 120 + 4 * Math.sin(x / 33 + 1);
const coastRoadZ = (x: number) => 158 + 4 * Math.sin(x / 37 + 0.5);
const northZ = (x: number) => -394 + 6 * Math.sin(x / 53);
const westX = (z: number) => -1162 + 9 * Math.sin(z / 47);

const clipRuns = (pts: P[], ok: (x: number, z: number) => boolean, minLen = 10): P[][] => {
  const runs: P[][] = []; let cur: P[] = [];
  for (const p of pts) { if (ok(p[0], p[1])) cur.push(p); else { if (cur.length >= minLen) runs.push(cur); cur = []; } }
  if (cur.length >= minLen) runs.push(cur); return runs;
};
function nearestOn(q: P[], x: number, z: number): [number, number, number] {
  let best: [number, number, number] = [Infinity, 0, 0];
  for (let i = 1; i < q.length; i++) { const a = q[i - 1], b = q[i]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0; const px = a[0] + t * dx, pz = a[1] + t * dz; const d = Math.hypot(x - px, z - pz);
    if (d < best[0]) best = [d, px, pz]; }
  return best;
}
const centre = (r: Road): P[] => (r.closed ? [...r.pts, r.pts[0]] : r.pts);
/** Roads that leave the west land to tie into the old network (not clipped to the west land; their outer end is a junction). */
const TIE_ROADS = new Set(['w-expy', 'w-coast']);
export const WEST_ROAD_NAMES: Record<string, string> = {
  'w-ring': 'Westgate Ring', 'w-expy': 'Westgate Expressway', 'w-coast': 'Sunset Coast Road', 'w-nsblvd': 'Cedar Boulevard', 'w-ewblvd': 'Westgate Boulevard',
  'w-bay1': 'Bayview Street', 'w-bay2': 'Harbour Street', 'w-north': 'Maple Heights Drive', 'w-west': 'Cedar Hills Road', 'w-iron': 'Foundry Road', 'w-iron3': 'Mill Road',
};
const okLand = (x: number, z: number) => onWest(x, z, 3) && !obbHit(PARK_CUT, x, z, 0) && !obbHit(WEST_STADIUM, x, z, 3);

function buildRoads(): Road[] {
  const roads: Road[] = [];
  const W: Record<RoadKind, number> = { ring: 5.5, boulevard: 6, avenue: 5, street: 4, lane: 3.6 };
  const push = (id: string, kind: RoadKind, pts: P[], cul = false, width = W[kind]) => roads.push({ id, kind, width, closed: false, pts, ...(cul ? { cul } : {}) });
  const add = (id: string, kind: RoadKind, ctrl: P[], cul = false, ok: (x: number, z: number) => boolean = okLand) => {
    for (const [i, run] of clipRuns(spline(ctrl, false), ok).entries()) push(`${id}${i ? `-${i}` : ''}`, kind, run, cul && i === 0);
  };
  const line = (a: P, b: P, n = 6): P[] => Array.from({ length: n + 1 }, (_, k) => [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n] as P);
  // Westgate Ring: a rounded superellipse in the grid's frame.
  const ring: P[] = []; for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; const c = Math.cos(a), s = Math.sin(a); ring.push(toWorld(RING_A * Math.sign(c) * Math.abs(c) ** 0.5, RING_B * Math.sign(s) * Math.abs(s) ** 0.5)); }
  roads.push({ id: 'w-ring', kind: 'ring', width: W.ring, closed: true, pts: spline(ring, true) });
  // Boulevards through the middle: Cedar Boulevard (north edge to the coast) and Westgate Boulevard (west edge to the ring's east side).
  add('w-nsblvd', 'boulevard', line(toWorld(0, -298), toWorld(0, 300), 10));
  add('w-ewblvd', 'boulevard', line(toWorld(-500, 0), toWorld(0, 0), 10).concat(line(toWorld(0, 0), toWorld(RING_A, 0), 4).slice(1)));
  // Downtown grid inside the ring, every 45 units in the grid frame (the park and the square sit in its blocks).
  for (const g of [-180, -135, -90, -45, 45, 90, 135, 180]) {
    const a: P[] = [], b: P[] = [];
    for (let t = -RING_A; t <= RING_A; t += 1) { a.push(toWorld(g, t)); b.push(toWorld(t, g)); }
    for (const [k, pts] of [a, b].entries()) for (const [i, run] of clipRuns(pts, (x, z) => inRing(x, z, 2.5) && okLand(x, z)).entries()) push(`w-grid${g}${k ? 'h' : 'v'}${i}`, 'street', run);
  }
  // Westgate Expressway: off the Airport Expressway, past the Space Center's south side, into the ring's east side.
  { const end = toWorld(RING_A, 0);
    push('w-expy', 'boulevard', spline([GW_TIE, [-246, -241], [-300, -240], [-372, -230], [-446, -210], [-516, -182], [-566, -152], [end[0] + 2, end[1] - 4]], false), false, 6.5); }
  // Sunset Coast Road: from the rural south-west corner, between the airport and the beach, along the whole west coast.
  { // threads the gap between the south-west country fields (cf:24/25 north of it, cf:26 south), then runs west
    const c: P[] = [RURAL_SW, [-124, 157], [-130, 165], [-138, 169.8], [-150, 169.8], [-165, 169.8], [-180, 169.8], [-196, 170], [-236, 170]]; for (let x = -290; x >= -1250; x -= 40) c.push([x, coastRoadZ(x)]);
    push('w-coast', 'avenue', spline(c, false)); }
  // Sunset Bay: two waterfront streets, lanes down to the coast road, and links up to the ring.
  { const s1: P[] = [], s2: P[] = []; for (let x = -1236; x <= -478; x += 30) { s1.push([x, bay1Z(x)]); if (x <= -486) s2.push([x, bay2Z(x)]); }
    add('w-bay1', 'street', s1); add('w-bay2', 'street', s2); }
  for (const x of [-1208, -1136, -1062, -990, -916, -844, -772, -700, -628, -556]) add(`w-bayl${-x}`, 'lane', [[x, bay1Z(x)], [x + 3, bay2Z(x)], [x, coastRoadZ(x)]]);
  for (const u of [-150, -90, 90, 150]) { const s = toWorld(u, RING_B - 1); add(`w-ringS${u}`, 'lane', [s, [s[0] - 2, (s[1] + bay1Z(s[0])) / 2], [s[0], bay1Z(s[0])]]); }
  // Maple Heights: a long curving drive north of the ring, links down to the ring, cul-de-sacs to the north edge.
  { const c: P[] = []; for (let x = -1244; x <= -330; x += 38) c.push([x, northZ(x)]); add('w-north', 'street', c); }
  for (const u of [-150, -90, 90, 150]) { const s = toWorld(u, -RING_B + 1); add(`w-ringN${u}`, 'lane', [s, [s[0] + 2, (s[1] + northZ(s[0])) / 2], [s[0], northZ(s[0])]]); }
  for (const x of [-1196, -1104, -1010, -930, -662, -574, -486, -400]) add(`w-culN${-x}`, 'lane', [[x, northZ(x)], [x + 3, northZ(x) - 22], [x + 1, northZ(x) - 42]], true);
  for (const x of [-1150, -1050, -960, -620, -530, -440]) add(`w-culM${-x}`, 'lane', [[x, northZ(x)], [x - 2, northZ(x) + 20], [x, northZ(x) + 38]], true);
  // Cedar Hills: a north-south road out west, links to the ring, cul-de-sacs west toward the wind farm.
  { const c: P[] = []; for (let z = northZ(-1162); z <= bay1Z(-1162); z += 36) c.push([westX(z), z]); c.push([westX(bay1Z(-1162)), bay1Z(-1162)]); add('w-west', 'street', c); }
  for (const v of [-110, 95]) { const s = toWorld(-RING_A + 1, v); add(`w-ringW${v}`, 'lane', [s, [(s[0] + westX(s[1])) / 2, s[1] + 2], [westX(s[1]), s[1]]]); }
  for (const z of [-340, -270, -200, -130, -60, 10]) add(`w-culW${-z}`, 'lane', [[westX(z), z], [westX(z) - 36, z + 3], [-1236, z + 1]], true);
  // Ironworks: Foundry Road and Mill Road from the expressway down to the coast, cross streets between them.
  add('w-iron', 'street', [[-430, -212], [-436, -120], [-428, -20], [-440, 80], [-432, coastRoadZ(-432)]]);
  add('w-iron3', 'street', [[-352, -232], [-354, -120], [-346, 30], [-350, coastRoadZ(-350)]]);
  { const s = toWorld(RING_A - 1, 95); add('w-iron2', 'street', [s, [(s[0] - 430) / 2, s[1] + 4], [-430, s[1] + 6]]); }
  add('w-iron4', 'lane', [[-430, -60], [-390, -58], [-352, -60], [-312, -62]], true);
  add('w-iron5', 'lane', [[-432, 60], [-390, 62], [-348, 60], [-308, 58]], true);
  return connectRoads(roads);
}

/** Every open end: snapped onto the nearest other road (short straight link), or capped with a cul-de-sac. */
const SNAP_R = 22;
function connectRoads(roads: Road[]): Road[] {
  for (const r of roads) {
    if (r.closed) continue;
    const ends: [RoadEnd, RoadEnd] = ['cul', 'cul'];
    for (const which of [0, 1] as const) {
      if (which === 1 && r.cul) { ends[1] = 'cul'; continue; }
      if (TIE_ROADS.has(r.id) && which === 0) { ends[0] = 'junction'; continue; } // ties into the old network
      const pts = r.pts; const p = which === 0 ? pts[0] : pts[pts.length - 1];
      let best: [number, number, number] = [Infinity, 0, 0];
      for (const o of roads) { if (o === r) continue; const n = nearestOn(centre(o), p[0], p[1]); if (n[0] < best[0]) best = n; }
      let done: RoadEnd | null = null;
      if (best[0] < 0.05) done = 'junction';
      else if (best[0] <= SNAP_R) {
        const to: P = [best[1], best[2]]; const L = Math.hypot(to[0] - p[0], to[1] - p[1]); const seg: P[] = [];
        for (let d = 1; d < L; d += 1) seg.push([p[0] + (to[0] - p[0]) * d / L, p[1] + (to[1] - p[1]) * d / L]); seg.push(to);
        if (seg.every(([x, z]) => onWest(x, z, 0.5) || TIE_ROADS.has(r.id))) { if (which === 0) r.pts = [...seg.reverse(), ...pts]; else r.pts = [...pts, ...seg]; done = 'junction'; }
      }
      ends[which] = done ?? 'cul';
    }
    r.ends = ends;
  }
  return roads;
}
export const WEST_ROADS: Road[] = buildRoads();
export const WEST_CUL_R = 4.4;
export const WEST_JUNCTIONS: Junction[] = (() => {
  const out: Junction[] = [];
  const add = (x: number, z: number, r: number) => { const j = out.find((o) => Math.hypot(o.x - x, o.z - z) < Math.max(o.r, r)); if (j) { j.r = Math.max(j.r, r); return; } out.push({ x, z, r }); };
  const wAt = (x: number, z: number, skip: Road) => { let w = 0; for (const o of WEST_ROADS) if (o !== skip && nearestOn(centre(o), x, z)[0] < 0.6) w = Math.max(w, o.width); return w; };
  for (const r of WEST_ROADS) { if (r.closed || !r.ends) continue;
    r.ends.forEach((e, i) => { if (e !== 'junction') return; const p = i === 0 ? r.pts[0] : r.pts[r.pts.length - 1]; add(p[0], p[1], Math.max(r.width, wAt(p[0], p[1], r), TIE_ROADS.has(r.id) && i === 0 ? 6.5 : 0) / 2 + 0.5); }); }
  const segs: { r: Road; a: P; b: P }[] = []; const G = 8; const grid = new Map<string, number[]>();
  for (const r of WEST_ROADS) { const q = centre(r); for (let i = 1; i < q.length; i++) { const k = segs.push({ r, a: q[i - 1], b: q[i] }) - 1; const key = `${Math.floor(q[i][0] / G)},${Math.floor(q[i][1] / G)}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); } }
  for (const [key, ids] of grid) { const [gx, gz] = key.split(',').map(Number); const near: number[] = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) near.push(...(grid.get(`${gx + a},${gz + b}`) ?? []));
    for (const i of ids) for (const j of near) { if (j <= i) continue; const s = segs[i], t = segs[j]; if (s.r === t.r) continue;
      const d1x = s.b[0] - s.a[0], d1z = s.b[1] - s.a[1], d2x = t.b[0] - t.a[0], d2z = t.b[1] - t.a[1]; const den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) continue;
      const u = ((t.a[0] - s.a[0]) * d2z - (t.a[1] - s.a[1]) * d2x) / den, v = ((t.a[0] - s.a[0]) * d1z - (t.a[1] - s.a[1]) * d1x) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) add(s.a[0] + u * d1x, s.a[1] + u * d1z, Math.max(s.r.width, t.r.width) / 2 + 0.5); } }
  return out;
})();
export const WEST_CUL_ENDS: P[] = WEST_ROADS.flatMap((r) => (r.closed || !r.ends ? [] : r.ends.flatMap((e, i) => (e === 'cul' ? [i === 0 ? r.pts[0] : r.pts[r.pts.length - 1]] : []))));

type Sample = { x: number; z: number; hw: number };
const CELL = 8; const sgrid = new Map<string, Sample[]>();
const put = (x: number, z: number, hw: number) => { const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; (sgrid.get(k) ?? sgrid.set(k, []).get(k)!).push({ x, z, hw }); };
for (const r of WEST_ROADS) r.pts.forEach(([x, z]) => put(x, z, r.width / 2));
for (const [x, z] of WEST_CUL_ENDS) put(x, z, WEST_CUL_R);
for (const j of WEST_JUNCTIONS) put(j.x, j.z, j.r);
/** Smallest (distance to a west road centreline − half width) within `reach`; Infinity when none is near. */
export function westRoadClearance(x: number, z: number, reach = 16): number {
  let best = Infinity; const c0 = Math.floor((x - reach) / CELL), c1 = Math.floor((x + reach) / CELL), r0 = Math.floor((z - reach) / CELL), r1 = Math.floor((z + reach) / CELL);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) for (const s of sgrid.get(`${i},${j}`) ?? []) best = Math.min(best, Math.hypot(s.x - x, s.z - z) - s.hw);
  return best;
}
const clearOfWestRoads = (b: OBB, m: number) => {
  if (!obbCorners(b).every(([x, z]) => onWest(x, z, 1.5))) return false;
  const reach = Math.hypot(b.w, b.d) / 2 + 8;
  const c0 = Math.floor((b.x - reach) / CELL), c1 = Math.floor((b.x + reach) / CELL), r0 = Math.floor((b.z - reach) / CELL), r1 = Math.floor((b.z + reach) / CELL);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) for (const s of sgrid.get(`${i},${j}`) ?? []) if (obbHit(b, s.x, s.z, s.hw + m)) return false;
  return true;
};
export function westNearestTangent(x: number, z: number): number {
  let best = Infinity, ang = 0;
  for (const r of WEST_ROADS) for (let i = 0; i < r.pts.length; i += 1) { const p = r.pts[i]; if (Math.abs(p[0] - x) > 40 || Math.abs(p[1] - z) > 40) continue; const d = Math.hypot(p[0] - x, p[1] - z); if (d < best) { best = d; const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)]; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
  return ang;
}

/* ---------------- districts + fill ---------------- */
export type WestDistrictName = 'Westgate' | 'Sunset Bay' | 'Maple Heights' | 'Cedar Hills' | 'Ironworks';
export function westDistrictName(x: number, z: number): WestDistrictName {
  if (x > -470) return 'Ironworks';
  if (inRing(x, z, -4)) return 'Westgate';
  if (z > bay1Z(x) - 30) return 'Sunset Bay';
  if (x < westX(z) + 40) return 'Cedar Hills';
  return z < -200 ? 'Maple Heights' : 'Cedar Hills';
}
export const westDistrict = (x: number, z: number): District => {
  const [u, v] = toLocal(x, z); const r = Math.hypot(u / 1.2, v);
  if (r < 92) return 'downtown';
  if (inRingL(u, v, 6)) return 'midtown';
  return 'suburb';
};
/** Industrial ground in Ironworks: warehouses, tanks and yards (decor; the fill keeps clear). */
export interface WestWarehouse extends OBB { h: number; kind: 'shed' | 'tank' | 'stack' }
export const WEST_WAREHOUSES: WestWarehouse[] = (() => {
  const out: WestWarehouse[] = []; const rand = rng(4242);
  for (const id of ['w-iron', 'w-iron3']) { const r = WEST_ROADS.find((o) => o.id === id); if (!r) continue; const pts = r.pts;
    for (const side of [1, -1]) for (let i = 10; i < pts.length - 10;) {
      const [x, z] = pts[i]; const a = pts[i - 2], b = pts[i + 2]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang), nz = Math.cos(ang);
      const k = rand(); const kind: WestWarehouse['kind'] = k < 0.62 ? 'shed' : k < 0.85 ? 'tank' : 'stack';
      const w = kind === 'shed' ? 16 + rand() * 12 : kind === 'tank' ? 9 : 7, d = kind === 'shed' ? 12 + rand() * 8 : kind === 'tank' ? 9 : 7;
      const off = r.width / 2 + 3 + d / 2; const o: WestWarehouse = { x: x + nx * off * side, z: z + nz * off * side, w, d, rot: -ang, h: kind === 'shed' ? 6 + rand() * 4 : kind === 'tank' ? 7 : 18, kind };
      if (clearOfWestRoads(o, 1.5) && !out.some((q) => obbOverlap(q, o, 2))) { out.push(o); i += Math.ceil(w + 4); } else i += 2;
    } }
  return out;
})();

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const DOWNTOWN_TALL = 30; // tallest Westgate towers (floors)
let fillCache: { houses: House[]; patches: Patch[] } | null = null;
/** West Chud fill: open-space patches first, then housing along every street's frontage, then block infill. Deterministic. */
export function westFill(): { houses: House[]; patches: Patch[] } {
  if (fillCache) return fillCache;
  const rand = rng(2026); const houses: House[] = []; const patches: Patch[] = [];
  const taken: OBB[] = [...WEST_RESERVED, ...WEST_WAREHOUSES];
  // spatial hash of everything placed so far (big reserved boxes go in every cell they touch)
  const TG = 24; const tgrid = new Map<string, OBB[]>();
  const take = (o: OBB) => { const r = Math.hypot(o.w, o.d) / 2; for (let i = Math.floor((o.x - r) / TG); i <= Math.floor((o.x + r) / TG); i++) for (let j = Math.floor((o.z - r) / TG); j <= Math.floor((o.z + r) / TG); j++) { const k = `${i},${j}`; (tgrid.get(k) ?? tgrid.set(k, []).get(k)!).push(o); } };
  taken.forEach(take);
  const free = (b: OBB, m: number) => { const r = Math.hypot(b.w, b.d) / 2 + m; for (let i = Math.floor((b.x - r) / TG); i <= Math.floor((b.x + r) / TG); i++) for (let j = Math.floor((b.z - r) / TG); j <= Math.floor((b.z + r) / TG); j++) for (const o of tgrid.get(`${i},${j}`) ?? []) if (obbOverlap(o, b, m)) return false; return true; };
  for (let i = 0; i < 2400 && patches.length < 46; i++) {
    const x = WEST.x0 + 20 + rand() * (WEST.x1 - WEST.x0 - 40), z = WEST.z0 + 12 + rand() * (WEST.z1 - WEST.z0 - 24); const dist = westDistrict(x, z);
    if (x > -470) continue;
    const c = westRoadClearance(x, z, 32); if (c < 3 || c > 14) continue;
    const kind: PatchKind = dist === 'downtown' ? (rand() < 0.7 ? 'plaza' : 'park') : rand() < 0.6 ? 'park' : 'lot';
    const s = kind === 'plaza' ? 9 + rand() * 3 : 10 + rand() * 7; const b: Patch = { x, z, w: s, d: s * (0.7 + rand() * 0.5), rot: -westNearestTangent(x, z), kind };
    if (clearOfWestRoads(b, 1) && free(b, 3)) { patches.push(b); take(b); }
  }
  const SKIP = new Set(['w-expy', 'w-iron', 'w-iron3', 'w-iron4', 'w-iron5']);
  for (const road of WEST_ROADS) {
    if (SKIP.has(road.id)) continue; const pts = road.pts; let typeIx = -1; let runLeft = 0;
    for (const row of [0, 1, 2]) for (const side of [1, -1]) for (let i = 2 + row * 2; i < pts.length - 2;) {
      const [x, z] = pts[i]; if (x > WEST.x1 - 4) { i += 4; continue; } const dist = westDistrict(x, z);
      if (row === 2 || (row === 1 && dist !== 'downtown')) { i += 4; continue; }
      const types = HOUSING_TYPES.filter((t) => t.districts.includes(dist));
      if (runLeft-- <= 0 || !types.includes(HOUSING_TYPES[typeIx])) { typeIx = HOUSING_TYPES.indexOf(types[Math.floor(rand() * types.length)]); runLeft = 3 + Math.floor(rand() * 5); }
      const t = HOUSING_TYPES[typeIx];
      const w = t.w[0] + rand() * (t.w[1] - t.w[0]), d = t.d[0] + rand() * (t.d[1] - t.d[0]);
      const a = pts[i - 2], b = pts[i + 2]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang), nz = Math.cos(ang);
      const setback = road.width / 2 + (dist === 'downtown' ? 1.3 : dist === 'midtown' ? 1.8 : 2.4) + rand() * (dist === 'suburb' ? 2.5 : 1) + d / 2 + row * (dist === 'downtown' ? 6.5 : 6);
      const gap = dist === 'downtown' ? 0.8 : dist === 'midtown' ? 3 + rand() * 3 : 7 + rand() * 8; // roomy midtown and suburban yards
      const hb: OBB = { x: x + nx * setback * side, z: z + nz * setback * side, w, d, rot: -ang };
      if (clearOfWestRoads(hb, 0.5) && free(hb, gap * 0.5)) {
        let floors = t.floors[0] + Math.floor(rand() * (t.floors[1] - t.floors[0] + 1));
        if (t.id === 'tower') { const [u, v] = toLocal(hb.x, hb.z); const k = Math.max(0, 1 - Math.hypot(u / 1.2, v) / 92); floors = Math.round(floors + k * (DOWNTOWN_TALL - floors) * (0.55 + rand() * 0.45)); }
        const hh: House = { ...hb, h: floors * t.floorH, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)] };
        houses.push(hh); take(hh); i += Math.max(1, Math.ceil(w + gap));
      } else i += 1;
    }
  }
  for (let k = 0; k < 300; k++) {
    const [u0, v0] = [(rand() * 2 - 1) * RING_A, (rand() * 2 - 1) * RING_B]; const [x, z] = toWorld(u0, v0); if (x > -470 || !inRingL(u0, v0, 4)) continue; // infill inside Westgate only
    const c = westRoadClearance(x, z, 32); if (c < 2 || c > 12) continue;
    const dist = westDistrict(x, z); const types = HOUSING_TYPES.filter((t) => t.districts.includes(dist)); const t = types[Math.floor(rand() * types.length)];
    const w = t.w[0] + rand() * (t.w[1] - t.w[0]), d = t.d[0] + rand() * (t.d[1] - t.d[0]);
    const hb: OBB = { x, z, w, d, rot: -westNearestTangent(x, z) };
    if (!clearOfWestRoads(hb, 0.8) || !free(hb, dist === 'suburb' ? 1.6 : 0.7)) continue;
    const floors = t.floors[0] + Math.floor(rand() * (t.floors[1] - t.floors[0] + 1));
    const hh: House = { ...hb, h: floors * t.floorH, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)] };
    houses.push(hh); take(hh);
  }
  fillCache = { houses, patches }; return fillCache;
}

/** Traffic: the ring, both boulevards, the expressway, Sunset Coast Road, the bay streets and Maple Heights Drive. */
export const WEST_CAR_ROUTES: Route[] = WEST_ROADS.filter((r) => r.kind === 'ring' || r.kind === 'boulevard' || r.kind === 'avenue' || r.id === 'w-bay1' || r.id === 'w-north' || r.id === 'w-west').map((road) => {
  const p = road.closed ? [...road.pts, road.pts[0]] : road.pts; const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return { road, len: cum[cum.length - 1], cum, p };
});
export const WEST_CAR_COUNT = 44;

/** District name signs (floating labels over each district). */
export const WEST_LABELS: Array<{ text: string; x: number; z: number; color: string }> = [
  { text: 'Westgate', x: WEST_DC[0] - 40, z: WEST_DC[1] - 30, color: '#7fd0ff' },
  { text: 'Sunset Bay', x: -820, z: 104, color: '#ffb870' },
  { text: 'Maple Heights', x: -800, z: -418, color: '#9be37a' },
  { text: 'Cedar Hills', x: -1196, z: -180, color: '#c6e07a' },
  { text: 'Ironworks', x: -392, z: -150, color: '#ffcf5a' },
  { text: 'West Chud Port', x: WEST_PORT.x, z: WEST_PORT.z + 10, color: '#7fe0ff' },
];
