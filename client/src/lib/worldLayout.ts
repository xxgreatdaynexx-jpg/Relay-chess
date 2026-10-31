/**
 * Pure organic city layout (no three.js) so tests can check cars never cross buildings.
 * Roads are sampled curves (ring road, curving boulevards, a diagonal avenue, a skewed downtown grid,
 * winding suburb lanes and cul-de-sacs). Buildings are placed along street frontage, rotated to face their street.
 */
import { HOUSING_TYPES, type District } from './housing';

export const PLATE = 96; // plate spans -PLATE..PLATE on x and z
export const PAD = 12; // landmark pad footprint (square, rotated to face its street)

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Waterfront: a winding shoreline along the south edge; water from shoreZ(x) to PLATE. */
export const shoreZ = (x: number) => 70 + 7 * Math.sin(x / 23 + 0.4) + 3.5 * Math.sin(x / 9 + 1.3);

export type RoadKind = 'ring' | 'boulevard' | 'avenue' | 'street' | 'lane';
export interface Road { id: string; kind: RoadKind; width: number; closed: boolean; pts: [number, number][]; cul?: boolean }
export const ROAD_WIDTH: Record<RoadKind, number> = { ring: 5, boulevard: 5.5, avenue: 4.5, street: 3.8, lane: 3.6 };

/** Centripetal-ish Catmull-Rom through control points, resampled at ~`step` spacing. */
function spline(ctrl: [number, number][], closed: boolean, step = 1): [number, number][] {
  const n = ctrl.length; const raw: [number, number][] = [];
  const P = (i: number) => closed ? ctrl[((i % n) + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < 24; k++) { const t = k / 24, t2 = t * t, t3 = t2 * t;
      raw.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); }
  }
  if (!closed) raw.push(ctrl[n - 1]);
  return resample(raw, step, closed);
}
function resample(pts: [number, number][], step: number, closed: boolean): [number, number][] {
  const out: [number, number][] = [pts[0]]; let carry = 0;
  const all = closed ? [...pts, pts[0]] : pts;
  for (let i = 1; i < all.length; i++) {
    const [ax, az] = all[i - 1], [bx, bz] = all[i]; const L = Math.hypot(bx - ax, bz - az); let d = step - carry;
    while (d <= L) { out.push([ax + (bx - ax) * d / L, az + (bz - az) * d / L]); d += step; }
    carry = L - (d - step);
  }
  if (closed && Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step * 0.5) out.pop();
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}
const onLand = (x: number, z: number, m = 0) => Math.abs(x) < PLATE - m && z > -PLATE + m && z < shoreZ(x) - m;
/** Split a polyline into the runs that stay on land (and optionally outside a radius). */
function clipRuns(pts: [number, number][], ok: (x: number, z: number) => boolean, minLen = 10): [number, number][][] {
  const runs: [number, number][][] = []; let cur: [number, number][] = [];
  for (const p of pts) { if (ok(p[0], p[1])) cur.push(p); else { if (cur.length >= minLen) runs.push(cur); cur = []; } }
  if (cur.length >= minLen) runs.push(cur);
  return runs;
}

