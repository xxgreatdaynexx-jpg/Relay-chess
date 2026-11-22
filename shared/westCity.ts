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
/** Westgate town: the old downtown plate's footprint (232 x 232) around the centre; the ring and its grid sit inside. */
export const WEST_TOWN = { x0: WEST_DC[0] - 116, x1: WEST_DC[0] + 116, z0: WEST_DC[1] - 116, z1: WEST_DC[1] + 116 } as const;
/** Maple Heights: the one small suburb pocket, north of town. */
export const WEST_POCKET = { x0: -866, x1: -654, z0: -398, z1: -284 } as const;
const inBox = (b: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, m = 0) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;

/* ---------------- countryside: lakes, the creek, hills ---------------- */
export interface WestLake { name: string; x: number; z: number; rx: number; rz: number }
export const WEST_LAKES: WestLake[] = [
  { name: 'Cedar Lake', x: -1010, z: -240, rx: 46, rz: 26 },
  { name: 'Mill Pond', x: -600, z: -232, rx: 18, rz: 12 },
];
/** Lake shoreline (wobbly ellipse), shared by the renderer and the keep-outs. */
export const lakeOutline = (l: WestLake, n = 48): P[] => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const k = 1 + 0.1 * Math.sin(a * 3 + l.x) + 0.05 * Math.sin(a * 5 + l.z); return [l.x + Math.cos(a) * l.rx * k, l.z + Math.sin(a) * l.rz * k] as P; });
/** Signed-ish distance outside a lake (negative inside), in units. */
export const lakeClearance = (x: number, z: number) => { let best = Infinity; for (const l of WEST_LAKES) { const e = Math.hypot((x - l.x) / (l.rx * 1.15), (z - l.z) / (l.rz * 1.15)); best = Math.min(best, (e - 1) * Math.min(l.rx, l.rz) * 1.15); } return best; };
/** Willow Creek: from the north edge, through Cedar Lake, down past the farms to the sea. Width 5. */
export const WEST_CREEK_W = 5;
export const WEST_CREEK: P[] = spline([[-930, -456], [-948, -410], [-966, -360], [-982, -310], [-998, -262], [-1000, -240], [-998, -214], [-986, -160], [-966, -100], [-952, -40], [-946, 10], [-934, 60], [-912, 110], [-896, 150], [-890, 194]], false);
export const creekClearance = (x: number, z: number) => { let best = Infinity; for (let i = 1; i < WEST_CREEK.length; i += 1) { const [ax, az] = WEST_CREEK[i - 1], [bx, bz] = WEST_CREEK[i]; if (Math.abs(ax - x) > 30 || Math.abs(az - z) > 30) continue; const dx = bx - ax, dz = bz - az; const L = dx * dx + dz * dz; const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0; best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz) - WEST_CREEK_W / 2); } return best; };
/** Water anywhere (lakes or the creek) within m of (x, z). */
export const nearWater = (x: number, z: number, m: number) => lakeClearance(x, z) < m || creekClearance(x, z) < m;

export const onWest = (x: number, z: number, m = 0) => x > WEST.x0 + m && x < WEST.x1 - m && z > WEST.z0 + m && z < WEST.z1 - m;

/** Reserved ground (no roads cut through, no housing): the park, the square, the stadium, the port, marina, wind farm. */
export const WESTGATE_PARK: OBB = { x: -838, z: -96, w: 48, d: 26, rot: 0 }; // north-west of the ring, inside the town plate
export const WESTGATE_SQUARE: OBB = { x: -767, z: -13, w: 18, d: 18, rot: 0 }; // the downtown block south-east of the crossing
export const WEST_STADIUM: OBB = { x: -1080, z: -70, w: 76, d: 34, rot: 0 }; // in the countryside north of Cedar Road
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
const bend = (t: number, k: number) => 2 * Math.sin(t / 41 + k * 1.7);

