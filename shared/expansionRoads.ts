/**
 * Road network for the Billionaire 2x land, built the same way as the original Chud City streets (worldLayout):
 * Catmull-Rom curves through hand-placed control points, resampled to ~1 unit, with every open end either joined to
 * another road (city/rural/Big Farms network included) or finished with a cul-de-sac turning circle. Crossings and
 * joins get filled junction caps. Every crossing of the Goldwood River is a bridge.
 *
 * Pure geometry (no three.js): the renderer, car bounds, the haul-truck road graph, plot placement and the overlap
 * tests all read from here.
 */
import { spline } from './worldLayout.js';
import { RIVER_PTS, riverClearance, riverCrossings, riverHalfW } from './expansionRiver.js';
import { BIG_EAST_X, BIG_NORTH_ROAD_Z } from './bigFarms.js';

type P = [number, number];
export type ExpRoadKind = 'highway' | 'parkway' | 'collector' | 'street' | 'lane' | 'drive' | 'farm' | 'path';
export const EXP_ROAD_WIDTH: Record<ExpRoadKind, number> = { highway: 6.5, parkway: 5.5, collector: 5, street: 4.5, lane: 4, drive: 3, farm: 3, path: 1.8 };
/** Paved roads carry traffic (cars, haul trucks); drives/farm tracks/footpaths are spurs. */
export const EXP_PAVED: Record<ExpRoadKind, boolean> = { highway: true, parkway: true, collector: true, street: true, lane: true, drive: true, farm: false, path: false };
export interface ExpRoad { id: string; name?: string; kind: ExpRoadKind; width: number; closed: boolean; pts: P[]; ends: ['junction' | 'cul' | 'open', 'junction' | 'cul' | 'open'] }

/** Existing straight roads the new network ties into (Big Farms ring, rural ring), as targets for end snapping. */
const NZ = -116 - 8, WX = -116 - 5;
const TIE_INS: Array<[P, P]> = [
  [[196, BIG_NORTH_ROAD_Z], [BIG_EAST_X, BIG_NORTH_ROAD_Z]], // Big Farms north road
  [[BIG_EAST_X, BIG_NORTH_ROAD_Z], [BIG_EAST_X, 150]], // Big Farms east road (north extension + east road)
  [[196, 150], [BIG_EAST_X, 150]], // Big Farms south road
  [[196, BIG_NORTH_ROAD_Z], [196, NZ]], // east-ring connector up to the Big Farms north road
  [[-80, NZ], [WX, NZ]], [[WX, NZ], [WX, 150]], // rural north + west roads
];

/** Goldwood: an upscale gated community north of the outskirts, around a landscaped central green. */
export const GOLDWOOD_C = { x: 50, z: -356, rx: 100, rz: 50 };
const ellipse = (c: { x: number; z: number; rx: number; rz: number }, n = 20, wob = 0): P[] => {
  const out: P[] = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const k = 1 + wob * Math.sin(a * 3 + 0.7); out.push([c.x + Math.cos(a) * c.rx * k, c.z + Math.sin(a) * c.rz * k]); }
  return out;
};
export const ellipsePoint = (t: number, c = GOLDWOOD_C, out = 0): P => [c.x + Math.cos(t) * (c.rx + out), c.z + Math.sin(t) * (c.rz + out)];