function buildRoads(): Road[] {
  const roads: Road[] = [];
  // Ring road: a bent loop that hugs the waterfront on its south side.
  const ring: [number, number][] = [];
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; const r = 64 * (1 + 0.08 * Math.sin(3 * a + 0.5) + 0.05 * Math.cos(2 * a));
    const x = Math.cos(a) * r * 1.08, z = Math.sin(a) * r; ring.push([x, Math.min(z, shoreZ(x) - 9)]); }
  roads.push({ id: 'ring', kind: 'ring', width: ROAD_WIDTH.ring, closed: true, pts: spline(ring, true) });
  // Curving boulevards through the middle (north-south S-curve, east-west sweep) and a diagonal avenue.
  const add = (id: string, kind: RoadKind, ctrl: [number, number][]) => {
    for (const [i, run] of clipRuns(spline(ctrl, false), (x, z) => onLand(x, z, 3)).entries()) roads.push({ id: `${id}${i || ''}`, kind, width: ROAD_WIDTH[kind], closed: false, pts: run });
  };
  add('nsblvd', 'boulevard', [[-6, -100], [6, -62], [-10, -26], [4, 8], [-4, 40], [6, 62]]);
  add('ewblvd', 'boulevard', [[-100, -4], [-62, -16], [-26, -2], [14, -10], [50, 6], [100, -6]]);
  add('diag', 'avenue', [[-84, 56], [-50, 30], [-18, 14], [26, -26], [58, -58], [90, -90]]);
  // Downtown: a small grid skewed to follow the boulevards, clipped to the core.
  const majors = roads.filter((r) => r.kind === 'boulevard' || r.kind === 'avenue').map((r) => r.pts);
  const sk = 0.32, cs = Math.cos(sk), sn = Math.sin(sk);
  for (const u of [-42, -21, 21, 42]) {
    const a: [number, number][] = [], b: [number, number][] = [];
    for (let v = -46; v <= 46; v += 1) { a.push([u * cs - v * sn, u * sn + v * cs]); b.push([v * cs - u * sn, v * sn + u * cs]); }
    for (const [k, pts] of [a, b].entries()) {
      const dir = k === 0 ? [-sn, cs] : [cs, sn];
      // Drop stretches that run alongside a boulevard (crossings are kept), so blocks stay deep enough to build on.
      const clearOfMajors = (x: number, z: number) => { for (const m of majors) for (let j = 1; j < m.length - 1; j++) { const p = m[j]; if (Math.hypot(p[0] - x, p[1] - z) < 11) { const tx = m[j + 1][0] - m[j - 1][0], tz = m[j + 1][1] - m[j - 1][1]; if (Math.abs(tx * dir[0] + tz * dir[1]) / Math.hypot(tx, tz) > 0.7) return false; } } return true; };
      for (const [i, run] of clipRuns(pts, (x, z) => Math.hypot(x, z) < 46 && onLand(x, z, 3) && clearOfMajors(x, z)).entries())
      roads.push({ id: `dt${u}${k}${i}`, kind: 'street', width: ROAD_WIDTH.street, closed: false, pts: run });
    }
  }
  // Midtown streets that follow the ring at an inner offset (broken into arcs).
  const arc = (id: string, r0: number, a0: number, a1: number, wob: number, kind: RoadKind) => {
    const ctrl: [number, number][] = []; for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; const r = r0 + wob * Math.sin(i * 1.7); ctrl.push([Math.cos(a) * r * 1.08, Math.sin(a) * r]); }
    for (const [i, run] of clipRuns(spline(ctrl, false), (x, z) => onLand(x, z, 4)).entries()) roads.push({ id: `${id}${i || ''}`, kind, width: ROAD_WIDTH[kind], closed: false, pts: run });
  };
  arc('mid-n', 48, -2.6, -0.6, 2, 'street'); arc('mid-e', 47, 0.1, 1.2, 2, 'street'); arc('mid-w', 48, 1.9, 3.1, 2, 'street');
  // Suburbs: winding lanes outside the ring and cul-de-sacs off it.
  arc('lane-nw', 84, -2.75, -1.95, 4, 'lane'); arc('lane-ne', 84, -1.2, -0.35, 4, 'lane'); arc('lane-w', 82, 2.7, 3.5, 3, 'lane'); arc('lane-e', 82, -0.15, 0.55, 3, 'lane');
  const ringPts = roads[0].pts; const R = rng(11);
  for (const a of [-2.95, -2.3, -1.65, -1.0, -0.45, 0.3, 2.95, 3.4, -2.0, -0.8]) {
    // nearest ring point at angle a
    let best = ringPts[0], bd = 1e9; for (const p of ringPts) { const d = Math.abs(Math.atan2(p[1], p[0] / 1.08) - a); if (d < bd) { bd = d; best = p; } }
    const out = Math.hypot(best[0], best[1]); const dir: [number, number] = [best[0] / out, best[1] / out];
    const len = 14 + R() * 8; const side = R() < 0.5 ? 1 : -1; const ctrl: [number, number][] = [];
    for (let i = 0; i <= 4; i++) { const t = i / 4; const w = Math.sin(t * Math.PI) * 4 * side; ctrl.push([best[0] + dir[0] * (3 + len * t) - dir[1] * w, best[1] + dir[1] * (3 + len * t) + dir[0] * w]); }
    const pts = spline(ctrl, false); if (!pts.every(([x, z]) => onLand(x, z, 6))) continue;
    roads.push({ id: `cul${a}`, kind: 'lane', width: ROAD_WIDTH.lane, closed: false, pts, cul: true });
  }
  return roads;
}
export const ROADS: Road[] = buildRoads();
export const CUL_R = 4; // cul-de-sac turning circle radius