function buildRoads(): Road[] {
  const roads: Road[] = [];
  const push = (id: string, kind: RoadKind, pts: P[], cul = false, width = ROAD_WIDTH[kind]) => roads.push({ id, kind, width, closed: false, pts, ...(cul ? { cul } : {}) });
  const add = (id: string, kind: RoadKind, ctrl: P[], cul = false, ok: (x: number, z: number) => boolean = okLand) => {
    for (const [i, run] of clipRuns(spline(ctrl, false), ok).entries()) push(`${id}${i ? `-${i}` : ''}`, kind, run, cul && i === 0);
  };
  const [cx, cz] = WEST_DC;
  // Westgate: the old core's rounded ring, two straight boulevards across the town plate, grid streets every 26 inside.
  const ring: P[] = []; for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; const c = Math.cos(a), s = Math.sin(a); ring.push(toWorld(RING_A * Math.sign(c) * Math.abs(c) ** 0.5, RING_B * Math.sign(s) * Math.abs(s) ** 0.5)); }
  roads.push({ id: 'w-ring', kind: 'ring', width: ROAD_WIDTH.ring, closed: true, pts: spline(ring, true) });
  add('w-nsblvd', 'boulevard', [[cx, WEST_TOWN.z0], [cx, coastRoadZ(cx)]]);
  add('w-ewblvd', 'boulevard', [[WEST_TOWN.x0, cz], [WEST_TOWN.x1, cz]]);
  for (const u of [-52, -26, 26, 52]) {
    const a: P[] = [], b: P[] = [];
    for (let v = -90; v <= 90; v += 1) { a.push(toWorld(u, v)); b.push(toWorld(v, u)); }
    for (const [k, pts] of [a, b].entries()) for (const [i, run] of clipRuns(pts, (x, z) => inRing(x, z, 2.5) && okLand(x, z)).entries()) push(`w-grid${u}${k}${i}`, 'street', run);
  }
  // Country roads at the old rural roads' width (4.5): Maple Road up to the suburb pocket, Cedar Road west to the farms, and
  // Ridge Road, a long loop north of Cedar Lake that ties the pocket, the far west and the expressway together.
  add('w-maple', 'avenue', [[cx, WEST_TOWN.z0], [cx + 3, -170], [cx + 8, -230], [cx + 10, WEST_POCKET.z1 - 26]]);
  add('w-cedar', 'avenue', [[WEST_TOWN.x0, cz], [-950, -6], [-1020, -14], [-1110, -10], [-1170, 4], [-1196, 50], [-1196, coastRoadZ(-1196)]]);
  add('w-ridge', 'avenue', [[-445, -188], [-500, -250], [-570, -310], [-630, -342], [WEST_POCKET.x1, -340]]);
  add('w-ridgew', 'avenue', [[WEST_POCKET.x0, -340], [-930, -350], [-1040, -332], [-1130, -306], [-1186, -236], [-1204, -140], [-1186, -40], [-1170, 4]]);
  add('w-stadium', 'lane', [[-1080, -12], [-1080, -30], [-1080, -48]], true);
  // Maple Heights: two short streets, the lanes between them and a few cul-de-sacs (the old suburbs' pattern, small).
  const P0 = WEST_POCKET;
  for (const [k, z] of [-312, -364].entries()) add(`w-pk${-z}`, 'street', Array.from({ length: 9 }, (_, i) => { const x = P0.x0 + 8 + (P0.x1 - P0.x0 - 16) * i / 8; return [x, z + bend(x, k)] as P; }));
  add('w-pkw', 'lane', [[P0.x0 + 8, -312], [P0.x0 + 6, -338], [P0.x0 + 8, -364]]); add('w-pke', 'lane', [[P0.x1 - 8, -312], [P0.x1 - 6, -338], [P0.x1 - 8, -364]]);
  for (const [x, z0, dir] of [[-820, -364, -1], [-716, -364, -1], [-768, -364, 1], [-700, -312, 1]] as const) add(`w-pkc${-x}${dir > 0 ? 's' : 'n'}`, 'lane', [[x, z0], [x, z0 + dir * 9], [x + 0.5, z0 + dir * 17]], true);
  // Ironworks: Foundry Road down to the coast and two yard lanes.
  add('w-iron', 'street', [[-412, -196], [-416, -100], [-410, 0], [-414, 100], [-412, coastRoadZ(-412)]]);
  add('w-iron2', 'lane', [[-412, -60], [-372, -58], [-330, -60]], true); add('w-iron3', 'lane', [[-412, 60], [-372, 62], [-330, 60]], true);
  // Westgate Expressway: off the Airport Expressway, past the Space Center's south side and Ironworks, into Westgate Boulevard.
  push('w-expy', 'boulevard', spline([GW_TIE, [-246, -241], [-300, -236], [-370, -218], [-445, -188], [-520, -142], [-590, -84], [-640, -28], [WEST_TOWN.x1 + 1, cz]], false), false, 6.5);
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

