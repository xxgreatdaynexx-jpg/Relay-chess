/** Pure city layout (no three.js) so tests can check cars never cross buildings. */
export const PLATE = 44; // plate spans -PLATE..PLATE on x and z
export const WATER_Z0 = 36; // water strip from here to PLATE
export const ROAD_W = 4;
export const ROADS_X = [-42, -21, 0, 21, 42]; // north-south roads (constant x)
export const ROADS_Z = [-31.5, -10.5, 10.5, 31.5]; // east-west roads (constant z)
export const ROAD_X_SPAN: [number, number] = [-33.5, 33.5]; // z extent of x-roads
export const ROAD_Z_SPAN: [number, number] = [-44, 44];
export const BLOCK_X = [-31.5, -10.5, 10.5, 31.5];
export const BLOCK_Z = [-21, 0, 21];
export const PAD = 12; // landmark pad footprint

export const SPOT_POS: Record<string, [number, number]> = {
  chess: [-31.5, -21], chat: [-10.5, -21], leaderboard: [10.5, -21],
  factory: [-31.5, 0], casino: [-10.5, 0], bank: [10.5, 0], warehouse: [31.5, 0],
  mine: [-31.5, 21], market: [-10.5, 21], arena: [10.5, 21],
};

export type AABB = { x0: number; x1: number; z0: number; z1: number };
export const landmarkBoxes = (): AABB[] => Object.values(SPOT_POS).map(([x, z]) => ({ x0: x - PAD / 2, x1: x + PAD / 2, z0: z - PAD / 2, z1: z + PAD / 2 }));

/** Filler towers: 2x2 per empty block, footprint up to 4.3 wide, with jitter. */
export function fillerSpots(rand: () => number): { x: number; z: number; w: number; d: number }[] {
  const out: { x: number; z: number; w: number; d: number }[] = [];
  const taken = new Set(Object.values(SPOT_POS).map(([x, z]) => `${x},${z}`));
  for (const bx of BLOCK_X) for (const bz of BLOCK_Z) {
    if (taken.has(`${bx},${bz}`)) continue;
    for (const ox of [-4.5, 4.5]) for (const oz of [-4.5, 4.5]) out.push({ x: bx + ox + (rand() - 0.5), z: bz + oz + (rand() - 0.5), w: 2.8 + rand() * 1.5, d: 2.8 + rand() * 1.5 });
  }
  // A row of small towers behind the back road, for skyline depth.
  for (const bx of BLOCK_X) for (const ox of [-6, 0, 6]) out.push({ x: bx + ox, z: -39, w: 3, d: 3 });
  return out;
}
export const fillerBoxes = (f: ReturnType<typeof fillerSpots>): AABB[] => f.map((b) => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 }));

/** Car loops run along road centrelines (corners are road intersections). */
export const CAR_LOOPS = [
  { x0: -21, x1: 21, z0: -10.5, z1: 10.5 },
  { x0: -42, x1: 42, z0: -31.5, z1: 31.5 },
  { x0: 0, x1: 42, z0: -31.5, z1: 10.5 },
];
export const CAR_COUNT = 8;
export const LANE = 0.9;
export type Loop = (typeof CAR_LOOPS)[number];
export function loopPoint(l: Loop, t: number, lane: number): readonly [number, number, number] {
  const w = l.x1 - l.x0, hh = l.z1 - l.z0, P = 2 * (w + hh); let d = (((t % 1) + 1) % 1) * P;
  if (d < w) return [l.x0 + d, l.z0 + lane, 0] as const; d -= w;
  if (d < hh) return [l.x1 - lane, l.z0 + d, Math.PI / 2] as const; d -= hh;
  if (d < w) return [l.x1 - d, l.z1 - lane, Math.PI] as const; d -= w;
  return [l.x0 + lane, l.z1 - d, -Math.PI / 2] as const;
}