interface Spec { id: string; name?: string; kind: ExpRoadKind; ctrl: P[]; closed?: boolean; cul?: [boolean, boolean]; step?: number }
const deg = (d: number) => (d * Math.PI) / 180;
const SPECS: Spec[] = [
  // ---- Goldwood ----
  { id: 'gw-circle', name: 'Goldwood Circle', kind: 'street', ctrl: ellipse(GOLDWOOD_C, 24, 0), closed: true },
  { id: 'gw-drive', name: 'Goldwood Drive', kind: 'parkway', ctrl: [ellipsePoint(deg(28)), [150, -328], [170, -313], [184, -306], [196, BIG_NORTH_ROAD_Z]] },
  { id: 'gw-west', name: 'Airport Expressway', kind: 'highway', ctrl: [ellipsePoint(deg(180)), [-76, -358], [-122, -346], [-165, -318], [-196, -278], [-212, -232], [-214, -188], [-204, -152], [-180, -132], [-148, -125], [WX, NZ]] },
  { id: 'gw-vine', name: 'Vineyard Lane', kind: 'lane', ctrl: [[184, -306], [198, -334], [214, -362], [238, -386], [266, -400], [286, -404]], cul: [false, true] },
  // ---- East Estates ----
  { id: 'ee-parkway', name: 'Estates Parkway', kind: 'parkway', ctrl: [[BIG_EAST_X, -40], [370, -40], [400, -42], [432, -48], [470, -62], [508, -84], [540, -112], [560, -150], [568, -196], [566, -240], [560, -276]] },
  { id: 'ee-north', name: 'Ridge Road', kind: 'collector', ctrl: [[BIG_EAST_X, BIG_NORTH_ROAD_Z], [372, -303], [404, -298], [450, -292], [500, -290], [540, -284], [560, -276], [586, -278], [626, -296], [660, -298], [700, -290]], cul: [false, true] },
  { id: 'ee-coast', name: 'Coastal Highway', kind: 'highway', ctrl: [[BIG_EAST_X, 150], [372, 150], [402, 148], [440, 152], [490, 156], [540, 152], [590, 146], [640, 150], [680, 146], [704, 128], [708, 96]] },
  { id: 'ee-bay', name: 'Estates Crescent', kind: 'street', ctrl: [[432, -48], [446, -10], [462, 22], [492, 48], [532, 62], [576, 60], [612, 44], [640, 18], [656, -14], [660, -48], [648, -82], [620, -104], [580, -116], [540, -112]] },
  { id: 'ee-bay-s', name: 'Bayview Road', kind: 'street', ctrl: [[532, 62], [536, 96], [540, 152]] },
  { id: 'ee-east', name: 'Shoreline Road', kind: 'collector', ctrl: [[708, 96], [700, 60], [680, 30], [656, -14]] },
  { id: 'ee-court', name: 'Estate Court', kind: 'lane', ctrl: [[567, -214], [536, -216], [504, -222], [472, -232]], cul: [false, true] },
  { id: 'ee-farm-w', name: 'Mill Lane', kind: 'lane', ctrl: [[400, -298], [420, -250], [432, -210], [440, -170], [448, -130], [470, -62]] },
  // ---- Orchard Ridge ----
  { id: 'or-loop', name: 'Orchard Loop', kind: 'lane', ctrl: [[586, -278], [600, -300], [610, -342], [640, -384], [690, -390], [712, -360], [700, -320], [660, -298]] },
];

const CUL_R = 4.2;
export const EXP_CUL_R = CUL_R;
function nearestOn(q: P[], x: number, z: number): [number, number, number] {
  let best: [number, number, number] = [Infinity, 0, 0];
  for (let i = 1; i < q.length; i++) { const a = q[i - 1], b = q[i]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0; const px = a[0] + t * dx, pz = a[1] + t * dz; const d = Math.hypot(x - px, z - pz);
    if (d < best[0]) best = [d, px, pz]; }
  return best;
}
const centre = (r: ExpRoad) => (r.closed ? [...r.pts, r.pts[0]] : r.pts);

function build(): ExpRoad[] {
  const roads: ExpRoad[] = SPECS.map((s) => ({ id: s.id, name: s.name, kind: s.kind, width: EXP_ROAD_WIDTH[s.kind], closed: !!s.closed, pts: spline(s.ctrl, !!s.closed, s.step ?? 1), ends: ['open', 'open'] }));
  const tie = TIE_INS.map(([a, b]) => [a, b] as P[]);
  for (const r of roads) {
    if (r.closed) { r.ends = ['junction', 'junction']; continue; }
    const spec = SPECS.find((s) => s.id === r.id)!;
    for (const which of [0, 1] as const) {
      if (spec.cul?.[which]) { r.ends[which] = 'cul'; continue; }
      const p = which === 0 ? r.pts[0] : r.pts[r.pts.length - 1];
      let best: [number, number, number] = [Infinity, 0, 0];
      for (const o of roads) if (o !== r) { const n = nearestOn(centre(o), p[0], p[1]); if (n[0] < best[0]) best = n; }
      for (const t of tie) { const n = nearestOn(t, p[0], p[1]); if (n[0] < best[0]) best = n; }
      if (best[0] < 0.05) { r.ends[which] = 'junction'; continue; }
      if (best[0] <= 6) { const q: P = [best[1], best[2]]; if (which === 0) r.pts.unshift(q); else r.pts.push(q); r.ends[which] = 'junction'; continue; }
      r.ends[which] = 'cul';
    }
  }
  return roads;
}
export const EXP_ROADS: ExpRoad[] = build();