/** Spatial hash of road centreline samples, for clearance checks. */
type Sample = { x: number; z: number; hw: number };
const CELL = 8; const grid = new Map<string, Sample[]>();
for (const r of ROADS) {
  const put = (x: number, z: number, hw: number) => { const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push({ x, z, hw }); };
  r.pts.forEach(([x, z]) => put(x, z, r.width / 2));
  if (r.cul) { const [x, z] = r.pts[r.pts.length - 1]; put(x, z, CUL_R); }
}
/** Smallest (distance to centreline − half width) within `reach`; Infinity when no road is near. */
export function roadClearance(x: number, z: number, reach = 16): number {
  let best = Infinity; const c0 = Math.floor((x - reach) / CELL), c1 = Math.floor((x + reach) / CELL), r0 = Math.floor((z - reach) / CELL), r1 = Math.floor((z + reach) / CELL);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) for (const s of grid.get(`${i},${j}`) ?? []) { const d = Math.hypot(s.x - x, s.z - z) - s.hw; if (d < best) best = d; }
  return best;
}
/** Nearest road sample's tangent angle (for facing a building to its street). */
function nearestTangent(x: number, z: number): number {
  let best = Infinity, ang = 0;
  for (const r of ROADS) for (let i = 0; i < r.pts.length; i++) { const d = Math.hypot(r.pts[i][0] - x, r.pts[i][1] - z); if (d < best) { best = d; const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)]; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
  return ang;
}

/** Oriented footprint. `rot` is three.js rotation.y; local x maps to world (cos rot, −sin rot). */
export interface OBB { x: number; z: number; w: number; d: number; rot: number }
const axes = (b: OBB) => { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [[c, -s], [s, c]] as const; };
export function obbCorners(b: OBB): [number, number][] { const [u, v] = axes(b); return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [b.x + u[0] * b.w / 2 * i + v[0] * b.d / 2 * j, b.z + u[1] * b.w / 2 * i + v[1] * b.d / 2 * j]); }
/** Is point within `m` of the footprint? */
export function obbHit(b: OBB, x: number, z: number, m: number): boolean { const [u, v] = axes(b); const dx = x - b.x, dz = z - b.z; return Math.abs(dx * u[0] + dz * u[1]) < b.w / 2 + m && Math.abs(dx * v[0] + dz * v[1]) < b.d / 2 + m; }
/** SAT overlap test with a gap margin. */
export function obbOverlap(a: OBB, b: OBB, m = 0): boolean {
  for (const ax of [...axes(a), ...axes(b)]) {
    const proj = (o: OBB) => { const [u, v] = axes(o); const c = o.x * ax[0] + o.z * ax[1]; const r = Math.abs(u[0] * ax[0] + u[1] * ax[1]) * o.w / 2 + Math.abs(v[0] * ax[0] + v[1] * ax[1]) * o.d / 2; return [c - r, c + r]; };
    const [a0, a1] = proj(a), [b0, b1] = proj(b); if (a1 + m <= b0 || b1 + m <= a0) return false;
  }
  return true;
}
/** Footprint clear of every road (centre + corners + edge midpoints) by `m`, and on land. */
function clearOfRoads(b: OBB, m: number): boolean {
  const cs = obbCorners(b); const pts = [[b.x, b.z], ...cs, ...cs.map((p, i) => [(p[0] + cs[(i + 1) % 4][0]) / 2, (p[1] + cs[(i + 1) % 4][1]) / 2])];
  if (!cs.every(([x, z]) => onLand(x, z, 1.5))) return false;
  // road samples are 1 apart; check samples against the box itself so long buildings are covered too
  const reach = Math.hypot(b.w, b.d) / 2 + 8;
  const c0 = Math.floor((b.x - reach) / CELL), c1 = Math.floor((b.x + reach) / CELL), r0 = Math.floor((b.z - reach) / CELL), r1 = Math.floor((b.z + reach) / CELL);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) for (const s of grid.get(`${i},${j}`) ?? []) if (obbHit(b, s.x, s.z, s.hw + m)) return false;
  return pts.length > 0;
}

export const district = (x: number, z: number): District => { const r = Math.hypot(x, z * 1.1); return r < 36 ? 'downtown' : r < 62 ? 'midtown' : 'suburb'; };

/**
 * Landmark slots on prominent spots (keyed by spot id; data-driven). Any WORLD_SPOTS id without a slot takes one
 * of SPARE_SLOTS, so a new landmark (e.g. the Stock Exchange, `stocks`) slots in without touching this file.
 * Positions are nudged off roads automatically and the pad turns to face its nearest street.
 */
