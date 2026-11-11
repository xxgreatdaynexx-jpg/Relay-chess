/**
 * Land fill, beach span, and deterministic scenery for the Billionaire 2x map.
 * Ground boxes cover every land cell of the expanded map that the original city /
 * outskirts / Big Farm / airport / racetrack slabs do not already paint, so there
 * are no sky gaps. Scenery is instanced later; this file only decides where it goes
 * (never on roads, lots, farms, runways or buildings).
 */
import { AIRPORT, AIRPORT_ROADS, RACETRACK, RACETRACK_ROADS, RUNWAY, RUNWAY2 } from './venues.js';
import { BIG_FARM_AREA, BIG_GROUND_X0, BIG_GROUND_X1, BIG_GROUND_Z0, BIG_ROADS, BIG_ROAD_W, bigFarms } from './bigFarms.js';
import { MAP_VIEW } from './farm.js';
import {
  EAST_X1, GOLDWOOD, PLASTICS_PLANT, RIG_DOCK,
  estateLots, expansionFarms, goldwoodHomes, goldwoodLot, wineryPlots, wineryVisual,
} from './mapExpansion.js';
import { EXP_BRIDGES, EXP_ROADS, GOLDWOOD_C, expRoadClearance, expRoadSegments } from './expansionRoads.js';
import { RIVER_PTS, riverClearance, riverDecor } from './expansionRiver.js';
import { OCEAN } from './ocean.js';
import { orchardPlots } from './orchard.js';
import { RURAL_ROAD_W, RURAL_ROADS } from './outskirts.js';
import { MINE_APRON, MINE_SITES, OUTSKIRTS, PLATE, type OBB, obbHit, obbOverlap } from './worldLayout.js';
import { BILLIONAIRE_SIGN_POS, BILLIONAIRE_SIGN_RADIUS } from './billionaireUpdate.js';

export type Aabb = { x0: number; x1: number; z0: number; z1: number };

/** Continuous land rectangle: whole 2x map down to the beach line (ocean stays south of this). */
export const LAND_FILL: Aabb = { x0: MAP_VIEW.x0, x1: MAP_VIEW.x1, z0: MAP_VIEW.z0, z1: OCEAN.beachZ };

/** Beach ribbon, extended west past the airport and east past East Estates / Orchard Ridge. */
export const BEACH_X0 = Math.min(OUTSKIRTS.x0 - 40, MAP_VIEW.x0 - 20, AIRPORT.x0 - 20);
export const BEACH_X1 = Math.max(OUTSKIRTS.x1 + 40, BIG_GROUND_X1 + 40, EAST_X1 + 40, MAP_VIEW.x1 + 20);

/** Ground already drawn by the city plate, outskirts strips, Big Farm fringe, airport and racetrack slabs. */
export const EXISTING_GROUND: Aabb[] = [
  { x0: -PLATE, x1: PLATE, z0: -PLATE, z1: PLATE },
  { x0: OUTSKIRTS.x0, x1: OUTSKIRTS.x1, z0: OUTSKIRTS.z0, z1: -PLATE },
  { x0: OUTSKIRTS.x0, x1: OUTSKIRTS.x1, z0: PLATE, z1: OUTSKIRTS.z1 },
  { x0: OUTSKIRTS.x0, x1: -PLATE, z0: -PLATE, z1: PLATE },
  { x0: PLATE, x1: OUTSKIRTS.x1, z0: -PLATE, z1: PLATE },
  { x0: OUTSKIRTS.x1, x1: BIG_GROUND_X1, z0: Math.min(OUTSKIRTS.z0, BIG_GROUND_Z0), z1: OUTSKIRTS.z1 },
  { x0: BIG_GROUND_X0, x1: OUTSKIRTS.x1, z0: BIG_GROUND_Z0, z1: OUTSKIRTS.z0 },
  { x0: AIRPORT.x0, x1: AIRPORT.x1, z0: AIRPORT.z0, z1: AIRPORT.z1 },
  { x0: RACETRACK.x0, x1: RACETRACK.x1, z0: RACETRACK.z0, z1: RACETRACK.z1 },
];

const EPS = 1e-6;
const overlapsAabb = (a: Aabb, b: Aabb) => a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.z0 < b.z1 - EPS && a.z1 > b.z0 + EPS;
const inAabb = (b: Aabb, x: number, z: number, m = 0) => x >= b.x0 - m && x <= b.x1 + m && z >= b.z0 - m && z <= b.z1 + m;

