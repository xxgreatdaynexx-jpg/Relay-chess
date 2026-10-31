/**
 * Pure organic city layout (no three.js) so tests can check cars never cross buildings.
 * Roads are sampled curves (ring road, curving boulevards, a diagonal avenue, a skewed downtown grid,
 * winding suburb lanes and cul-de-sacs). Buildings are placed along street frontage, rotated to face their street.
 */
import { HOUSING_TYPES, type District } from './housing';

export const PLATE = 116; // plate spans -PLATE..PLATE on x and z
export const PAD = 12; // landmark pad footprint (square, rotated to face its street)

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Waterfront: a winding shoreline along the south edge; water from shoreZ(x) to PLATE. */
export const shoreZ = (x: number) => 70 + 7 * Math.sin(x / 23 + 0.4) + 3.5 * Math.sin(x / 9 + 1.3);

export type RoadKind = 'ring' | 'boulevard' | 'avenue' | 'street' | 'lane';
/** `cul`: the road's end is a capped cul-de-sac. `ends`: what each open end does after connectRoads (junction / cul-de-sac cap / runs off the plate edge). */
export type RoadEnd = 'junction' | 'cul' | 'edge';
export interface Road { id: string; kind: RoadKind; width: number; closed: boolean; pts: [number, number][]; cul?: boolean; ends?: [RoadEnd, RoadEnd] }
/** A filled junction cap: where a road end meets another road, or two roads cross. */
export interface Junction { x: number; z: number; r: number }
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

/** Waterfront drive: follows the shore's long swell (not its small ripples) at a steady distance inland. */
export const waterfrontZ = (x: number) => 59 + 7 * Math.sin(x / 23 + 0.4);
/** Ring road: a rounded rectangle (large-radius corners) over the north of the city; its south side is the waterfront drive. */
const RING_A = 78, RING_B = 72;
function inRing(x: number, z: number, m = 0): boolean {
  if (Math.abs(x) > RING_A - m) return false;
  if (z > 0) return z < waterfrontZ(x) - m;
  return (Math.abs(x) / (RING_A - m)) ** 4 + (Math.abs(z) / (RING_B - m)) ** 4 < 1;
}
function buildRoads(): Road[] {
  const roads: Road[] = [];
  const push = (id: string, kind: RoadKind, pts: [number, number][], cul = false) => roads.push({ id, kind, width: ROAD_WIDTH[kind], closed: false, pts, ...(cul ? { cul } : {}) });
  const add = (id: string, kind: RoadKind, ctrl: [number, number][], ok: (x: number, z: number) => boolean = (x, z) => onLand(x, z, 3)) => {
    for (const [i, run] of clipRuns(spline(ctrl, false), ok).entries()) push(`${id}${i || ''}`, kind, run);
  };
  // Ring: north half is a superellipse (straight-ish sides, big round corners), south side runs along the shore.
  const ring: [number, number][] = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI + (i / 16) * Math.PI; const c = Math.cos(a), s = Math.sin(a);
    ring.push([RING_A * Math.sign(c) * Math.abs(c) ** 0.5, RING_B * Math.sign(s) * Math.abs(s) ** 0.5]); }
  ring.push([RING_A, waterfrontZ(RING_A) * 0.5]);
  for (let x = RING_A; x >= -RING_A; x -= 13) ring.push([x, waterfrontZ(x)]);
  ring.push([-RING_A, waterfrontZ(-RING_A) * 0.5]);
  roads.push({ id: 'ring', kind: 'ring', width: ROAD_WIDTH.ring, closed: true, pts: spline(ring, true) });
  // Waterfront drive carries on past the ring to both edges of the plate.
  const shoreRun = (x0: number, x1: number) => { const c: [number, number][] = []; for (let k = 0; k <= 6; k++) { const x = x0 + (x1 - x0) * k / 6; c.push([x, waterfrontZ(x)]); } return c; };
  add('shore-e', 'avenue', shoreRun(RING_A, PLATE + 6)); add('shore-w', 'avenue', shoreRun(-RING_A, -PLATE - 6));
  // Two straight boulevards crossing at right angles; north-south one runs to the north edge (Trailer Park entrance).
  add('nsblvd', 'boulevard', [[0, -PLATE - 6], [0, waterfrontZ(0)]]);
  add('ewblvd', 'boulevard', [[-PLATE - 6, 0], [PLATE + 6, 0]]);
  // Downtown/midtown grid aligned with the boulevards, every street teeing into the ring.
  for (const u of [-52, -26, 26, 52]) {
    const a: [number, number][] = [], b: [number, number][] = [];
    for (let v = -90; v <= 90; v += 1) { a.push([u, v]); b.push([v, u]); }
    for (const [k, pts] of [a, b].entries()) for (const [i, run] of clipRuns(pts, (x, z) => inRing(x, z, 2.5) && onLand(x, z, 3)).entries()) push(`grid${u}${k}${i}`, 'street', run);
  }
  // Suburbs outside the ring: evenly spaced streets with gentle curves, a few cul-de-sacs.
  add('sub-n', 'street', [[0, -94], [30, -96], [60, -93], [92, -88], [PLATE + 6, -86]]); // north-east crescent
  for (const x of [34, 70]) add(`sub-n${x}`, 'lane', [[x, -60], [x + 1, -94]]);
  add('sub-e', 'lane', [[RING_A, -36], [97, -38], [106, -39]]);
  add('sub-e2', 'lane', [[RING_A, 30], [97, 32], [106, 33]]);
  add('sub-w', 'lane', [[-RING_A, -40], [-97, -42], [-106, -43]]);
  add('sub-w2', 'lane', [[-RING_A, 30], [-97, 31], [-106, 31]]);
  add('sub-ex', 'lane', [[106, -39], [108, -3], [106, 33]]); add('sub-wx', 'lane', [[-106, -43], [-108, -6], [-106, 31]]);
  add('sub-nw', 'street', [[0, -84], [-24, -82], [-46, -76]]);
  const cul = (id: string, ctrl: [number, number][]) => { const pts = spline(ctrl, false); if (pts.every(([x, z]) => onLand(x, z, 6))) push(id, 'lane', pts, true); };
  cul('cul-n1', [[52, -95], [52, -108]]); cul('cul-n2', [[88, -88], [88, -104]]);
  cul('cul-e1', [[97, -38], [97, -18]]); cul('cul-e2', [[97, 32], [97, 14]]);
  cul('cul-w1', [[-97, -42], [-97, -22]]); cul('cul-w2', [[-97, 31], [-97, 12]]);
  cul('cul-nw', [[-24, -82], [-25, -68]]);
  return connectRoads(roads);
}