export const LANDMARK_SLOTS: Record<string, [number, number]> = {
  leaderboard: [12, -18], // downtown, by the boulevards' crossing
  chat: [14, 20], // central plaza
  chess: [-40, -36],
  bank: [34, -2], // financial district
  stocks: [28, -36], // reserved: Stock Exchange (next to the bank)
  casino: [30, 50], // waterfront
  arena: [64, 30],
  market: [-30, 44], // waterfront market
  factory: [-74, 10],
  mine: [-66, -62],
  warehouse: [72, -46],
};
export const SPARE_SLOTS: [number, number][] = [[-4, 58], [52, -74], [-82, 40], [80, 10]];

function placeLandmarks(ids: string[]): Record<string, OBB> {
  const out: Record<string, OBB> = {}; const spare = [...SPARE_SLOTS];
  for (const id of ids) {
    const want = LANDMARK_SLOTS[id] ?? spare.shift(); if (!want) continue;
    let placed: OBB | null = null;
    for (let rad = 0; rad <= 36 && !placed; rad += 2) for (let k = 0; k < Math.max(1, rad * 3) && !placed; k++) {
      const a = (k / Math.max(1, rad * 3)) * Math.PI * 2; const x = want[0] + Math.cos(a) * rad, z = want[1] + Math.sin(a) * rad;
      const b: OBB = { x, z, w: PAD, d: PAD, rot: -nearestTangent(x, z) };
      if (clearOfRoads(b, 1.2) && !Object.values(out).some((o) => obbOverlap(o, b, 5))) placed = b;
    }
    if (placed) out[id] = placed;
  }
  return out;
}
export const LANDMARK_IDS = ['casino', 'chess', 'mine', 'arena', 'factory', 'warehouse', 'bank', 'market', 'leaderboard', 'chat', 'stocks'];
let lmCache: { key: string; v: Record<string, OBB> } | null = null;
/** Landmark footprints for the given spot ids (defaults to every known slot). */
export function landmarks(ids: string[] = LANDMARK_IDS): Record<string, OBB> {
  const key = ids.join(','); if (lmCache?.key !== key) lmCache = { key, v: placeLandmarks(ids) }; return lmCache.v;
}
export const SPOT_POS: Record<string, [number, number]> = new Proxy({} as Record<string, [number, number]>, { get: (_t, id: string) => { const b = landmarks()[id]; return b ? [b.x, b.z] : undefined; } });
export const landmarkBoxes = (ids?: string[]): OBB[] => Object.values(landmarks(ids));

export type PatchKind = 'park' | 'plaza' | 'lot';
export interface Patch extends OBB { kind: PatchKind }
export interface House extends OBB { h: number; type: string; color: number }