/** Subtract hole `b` from `a`, returning up to four leftover rectangles. */
export function subtractAabb(a: Aabb, b: Aabb): Aabb[] {
  const ix0 = Math.max(a.x0, b.x0), ix1 = Math.min(a.x1, b.x1);
  const iz0 = Math.max(a.z0, b.z0), iz1 = Math.min(a.z1, b.z1);
  if (ix0 >= ix1 - EPS || iz0 >= iz1 - EPS) return [a];
  const out: Aabb[] = [];
  if (a.x0 < ix0 - EPS) out.push({ x0: a.x0, x1: ix0, z0: a.z0, z1: a.z1 });
  if (ix1 < a.x1 - EPS) out.push({ x0: ix1, x1: a.x1, z0: a.z0, z1: a.z1 });
  if (a.z0 < iz0 - EPS) out.push({ x0: ix0, x1: ix1, z0: a.z0, z1: iz0 });
  if (iz1 < a.z1 - EPS) out.push({ x0: ix0, x1: ix1, z0: iz1, z1: a.z1 });
  return out;
}

export function subtractRects(base: Aabb, holes: Aabb[]): Aabb[] {
  let parts = [base];
  for (const h of holes) {
    const next: Aabb[] = [];
    for (const p of parts) next.push(...subtractAabb(p, h));
    parts = next;
  }
  return parts.filter((r) => r.x1 - r.x0 > 0.05 && r.z1 - r.z0 > 0.05);
}

/** New countryside slabs that fill every sky gap on the 2x land rectangle. */
export function expansionLandBoxes(): Aabb[] {
  return subtractRects(LAND_FILL, EXISTING_GROUND);
}

export function landCoveredAt(x: number, z: number): boolean {
  if (z > OCEAN.beachZ + 0.01 || z < LAND_FILL.z0 - 0.01 || x < LAND_FILL.x0 - 0.01 || x > LAND_FILL.x1 + 0.01) return z > OCEAN.beachZ;
  return EXISTING_GROUND.some((b) => inAabb(b, x, z)) || expansionLandBoxes().some((b) => inAabb(b, x, z));
}

/** Road segment as an OBB (w along the polyline, d = width). rot matches worldLayout's axis convention. */
export const roadObb = (a: [number, number], b: [number, number], width: number): OBB => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: L, d: width, rot: -Math.atan2(dz, dx) };
};

/** The curved expansion network (shared/expansionRoads.ts) as short OBB pieces. */
export function expansionRoadFootprints(): Array<OBB & { id: string }> {
  return expRoadSegments().map((g, i) => ({ id: `${g.id}#${i}`, ...roadObb(g.a, g.b, g.w) }));
}

export function allExpansionKeepRoads(): Array<OBB & { id: string }> {
  return [
    ...expansionRoadFootprints(),
    ...RURAL_ROADS.map((r, i) => ({ id: `rural-${i}`, ...roadObb(r[0], r[1], RURAL_ROAD_W) })),
    ...BIG_ROADS.map((r, i) => ({ id: `big-${i}`, ...roadObb(r[0], r[1], BIG_ROAD_W) })),
    ...[...AIRPORT_ROADS, ...RACETRACK_ROADS].map(([a, b, w], i) => ({ id: `venue-${i}`, ...roadObb(a, b, w) })),
  ];
}

/** Goldwood's central green (inside Goldwood Circle) and its pond. */
export const GOLDWOOD_GREEN = { x: GOLDWOOD_C.x, z: GOLDWOOD_C.z, rx: GOLDWOOD_C.rx - 8, rz: GOLDWOOD_C.rz - 8 };
export const GOLDWOOD_POND = { x: GOLDWOOD_C.x + 14, z: GOLDWOOD_C.z + 4, rx: 22, rz: 10 };
/** Gatehouses where Goldwood Drive and the Airport Expressway leave the community. */
export const GOLDWOOD_GATES: Array<{ x: number; z: number; ang: number; road: string; label: string }> = (() => {
  const at = (id: string, s: number) => { const r = EXP_ROADS.find((o) => o.id === id)!; let acc = 0; for (let i = 1; i < r.pts.length; i++) { const L = Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); if (acc + L >= s) return { x: r.pts[i][0], z: r.pts[i][1], ang: Math.atan2(r.pts[i][1] - r.pts[i - 1][1], r.pts[i][0] - r.pts[i - 1][0]) }; acc += L; } return { x: r.pts[0][0], z: r.pts[0][1], ang: 0 }; };
  return [{ ...at('gw-drive', 24), road: 'gw-drive', label: 'GOLDWOOD' }, { ...at('gw-west', 26), road: 'gw-west', label: 'GOLDWOOD' }];
})();

