/** Pure city layout (no three.js) so tests can check cars never cross buildings. */
import { HOUSING_TYPES, type District } from './housing';

export const BLOCK = 21; // road pitch
export const NBX = 8, NBZ = 7; // city blocks across (x) and deep (z)
export const ROAD_W = 4;
export const ROADS_X = Array.from({ length: NBX + 1 }, (_, i) => (i - NBX / 2) * BLOCK); // north-south roads (constant x)
export const ROADS_Z = Array.from({ length: NBZ + 1 }, (_, i) => (i - NBZ / 2) * BLOCK); // east-west roads (constant z)
export const BLOCK_X = Array.from({ length: NBX }, (_, i) => (i - (NBX - 1) / 2) * BLOCK);
export const BLOCK_Z = Array.from({ length: NBZ }, (_, i) => (i - (NBZ - 1) / 2) * BLOCK);
export const PLATE = ROADS_X[NBX] + 4; // plate spans -PLATE..PLATE on x and z
export const WATER_Z0 = ROADS_Z[NBZ] + 2.5; // water strip from here to PLATE
export const ROAD_X_SPAN: [number, number] = [ROADS_Z[0] - 2, ROADS_Z[NBZ] + 2]; // z extent of x-roads
export const ROAD_Z_SPAN: [number, number] = [-PLATE, PLATE];
export const PAD = 12; // landmark pad footprint

/** Landmarks spread through the grid with at least one plain block between neighbours. */
export const SPOT_POS: Record<string, [number, number]> = {
  chess: [BLOCK_X[1], BLOCK_Z[1]], leaderboard: [BLOCK_X[4], BLOCK_Z[0]], bank: [BLOCK_X[6], BLOCK_Z[1]],
  chat: [BLOCK_X[3], BLOCK_Z[2]], casino: [BLOCK_X[4], BLOCK_Z[4]], factory: [BLOCK_X[0], BLOCK_Z[4]],
  warehouse: [BLOCK_X[7], BLOCK_Z[3]], mine: [BLOCK_X[1], BLOCK_Z[6]], market: [BLOCK_X[3], BLOCK_Z[6]], arena: [BLOCK_X[6], BLOCK_Z[5]],
  stocks: [BLOCK_X[2], BLOCK_Z[4]],
};

export type AABB = { x0: number; x1: number; z0: number; z1: number };
export const landmarkBoxes = (): AABB[] => Object.values(SPOT_POS).map(([x, z]) => ({ x0: x - PAD / 2, x1: x + PAD / 2, z0: z - PAD / 2, z1: z + PAD / 2 }));

export type BlockKind = 'landmark' | 'housing' | 'park' | 'plaza' | 'lot';
export interface CityBlock { x: number; z: number; kind: BlockKind; district: District }
const district = (x: number, z: number): District => { const r = Math.max(Math.abs(x) / (BLOCK * NBX / 2), Math.abs(z) / (BLOCK * NBZ / 2)); return r < 0.4 ? 'downtown' : r < 0.75 ? 'midtown' : 'suburb'; };
/** Every block gets a kind; empty blocks are mostly housing with some parks, plazas and empty lots. */
export function cityBlocks(rand: () => number): CityBlock[] {
  const taken = new Set(Object.values(SPOT_POS).map(([x, z]) => `${x},${z}`));
  const out: CityBlock[] = [];
  for (const x of BLOCK_X) for (const z of BLOCK_Z) {
    const dist = district(x, z);
    if (taken.has(`${x},${z}`)) { out.push({ x, z, kind: 'landmark', district: dist }); continue; }
    const v = rand();
    const kind: BlockKind = v < 0.13 ? 'park' : v < 0.2 ? (dist === 'suburb' ? 'park' : 'plaza') : v < 0.27 ? 'lot' : 'housing';
    out.push({ x, z, kind, district: dist });
  }
  return out;
}

export interface House { x: number; z: number; w: number; d: number; h: number; type: string; color: number; rot: number }
const INNER = BLOCK - ROAD_W - 2; // usable block width (keeps a sidewalk gap to the road)
/** Pack one block with houses of the district's types, on a jittered sub-grid so nothing overlaps or touches a road. */
function packBlock(b: CityBlock, rand: () => number, out: House[]) {
  const types = HOUSING_TYPES.filter((t) => t.districts.includes(b.district));
  const t = types[Math.floor(rand() * types.length)];
  const cellW = t.w[1] + 1, cellD = t.d[1] + 1.2;
  const nx = Math.max(1, Math.floor(INNER / cellW)), nz = Math.max(1, Math.floor(INNER / cellD));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (t.id === 'house' && rand() < 0.15) continue; // yards / gaps in the suburbs
    const w = t.w[0] + rand() * (t.w[1] - t.w[0]), d = t.d[0] + rand() * (t.d[1] - t.d[0]);
    const cx = b.x + (i - (nx - 1) / 2) * (INNER / nx), cz = b.z + (j - (nz - 1) / 2) * (INNER / nz);
    const floors = t.floors[0] + Math.floor(rand() * (t.floors[1] - t.floors[0] + 1));
    out.push({ x: cx, z: cz, w, d, h: floors * t.floorH, type: t.id, color: t.colors[Math.floor(rand() * t.colors.length)], rot: 0 });
  }
}
export function fillerSpots(rand: () => number, blocks = cityBlocks(rand)): House[] {
  const out: House[] = [];
  for (const b of blocks) if (b.kind === 'housing') packBlock(b, rand, out);
  return out;
}
export const fillerBoxes = (f: { x: number; z: number; w: number; d: number }[]): AABB[] => f.map((b) => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 }));

/** Car loops run along road centrelines (corners are road intersections). */
const RX = (i: number) => ROADS_X[i], RZ = (i: number) => ROADS_Z[i];
export const CAR_LOOPS = [
  { x0: RX(0), x1: RX(NBX), z0: RZ(0), z1: RZ(NBZ) }, // ring road
  { x0: RX(2), x1: RX(6), z0: RZ(2), z1: RZ(5) }, // downtown loop
  { x0: RX(4), x1: RX(7), z0: RZ(1), z1: RZ(4) },
  { x0: RX(1), x1: RX(4), z0: RZ(4), z1: RZ(7) },
];
/** ~1 car per 4 blocks: density scales with the network instead of per block. */
export const CAR_COUNT = Math.round((NBX * NBZ) / 4);
export const LANE = 0.9;
export type Loop = (typeof CAR_LOOPS)[number];
export function loopPoint(l: Loop, t: number, lane: number): readonly [number, number, number] {
  const w = l.x1 - l.x0, hh = l.z1 - l.z0, P = 2 * (w + hh); let d = (((t % 1) + 1) % 1) * P;
  if (d < w) return [l.x0 + d, l.z0 + lane, 0] as const; d -= w;
  if (d < hh) return [l.x1 - lane, l.z0 + d, Math.PI / 2] as const; d -= hh;
  if (d < w) return [l.x1 - d, l.z1 - lane, Math.PI] as const; d -= w;
  return [l.x0 + lane, l.z1 - d, -Math.PI / 2] as const;
}