export interface ExpJunction { x: number; z: number; r: number }
/** Filled junction caps (every joined end + every crossing). */
export const EXP_JUNCTIONS: ExpJunction[] = (() => {
  const out: ExpJunction[] = [];
  const add = (x: number, z: number, r: number) => { const j = out.find((o) => Math.hypot(o.x - x, o.z - z) < Math.max(o.r, r)); if (j) { j.r = Math.max(j.r, r); return; } out.push({ x, z, r }); };
  const all: Array<{ id: string; w: number; pts: P[] }> = [...EXP_ROADS.map((r) => ({ id: r.id, w: r.width, pts: centre(r) })), ...TIE_INS.map(([a, b], i) => ({ id: `tie${i}`, w: 4.5, pts: [a, b] as P[] }))];
  const wAt = (x: number, z: number, skip: string) => { let w = 0; for (const o of all) if (o.id !== skip && nearestOn(o.pts, x, z)[0] < 0.6) w = Math.max(w, o.w); return w; };
  for (const r of EXP_ROADS) r.ends.forEach((e, i) => { if (e !== 'junction' || r.closed) return; const p = i === 0 ? r.pts[0] : r.pts[r.pts.length - 1]; add(p[0], p[1], Math.max(r.width, wAt(p[0], p[1], r.id)) / 2 + 0.6); });
  for (let a = 0; a < EXP_ROADS.length; a++) for (let b = a + 1; b < EXP_ROADS.length; b++) {
    const A = centre(EXP_ROADS[a]), B = centre(EXP_ROADS[b]);
    for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) {
      const s0 = A[i - 1], s1 = A[i], t0 = B[j - 1], t1 = B[j];
      if (Math.max(s0[0], s1[0]) < Math.min(t0[0], t1[0]) || Math.max(t0[0], t1[0]) < Math.min(s0[0], s1[0]) || Math.max(s0[1], s1[1]) < Math.min(t0[1], t1[1]) || Math.max(t0[1], t1[1]) < Math.min(s0[1], s1[1])) continue;
      const d1x = s1[0] - s0[0], d1z = s1[1] - s0[1], d2x = t1[0] - t0[0], d2z = t1[1] - t0[1]; const den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) continue;
      const u = ((t0[0] - s0[0]) * d2z - (t0[1] - s0[1]) * d2x) / den, v = ((t0[0] - s0[0]) * d1z - (t0[1] - s0[1]) * d1x) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) add(s0[0] + u * d1x, s0[1] + u * d1z, Math.max(EXP_ROADS[a].width, EXP_ROADS[b].width) / 2 + 0.6);
    }
  }
  return out;
})();
export const EXP_CUL_ENDS: P[] = EXP_ROADS.flatMap((r) => r.closed ? [] : r.ends.flatMap((e, i) => (e === 'cul' ? [i === 0 ? r.pts[0] : r.pts[r.pts.length - 1]] : [])));

export interface ExpBridge { road: string; x: number; z: number; ang: number; len: number; width: number; foot: boolean }
/** Footbridges on the riverside trail (walkers only, not part of the road graph). */
export const FOOTBRIDGES: ExpBridge[] = [];
/** Every place a road crosses the river: a bridge deck spanning the water plus a little bank on each side. */
export const EXP_BRIDGES: ExpBridge[] = (() => {
  const out: ExpBridge[] = [];
  for (const r of [...EXP_ROADS]) {
    const q = centre(r);
    for (let i = 1; i < q.length; i++) for (const c of riverCrossings(q[i - 1], q[i])) {
      const ang = Math.atan2(q[i][1] - q[i - 1][1], q[i][0] - q[i - 1][0]);
      // span: walk out along the road heading until clear of the water on both sides
      const hw = riverHalfW(c.s); let len = hw * 2 + 6;
      for (let k = 0; k < 40; k++) { const L = len / 2; const a: P = [c.x - Math.cos(ang) * L, c.z - Math.sin(ang) * L], b: P = [c.x + Math.cos(ang) * L, c.z + Math.sin(ang) * L]; if (riverClearance(a[0], a[1]) > 2.5 && riverClearance(b[0], b[1]) > 2.5) break; len += 1; }
      out.push({ road: r.id, x: c.x, z: c.z, ang, len, width: r.width + 1.4, foot: r.kind === 'path' });
    }
  }
  for (const f of FOOTBRIDGES) out.push(f);
  return out;
})();

