/**
 * West Chud: the city's western half. New land west of the airport doubles the map (x from -1296 to the old
 * west edge at -286, same north/south span down to the beach). Nothing on the old map moves: every existing lot,
 * building, farm and id keeps its place. Two roads tie the districts into the old network: the Westgate Expressway
 * (off the Airport Expressway, north of the Speedway) and Sunset Coast Road (west from the rural south-west corner,
 * between the airport and the beach; the Fort McChud Bridge approach leaves it south of the airport).
 *
 * Laid out as more of the same city, not a new pattern (shared/worldLayout.ts is the reference):
 *   - the same road widths, markings and junction caps; an axis-aligned grid on the old downtown's 26-unit phase;
 *   - Westgate downtown copies the old core: the 78 x 72 rounded ring, two straight boulevards crossing at its centre
 *     (Westgate Boulevard sits on the old east-west boulevard's line), grid streets every 26 teeing into the ring, and the
 *     same downtown/midtown/suburb radii;
 *   - suburbs outside the ring: gently bent streets every 52 (east-west) and 104 (north-south), lanes and cul-de-sacs;
 *   - buildings come from the old fill rules, and each copies the footprint and height of an old building of its type;
 *   - wooded blocks, the countryside strips and Ironworks stay open (shared/westScenery.ts plants them like the old land).
 * Houses and patches use the city's property ids (b:<type>:<pos> / p:<kind>:<pos>), so they are bought, taxed and
 * sold exactly like the old city's.
 *
 * Pure geometry (no three.js): the renderer, real estate catalog and the layout tests read from here.
 */
import { ROAD_WIDTH, cityFill, spline, obbOverlap, obbHit, obbCorners, type OBB, type Road, type RoadKind, type RoadEnd, type Junction, type House, type Patch, type PatchKind, type Route } from './worldLayout.js';
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

/**
 * Westgate downtown centre. West Chud copies the original city's plan (shared/worldLayout.ts) instead of inventing its own:
 * an axis-aligned grid on the same 26-unit phase as the old downtown (so its streets line up with the old ones across the
 * airport), the same rounded ring (78 x 72) with the same downtown/midtown radii, the same road widths and markings.
 * The centre sits on the old Westgate Boulevard line (z = 0, the old east-west boulevard's line).
 */
export const WEST_DC: P = [-780, 0];
/** Kept for callers that think in the downtown's frame; the grid is not skewed (same orientation as the old city). */
export const toWorld = (u: number, v: number): P => [WEST_DC[0] + u, WEST_DC[1] + v];
export const toLocal = (x: number, z: number): P => [x - WEST_DC[0], z - WEST_DC[1]];
const RING_A = 78, RING_B = 72; // the old city's ring
const inRingL = (u: number, v: number, m = 0) => Math.abs(u) < RING_A - m && (Math.abs(u) / (RING_A - m)) ** 4 + (Math.abs(v) / (RING_B - m)) ** 4 < 1;
const inRing = (x: number, z: number, m = 0) => { const [u, v] = toLocal(x, z); return inRingL(u, v, m); };
/** Suburban street lines, on the old grid's 26-unit phase: north-south every 104, east-west every 52 (blocks 104 x 52). */
export const WEST_COLS = [-1196, -1092, -988, -884, -676, -572, -468, -364] as const; // plus Cedar Boulevard at x = -780
export const WEST_ROWS = [-416, -364, -312, -260, -208, -156, -104, -52, 52, 104] as const; // plus Westgate Boulevard at z = 0
const COL_X0 = WEST_COLS[0], COL_X1 = WEST_COLS[WEST_COLS.length - 1], ROW_Z0 = WEST_ROWS[0];

export const onWest = (x: number, z: number, m = 0) => x > WEST.x0 + m && x < WEST.x1 - m && z > WEST.z0 + m && z < WEST.z1 - m;

