/**
 * Big Farms: a countryside district EAST of the east ring road (x = 196), beside the Farm district and Magma Depths.
 * The original eight large fenced farms (20x20, 24x24 and 30x30 tiles) sit in two columns either side of a north-south
 * lane, each lot with a yard on its road side holding a barn, a farmhouse, a silo and a machinery pad. A new east road
 * (x = BIG_EAST_X) and extensions of the north and south ring roads close the loop; every farm has a driveway off the lane.
 *
 * Four more large plots continue the same two columns NORTH of the existing north road, on clear land that stays off
 * the Stone Quarry (around 328,-158), its haul road, lakes, buildings and the original eight farms. Their lots, ids
 * (cf:1008–cf:1011) and prices use the same rules; existing cf:<n> ids and positions stay put.
 *
 * The farms are ordinary countryside field farms (`cf:<n>`, n >= BIG_FARM_N0) so deeds, planting, machines, fertilizer,
 * auto-sell, net worth and the wealth tax all work unchanged. Their price is bigFarmPrice (premium, grows faster than
 * the tile count). Nothing here feeds the seeded outskirts fill.
 * No imports from farm.ts (it imports BIG_FARM_AREA for the map bounds): TILE is mirrored here and tested equal.
 *
 * There is no per-account cap on how many Big Farms a player may own. The Bill Chud 1 farmland tile limit still applies.
 */
type P = [number, number];
export const BIG_TILE = 2;
export const BIG_FARM_N0 = 1000;
const NZ = -116 - 8, SZ = 150, EX = 196; // north / south / east ring roads (shared/outskirts.ts)
export const BIG_LANE_X = 275, BIG_EAST_X = 346, BIG_ROAD_W = 4.5;
/** New east-west road at the north end of the northern lots (south of the area bound). */
export const BIG_NORTH_ROAD_Z = -304;
export const BIG_FARM_AREA = { x0: 200, x1: BIG_EAST_X + 10, z0: BIG_NORTH_ROAD_Z - 8, z1: SZ + 8 };
/** Grass (and Christmas ground texture) continues this far past the farm block and west of the east-ring connector. */
export const BIG_GROUND_X0 = EX - 24;
export const BIG_GROUND_X1 = BIG_FARM_AREA.x1 + 40;
export const BIG_GROUND_Z0 = BIG_FARM_AREA.z0;
const YARD = 12, GAP = 3, Z_START = NZ + 6;
/** South edge of the first northern lots: 4 units north of the existing north road. */
const NORTH_SETBACK = 4;
/** Keep-out around the Stone Quarry pad (MINE_APRON/2 + 4), mirrored so this file does not import worldLayout. */
const QUARRY = { x: 328, z: -158, keep: 21 };
const COLS: Array<{ x0: number; x1: number; side: 1 | -1; sizes: number[] }> = [
  { x0: 209, x1: 271, side: 1, sizes: [30, 24, 20, 24] }, // west column: lane on its east (+x) side
  { x0: 279, x1: 341, side: -1, sizes: [20, 30, 20, 24] }, // east column: lane on its west side
];
export interface BigFarm { n: number; size: number; x: number; z: number; w: number; d: number; cols: number; rows: number
  lot: { x0: number; x1: number; z0: number; z1: number }
  barn: { x: number; z: number; w: number; d: number }; house: { x: number; z: number; w: number; d: number }; silo: P
  /** machinery pad (x0..x1 at yard z) */ pad: { x0: number; x1: number; z: number }; drive: [P, P]
  /** parked machinery on the pad (farming rework: seeder + harvester + tractor) */ machines: Array<{ kind: 'tractor' | 'harvester' | 'seeder'; x: number; z: number; yaw: number }> }

