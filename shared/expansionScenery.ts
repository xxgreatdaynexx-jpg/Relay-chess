/**
 * Land fill, beach span, and deterministic scenery for the Billionaire 2x map.
 * Ground boxes cover every land cell of the expanded map that the original city /
 * outskirts / Big Farm / airport / racetrack slabs do not already paint, so there
 * are no sky gaps. Scenery is instanced later; this file only decides where it goes
 * (never on roads, lots, farms, runways or buildings).
 */
import { AIRPORT, RACETRACK, RUNWAY, RUNWAY2 } from './venues.js';
import { BIG_GROUND_X0, BIG_GROUND_X1, BIG_GROUND_Z0, BIG_ROADS, BIG_ROAD_W } from './bigFarms.js';
import { MAP_VIEW } from './farm.js';
import {
  EAST_X1, EXPANSION_ROAD_W, EXPANSION_ROADS, GOLDWOOD, PLASTICS_PLANT, RIG_DOCK,
  estateLots, expansionFarms, goldwoodHomes, wineryPlots,
} from './mapExpansion.js';
import { OCEAN } from './ocean.js';
import { orchardPlots, ORCHARD_ROADS } from './orchard.js';
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

export function expansionRoadFootprints(): Array<OBB & { id: string }> {
  return [
    ...EXPANSION_ROADS.map((r, i) => ({ id: `exp-road-${i}`, ...roadObb(r[0], r[1], EXPANSION_ROAD_W) })),
    ...ORCHARD_ROADS.map((r, i) => ({ id: `orch-road-${i}`, ...roadObb(r[0], r[1], EXPANSION_ROAD_W) })),
  ];
}

export function allExpansionKeepRoads(): Array<OBB & { id: string }> {
  return [
    ...expansionRoadFootprints(),
    ...RURAL_ROADS.map((r, i) => ({ id: `rural-${i}`, ...roadObb(r[0], r[1], RURAL_ROAD_W) })),
    ...BIG_ROADS.map((r, i) => ({ id: `big-${i}`, ...roadObb(r[0], r[1], BIG_ROAD_W) })),
  ];
}

/** Buyable / built footprints that scenery and new roads must stay off. */
export function expansionPlotFootprints(): Array<OBB & { id: string }> {
  const plots: Array<OBB & { id: string }> = [
    ...estateLots().map((l) => ({ ...l, id: `lot:estate:${l.n}` })),
    ...expansionFarms().map((f) => ({ ...f, id: `cf:${f.n}` })),
    ...goldwoodHomes().map((h) => ({ ...h, id: `b:mansion:${h.n}` })),
    ...wineryPlots().map((v) => ({ ...v, id: `winery:${v.n}` })),
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
  }
  return plots;
}

export type SceneryKind = 'pine' | 'deciduous' | 'bush' | 'rock' | 'lamp' | 'pond' | 'hedge' | 'fence';
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

const blocked = (x: number, z: number, rad: number, roads: OBB[], plots: OBB[], ponds: Array<{ x: number; z: number; r: number }>) => {
  if (z > OCEAN.beachZ - 6 || z < LAND_FILL.z0 + 2 || x < LAND_FILL.x0 + 2 || x > LAND_FILL.x1 - 2) return true;
  if (Math.hypot(x - RIG_DOCK.x, z - RIG_DOCK.z) < Math.max(RIG_DOCK.w, RIG_DOCK.d) / 2 + 8) return true;
  if (Math.abs(x - 40) < 50 && z > OCEAN.beachZ - 8) return true; // harbour
  for (const r of roads) if (obbHit(r, x, z, rad + r.d / 2 * 0 + 1.2)) return true;
  for (const p of plots) if (obbHit(p, x, z, rad + 1.4)) return true;
  for (const q of ponds) if (Math.hypot(x - q.x, z - q.z) < q.r + rad + 1.5) return true;
  return false;
};

const onNewLand = (x: number, z: number, boxes: Aabb[]) => boxes.some((b) => inAabb(b, x, z, -0.8));

/**
 * Deterministic scenery for the new land only (gaps + East Estates + Goldwood + Orchard Ridge).
 * Lamps sit beside expansion roads; hedges ring Goldwood mansions just outside the footprint.
 */