/** Reserved ground (no roads cut through, no housing): the park, the square, the stadium, the port, marina, wind farm. Each sits inside one block. */
export const WESTGATE_PARK: OBB = { x: -832, z: -130, w: 88, d: 34, rot: 0 }; // block x -884..-780, z -156..-104
export const WESTGATE_SQUARE: OBB = { x: -767, z: -13, w: 18, d: 18, rot: 0 }; // the downtown block south-east of the crossing
export const WEST_STADIUM: OBB = { x: -1040, z: -78, w: 76, d: 34, rot: 0 }; // block x -1092..-988, z -104..-52
export const WEST_PORT: OBB = { x: -430, z: 206, w: 200, d: 52, rot: 0 };
export const WEST_MARINA: OBB = { x: -1070, z: 210, w: 110, d: 48, rot: 0 };
export const WEST_LIGHTHOUSE: P = [-1272, 186];
export const WIND_X = -1278;
export const WIND_TURBINES: P[] = [-420, -340, -260, -180, -100, -20, 60].map((z) => [WIND_X, z]);
export const WEST_RESERVED: OBB[] = [WESTGATE_PARK, WESTGATE_SQUARE, WEST_STADIUM];

/* ---------------- roads ---------------- */
const coastRoadZ = (x: number) => 158 + 4 * Math.sin(x / 37 + 0.5);

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
};
const okLand = (x: number, z: number) => onWest(x, z, 3) && !obbHit(WESTGATE_PARK, x, z, 2) && !obbHit(WEST_STADIUM, x, z, 3);
/** Gentle suburban bends (the old suburbs' streets wander a few units off straight). Zero at the block corners' lines' ends is not needed: open ends snap. */
const bend = (t: number, k: number) => 4 * Math.sin(t / 53 + k * 1.7);

function buildRoads(): Road[] {
  const roads: Road[] = []; const rand = rng(77);
  const push = (id: string, kind: RoadKind, pts: P[], cul = false, width = ROAD_WIDTH[kind]) => roads.push({ id, kind, width, closed: false, pts, ...(cul ? { cul } : {}) });
  const add = (id: string, kind: RoadKind, ctrl: P[], cul = false, ok: (x: number, z: number) => boolean = okLand) => {
    for (const [i, run] of clipRuns(spline(ctrl, false), ok).entries()) push(`${id}${i ? `-${i}` : ''}`, kind, run, cul && i === 0);
  };
  const line = (a: P, b: P, f: (t: number) => P): P[] => { const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 13)); return Array.from({ length: n + 1 }, (_, k) => f(k / n)); };
  // Westgate Ring: the old ring's rounded superellipse (straight-ish sides, big round corners), same size.
  const ring: P[] = []; for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; const c = Math.cos(a), s = Math.sin(a); ring.push(toWorld(RING_A * Math.sign(c) * Math.abs(c) ** 0.5, RING_B * Math.sign(s) * Math.abs(s) ** 0.5)); }
  roads.push({ id: 'w-ring', kind: 'ring', width: ROAD_WIDTH.ring, closed: true, pts: spline(ring, true) });
  // Two straight boulevards crossing at right angles in the middle, like the old pair: Cedar Boulevard (north streets to the
  // coast) and Westgate Boulevard (on the old east-west boulevard's line, across the whole district).
  add('w-nsblvd', 'boulevard', [[WEST_DC[0], ROW_Z0], [WEST_DC[0], coastRoadZ(WEST_DC[0])]]);
  add('w-ewblvd', 'boulevard', [[COL_X0, WEST_DC[1]], [COL_X1, WEST_DC[1]]]);
  // Downtown/midtown grid inside the ring, every 26 like the old one, every street teeing into the ring.
  for (const u of [-52, -26, 26, 52]) {
    const a: P[] = [], b: P[] = [];
    for (let v = -90; v <= 90; v += 1) { a.push(toWorld(u, v)); b.push(toWorld(v, u)); }
    for (const [k, pts] of [a, b].entries()) for (const [i, run] of clipRuns(pts, (x, z) => inRing(x, z, 2.5) && okLand(x, z)).entries()) push(`w-grid${u}${k}${i}`, 'street', run);
  }
  // Suburban streets outside the ring on the same phase: east-west every 52, north-south every 104 (the ±52 rows carry the
  // downtown grid lines straight on out of the ring), gently bent like the old suburbs.
  const outRing = (x: number, z: number) => okLand(x, z) && !inRing(x, z, -2.5);
  WEST_ROWS.forEach((z, k) => { const amp = Math.abs(z) === 52 ? 0 : 1; add(`w-row${-z}`, 'street', line([COL_X0, z], [COL_X1, z], (t) => { const x = COL_X0 + (COL_X1 - COL_X0) * t; return [x, z + amp * bend(x, k)]; }), false, outRing); });
  WEST_COLS.forEach((x, k) => { const z1 = coastRoadZ(x); add(`w-col${-x}`, 'street', line([x, ROW_Z0], [x, z1], (t) => { const z = ROW_Z0 + (z1 - ROW_Z0) * t; return [x + bend(z, k + 3) * Math.sin(Math.PI * t), z]; }), false, outRing); });
  // Inside each suburban block: some get a lane straight through, more get a cul-de-sac (13-20 long, like the old ones).
  const xs = [...WEST_COLS.slice(0, 4), WEST_DC[0], ...WEST_COLS.slice(4)]; const zs = [...WEST_ROWS.slice(0, 8), WEST_DC[1], ...WEST_ROWS.slice(8)];
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j < zs.length; j++) {
    const xm = (xs[i] + xs[i + 1]) / 2, zN = zs[j], zS = j + 1 < zs.length ? zs[j + 1] : coastRoadZ(xm); const k = rand(), side = rand(), len = 14 + rand() * 6;
    if (xm > -470) continue; // Ironworks keeps its big yards
    if (Math.abs(xm - WEST_DC[0]) < RING_A + 30 && zS > -RING_B - 8 && zN < RING_B + 8) continue; // the ring's own blocks
    if ([WESTGATE_PARK, WEST_STADIUM].some((o) => obbHit(o, xm, (zN + zS) / 2, 4))) continue;
    if (k < 0.3) add(`w-lane${-xm}_${-zN}`, 'lane', [[xm, zN], [xm + 1, (zN + zS) / 2], [xm, zS]]);
    else if (k < 0.8) { const z0 = side < 0.5 ? zN : zS, dir = side < 0.5 ? 1 : -1; add(`w-cul${-xm}_${-zN}`, 'lane', [[xm, z0], [xm, z0 + dir * len * 0.5], [xm + 0.5, z0 + dir * len]], true); }
  }
  // Westgate Expressway: off the Airport Expressway, past the Space Center's south side, into the 208 street.
  push('w-expy', 'boulevard', spline([GW_TIE, [-246, -241], [-290, -233], [-330, -218], [COL_X1 + 2, -208.5]], false), false, 6.5);
  // Sunset Coast Road: from the rural south-west corner, between the airport and the beach, along the whole west coast.
  { // threads the gap between the south-west country fields (cf:24/25 north of it, cf:26 south), then runs west
    const c: P[] = [RURAL_SW, [-124, 157], [-130, 165], [-138, 169.8], [-150, 169.8], [-165, 169.8], [-180, 169.8], [-196, 170], [-236, 170]]; for (let x = -290; x >= -1250; x -= 40) c.push([x, coastRoadZ(x)]);
    push('w-coast', 'avenue', spline(c, false), false, 5); } // the link roads keep the countryside's collector width (shared/expansionRoads.ts)
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