function yardKit(c: (typeof COLS)[number], yz: number) {
  const far = c.side > 0 ? c.x0 : c.x1, near = c.side > 0 ? c.x1 : c.x0, k = c.side;
  return {
    barn: { x: far + k * 7, z: yz, w: 10, d: 7 }, house: { x: far + k * 17.5, z: yz, w: 6, d: 5 }, silo: [far + k * 25, yz] as P,
    pad: { x0: Math.min(far + k * 30, near - k * 2), x1: Math.max(far + k * 30, near - k * 2), z: yz },
    machines: [
      { kind: 'harvester' as const, x: far + k * 33, z: yz, yaw: Math.PI / 2 },
      { kind: 'seeder' as const, x: far + k * 41, z: yz, yaw: Math.PI / 2 },
      { kind: 'tractor' as const, x: far + k * 48, z: yz, yaw: Math.PI / 2 },
    ],
    drive: [[BIG_LANE_X, yz], [near - k * 6, yz]] as [P, P],
  };
}

let cache: BigFarm[] | null = null;
export function bigFarms(): BigFarm[] {
  if (cache) return cache;
  const out: BigFarm[] = [];
  const push = (c: (typeof COLS)[number], s: number, lotZ0: number, lotZ1: number, fieldZ: number, yz: number) => {
    const w = s * BIG_TILE + 2, d = w; const cx = (c.x0 + c.x1) / 2; const kit = yardKit(c, yz);
    out.push({ n: BIG_FARM_N0 + out.length, size: s, cols: s, rows: s, w, d, x: cx, z: fieldZ, lot: { x0: c.x0, x1: c.x1, z0: lotZ0, z1: lotZ1 }, ...kit });
  };
  for (const c of COLS) {
    let z = Z_START;
    for (const s of c.sizes) {
      const w = s * BIG_TILE + 2, d = w; const yz = z + YARD / 2;
      push(c, s, z, z + YARD + d, z + YARD + d / 2, yz);
      z += YARD + d + GAP;
    }
  }
  // Northern plots: same columns, yards on the south (toward the existing north road / lane). East column starts
  // north of the quarry keep-out; the west column starts just north of the existing north road.
  const west = COLS[0]!, east = COLS[1]!;
  const northLot = (c: (typeof COLS)[number], s: number, lotZ1: number) => {
    const d = s * BIG_TILE + 2, lotZ0 = lotZ1 - YARD - d;
    push(c, s, lotZ0, lotZ1, lotZ0 + d / 2, lotZ1 - YARD / 2);
    return lotZ0;
  };
  const westZ0a = northLot(west, 24, NZ - NORTH_SETBACK);
  northLot(west, 30, westZ0a - GAP);
  const eastZ0a = northLot(east, 20, QUARRY.z - QUARRY.keep - 2);
  northLot(east, 24, eastZ0a - GAP);
  cache = out; return out;
}
/** Roads: north + south ring extensions, the new east road, the farm lane, the northern extension, the east-ring connector up to the new north road, and one driveway per farm. */
export const BIG_ROADS: Array<[P, P]> = [
  [[EX, NZ], [BIG_EAST_X, NZ]], [[EX, SZ], [BIG_EAST_X, SZ]], [[BIG_EAST_X, NZ], [BIG_EAST_X, SZ]], [[BIG_LANE_X, NZ], [BIG_LANE_X, SZ]],
  [[BIG_LANE_X, BIG_NORTH_ROAD_Z], [BIG_LANE_X, NZ]],
  [[EX, BIG_NORTH_ROAD_Z], [BIG_EAST_X, BIG_NORTH_ROAD_Z]],
  [[BIG_EAST_X, BIG_NORTH_ROAD_Z], [BIG_EAST_X, NZ]],
  [[EX, BIG_NORTH_ROAD_Z], [EX, NZ]],
  ...bigFarms().map((f) => f.drive),
];
/** Premium price (base chips) for a big farm: 250 per tile scaled up by (1 + tiles / 900), rounded to 5,000.
 *  20x20 = 145,000 · 24x24 = 235,000 · 30x30 = 450,000. */
export const bigFarmPrice = (tiles: number) => Math.round((250 * tiles * (1 + tiles / 900)) / 5000) * 5000;
export const isBigFarmN = (n: number) => n >= BIG_FARM_N0 && n < BIG_FARM_N0 + bigFarms().length;