/** Coarse segments [a, b, width] for collision / car bounds / road-vs-plot checks (one per ~4 units). */
export function expRoadSegments(kinds?: ExpRoadKind[]): Array<{ id: string; a: P; b: P; w: number; kind: ExpRoadKind }> {
  const out: Array<{ id: string; a: P; b: P; w: number; kind: ExpRoadKind }> = [];
  for (const r of EXP_ROADS) { if (kinds && !kinds.includes(r.kind)) continue; const q = centre(r); const step = 3;
    for (let i = 0; i < q.length - 1; i += step) { const j = Math.min(q.length - 1, i + step); out.push({ id: r.id, a: q[i], b: q[j], w: r.width, kind: r.kind }); } }
  return out;
}

/** Spatial hash over every expansion road centreline sample for fast clearance. */
type Sample = { x: number; z: number; hw: number };
const CELL = 8; const grid = new Map<string, Sample[]>();
const put = (x: number, z: number, hw: number) => { const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push({ x, z, hw }); };
for (const r of EXP_ROADS) for (const [x, z] of r.pts) put(x, z, r.width / 2);
for (const [x, z] of EXP_CUL_ENDS) put(x, z, CUL_R);
for (const j of EXP_JUNCTIONS) put(j.x, j.z, j.r);
/** Distance from (x, z) to the nearest expansion road edge (negative = on the road); Infinity when none within reach. */
export function expRoadClearance(x: number, z: number, reach = 16): number {
  let best = Infinity; const c0 = Math.floor((x - reach) / CELL), c1 = Math.floor((x + reach) / CELL), r0 = Math.floor((z - reach) / CELL), r1 = Math.floor((z + reach) / CELL);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) for (const s of grid.get(`${i},${j}`) ?? []) { const d = Math.hypot(s.x - x, s.z - z) - s.hw; if (d < best) best = d; }
  return best;
}
export const onExpansionRoad = (x: number, z: number, m = 0) => expRoadClearance(x, z, 12) <= m;
/** Point and heading at arc length s along a road (for frontage placement). */
export function roadAt(id: string, s: number): { x: number; z: number; ang: number } {
  const r = EXP_ROADS.find((o) => o.id === id); if (!r) throw new Error(`no road ${id}`);
  const q = centre(r); let acc = 0;
  for (let i = 1; i < q.length; i++) { const L = Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); if (acc + L >= s) { const t = (s - acc) / (L || 1); return { x: q[i - 1][0] + (q[i][0] - q[i - 1][0]) * t, z: q[i - 1][1] + (q[i][1] - q[i - 1][1]) * t, ang: Math.atan2(q[i][1] - q[i - 1][1], q[i][0] - q[i - 1][0]) }; } acc += L; }
  const n = q.length; return { x: q[n - 1][0], z: q[n - 1][1], ang: Math.atan2(q[n - 1][1] - q[n - 2][1], q[n - 1][0] - q[n - 2][0]) };
}
export const roadLength = (id: string) => { const r = EXP_ROADS.find((o) => o.id === id)!; const q = centre(r); let L = 0; for (let i = 1; i < q.length; i++) L += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); return L; };
void RIVER_PTS;

/**
 * Frontage placement (like the city's buildings along street frontage): a footprint `w` along the road and `d` deep,
 * set back `gap` from the road edge on `side` (+1 = left of travel, -1 = right), turned to face the road when
 * `face`; axis-aligned footprints (farms, orchards) use their support width instead.
 */
export function frontage(id: string, s: number, side: 1 | -1, w: number, d: number, gap = 2.5, face = true): { x: number; z: number; rot: number } {
  const r = EXP_ROADS.find((o) => o.id === id)!; const p = roadAt(id, s);
  const nx = -Math.sin(p.ang) * side, nz = Math.cos(p.ang) * side;
  const off = r.width / 2 + gap + (face ? d / 2 : Math.abs(nx) * w / 2 + Math.abs(nz) * d / 2);
  const x = p.x + nx * off, z = p.z + nz * off;
  return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, rot: face ? Math.round(Math.atan2(-nx, -nz) * 1000) / 1000 : 0 };
}