type Sample = { x: number; z: number; hw: number; ang?: number };
const CELL = 8; const sgrid = new Map<string, Sample[]>();
const put = (x: number, z: number, hw: number, ang?: number) => { const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; (sgrid.get(k) ?? sgrid.set(k, []).get(k)!).push({ x, z, hw, ang }); };
for (const r of WEST_ROADS) { const q = r.pts; q.forEach(([x, z], i) => { const a = q[Math.max(0, i - 1)], b = q[Math.min(q.length - 1, i + 1)]; put(x, z, r.width / 2, Math.atan2(b[1] - a[1], b[0] - a[0])); }); }
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
/** Heading of the nearest road centreline sample (within 40), like worldLayout.nearestTangent. */
export function westNearestTangent(x: number, z: number): number {
  let best = Infinity, ang = 0; const R = 40; const c0 = Math.floor((x - R) / CELL), c1 = Math.floor((x + R) / CELL), r0 = Math.floor((z - R) / CELL), r1 = Math.floor((z + R) / CELL);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) for (const s of sgrid.get(`${i},${j}`) ?? []) { if (s.ang === undefined) continue; const d = Math.hypot(s.x - x, s.z - z); if (d < best) { best = d; ang = s.ang; } }
  return ang;
}

/* ---------------- districts + fill ---------------- */
export type WestDistrictName = 'Westgate' | 'Sunset Bay' | 'Maple Heights' | 'Cedar Hills' | 'Ironworks';
export function westDistrictName(x: number, z: number): WestDistrictName {
  if (inRing(x, z, -4)) return 'Westgate';
  if (x > -470) return 'Ironworks';
  if (z > 78) return 'Sunset Bay';
  return x < -884 ? 'Cedar Hills' : 'Maple Heights';
}
/** Same rule and radii as the old city's worldLayout.district, measured from Westgate's centre. */
export const westDistrict = (x: number, z: number): District => { const r = Math.hypot(x - WEST_DC[0], (z - WEST_DC[1]) * 1.1); return r < 36 ? 'downtown' : r < 62 ? 'midtown' : 'suburb'; };
/** Ironworks: industrial ground east of x = -470 (warehouses, tanks and stacks; no housing). */
export const WEST_INDUSTRIAL_X = -470;
/** Industrial ground in Ironworks: warehouses, tanks and yards (decor; the fill keeps clear). */
export interface WestWarehouse extends OBB { h: number; kind: 'shed' | 'tank' | 'stack' }
export const WEST_WAREHOUSES: WestWarehouse[] = (() => {
  const out: WestWarehouse[] = []; const rand = rng(4242);
  for (const r of WEST_ROADS) { if (r.closed || TIE_ROADS.has(r.id)) continue; const pts = r.pts;
    for (const side of [1, -1]) for (let i = 3; i < pts.length - 3;) {
      const [x, z] = pts[i]; if (x < WEST_INDUSTRIAL_X + 8 || x > WEST.x1 - 6 || z > 140) { i += 2; continue; }
      const a = pts[i - 2], b = pts[i + 2]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang), nz = Math.cos(ang);
      const k = rand(); const kind: WestWarehouse['kind'] = k < 0.62 ? 'shed' : k < 0.85 ? 'tank' : 'stack';
      const w = kind === 'shed' ? 16 + rand() * 12 : kind === 'tank' ? 9 : 7, d = kind === 'shed' ? 12 + rand() * 8 : kind === 'tank' ? 9 : 7;
      const off = r.width / 2 + 3 + d / 2; const o: WestWarehouse = { x: x + nx * off * side, z: z + nz * off * side, w, d, rot: -ang, h: kind === 'shed' ? 6 + rand() * 4 : kind === 'tank' ? 7 : 18, kind };
      if (o.x > WEST_INDUSTRIAL_X + 4 && clearOfWestRoads(o, 1.5) && !out.some((q) => obbOverlap(q, o, 2))) { out.push(o); i += Math.ceil(w + 4); } else i += 2;
    } }
  return out;
})();

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
/**
 * Woods: like the countryside between the old city's districts, some suburban blocks stay wooded (clumps of trees, no
 * housing). Picked once, deterministically; never the ring's blocks or the reserved ones.
 */