/** Closest point on a polyline to (x, z): [distance, px, pz]. */
function nearestOn(q: [number, number][], x: number, z: number): [number, number, number] {
  let best: [number, number, number] = [Infinity, 0, 0];
  for (let i = 1; i < q.length; i++) { const a = q[i - 1], b = q[i]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0; const px = a[0] + t * dx, pz = a[1] + t * dz; const d = Math.hypot(x - px, z - pz);
    if (d < best[0]) best = [d, px, pz]; }
  return best;
}
const centre = (r: Road) => (r.closed ? [...r.pts, r.pts[0]] : r.pts);
export const SNAP_R = 18; // an open end this close to another road is joined to it
const EDGE_R = 14; // an open end this close to the plate side runs off the edge
/**
 * Make the network continuous: every open road end is joined to the nearest other road's centreline
 * (a short straight connector), runs out to the plate edge, or gets a cul-de-sac cap.
 */
function connectRoads(roads: Road[]): Road[] {
  for (const r of roads) {
    if (r.closed) continue;
    const ends: [RoadEnd, RoadEnd] = ['cul', 'cul'];
    for (const which of [0, 1] as const) {
      if (which === 1 && r.cul) { ends[1] = 'cul'; continue; }
      const pts = r.pts; const p = which === 0 ? pts[0] : pts[pts.length - 1]; const prev = which === 0 ? pts[Math.min(3, pts.length - 1)] : pts[Math.max(0, pts.length - 4)];
      let best: [number, number, number] = [Infinity, 0, 0];
      for (const o of roads) { if (o === r) continue; const n = nearestOn(centre(o), p[0], p[1]); if (n[0] < best[0]) best = n; }
      const line = (to: [number, number]) => { const L = Math.hypot(to[0] - p[0], to[1] - p[1]); const seg: [number, number][] = []; for (let d = 1; d < L; d += 1) seg.push([p[0] + (to[0] - p[0]) * d / L, p[1] + (to[1] - p[1]) * d / L]); seg.push(to); return seg; };
      const okLine = (seg: [number, number][]) => seg.every(([x, z]) => onLand(x, z, 0.5));
      let done: RoadEnd | null = null;
      const nearSide = PLATE - Math.max(Math.abs(p[0]), Math.abs(p[1])) <= 4; // clipped by the plate itself: it runs off the edge
      if (best[0] < 0.05) done = 'junction';
      else if (!nearSide && best[0] <= SNAP_R) { const seg = line([best[1], best[2]]); if (okLine(seg)) { if (which === 0) r.pts = [...seg.reverse(), ...pts]; else r.pts = [...pts, ...seg]; done = 'junction'; } }
      if (!done) {
        // Run straight out along the road's heading to the plate side if it's close.
        const dx = p[0] - prev[0], dz = p[1] - prev[1]; const L = Math.hypot(dx, dz) || 1; const ux = dx / L, uz = dz / L;
        const toEdge = Math.min(ux ? ((ux > 0 ? PLATE : -PLATE) - p[0]) / ux : Infinity, uz ? ((uz > 0 ? PLATE : -PLATE) - p[1]) / uz : Infinity);
        if (toEdge <= EDGE_R) { const seg = line([p[0] + ux * toEdge, p[1] + uz * toEdge]); if (seg.every(([x, z]) => Math.abs(x) <= PLATE + 1e-6 && z < shoreZ(x) - 0.5)) { if (which === 0) r.pts = [...seg.reverse(), ...r.pts]; else r.pts = [...r.pts, ...seg]; done = 'edge'; } }
      }
      ends[which] = done ?? 'cul';
    }
    r.ends = ends;
  }
  return roads;
}
export const ROADS: Road[] = buildRoads();