/** Built-up West Chud: the Westgate town plate and the Maple Heights pocket. Everything else is countryside. */
export const westTown = (x: number, z: number) => inBox(WEST_TOWN, x, z) || inBox(WEST_POCKET, x, z);

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const OLD_PLATE_AREA = 232 * 232; // the old downtown plate (worldLayout PLATE 116)
const keepOut = (b: OBB, m: number) => [...WEST_RESERVED, ...WEST_WAREHOUSES].some((o) => obbOverlap(o, b, m)) || obbCorners(b).some(([x, z]) => nearWater(x, z, m + 2)) || nearWater(b.x, b.z, m + 2);

/**
 * West Chud farms: countryside crop fields on the ordinary farm system (cf:<3000+k>: deed, plant, grow, harvest, tax),
 * laid out like the East Estates farms: square to the compass, set back from a country road, with a farmhouse by the road.
 */
export const WEST_FARM_N0 = 3000;
export interface WestFarm extends OBB { n: number; cols: number; rows: number; home: OBB }
export const WEST_FARMS: WestFarm[] = (() => {
  const out: WestFarm[] = []; const sizes: Array<[number, number]> = [[16, 12], [20, 16], [14, 10], [24, 18], [12, 10], [18, 14], [16, 12], [20, 14]];
  let k = 0;
  for (const id of ['w-cedar', 'w-coast', 'w-ridgew', 'w-ridge', 'w-maple']) { const r = WEST_ROADS.find((o) => o.id === id); if (!r) continue; const q = r.pts;
    for (const side of [1, -1]) for (let i = 6; i < q.length - 6;) {
      const [x, z] = q[i]; if (x > WEST_INDUSTRIAL_X - 10 || westTown(x, z) || x < WEST.x0 + 20) { i += 4; continue; }
      const [cols, rows] = sizes[k % sizes.length]; const w = cols * 2 + 2, d = rows * 2 + 2;
      const a = q[i - 3], b = q[i + 3]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang), nz = Math.cos(ang);
      // square to the compass: push out along whichever axis the road's normal mostly points
      const ax = Math.abs(nx) > Math.abs(nz); const off = r.width / 2 + 3 + (ax ? w : d) / 2;
      const fx = ax ? x + Math.sign(nx * side) * off : x, fz = ax ? z : z + Math.sign(nz * side) * off;
      const f: OBB = { x: fx, z: fz, w, d, rot: 0 };
      const ok = obbCorners(f).every(([px, pz]) => onWest(px, pz, 4) && !westTown(px, pz) && px < WEST_INDUSTRIAL_X - 6) && !(f.z + d / 2 > WEST.z1 - 8)
        && clearOfWestRoads(f, 2.5) && !keepOut(f, 4) && !out.some((o) => obbOverlap(o, f, 6)) && Math.abs(fx - WIND_X) > d / 2 + w / 2 + 8;
      if (!ok) { i += 3; continue; }
      // farmhouse by the road at the field's corner
      const hx = ax ? x + Math.sign(nx * side) * (r.width / 2 + 3) : x + (w / 2 + 5), hz = ax ? z + (d / 2 + 5) : z + Math.sign(nz * side) * (r.width / 2 + 3);
      const home: OBB = { x: hx, z: hz, w: 3, d: 3, rot: -ang };
      out.push({ n: WEST_FARM_N0 + out.length, cols, rows, ...f, home }); k++; i += Math.ceil((ax ? d : w) + 10);
    } }
  return out;
})();

/** Hills: low rolling mounds in the grass colour, like the old outskirts' (radius 6-14, height 3-8). */
export const WEST_HILLS: Array<[number, number, number, number]> = (() => {
  const out: Array<[number, number, number, number]> = []; const r = rng(515);
  for (let t = 0; out.length < 34 && t < 3000; t++) {
    const x = WEST.x0 + 20 + r() * (WEST.x1 - WEST.x0 - 40), z = WEST.z0 + 16 + r() * (WEST.z1 - WEST.z0 - 60); const rad = 6 + r() * 8, h = 3 + r() * 5;
    if (westTown(x, z) || x > WEST_INDUSTRIAL_X - 10 || Math.abs(x - WIND_X) < rad + 8 || westRoadClearance(x, z, rad + 20) < rad + 2 || nearWater(x, z, rad + 3)) continue;
    const b: OBB = { x, z, w: rad * 2, d: rad * 2, rot: 0 };
    if (WEST_FARMS.some((f) => obbOverlap(f, b, 3) || obbOverlap(f.home, b, 3)) || WEST_RESERVED.some((o) => obbOverlap(o, b, 3)) || out.some(([hx, hz, hr]) => Math.hypot(hx - x, hz - z) < hr + rad + 6)) continue;
    out.push([x, z, rad, h]);
  }
  return out;
})();