export function expansionScenery(seed = 1): ScenerySpot[] {
  const boxes = expansionLandBoxes();
  const roads = allExpansionKeepRoads();
  const plots = expansionPlotFootprints();
  const rnd = mulberry(0x9e3779b9 ^ (seed * 0x85ebca6b));
  const spots: ScenerySpot[] = [];
  const ponds: Array<{ x: number; z: number; r: number }> = [];

  const pondTries: Array<[number, number, number]> = [
    [100, -250, 8], [280, -380, 7], [300, -200, 9], [800 - 80, 20, 7],
    [500, 130, 6.5], [-80, -280, 7.5], [240, -80, 6], [700, -240, 7],
  ];
  for (const [x, z, r] of pondTries) {
    if (!onNewLand(x, z, boxes)) continue;
    if (blocked(x, z, r + 2, roads, plots, [])) continue;
    ponds.push({ x, z, r });
    spots.push({ kind: 'pond', x, z, s: r, rot: 0 });
  }

  for (const b of boxes) {
    const spanX = b.x1 - b.x0, spanZ = b.z1 - b.z0;
    if (spanX < 8 || spanZ < 8) continue;
    const step = 16;
    for (let x = b.x0 + 6; x < b.x1 - 6; x += step) {
      for (let z = b.z0 + 6; z < b.z1 - 6; z += step) {
        const jx = x + (rnd() - 0.5) * 10, jz = z + (rnd() - 0.5) * 10;
        if (!onNewLand(jx, jz, boxes)) continue;
        const scale = 0.75 + rnd() * 0.55;
        if (blocked(jx, jz, 1.6 * scale, roads, plots, ponds)) continue;
        const kind: SceneryKind = rnd() < 0.62 ? 'pine' : 'deciduous';
        spots.push({ kind, x: jx, z: jz, s: scale, rot: rnd() * Math.PI * 2 });
        // a bush near some trees
        if (rnd() < 0.45) {
          const bx = jx + (rnd() - 0.5) * 5, bz = jz + (rnd() - 0.5) * 5;
          if (onNewLand(bx, bz, boxes) && !blocked(bx, bz, 0.8, roads, plots, ponds)) {
            spots.push({ kind: 'bush', x: bx, z: bz, s: 0.55 + rnd() * 0.4, rot: rnd() * Math.PI });
          }
        }
        if (rnd() < 0.18) {
          const rx = jx + (rnd() - 0.5) * 6, rz = jz + (rnd() - 0.5) * 6;
          if (onNewLand(rx, rz, boxes) && !blocked(rx, rz, 0.7, roads, plots, ponds)) {
            spots.push({ kind: 'rock', x: rx, z: rz, s: 0.4 + rnd() * 0.5, rot: rnd() * Math.PI });
          }
        }
      }
    }
  }

  // Extra bushes in leftover pockets (tighter grid, skip if blocked).
  for (const b of boxes) {
    for (let x = b.x0 + 4; x < b.x1 - 4; x += 22) {
      for (let z = b.z0 + 4; z < b.z1 - 4; z += 22) {
        const jx = x + (rnd() - 0.5) * 8, jz = z + (rnd() - 0.5) * 8;
        if (!onNewLand(jx, jz, boxes) || blocked(jx, jz, 0.7, roads, plots, ponds)) continue;
        if (rnd() > 0.35) continue;
        spots.push({ kind: 'bush', x: jx, z: jz, s: 0.5 + rnd() * 0.35, rot: rnd() * Math.PI });
      }
    }
  }

  // Lamps along expansion / orchard roads, offset to the shoulder.
  const expRoads = [...EXPANSION_ROADS, ...ORCHARD_ROADS];
  let li = 0;
  for (const [a, b] of expRoads) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    for (let t = 8; t < L - 6; t += 22) {
      const side = (li++ % 2) ? 1 : -1;
      const x = a[0] + ux * t + nx * side * (EXPANSION_ROAD_W / 2 + 2.4);
      const z = a[1] + uz * t + nz * side * (EXPANSION_ROAD_W / 2 + 2.4);
      if (z > OCEAN.beachZ - 4) continue;
      if (plots.some((p) => obbHit(p, x, z, 1.2))) continue;
      if (roads.some((r) => obbHit(r, x, z, 0.9))) continue;
      spots.push({ kind: 'lamp', x, z, s: 1, rot: Math.atan2(ux, uz) });
    }
  }

  // Hedges just outside each Goldwood mansion (skip the south face of the north row, where the driveway meets the curb).
  for (const h of goldwoodHomes()) {
    const gap = 1.3, step = 1.6;
    const sides: Array<[number, number, number, number]> = [
      [h.x - h.w / 2 - gap, h.z - h.d / 2, 0, h.d], // west
      [h.x + h.w / 2 + gap, h.z - h.d / 2, 0, h.d], // east
      [h.x - h.w / 2, h.z + h.d / 2 + gap, h.w, 0], // south (toward mid street)
      [h.x - h.w / 2, h.z - h.d / 2 - gap, h.w, 0], // north
    ];
    sides.forEach(([sx, sz, alongX, alongZ], side) => {
      const len = Math.max(alongX, alongZ) || 0.1;
      // Leave a doorway gap on the south face of the north row (driveway approach).
      const skipSouth = h.z <= -400 && side === 2;
      for (let t = 0.4; t <= len - 0.4; t += step) {
        if (skipSouth && Math.abs(t - len / 2) < 2.2) continue;
        const x = sx + (alongX ? t : 0);
        const z = sz + (alongZ ? t : 0);
        if (roads.some((r) => obbHit(r, x, z, 0.8))) continue;
        spots.push({ kind: 'hedge', x, z, s: 1, rot: alongX ? 0 : Math.PI / 2 });
      }
    });
  }

  // Short fence runs along the outer Goldwood and East Estates edges, off the roads.
  const fenceRuns: Array<[number, number, number, number]> = [
    [GOLDWOOD.x0 + 4, GOLDWOOD.z0 + 4, GOLDWOOD.x1 - 4, GOLDWOOD.z0 + 4],
    [GOLDWOOD.x0 + 4, GOLDWOOD.z0 + 4, GOLDWOOD.x0 + 4, GOLDWOOD.z1 - 8],
    [EAST_X1 - 6, -400, EAST_X1 - 6, 140],
  ];
  for (const [ax, az, bx, bz] of fenceRuns) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    for (let t = 0; t <= L; t += 2.2) {
      const x = ax + ux * t, z = az + uz * t;
      if (blocked(x, z, 0.6, roads, plots, ponds)) continue;
      spots.push({ kind: 'fence', x, z, s: 1, rot: Math.atan2(ux, uz) });
    }
  }

  return spots;
}