/** Buyable / built footprints that scenery and new roads must stay off. Mansions and wineries use their landscaped grounds. */
export function expansionPlotFootprints(): Array<OBB & { id: string }> {
  const plots: Array<OBB & { id: string }> = [
    ...estateLots().map((l) => ({ ...l, id: `lot:estate:${l.n}` })),
    ...expansionFarms().map((f) => ({ ...f, id: `cf:${f.n}` })),
    ...goldwoodHomes().map((h) => ({ ...goldwoodLot(h), id: `b:mansion:${h.n}` })),
    ...wineryPlots().map((v) => ({ ...wineryVisual(v), id: `winery:${v.n}` })),
    ...orchardPlots().map((o) => ({ ...o, id: `orchard:${o.n}` })),
    { ...PLASTICS_PLANT, id: 'plastics' },
    { ...RIG_DOCK, id: 'rigdock' },
    { x: (AIRPORT.x0 + AIRPORT.x1) / 2, z: (AIRPORT.z0 + AIRPORT.z1) / 2, w: AIRPORT.x1 - AIRPORT.x0, d: AIRPORT.z1 - AIRPORT.z0, rot: 0, id: 'airport' },
    { x: RUNWAY.x, z: (RUNWAY.z0 + RUNWAY.z1) / 2, w: RUNWAY.w + 4, d: RUNWAY.z1 - RUNWAY.z0, rot: 0, id: 'runway' },
    { x: RUNWAY2.x, z: (RUNWAY2.z0 + RUNWAY2.z1) / 2, w: RUNWAY2.w + 4, d: RUNWAY2.z1 - RUNWAY2.z0, rot: 0, id: 'runway2' },
    { x: (RACETRACK.x0 + RACETRACK.x1) / 2, z: (RACETRACK.z0 + RACETRACK.z1) / 2, w: RACETRACK.x1 - RACETRACK.x0, d: RACETRACK.z1 - RACETRACK.z0, rot: 0, id: 'racetrack' },
    { x: BILLIONAIRE_SIGN_POS[0], z: BILLIONAIRE_SIGN_POS[1], w: BILLIONAIRE_SIGN_RADIUS * 2, d: BILLIONAIRE_SIGN_RADIUS * 2, rot: 0, id: 'billionaire-sign' },
  ];
  for (const [id, s] of Object.entries(MINE_SITES)) {
    plots.push({ x: s.x, z: s.z, w: MINE_APRON, d: MINE_APRON, rot: 0, id: `mine:${id}` });
    // haul tracks: a narrow keep-out along each mine's dirt road so trucks are never blocked
    const pts: Array<[number, number]> = [[s.x, s.z], ...s.track];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      plots.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: L + 4, d: 8, rot: -Math.atan2(b[1] - a[1], b[0] - a[0]), id: `haul:${id}#${i}` });
    }
  }
  for (const f of bigFarms()) {
    // the planted field and the whole lot (yard with barn, house, silo, pad and driveway)
    plots.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, id: `cf:${f.n}` });
    const lot = f.lot; plots.push({ x: (lot.x0 + lot.x1) / 2, z: (lot.z0 + lot.z1) / 2, w: lot.x1 - lot.x0, d: lot.z1 - lot.z0, rot: 0, id: `cf:${f.n}:lot` });
  }
  return plots;
}

export type SceneryKind = 'pine' | 'deciduous' | 'bush' | 'rock' | 'lamp' | 'pond' | 'hedge' | 'fence' | 'reed';
export interface ScenerySpot { kind: SceneryKind; x: number; z: number; s: number; rot: number }