const WOOD_BLOCKS: Array<{ x0: number; x1: number; z0: number; z1: number }> = (() => {
  const out: Array<{ x0: number; x1: number; z0: number; z1: number }> = []; const r = rng(31);
  const xs = [...WEST_COLS.slice(0, 4), WEST_DC[0], ...WEST_COLS.slice(4)]; const zs = [...WEST_ROWS.slice(0, 8), WEST_DC[1], ...WEST_ROWS.slice(8)];
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const b = { x0: xs[i], x1: xs[i + 1], z0: zs[j], z1: zs[j + 1] }; const k = r(); const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (cx > WEST_INDUSTRIAL_X || Math.abs(cx - WEST_DC[0]) < RING_A + 30 && Math.abs(cz - WEST_DC[1]) < RING_B + 40) continue;
    if ([WESTGATE_PARK, WEST_STADIUM].some((o) => obbHit(o, cx, cz, 4))) continue;
    if (k < (j === 0 || i === 0 ? 0.35 : 0.16)) out.push(b); // more of them toward the edges, like the old outskirts
  }
  return out;
})();
const inWoods = (x: number, z: number) => WOOD_BLOCKS.some((b) => x > b.x0 + 3 && x < b.x1 - 3 && z > b.z0 + 3 && z < b.z1 - 3);
/** Built-up West Chud: everything but Ironworks, the countryside strips round the edges and the wooded blocks. */
export const westTown = (x: number, z: number) => x < WEST_INDUSTRIAL_X && x > COL_X0 - 24 && z > ROW_Z0 - 30 && !inWoods(x, z);
/** Old downtown plate area (worldLayout PLATE 116): the fill's infill attempts scale with land area from the old 4000. */
const OLD_PLATE_AREA = 232 * 232;
/**
 * Suburban frontage rows. The old suburbs have few streets, so all three frontage rows fit; West Chud's suburbs have a street
 * every 52, where a third row would pack the blocks. Two rows give the old suburbs' measured density (about 11 buildings and
 * 14% ground cover per 1000 square units, against 8-14 and 11-13% in the old ones). Downtown and midtown keep all three.
 */
