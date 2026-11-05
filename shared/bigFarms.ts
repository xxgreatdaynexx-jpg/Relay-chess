/**
 * Big Farms (Millionaire Update map expansion, Dayne 2026-11-04): a new countryside district EAST of the east ring road
 * (x = 196), beside the Farm district and Magma Depths. Eight large fenced farms (20x20, 24x24 and 30x30 tiles) in two
 * columns either side of a north-south lane, each lot with a yard on its road side holding a barn, a farmhouse, a silo
 * and a machinery pad (room for the farming-rework seeders / harvesters). A new east road (x = BIG_EAST_X) and
 * extensions of the north and south ring roads close the loop; every farm has a driveway off the lane.
 *
 * The farms are ordinary countryside field farms (`cf:<n>`, n >= BIG_FARM_N0) so deeds, planting, machines, fertilizer,
 * auto-sell, net worth and the wealth tax all work unchanged. Their price is bigFarmPrice (premium, grows faster than
 * the tile count). Nothing here feeds the seeded outskirts fill, so every existing cf:<n> id and position stays put.
 * No imports from farm.ts (it imports BIG_FARM_AREA for the map bounds): TILE is mirrored here and tested equal.
 */
type P = [number, number];
export const BIG_TILE = 2;
export const BIG_FARM_N0 = 1000;
/** An account may own at most this many Big Farms (server-enforced in RealEstate.buy). */
export const MAX_BIG_FARMS = 1;
const NZ = -116 - 8, SZ = 150, EX = 196; // north / south / east ring roads (shared/outskirts.ts)
export const BIG_LANE_X = 275, BIG_EAST_X = 346, BIG_ROAD_W = 4.5;
export const BIG_FARM_AREA = { x0: 200, x1: BIG_EAST_X + 10, z0: NZ - 8, z1: SZ + 8 };
const YARD = 12, GAP = 3, Z_START = NZ + 6;
const COLS: Array<{ x0: number; x1: number; side: 1 | -1; sizes: number[] }> = [
  { x0: 209, x1: 271, side: 1, sizes: [30, 24, 20, 24] }, // west column: lane on its east (+x) side
  { x0: 279, x1: 341, side: -1, sizes: [20, 30, 20, 24] }, // east column: lane on its west side
];
export interface BigFarm { n: number; size: number; x: number; z: number; w: number; d: number; cols: number; rows: number
  lot: { x0: number; x1: number; z0: number; z1: number }
  barn: { x: number; z: number; w: number; d: number }; house: { x: number; z: number; w: number; d: number }; silo: P
  /** machinery pad (x0..x1 at yard z) */ pad: { x0: number; x1: number; z: number }; drive: [P, P]
  /** parked machinery on the pad (farming rework: seeder + harvester + tractor) */ machines: Array<{ kind: 'tractor' | 'harvester' | 'seeder'; x: number; z: number; yaw: number }> }
let cache: BigFarm[] | null = null;
export function bigFarms(): BigFarm[] {
  if (cache) return cache;
  const out: BigFarm[] = [];
  for (const c of COLS) {
    let z = Z_START;
    for (const s of c.sizes) {
      const w = s * BIG_TILE + 2, d = w; const yz = z + YARD / 2; const cx = (c.x0 + c.x1) / 2;
      // buildings at the far end of the yard (away from the lane), the pad on the lane side, the driveway onto the pad
      const far = c.side > 0 ? c.x0 : c.x1, near = c.side > 0 ? c.x1 : c.x0, k = c.side;
      const barn = { x: far + k * 7, z: yz, w: 10, d: 7 }, house = { x: far + k * 17.5, z: yz, w: 6, d: 5 }, silo: P = [far + k * 25, yz];
      const pad = { x0: Math.min(far + k * 30, near - k * 2), x1: Math.max(far + k * 30, near - k * 2), z: yz };
      out.push({ n: BIG_FARM_N0 + out.length, size: s, cols: s, rows: s, w, d, x: cx, z: z + YARD + d / 2, lot: { x0: c.x0, x1: c.x1, z0: z, z1: z + YARD + d },
        barn, house, silo, pad, machines: [{ kind: 'harvester', x: far + k * 33, z: yz, yaw: Math.PI / 2 }, { kind: 'seeder', x: far + k * 41, z: yz, yaw: Math.PI / 2 }, { kind: 'tractor', x: far + k * 48, z: yz, yaw: Math.PI / 2 }], drive: [[BIG_LANE_X, yz], [near - k * 6, yz]] });
      z += YARD + d + GAP;
    }
  }
  cache = out; return out;
}
/** Roads: north + south ring extensions, the new east road, the farm lane and one driveway per farm. */
export const BIG_ROADS: Array<[P, P]> = [
  [[EX, NZ], [BIG_EAST_X, NZ]], [[EX, SZ], [BIG_EAST_X, SZ]], [[BIG_EAST_X, NZ], [BIG_EAST_X, SZ]], [[BIG_LANE_X, NZ], [BIG_LANE_X, SZ]],
  ...bigFarms().map((f) => f.drive),
];
/** Premium price (base chips) for a big farm: 250 per tile scaled up by (1 + tiles / 900), rounded to 5,000.
 *  20x20 = 145,000 · 24x24 = 235,000 · 30x30 = 450,000. */
export const bigFarmPrice = (tiles: number) => Math.round((250 * tiles * (1 + tiles / 900)) / 5000) * 5000;
export const isBigFarmN = (n: number) => n >= BIG_FARM_N0 && n < BIG_FARM_N0 + bigFarms().length;