export function sceneryOverlaps(spots: ScenerySpot[] = expansionScenery()): Array<{ kind: SceneryKind; x: number; z: number; hit: string }> {
  const roads = allExpansionKeepRoads();
  const plots = expansionPlotFootprints();
  const hits: Array<{ kind: SceneryKind; x: number; z: number; hit: string }> = [];
  const rad: Record<SceneryKind, number> = { pine: 1.3, deciduous: 1.3, bush: 0.6, rock: 0.55, lamp: 0.4, pond: 0, hedge: 0.45, fence: 0.3 };
  for (const s of spots) {
    if (s.kind === 'pond' || s.kind === 'hedge') {
      // ponds were placed off plots/roads; hedges sit just outside mansion boxes on purpose (still off roads)
      const r = s.kind === 'pond' ? s.s : 0.45;
      for (const rd of roads) if (obbHit(rd, s.x, s.z, r + 0.6)) hits.push({ kind: s.kind, x: s.x, z: s.z, hit: (rd as OBB & { id?: string }).id ?? 'road' });
      if (s.kind === 'pond') {
        for (const p of plots) if (obbHit(p, s.x, s.z, r + 0.8)) hits.push({ kind: s.kind, x: s.x, z: s.z, hit: (p as OBB & { id: string }).id });
      }
      continue;
    }
    const r = (rad[s.kind] ?? 0.6) * (s.kind === 'pine' || s.kind === 'deciduous' ? s.s : 1);
    for (const rd of roads) if (obbHit(rd, s.x, s.z, r + 0.7)) hits.push({ kind: s.kind, x: s.x, z: s.z, hit: (rd as OBB & { id?: string }).id ?? 'road' });
    for (const p of plots) if (obbHit(p, s.x, s.z, r + 1.0)) hits.push({ kind: s.kind, x: s.x, z: s.z, hit: (p as OBB & { id: string }).id });
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

// silence unused in some builds
void overlapsAabb;