const SUBURB_ROWS = 1;
let fillCache: { houses: House[]; patches: Patch[] } | null = null;
/**
 * West Chud fill, the old city's cityFill rules unchanged (same housing types, sizes, floors, setbacks, gaps, rows and
 * district mix): open-space patches first, then housing along every street's frontage, then block infill. Deterministic.
 */
export function westFill(): { houses: House[]; patches: Patch[] } {
  if (fillCache) return fillCache;
  const rand = rng(2026); const houses: House[] = []; const patches: Patch[] = [];
  const taken: OBB[] = [...WEST_RESERVED, ...WEST_WAREHOUSES];
  // spatial hash of everything placed so far (big reserved boxes go in every cell they touch)
  const TG = 24; const tgrid = new Map<string, OBB[]>();
  const take = (o: OBB) => { const r = Math.hypot(o.w, o.d) / 2; for (let i = Math.floor((o.x - r) / TG); i <= Math.floor((o.x + r) / TG); i++) for (let j = Math.floor((o.z - r) / TG); j <= Math.floor((o.z + r) / TG); j++) { const k = `${i},${j}`; (tgrid.get(k) ?? tgrid.set(k, []).get(k)!).push(o); } };
  taken.forEach(take);
  const free = (b: OBB, m: number) => { const r = Math.hypot(b.w, b.d) / 2 + m; for (let i = Math.floor((b.x - r) / TG); i <= Math.floor((b.x + r) / TG); i++) for (let j = Math.floor((b.z - r) / TG); j <= Math.floor((b.z + r) / TG); j++) for (const o of tgrid.get(`${i},${j}`) ?? []) if (obbOverlap(o, b, m)) return false; return true; };
  // Sizes come straight from the old city: each new building copies the footprint and height of a random old building of
  // the same type, so West Chud's houses, row houses, apartments and towers have exactly the old ones' size distributions.
  const pool = new Map<string, House[]>(); for (const h of cityFill().houses) (pool.get(h.type) ?? pool.set(h.type, []).get(h.type)!).push(h);
  const pickR = rng(9091); pickR(); // own stream: consecutive draws of one Lehmer stream are correlated
  const like = (type: string): { w: number; d: number; h: number } => { const a = pool.get(type); if (a?.length) return a[Math.floor(pickR() * a.length)]; const t = HOUSING_TYPES.find((o) => o.id === type)!; return { w: t.w[0], d: t.d[0], h: t.floors[0] * t.floorH }; };
  const urban = westTown; // Ironworks, the countryside strips and the woods stay open
  for (let i = 0; i < 2400 && patches.length < 46; i++) {
    const x = WEST.x0 + 8 + rand() * (WEST.x1 - WEST.x0 - 16), z = WEST.z0 + 8 + rand() * (WEST.z1 - WEST.z0 - 16); const dist = westDistrict(x, z);
    if (!urban(x, z)) continue;
    const kind: PatchKind = dist === 'downtown' ? 'plaza' : rand() < 0.75 ? 'park' : 'lot';
    const s = kind === 'plaza' ? 9 : 10 + rand() * 6; const b: Patch = { x, z, w: s, d: s * (0.7 + rand() * 0.5), rot: -westNearestTangent(x, z), kind };
    if (clearOfWestRoads(b, 1) && free(b, 3)) { patches.push(b); take(b); }
  }
  for (const road of WEST_ROADS) {
    if (road.id === 'w-expy') continue; const pts = road.pts; let typeIx = -1; let runLeft = 0;
    for (const row of [0, 1, 2]) for (const side of [1, -1]) for (let i = 2 + row * 2; i < pts.length - 2;) {
      const [x, z] = pts[i]; if (!urban(x, z)) { i += 2; continue; } const dist = westDistrict(x, z);
      if (row > SUBURB_ROWS && dist === 'suburb') { i += 4; continue; } // see SUBURB_ROWS
      const types = HOUSING_TYPES.filter((t) => t.districts.includes(dist));
      if (runLeft-- <= 0 || !types.includes(HOUSING_TYPES[typeIx])) { typeIx = HOUSING_TYPES.indexOf(types[Math.floor(rand() * types.length)]); runLeft = 3 + Math.floor(rand() * 5); }
      const t = HOUSING_TYPES[typeIx];
      const e = like(t.id); const w = e.w, d = e.d;
      const a = pts[i - 2], b = pts[i + 2]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang), nz = Math.cos(ang);
      const setback = road.width / 2 + (dist === 'downtown' ? 1.3 : dist === 'midtown' ? 1.8 : 2.4) + rand() * (dist === 'suburb' ? 2.5 : 1) + d / 2 + row * (dist === 'downtown' ? 6.5 : 6);
      const gap = dist === 'downtown' ? 0.5 : dist === 'midtown' ? 0.9 : 1.6 + rand() * 1.8;
      const hb: OBB = { x: x + nx * setback * side, z: z + nz * setback * side, w, d, rot: -ang };
      if (urban(hb.x, hb.z) && clearOfWestRoads(hb, 0.5) && free(hb, gap * 0.5)) {
        const hh: House = { ...hb, h: e.h, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)] };
        houses.push(hh); take(hh); i += Math.max(1, Math.ceil(w + gap));
      } else i += 1;
    }
  }
  // Infill: block interiors get a few more homes, still turned to their nearest street (the old 4000 tries, scaled by area).
  const tries = Math.round(4000 * ((WEST.x1 - WEST.x0) * (WEST.z1 - WEST.z0)) / OLD_PLATE_AREA);
  for (let k = 0; k < tries; k++) {
    const x = WEST.x0 + rand() * (WEST.x1 - WEST.x0), z = WEST.z0 + rand() * (WEST.z1 - WEST.z0); if (!urban(x, z)) continue;
    const c = westRoadClearance(x, z, 32); if (c < 2 || c > 12) continue; // only near a street, never stranded mid-block
    const dist = westDistrict(x, z); const types = HOUSING_TYPES.filter((t) => t.districts.includes(dist)); const t = types[Math.floor(rand() * types.length)];
    const e = like(t.id); const w = e.w, d = e.d;
    const hb: OBB = { x, z, w, d, rot: -westNearestTangent(x, z) };
    if (!clearOfWestRoads(hb, 0.8) || !free(hb, dist === 'suburb' ? 1.6 : 0.7)) continue;
    const hh: House = { ...hb, h: e.h, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)] };
    houses.push(hh); take(hh);
  }
  fillCache = { houses, patches }; return fillCache;
}