const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/** Smooth value noise in 0..1 (deterministic), for forest stands and clearings. */
const hash2 = (i: number, j: number) => { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x: number, z: number) => { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j; const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
export const forestNoise = (x: number, z: number) => 0.6 * vnoise(x / 62 + 11.3, z / 62 - 4.1) + 0.3 * vnoise(x / 23 - 2.7, z / 23 + 8.9) + 0.1 * vnoise(x / 9, z / 9);

/** Plot-ish keep-outs used by the scenery generator (grounds of plots, the Goldwood green and pond, gates, the harbour). */
const keepBoxes = (): Array<OBB & { id: string; pad: number }> => [
  ...expansionPlotFootprints().map((p) => ({ ...p, pad: 1.4 })),
  ...GOLDWOOD_GATES.map((g, i) => ({ x: g.x, z: g.z, w: 22, d: 16, rot: -g.ang, id: `gw-gate-${i}`, pad: 0.5 })),
];
const inEllipse = (e: { x: number; z: number; rx: number; rz: number }, x: number, z: number, m = 0) => ((x - e.x) / (e.rx + m)) ** 2 + ((z - e.z) / (e.rz + m)) ** 2 < 1;
/** Clearance from every road the scenery must respect (expansion network + rural/Big Farms/venue roads). */
const otherRoads = () => [
  ...RURAL_ROADS.map(([a, b]) => ({ a, b, w: RURAL_ROAD_W })), ...BIG_ROADS.map(([a, b]) => ({ a, b, w: BIG_ROAD_W })),
  ...[...AIRPORT_ROADS, ...RACETRACK_ROADS].map(([a, b, w]) => ({ a, b, w })),
];
const segDist = (x: number, z: number, a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const L = dx * dx + dz * dz; const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0; return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
export function anyRoadClearance(x: number, z: number): number {
  let d = expRoadClearance(x, z, 14);
  for (const r of otherRoads()) { const v = segDist(x, z, r.a, r.b) - r.w / 2; if (v < d) d = v; }
  return d;
}

const onNewLand = (x: number, z: number, boxes: Aabb[]) => boxes.some((b) => inAabb(b, x, z, -0.8));

/**
 * Deterministic scenery for the new land: dense natural forest stands with clearings (value noise, like the outskirts'
 * clustered woods but continuous), riverbank trees, reeds and rocks, street trees and lamps along the new roads,
 * hedges around each Goldwood mansion's grounds, the Goldwood perimeter fence and a few woodland ponds.
 * Nothing lands on a road, a plot's grounds, the river, a bridge approach, the Goldwood green or the beach.
 */
let sceneryCache: ScenerySpot[] | null = null;
export function expansionScenery(seed = 1): ScenerySpot[] {
  if (seed === 1 && sceneryCache) return sceneryCache;
  const boxes = expansionLandBoxes();
  const keeps = keepBoxes();
  const rnd = mulberry(0x9e3779b9 ^ (seed * 0x85ebca6b));
  const spots: ScenerySpot[] = [];
  const ponds: Array<{ x: number; z: number; r: number }> = [];
  const clearOf = (x: number, z: number, rad: number, roadGap = 1.6) => {
    if (z > OCEAN.beachZ - 7 || z < LAND_FILL.z0 + 2 || x < LAND_FILL.x0 + 2 || x > LAND_FILL.x1 - 2) return false;
    if (anyRoadClearance(x, z) < rad + roadGap) return false;
    if (riverClearance(x, z) < rad + 1.4) return false;
    for (const b of EXP_BRIDGES) if (Math.hypot(x - b.x, z - b.z) < b.len / 2 + 4) return false;
    for (const p of keeps) if (obbHit(p, x, z, rad + p.pad)) return false;
    if (inEllipse(GOLDWOOD_GREEN, x, z, 2)) return false;
    for (const q of ponds) if (Math.hypot(x - q.x, z - q.z) < q.r + rad + 1.6) return false;
    return true;
  };

  // woodland ponds (in clearings)
  for (const [x, z, r] of [[300, -200, 8], [250, -430, 6.5], [-150, -420, 8], [-20, -250, 7], [690, -200, 8], [470, 100, 6], [600, -440, 6], [-250, -300, 7]] as Array<[number, number, number]>) {
    if (!onNewLand(x, z, boxes) || !clearOf(x, z, r + 3, 2)) continue;
    ponds.push({ x, z, r }); spots.push({ kind: 'pond', x, z, s: r, rot: 0 });
  }

  // forest: jittered grid, kept where the stand noise is high; pines and broadleaf in separate stands
  const STEP = 4.1;
  for (const b of boxes) {
    for (let gx = Math.ceil(b.x0 / STEP) * STEP; gx < b.x1; gx += STEP) for (let gz = Math.ceil(b.z0 / STEP) * STEP; gz < b.z1; gz += STEP) {
      const x = gx + (hash2(Math.round(gx * 7), Math.round(gz * 3)) - 0.5) * STEP * 0.9, z = gz + (hash2(Math.round(gz * 5), Math.round(gx * 11)) - 0.5) * STEP * 0.9;
      if (!inAabb(b, x, z, -0.8)) continue;
      const n = forestNoise(x, z);
      // denser deep in the woods, thinning into meadows; a soft fringe of scattered trees around each stand
      const edge = n - 0.41; if (edge < -0.06) continue; if (edge < 0.02 && hash2(Math.round(x * 13), Math.round(z * 17)) > 0.3) continue;
      const scale = 0.85 + hash2(Math.round(x * 3), Math.round(z * 29)) * 0.65 + Math.max(0, edge) * 0.6;
      if (!clearOf(x, z, 1.3 * scale)) continue;
      const conifer = vnoise(x / 48 - 30, z / 48 + 17) > 0.52;
      spots.push({ kind: conifer ? 'pine' : 'deciduous', x, z, s: scale, rot: hash2(Math.round(x * 31), Math.round(z * 7)) * Math.PI * 2 });
      if (hash2(Math.round(x * 41), Math.round(z * 43)) < 0.12) { const bx = x + 2.2, bz = z - 1.4; if (clearOf(bx, bz, 0.7)) spots.push({ kind: 'bush', x: bx, z: bz, s: 0.6 + rnd() * 0.4, rot: rnd() * Math.PI }); }
      if (hash2(Math.round(x * 53), Math.round(z * 59)) < 0.035) { const rx = x - 1.8, rz = z + 1.6; if (clearOf(rx, rz, 0.6) && riverClearance(rx, rz) > 1) spots.push({ kind: 'rock', x: rx, z: rz, s: 0.5 + rnd() * 0.6, rot: rnd() * Math.PI }); }
    }
  }
  // meadow scatter: lone trees and bushes in the clearings so open land is never bare
  for (const b of boxes) for (let x = b.x0 + 5; x < b.x1 - 5; x += 19) for (let z = b.z0 + 5; z < b.z1 - 5; z += 19) {
    const jx = x + (rnd() - 0.5) * 14, jz = z + (rnd() - 0.5) * 14; if (forestNoise(jx, jz) > 0.44) continue;
    const k = rnd(); const kind: SceneryKind = k < 0.35 ? 'deciduous' : k < 0.5 ? 'pine' : k < 0.85 ? 'bush' : 'rock';
    const sc = kind === 'bush' ? 0.6 + rnd() * 0.5 : kind === 'rock' ? 0.5 + rnd() * 0.6 : 0.8 + rnd() * 0.5;
    if (onNewLand(jx, jz, boxes) && clearOf(jx, jz, kind === 'deciduous' || kind === 'pine' ? 1.3 * sc : 0.7)) spots.push({ kind, x: jx, z: jz, s: sc, rot: rnd() * Math.PI * 2 });
  }

  // the river: bank trees, reeds in the shallows, rocks on the bends
  const R = riverDecor();
  for (const [x, z, sc] of R.trees) if (clearOf(x, z, 1.3 * sc)) spots.push({ kind: hash2(Math.round(x), Math.round(z)) < 0.35 ? 'pine' : 'deciduous', x, z, s: sc, rot: hash2(Math.round(z), Math.round(x)) * 6.28 });
  for (const [x, z, sc] of R.reeds) { let ok = anyRoadClearance(x, z) > 1.5; for (const b of EXP_BRIDGES) if (Math.hypot(x - b.x, z - b.z) < b.len / 2 + 2) ok = false; if (ok && z < OCEAN.beachZ - 2) spots.push({ kind: 'reed', x, z, s: sc, rot: 0 }); }
  for (const [x, z, sc] of R.rocks) { let ok = anyRoadClearance(x, z) > 1.2 && riverClearance(x, z) > 0.6 && keeps.every((p) => !obbHit(p, x, z, sc + 0.5)); for (const b of EXP_BRIDGES) if (Math.hypot(x - b.x, z - b.z) < b.len / 2 + 2) ok = false; if (ok && z < OCEAN.beachZ - 3) spots.push({ kind: 'rock', x, z, s: sc, rot: x }); }

  // street lamps (the city's streetlight) and street trees along the new roads
  for (const r of EXP_ROADS) {
    if (r.kind === 'farm' || r.kind === 'path' || r.kind === 'drive') continue;
    const gw = r.id.startsWith('gw-') && r.id !== 'gw-west';
    const lampEvery = r.kind === 'highway' ? 26 : gw ? 16 : 22, treeEvery = gw ? 9 : r.kind === 'parkway' ? 13 : 0;
    const q = r.closed ? [...r.pts, r.pts[0]] : r.pts; let acc = 0, nextLamp = 6, nextTree = 4, li = 0;
    for (let i = 1; i < q.length; i++) {
      const a = q[i - 1], b = q[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const ux = (b[0] - a[0]) / (L || 1), uz = (b[1] - a[1]) / (L || 1);
      acc += L;
      if (acc >= nextLamp) { nextLamp += lampEvery; const sides = gw ? [1, -1] : [(li++ % 2) ? 1 : -1];
        for (const sd of sides) { const o = r.width / 2 + 1.0; const x = b[0] - uz * o * sd, z = b[1] + ux * o * sd;
          if (anyRoadClearance(x, z) > 0.5 && riverClearance(x, z) > 1 && keeps.every((p) => !obbHit(p, x, z, 0.6)) && z < OCEAN.beachZ - 4) spots.push({ kind: 'lamp', x, z, s: 1, rot: Math.atan2(ux, uz) }); } }
      if (treeEvery && acc >= nextTree) { nextTree += treeEvery;
        for (const sd of [1, -1]) { const o = r.width / 2 + 3.2; const x = b[0] - uz * o * sd, z = b[1] + ux * o * sd;
          if (anyRoadClearance(x, z) > 1.8 && riverClearance(x, z) > 2.5 && keeps.every((p) => !obbHit(p, x, z, 1.7)) && !spots.some((t) => t.kind === 'lamp' && Math.hypot(t.x - x, t.z - z) < 2.5)) spots.push({ kind: 'deciduous', x, z, s: 0.95 + rnd() * 0.25, rot: rnd() * 6.28 }); } }
    }
  }

  // Goldwood: clipped hedges around each mansion's grounds (open at the front, where the drive meets the street)
  for (const h of goldwoodHomes()) {
    const lot = goldwoodLot(h); const c = Math.cos(lot.rot), sn = Math.sin(lot.rot);
    const toW = (lx: number, lz: number): [number, number] => [lot.x + lx * c + lz * sn, lot.z - lx * sn + lz * c];
    const hw = lot.w / 2 + 0.9, hd = lot.d / 2 + 0.9, step = 1.5;
    const runs: Array<[number, number, number, number]> = [[-hw, -hd, hw, -hd], [-hw, -hd, -hw, hd - 6], [hw, -hd, hw, hd - 6]];
    for (const [ax, az, bx, bz] of runs) { const L = Math.hypot(bx - ax, bz - az); for (let t = 0.4; t <= L; t += step) { const lx = ax + (bx - ax) * t / L, lz = az + (bz - az) * t / L; const [x, z] = toW(lx, lz);
      if (anyRoadClearance(x, z) > 0.9 && riverClearance(x, z) > 1) spots.push({ kind: 'hedge', x, z, s: 1, rot: lot.rot + (Math.abs(bz - az) > Math.abs(bx - ax) ? Math.PI / 2 : 0) }); } }
  }
  // Big Farms fill: the district between the city and the river used to be bare snow. Windbreaks along each
  // field edge, hedgerows and fence runs, roadside trees, and a belt of woods toward the river and around the quarry
  // (barns, houses and silos already sit in each yard). Nothing lands on a plot, a road, the river or a haul track.
  {
    const A = BIG_FARM_AREA;
    const inBig = (x: number, z: number) => x >= A.x0 - 18 && x <= A.x1 + 28 && z >= A.z0 - 8 && z <= A.z1 + 8;
    const edgeTree = (x: number, z: number, sc = 0.95) => { if (!clearOf(x, z, 1.05 * sc, 1.25) || !inBig(x, z)) return; const conifer = vnoise(x / 40, z / 40) > 0.55; spots.push({ kind: conifer ? 'pine' : 'deciduous', x, z, s: sc, rot: hash2(Math.round(x * 11), Math.round(z * 19)) * 6.28 }); };
    const hedgeAt = (x: number, z: number, rot: number) => { if (clearOf(x, z, 0.55, 1.2) && inBig(x, z)) spots.push({ kind: 'hedge', x, z, s: 1, rot }); };
    const fenceAt = (x: number, z: number, rot: number) => { if (clearOf(x, z, 0.35, 1.1) && inBig(x, z)) spots.push({ kind: 'fence', x, z, s: 1, rot }); };
    // windbreaks: a row of trees + a hedge just outside each field's long edges (2–3 units off the soil)
    for (const f of bigFarms()) {
      const hw = f.w / 2 + 3.2, hd = f.d / 2 + 3.2;
      for (const [ax, az, bx, bz, rot] of [
        [f.x - hw, f.z - hd, f.x + hw, f.z - hd, 0],
        [f.x - hw, f.z + hd, f.x + hw, f.z + hd, 0],
        [f.x - hw, f.z - hd, f.x - hw, f.z + hd, Math.PI / 2],
        [f.x + hw, f.z - hd, f.x + hw, f.z + hd, Math.PI / 2],
      ] as Array<[number, number, number, number, number]>) {
        const L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
        for (let t = 1.6; t < L - 1.4; t += 3.1) { const x = ax + ux * t, z = az + uz * t; hedgeAt(x, z, rot); }
        for (let t = 2.4; t < L - 2; t += 7.2) { const j = (hash2(Math.round((ax + ux * t) * 3), Math.round((az + uz * t) * 5)) - 0.5) * 1.4; edgeTree(ax + ux * t + uz * j * 0.4, az + uz * t - ux * j * 0.4, 0.85 + hash2(Math.round(t), f.n) * 0.4); }
      }
      // a short fence run along the yard side of the lot (not across the driveway)
      const lot = f.lot; const midX = (lot.x0 + lot.x1) / 2;
      for (let x = lot.x0 + 1.2; x < lot.x1 - 1.2; x += 2.2) {
        if (Math.abs(x - midX) < 5) continue; // driveway gap
        fenceAt(x, lot.z0 + 0.8, 0); fenceAt(x, lot.z1 - 0.8, 0);
      }
    }
    // roadside trees along Big Farm roads (both sides, every ~11 units, skipping junctions)
    for (const [a, b] of BIG_ROADS) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux;
      for (let t = 6; t < L - 6; t += 11) {
        if (hash2(Math.round(a[0] + t), Math.round(a[1] + t)) < 0.22) continue;
        for (const s of [1, -1] as const) {
          const x = a[0] + ux * t + nx * s * (BIG_ROAD_W / 2 + 3.2), z = a[1] + uz * t + nz * s * (BIG_ROAD_W / 2 + 3.2);
          edgeTree(x, z, 0.9 + hash2(Math.round(x), Math.round(z)) * 0.35);
          if (hash2(Math.round(z * 3), Math.round(x * 7)) < 0.35) hedgeAt(x + nx * s * 1.6, z + nz * s * 1.6, Math.atan2(uz, ux));
        }
      }
    }
    // woodland belt: denser toward the river (east of BIG_EAST-ish) and around the quarry, plus meadow scatter in the gaps
    for (let gx = A.x0 - 14; gx < A.x1 + 26; gx += 4.4) for (let gz = A.z0 - 4; gz < A.z1 + 6; gz += 4.4) {
      const x = gx + (hash2(Math.round(gx * 9), Math.round(gz * 4)) - 0.5) * 3.6, z = gz + (hash2(Math.round(gz * 6), Math.round(gx * 13)) - 0.5) * 3.6;
      if (!inBig(x, z)) continue;
      const towardRiver = x > 330 ? 0.22 : 0;
      const n = forestNoise(x + 80, z - 40) + towardRiver;
      const nearQ = Math.hypot(x - 328, z + 158);
      // a ring of trees around the quarry pad (outside the apron), and a modest stand in leftover yards
      const want = (n > 0.52 && x > 300) || (nearQ > 22 && nearQ < 52 && n > 0.35) || (n > 0.62);
      // leftover corridors between lots: a generous scatter so the snow is never a bare sheet
      if (!want && hash2(Math.round(x * 17), Math.round(z * 23)) > 0.22) continue;
      const sc = 0.8 + hash2(Math.round(x * 5), Math.round(z * 11)) * 0.55;
      if (clearOf(x, z, 1.25 * sc, 2.0)) { const conifer = vnoise(x / 36 + 4, z / 36) > 0.5; spots.push({ kind: conifer ? 'pine' : 'deciduous', x, z, s: sc, rot: hash2(Math.round(z), Math.round(x)) * 6.28 });
        if (hash2(Math.round(x * 29), Math.round(z * 31)) < 0.18) { const bx = x + 1.8, bz = z - 1.2; if (clearOf(bx, bz, 0.6, 1.6)) spots.push({ kind: 'bush', x: bx, z: bz, s: 0.55 + rnd() * 0.4, rot: rnd() * 6 }); } }
    }
  }

    // Goldwood perimeter: a timber estate fence on an outer ellipse, with gaps for the two gates
  { const E = { x: GOLDWOOD_C.x, z: GOLDWOOD_C.z, rx: GOLDWOOD_C.rx + 50, rz: GOLDWOOD_C.rz + 47 }; const N = 260;
    for (let i = 0; i < N; i++) { const t = (i / N) * Math.PI * 2; const x = E.x + Math.cos(t) * E.rx, z = Math.max(LAND_FILL.z0 + 3, E.z + Math.sin(t) * E.rz);
      const t2 = ((i + 1) / N) * Math.PI * 2; const ang = Math.atan2(Math.sin(t2) * E.rz - Math.sin(t) * E.rz, Math.cos(t2) * E.rx - Math.cos(t) * E.rx);
      if (anyRoadClearance(x, z) < 2.5 || keeps.some((p) => obbHit(p, x, z, 1))) continue;
      spots.push({ kind: 'fence', x, z, s: 1, rot: Math.PI / 2 - ang }); } }
  // East Estates: split-rail fence along the far east edge
  for (let z = -440; z < 150; z += 2.2) { const x = EAST_X1 - 3; if (anyRoadClearance(x, z) > 1.5 && keeps.every((p) => !obbHit(p, x, z, 1))) spots.push({ kind: 'fence', x, z, s: 1, rot: 0 }); }

  if (seed === 1) sceneryCache = spots;
  return spots;
}

/** Overlap check: every scenery item against roads (all networks), plot grounds, the river and bridges. */
export function sceneryOverlaps(spots: ScenerySpot[] = expansionScenery()): Array<{ kind: SceneryKind; x: number; z: number; hit: string }> {
  const plots = expansionPlotFootprints();
  const hits: Array<{ kind: SceneryKind; x: number; z: number; hit: string }> = [];
  const rad: Record<SceneryKind, number> = { pine: 1.0, deciduous: 1.0, bush: 0.5, rock: 0.45, lamp: 0.3, pond: 0, hedge: 0.4, fence: 0.2, reed: 0 };
  for (const s of spots) {
    const r = s.kind === 'pond' ? s.s : (rad[s.kind] ?? 0.5) * (s.kind === 'pine' || s.kind === 'deciduous' ? s.s : 1);
    if (anyRoadClearance(s.x, s.z) < r + 0.3) hits.push({ kind: s.kind, x: s.x, z: s.z, hit: 'road' });
    if (s.kind !== 'reed' && riverClearance(s.x, s.z) < r) hits.push({ kind: s.kind, x: s.x, z: s.z, hit: 'river' });
    if (s.kind === 'reed' && riverClearance(s.x, s.z) > 0.5) hits.push({ kind: s.kind, x: s.x, z: s.z, hit: 'reed-on-land' });
    if (s.kind === 'hedge') continue; // hedges ring the mansion grounds just outside them
    for (const p of plots) if (obbHit(p, s.x, s.z, r + 0.3)) hits.push({ kind: s.kind, x: s.x, z: s.z, hit: p.id });
  }
  return hits;
}

export function expansionRoadPlotOverlaps(margin = 0.25): Array<{ road: string; plot: string }> {
  const out: Array<{ road: string; plot: string }> = [];
  const roads = expansionRoadFootprints();
  const plots = expansionPlotFootprints().filter((p) => !p.id.startsWith('airport') && !p.id.startsWith('runway') && p.id !== 'racetrack' && !p.id.startsWith('mine') && p.id !== 'billionaire-sign');
  for (const rd of roads) for (const p of plots) if (obbOverlap(rd, p, margin)) out.push({ road: rd.id, plot: p.id });
  return out;
}

/** Plots (and their grounds) that dip into the river, with their clearance from the water's edge. */
export function riverPlotOverlaps(minGap = 3): Array<{ plot: string; gap: number }> {
  const out: Array<{ plot: string; gap: number }> = [];
  for (const p of expansionPlotFootprints()) {
    const c = Math.cos(p.rot), s = Math.sin(p.rot); let g = Infinity;
    for (let i = -1; i <= 1; i += 0.25) for (let j = -1; j <= 1; j += 0.25) { const lx = (i * p.w) / 2, lz = (j * p.d) / 2; g = Math.min(g, riverClearance(p.x + lx * c + lz * s, p.z - lx * s + lz * c)); }
    if (g < minGap) out.push({ plot: p.id, gap: g });
  }
  return out;
}

// silence unused in some builds
void overlapsAabb; void RIVER_PTS;