/** Parks, plazas and empty lots in open ground, then housing along every street's frontage, facing the street. */
export function cityFill(seed = 7, ids?: string[]): { houses: House[]; patches: Patch[] } {
  const rand = rng(seed); const lms = landmarkBoxes(ids);
  const taken: OBB[] = [...lms]; const houses: House[] = []; const patches: Patch[] = [];
  const free = (b: OBB, m: number) => !taken.some((o) => Math.abs(o.x - b.x) < 30 && Math.abs(o.z - b.z) < 30 && obbOverlap(o, b, m));
  // Open-space patches first so the frontage fill leaves them alone.
  for (let i = 0; i < 400 && patches.length < 16; i++) {
    const x = (rand() * 2 - 1) * (PLATE - 8), z = (rand() * 2 - 1) * (PLATE - 8); const dist = district(x, z);
    const kind: PatchKind = dist === 'downtown' ? 'plaza' : rand() < 0.75 ? 'park' : 'lot';
    const s = kind === 'plaza' ? 9 : 10 + rand() * 6; const b: Patch = { x, z, w: s, d: s * (0.7 + rand() * 0.5), rot: -nearestTangent(x, z), kind };
    if (clearOfRoads(b, 1) && free(b, 3)) { patches.push(b); taken.push(b); }
  }
  for (const road of ROADS) {
    const pts = road.pts; let typeIx = -1; let runLeft = 0;
    for (const row of [0, 1, 2]) for (const side of [1, -1]) for (let i = 2 + row * 2; i < pts.length - 2;) {
      const [x, z] = pts[i]; const dist = district(x, z);
      const types = HOUSING_TYPES.filter((t) => t.districts.includes(dist));
      if (runLeft-- <= 0 || !types.includes(HOUSING_TYPES[typeIx])) { typeIx = HOUSING_TYPES.indexOf(types[Math.floor(rand() * types.length)]); runLeft = 3 + Math.floor(rand() * 5); }
      const t = HOUSING_TYPES[typeIx];
      const w = t.w[0] + rand() * (t.w[1] - t.w[0]), d = t.d[0] + rand() * (t.d[1] - t.d[0]);
      const a = pts[i - 2], b = pts[i + 2]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang), nz = Math.cos(ang);
      const setback = road.width / 2 + (dist === 'downtown' ? 1.3 : dist === 'midtown' ? 1.8 : 2.4) + rand() * (dist === 'suburb' ? 2.5 : 1) + d / 2 + row * (dist === 'downtown' ? 6.5 : 6);
      const gap = dist === 'downtown' ? 0.5 : dist === 'midtown' ? 0.9 : 1.6 + rand() * 1.8;
      const hb: OBB = { x: x + nx * setback * side, z: z + nz * setback * side, w, d, rot: -ang };
      if (clearOfRoads(hb, 0.5) && free(hb, gap * 0.5)) {
        const floors = t.floors[0] + Math.floor(rand() * (t.floors[1] - t.floors[0] + 1));
        const hh: House = { ...hb, h: floors * t.floorH, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)] };
        houses.push(hh); taken.push(hh); i += Math.max(1, Math.ceil(w + gap));
      } else i += 1;
    }
  }
  // Infill: block interiors get a few more homes, still turned to their nearest street.
  for (let k = 0; k < 4000; k++) {
    const x = (rand() * 2 - 1) * (PLATE - 4), z = (rand() * 2 - 1) * (PLATE - 4); const c = roadClearance(x, z, 32);
    if (c < 2 || c > 30) continue;
    const dist = district(x, z); const types = HOUSING_TYPES.filter((t) => t.districts.includes(dist)); const t = types[Math.floor(rand() * types.length)];
    const w = t.w[0] + rand() * (t.w[1] - t.w[0]), d = t.d[0] + rand() * (t.d[1] - t.d[0]);
    const hb: OBB = { x, z, w, d, rot: -nearestTangent(x, z) };
    if (!clearOfRoads(hb, 0.8) || !free(hb, dist === 'suburb' ? 1.6 : 0.7)) continue;
    const floors = t.floors[0] + Math.floor(rand() * (t.floors[1] - t.floors[0] + 1));
    const hh: House = { ...hb, h: floors * t.floorH, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)] };
    houses.push(hh); taken.push(hh);
  }
  return { houses, patches };
}
/** Back-compat helpers. */
export const fillerSpots = (seed = 7) => cityFill(seed).houses;

/** Car routes: closed ring + open boulevards/avenue (cars U-turn at the ends, switching lanes). */
export interface Route { road: Road; len: number; cum: number[]; p: [number, number][] }
export const CAR_ROUTES: Route[] = ROADS.filter((r) => r.kind === 'ring' || r.kind === 'boulevard' || r.kind === 'avenue').map((road) => {
  const p = road.closed ? [...road.pts, road.pts[0]] : road.pts; const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return { road, len: cum[cum.length - 1], cum, p };
});
const NETWORK_LEN = ROADS.reduce((s, r) => s + r.pts.length, 0);
/** ~1 car per 120 units of road: density follows the network, not the block count. */
export const CAR_COUNT = Math.max(8, Math.min(16, Math.round(NETWORK_LEN / 120)));
export const LANE = 0.9;
/** Position on a route at t (laps for closed roads; open roads go out and back, the return trip in the other lane). Returns [x, z, heading]. */
export function routePoint(r: Route, t: number, lane: number): readonly [number, number, number] {
  const p = r.p;
  let u = ((t % 1) + 1) % 1; let back = false;
  if (!r.road.closed) { u *= 2; if (u > 1) { u = 2 - u; back = true; } }
  const s = u * r.len; let lo = 1, hi = r.cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (r.cum[m] < s) lo = m + 1; else hi = m; } const i = lo;
  const seg = r.cum[i] - r.cum[i - 1] || 1; const f = (s - r.cum[i - 1]) / seg;
  const [ax, az] = p[i - 1], [bx, bz] = p[i]; let ang = Math.atan2(bz - az, bx - ax); if (back) ang += Math.PI;
  const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
  return [x - Math.sin(ang) * lane, z + Math.cos(ang) * lane, ang] as const;
}