/** Traffic: the ring, both boulevards, the expressway and Sunset Coast Road (the old city's rule: ring, boulevards, avenues). */
export const WEST_CAR_ROUTES: Route[] = WEST_ROADS.filter((r) => r.kind === 'ring' || r.kind === 'boulevard' || r.kind === 'avenue').map((road) => {
  const p = road.closed ? [...road.pts, road.pts[0]] : road.pts; const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return { road, len: cum[cum.length - 1], cum, p };
});
/** Same density as the old city (one car per ~120 units of network), capped for phones. */
export const WEST_CAR_COUNT = Math.max(8, Math.min(44, Math.round(WEST_ROADS.reduce((s, r) => s + r.pts.length, 0) / 120)));

/** District name signs (floating labels over each district). */
export const WEST_LABELS: Array<{ text: string; x: number; z: number; color: string }> = [
  { text: 'Westgate', x: WEST_DC[0] - 40, z: WEST_DC[1] - 40, color: '#7fd0ff' },
  { text: 'Sunset Bay', x: -940, z: 128, color: '#ffb870' },
  { text: 'Maple Heights', x: -700, z: -300, color: '#9be37a' },
  { text: 'Cedar Hills', x: -1120, z: -200, color: '#c6e07a' },
  { text: 'Ironworks', x: -412, z: -120, color: '#ffcf5a' },
  { text: 'West Chud Port', x: WEST_PORT.x, z: WEST_PORT.z + 10, color: '#7fe0ff' },
];