/** Junction caps: every joined road end, and every place two roads cross. Radius covers the widest road there. */
export const JUNCTIONS: Junction[] = (() => {
  const out: Junction[] = [];
  const add = (x: number, z: number, r: number) => { const j = out.find((o) => Math.hypot(o.x - x, o.z - z) < Math.max(o.r, r)); if (j) { j.r = Math.max(j.r, r); return; } out.push({ x, z, r }); };
  const wAt = (x: number, z: number, skip: Road) => { let w = 0; for (const o of ROADS) if (o !== skip && nearestOn(centre(o), x, z)[0] < 0.6) w = Math.max(w, o.width); return w; };
  for (const r of ROADS) { if (r.closed || !r.ends) continue;
    r.ends.forEach((e, i) => { if (e !== 'junction') return; const p = i === 0 ? r.pts[0] : r.pts[r.pts.length - 1]; add(p[0], p[1], Math.max(r.width, wAt(p[0], p[1], r)) / 2 + 0.4); }); }
  // Crossings: segment intersections between different roads (grid-bucketed).
  const segs: { r: Road; a: [number, number]; b: [number, number] }[] = []; const G = 8; const grid = new Map<string, number[]>();
  for (const r of ROADS) { const q = centre(r); for (let i = 1; i < q.length; i++) { const k = segs.push({ r, a: q[i - 1], b: q[i] }) - 1; const gx = Math.floor(q[i][0] / G), gz = Math.floor(q[i][1] / G); const key = `${gx},${gz}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); } }
  for (const [key, ids] of grid) { const [gx, gz] = key.split(',').map(Number); const near: number[] = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) near.push(...(grid.get(`${gx + a},${gz + b}`) ?? []));
    for (const i of ids) for (const j of near) { if (j <= i) continue; const s = segs[i], t = segs[j]; if (s.r === t.r) continue;
      const d1x = s.b[0] - s.a[0], d1z = s.b[1] - s.a[1], d2x = t.b[0] - t.a[0], d2z = t.b[1] - t.a[1]; const den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) continue;
      const u = ((t.a[0] - s.a[0]) * d2z - (t.a[1] - s.a[1]) * d2x) / den, v = ((t.a[0] - s.a[0]) * d1z - (t.a[1] - s.a[1]) * d1x) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) add(s.a[0] + u * d1x, s.a[1] + u * d1z, Math.max(s.r.width, t.r.width) / 2 + 0.4); } }
  return out;
})();
/** Open road ends that should get a cul-de-sac turning circle. */
export const CUL_ENDS: [number, number][] = ROADS.flatMap((r) => (r.closed || !r.ends ? [] : r.ends.flatMap((e, i) => (e === 'cul' ? [i === 0 ? r.pts[0] : r.pts[r.pts.length - 1]] : []))));
export const CUL_R = 4; // cul-de-sac turning circle radius

/** Spatial hash of road centreline samples, for clearance checks. */
type Sample = { x: number; z: number; hw: number };
const CELL = 8; const grid = new Map<string, Sample[]>();
for (const r of ROADS) {
  const put = (x: number, z: number, hw: number) => { const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push({ x, z, hw }); };
  r.pts.forEach(([x, z]) => put(x, z, r.width / 2));
  if (r.cul) { const [x, z] = r.pts[r.pts.length - 1]; put(x, z, CUL_R); }
  r.ends?.forEach((e, i) => { if (e === 'cul') { const [x, z] = i === 0 ? r.pts[0] : r.pts[r.pts.length - 1]; put(x, z, CUL_R); } });
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
  // Blocks of the grid (streets at 0, ±26, ±52 on both axes): each landmark sits in the middle of its block.
  leaderboard: [13, -13], // downtown, by the boulevards' crossing
  chat: [-13, 13], // central plaza
  chess: [-39, -39],
  bank: [39, -13], // financial district
  stocks: [39, -39], // Stock Exchange, next to the bank
  casino: [39, 42], // waterfront
  arena: [65, 13],
  market: [-39, 42], // waterfront market
  factory: [-65, 13],
  mine: [-65, -39],
  warehouse: [65, -39],
};
export const SPARE_SLOTS: [number, number][] = [[13, 42], [-13, -39], [-39, -13], [13, -65]];

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
  const taken: OBB[] = [...lms, PARK_AREA]; const houses: House[] = []; const patches: Patch[] = [];
  const free = (b: OBB, m: number) => !obbOverlap(PARK_AREA, b, m) && !taken.some((o) => Math.abs(o.x - b.x) < 30 && Math.abs(o.z - b.z) < 30 && obbOverlap(o, b, m));
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
    if (c < 2 || c > 12) continue; // only near a street, never stranded mid-block
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
/**
 * Trailer Park on the north-west edge: a gravel spine running west off the north boulevard with lots on both
 * sides (lot 0 is nearest the entrance). When it fills up, a second spine runs south down the west edge and
 * takes any spot clear of roads and buildings, so the park grows rows as players join.
 */
export const PARK_Z = -PLATE + 12; // gravel spine centreline
export const PARK_X1 = -16; // east end of the lots (entrance side)
export const LOT_STEP = 5; // lot pitch along the lane
export const TRAILER = { w: 2.8, d: 7.4 }; // trailer footprint (w along the lane)
const PARK_X0 = -PLATE + 4;
export const PARK_AREA: OBB = { x: (PARK_X0 + PARK_X1 + 4) / 2, z: PARK_Z, w: PARK_X1 + 4 - PARK_X0, d: 24, rot: 0 };
const NS = () => ROADS.find((r) => r.id === 'nsblvd')!;
/** Where the gravel spine meets the boulevard (its kerb), and the park sign beside it. */
export const PARK_GATE: [number, number] = (() => { const p = NS().pts.reduce((a, b) => (Math.abs(b[1] - PARK_Z) < Math.abs(a[1] - PARK_Z) ? b : a)); return [p[0] - ROAD_WIDTH.boulevard / 2 + 0.2, PARK_Z]; })();
export const PARK_SIGN: [number, number] = [PARK_X1 + 4, PARK_Z - 6];
export interface ParkLot extends OBB { i: number }
export function parkLayout(n: number, solids: OBB[] = []): { lots: ParkLot[]; lanes: [number, number][][] } {
  const lots: ParkLot[] = []; const lanes: [number, number][][] = [];
  let lastX = PARK_X1;
  for (let x = PARK_X1 - 3; x > PARK_X0 + 2 && lots.length < n; x -= LOT_STEP) for (const side of [1, -1]) {
    if (lots.length >= n) break;
    lots.push({ i: lots.length, x, z: PARK_Z + side * (2.2 + TRAILER.d / 2 + 0.6), w: TRAILER.w, d: TRAILER.d, rot: 0 }); lastX = x;
  }
  lanes.push([PARK_GATE, [Math.min(PARK_X1 - 4, lastX - 3), PARK_Z]]);
  if (lots.length < n) {
    // West-edge spine, heading south from the north spine's far end.
    const X = PARK_X0 + 8; let lastZ = PARK_Z;
    for (let z = PARK_Z + 14; z < shoreZ(X) - 8 && lots.length < n; z += LOT_STEP) for (const side of [1, -1]) {
      if (lots.length >= n) break;
      const b: ParkLot = { i: lots.length, x: X + side * (2.2 + TRAILER.d / 2 + 0.6), z, w: TRAILER.d, d: TRAILER.w, rot: 0 };
      if (!clearOfRoads(b, 1) || solids.some((o) => Math.abs(o.x - b.x) < 30 && Math.abs(o.z - b.z) < 30 && obbOverlap(o, b, 0.8))) continue;
      lots.push(b); lastZ = z;
    }
    lanes[0][1] = [X, PARK_Z]; lanes.push([[X, PARK_Z], [X, lastZ + 3]]);
  }
  return { lots, lanes };
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