let fillCache: { houses: House[]; patches: Patch[] } | null = null;
/**
 * West Chud fill. Westgate and the Maple Heights pocket use the old city's cityFill rules unchanged (same housing types,
 * setbacks, gaps, rows and district mix, each building copying an old one's footprint and height); the countryside gets a
 * farmhouse per farm and empty lots along its roads, like the old open land. Deterministic.
 */
export function westFill(): { houses: House[]; patches: Patch[] } {
  if (fillCache) return fillCache;
  const rand = rng(2026); const houses: House[] = []; const patches: Patch[] = [];
  const taken: OBB[] = [...WEST_RESERVED, ...WEST_WAREHOUSES, ...WEST_FARMS, ...WEST_HILLS.map(([x, z, r]) => ({ x, z, w: r * 1.6, d: r * 1.6, rot: 0 }))];
  const TG = 24; const tgrid = new Map<string, OBB[]>();
  const take = (o: OBB) => { const r = Math.hypot(o.w, o.d) / 2; for (let i = Math.floor((o.x - r) / TG); i <= Math.floor((o.x + r) / TG); i++) for (let j = Math.floor((o.z - r) / TG); j <= Math.floor((o.z + r) / TG); j++) { const k = `${i},${j}`; (tgrid.get(k) ?? tgrid.set(k, []).get(k)!).push(o); } };
  taken.forEach(take);
  const free = (b: OBB, m: number) => { const r = Math.hypot(b.w, b.d) / 2 + m; for (let i = Math.floor((b.x - r) / TG); i <= Math.floor((b.x + r) / TG); i++) for (let j = Math.floor((b.z - r) / TG); j <= Math.floor((b.z + r) / TG); j++) for (const o of tgrid.get(`${i},${j}`) ?? []) if (obbOverlap(o, b, m)) return false; return true; };
  const pool = new Map<string, House[]>(); for (const h of cityFill().houses) (pool.get(h.type) ?? pool.set(h.type, []).get(h.type)!).push(h);
  const pickR = rng(9091); pickR(); // own stream: consecutive draws of one Lehmer stream are correlated
  const like = (type: string): { w: number; d: number; h: number } => { const a = pool.get(type); if (a?.length) return a[Math.floor(pickR() * a.length)]; const t = HOUSING_TYPES.find((o) => o.id === type)!; return { w: t.w[0], d: t.d[0], h: t.floors[0] * t.floorH }; };
  const urban = westTown;
  // town patches (old rule: plazas downtown, else 3 parks to 1 lot), as many per area as the old plate's 16
  for (let i = 0; i < 600 && patches.length < 20; i++) {
    const inPocket = i % 3 === 2; const B = inPocket ? WEST_POCKET : WEST_TOWN;
    const x = B.x0 + 8 + rand() * (B.x1 - B.x0 - 16), z = B.z0 + 8 + rand() * (B.z1 - B.z0 - 16); const dist = westDistrict(x, z);
    const kind: PatchKind = dist === 'downtown' ? 'plaza' : rand() < 0.75 ? 'park' : 'lot';
    const s = kind === 'plaza' ? 9 : 10 + rand() * 6; const b: Patch = { x, z, w: s, d: s * (0.7 + rand() * 0.5), rot: -westNearestTangent(x, z), kind };
    if (clearOfWestRoads(b, 1) && free(b, 3) && !keepOut(b, 1)) { patches.push(b); take(b); }
  }
  // farmhouses (country homes, like the old outskirts' farmhouses)
  for (const f of WEST_FARMS) { const e = like('house'); const hb: OBB = { ...f.home, w: e.w, d: e.d };
    if (clearOfWestRoads(hb, 0.5) && free(hb, 1)) { houses.push({ ...hb, h: e.h, type: 'house', color: HOUSING_TYPES.find((t) => t.id === 'house')!.colors[Math.floor(rand() * 6) % HOUSING_TYPES.find((t) => t.id === 'house')!.colors.length] }); take(hb); } }
  // town frontage, the old rules
  for (const road of WEST_ROADS) {
    if (road.id === 'w-expy') continue; const pts = road.pts; let typeIx = -1; let runLeft = 0;
    for (const row of [0, 1]) for (const side of [1, -1]) for (let i = 2 + row * 2; i < pts.length - 2;) {
      const [x, z] = pts[i]; if (!urban(x, z) || (row > 0 && inBox(WEST_POCKET, x, z))) { i += 2; continue; } const dist = westDistrict(x, z); // the pocket: one row a side, room for gardens
      const types = HOUSING_TYPES.filter((t) => t.districts.includes(dist));
      if (runLeft-- <= 0 || !types.includes(HOUSING_TYPES[typeIx])) { typeIx = HOUSING_TYPES.indexOf(types[Math.floor(rand() * types.length)]); runLeft = 3 + Math.floor(rand() * 5); }
      const t = HOUSING_TYPES[typeIx];
      const e = like(t.id); const w = e.w, d = e.d;
      const a = pts[i - 2], b = pts[i + 2]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang), nz = Math.cos(ang);
      const setback = road.width / 2 + (dist === 'downtown' ? 1.3 : dist === 'midtown' ? 1.8 : 2.4) + rand() * (dist === 'suburb' ? 2.5 : 1) + d / 2 + row * (dist === 'downtown' ? 6.5 : 6);
      const gap = dist === 'downtown' ? 0.5 : dist === 'midtown' ? 0.9 : 1.6 + rand() * 1.8;
      const hb: OBB = { x: x + nx * setback * side, z: z + nz * setback * side, w, d, rot: -ang };
      if (urban(hb.x, hb.z) && clearOfWestRoads(hb, 0.5) && free(hb, gap * 0.5) && !keepOut(hb, 0.5)) {
        const hh: House = { ...hb, h: e.h, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)] };
        houses.push(hh); take(hh); i += Math.max(1, Math.ceil(w + gap));
      } else i += 1;
    }
  }
  // infill in Westgate only: a quarter of the old plate's 4000 tries, since the old plate's civic buildings take the rest of its room
  const tries = Math.round(1000 * ((WEST_TOWN.x1 - WEST_TOWN.x0) * (WEST_TOWN.z1 - WEST_TOWN.z0)) / OLD_PLATE_AREA);
  for (let k = 0; k < tries; k++) {
    const B = WEST_TOWN; const x = B.x0 + rand() * (B.x1 - B.x0), z = B.z0 + rand() * (B.z1 - B.z0);
    const c = westRoadClearance(x, z, 32); if (c < 2 || c > 12) continue; // only near a street, never stranded mid-block
    const dist = westDistrict(x, z); const types = HOUSING_TYPES.filter((t) => t.districts.includes(dist)); const t = types[Math.floor(rand() * types.length)];
    const e = like(t.id); const w = e.w, d = e.d;
    const hb: OBB = { x, z, w, d, rot: -westNearestTangent(x, z) };
    if (!clearOfWestRoads(hb, 0.8) || !free(hb, dist === 'suburb' ? 1.6 : 0.7) || keepOut(hb, 0.5)) continue;
    const hh: House = { ...hb, h: e.h, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)] };
    houses.push(hh); take(hh);
  }
  // empty lots along the country roads: open, buildable land deeds (old empty-lot rules and prices)
  for (const road of WEST_ROADS) { if (road.kind !== 'avenue') continue; const q = road.pts;
    for (const side of [1, -1]) for (let i = 12; i < q.length - 12; i += 9) {
      const [x, z] = q[i]; if (urban(x, z) || x > WEST_INDUSTRIAL_X - 6 || rand() > 0.32) continue;
      const a = q[i - 3], b = q[i + 3]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(ang), nz = Math.cos(ang);
      const w = 14 + rand() * 8, d = 12 + rand() * 6; const off = road.width / 2 + 2.5 + d / 2;
      const lot: Patch = { x: x + nx * off * side, z: z + nz * off * side, w, d, rot: -ang, kind: 'lot' };
      if (obbCorners(lot).every(([px, pz]) => onWest(px, pz, 3) && pz < WEST.z1 - 6) && clearOfWestRoads(lot, 1) && free(lot, 4) && !keepOut(lot, 2)) { patches.push(lot); take(lot); i += 6; }
    } }
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
  { text: 'Maple Heights', x: (WEST_POCKET.x0 + WEST_POCKET.x1) / 2, z: WEST_POCKET.z0 + 20, color: '#9be37a' },
  { text: 'Cedar Hills', x: -1140, z: -110, color: '#c6e07a' },
  ...WEST_LAKES.map((l) => ({ text: l.name, x: l.x, z: l.z, color: '#7fe0ff' })),
  { text: 'Willow Creek', x: -952, z: 60, color: '#7fe0ff' },
  { text: 'Ironworks', x: -412, z: -120, color: '#ffcf5a' },
  { text: 'West Chud Port', x: WEST_PORT.x, z: WEST_PORT.z + 10, color: '#7fe0ff' },
];
