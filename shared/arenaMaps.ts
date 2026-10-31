/**
 * Data-driven 3D arena maps. A map is a list of axis-aligned solids (boxes) and ramps on a flat
 * ground plane at z = 0. Coordinates: x/y are the horizontal plane (same as the old 2D arena),
 * z is up. One unit is roughly one metre; a player is 1.7 tall.
 *
 * Adding a map = adding a new ArenaMap definition to MAPS. Physics, hit detection, spawns,
 * the minimap and the 3D renderer all read the same data.
 */

export type Material = 'sand' | 'plaster' | 'concrete' | 'crate' | 'metal' | 'sandbag' | 'wood' | 'container' | 'container2' | 'tile' | 'carpet' | 'drywall';

export interface Solid { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number; mat: Material }
/** A wedge whose walkable top rises linearly from zLow to zHigh along `dir` (the uphill direction). */
export interface Ramp { x0: number; y0: number; x1: number; y1: number; zLow: number; zHigh: number; dir: '+x' | '-x' | '+y' | '-y'; mat: Material }

export interface ArenaMap {
  id: string;
  name: string;
  /** Playable extent: 0..w along x, 0..d along y. */
  w: number;
  d: number;
  solids: Solid[];
  ramps: Ramp[];
  /** Spawn points [x, y, z] (z = floor height there). */
  spawns: Array<[number, number, number]>;
  /** Look: sky/fog colours and the ground material. */
  sky: string;
  fog: string;
  ground: Material;
  /** Named check points, one per walkable level (floor, roof, catwalk...). Tests prove each is reachable on foot. */
  levels?: Array<{ name: string; at: [number, number, number] }>;
}

// ---- tiny builders so map definitions stay readable
const box = (x0: number, y0: number, x1: number, y1: number, z1: number, mat: Material, z0 = 0): Solid => ({ x0, y0, x1, y1, z0, z1, mat });
/** A cube crate (size s) at (x,y) corner, stacked `n` high. */
const crates = (x: number, y: number, s: number, n = 1, z = 0): Solid[] =>
  Array.from({ length: n }, (_, i) => box(x, y, x + s, y + s, z + s * (i + 1), 'crate', z + s * i));
/** Straight stairs: `n` steps of `rise` from z=base, each `run` deep, going in `dir` starting at the given edge. */
function stairs(x0: number, y0: number, x1: number, y1: number, dir: Ramp['dir'], n: number, top: number, mat: Material = 'concrete', base = 0): Solid[] {
  const out: Solid[] = [];
  const along = dir === '+x' || dir === '-x' ? x1 - x0 : y1 - y0;
  const run = along / n;
  for (let i = 0; i < n; i++) {
    const h = base + ((top - base) * (i + 1)) / n;
    // step i occupies the slice that is i steps up the stairs (and everything uphill of it is higher)
    if (dir === '+x') out.push(box(x0 + run * i, y0, x0 + run * (i + 1), y1, h, mat, base));
    if (dir === '-x') out.push(box(x1 - run * (i + 1), y0, x1 - run * i, y1, h, mat, base));
    if (dir === '+y') out.push(box(x0, y0 + run * i, x1, y0 + run * (i + 1), h, mat, base));
    if (dir === '-y') out.push(box(x0, y1 - run * (i + 1), x1, y1 - run * i, h, mat, base));
  }
  return out;
}

const WALL_H = 7;
function perimeter(w: number, d: number, mat: Material): Solid[] {
  return [box(-1, -1, w + 1, 0, WALL_H, mat), box(-1, d, w + 1, d + 1, WALL_H, mat), box(-1, 0, 0, d, WALL_H, mat), box(w, 0, w + 1, d, WALL_H, mat)];
}

/** "Dunes": sun-baked desert town. Raised A plateau (NE), a long catwalk over mid, a stair tower, crates everywhere. */
export const DUNES: ArenaMap = {
  id: 'dunes',
  name: 'Dunes',
  w: 48,
  d: 48,
  sky: '#c9b48a',
  fog: '#b9a67f',
  ground: 'sand',
  solids: [
    ...perimeter(48, 48, 'plaster'),
    // --- A plateau (NE): 1.6 high, reached by a ramp from mid and stairs from the east lane
    box(30, 0, 48, 12, 1.6, 'sand'),
    ...stairs(42, 12, 48, 16, '-y', 4, 1.6),
    // cover up on A
    // (sitting ON the plateau: they used to start at z=0, buried inside it with only a sliver poking out)
    ...crates(33, 3, 1.2, 2, 1.6), ...crates(34.2, 3, 1.2, 1, 1.6), ...crates(40, 6, 1.2, 1, 1.6), box(37, 9, 41, 9.8, 1.6 + 0.9, 'sandbag', 1.6),
    box(44, 2, 46, 4, 1.6 + 1.0, 'crate', 1.6),
    // A house wall with a doorway: two wall pieces and a lintel you can walk under
    box(36, 12, 37, 20, 4, 'plaster'), box(24, 19, 26, 20, 4, 'plaster'), box(28, 19, 30, 20, 4, 'plaster'), box(26, 19, 28, 20, 4, 'plaster', 2.4),
    // --- Mid: the catwalk (walk on top at 3.2 or underneath), its tower and supports
    box(14, 23, 34, 25, 3.2, 'metal', 2.9),
    box(17, 23, 17.4, 23.4, 2.9, 'metal'), box(17, 24.6, 17.4, 25, 2.9, 'metal'),
    box(24, 23, 24.4, 23.4, 2.9, 'metal'), box(24, 24.6, 24.4, 25, 2.9, 'metal'),
    box(31, 23, 31.4, 23.4, 2.9, 'metal'), box(31, 24.6, 31.4, 25, 2.9, 'metal'),
    box(34, 21, 38, 27, 3.2, 'concrete'),
    ...stairs(34, 27, 38, 33, '-y', 8, 3.2),
    // railings on the catwalk (low, so you can still shoot over them)
    box(14, 22.85, 34, 23, 4.0, 'metal', 3.2), box(14, 25, 34, 25.15, 4.0, 'metal', 3.2),
    // mid walls that split the lanes
    box(20, 0, 22, 14, 4.5, 'plaster'),
    box(22, 34, 30, 36, 4.5, 'plaster'),
    box(10, 14, 12, 21, 3.5, 'plaster'),
    // archway into B: two pillars and a lintel overhead
    box(12, 30, 13.5, 31.5, 4, 'sand'), box(16.5, 30, 18, 31.5, 4, 'sand'), box(12, 30, 18, 31.5, 4, 'sand', 3),
    // --- B site (SW): sunken courtyard walls, a raised B platform reached by crate steps
    box(0, 36, 8, 37, 3.5, 'plaster'), box(10, 36, 16, 37, 3.5, 'plaster'), box(16, 36, 17, 48, 3.5, 'plaster'),
    box(2, 42, 8, 47, 2.0, 'concrete'),
    ...crates(8, 44.8, 1.0), ...crates(9, 44.8, 1.0, 2), ...crates(10, 44.8, 1.0, 1, 0),
    ...crates(11, 39, 1.2, 2), ...crates(12.2, 39, 1.2),
    // --- crates and sandbags all over (jump on the 1.0s, chain up to stacks)
    ...crates(4, 4, 1.0), ...crates(5, 4, 1.0, 2), ...crates(6, 4, 1.0, 3),
    ...crates(8, 10, 1.2), ...crates(26, 6, 1.2, 2), ...crates(27.2, 6, 1.2),
    ...crates(25, 28, 1.0), ...crates(26, 28, 1.0, 2),
    ...crates(40, 30, 1.2), ...crates(41.2, 30, 1.2, 2), ...crates(44, 38, 1.0),
    ...crates(20, 40, 1.2), ...crates(32, 42, 1.2, 2), ...crates(36, 44, 1.0),
    box(4, 26, 8, 26.8, 0.9, 'sandbag'), box(40, 22, 44, 22.8, 0.9, 'sandbag'), box(26, 14, 29, 14.8, 0.9, 'sandbag'),
    // long-lane cover on the east side
    box(44, 24, 45.5, 28, 2.2, 'concrete'), box(46.4, 34, 48, 36, 3.0, 'concrete'),
  ],
  ramps: [
    // up to the A plateau from mid
    { x0: 30, y0: 12, x1: 36, y1: 18, zLow: 0, zHigh: 1.6, dir: '-y', mat: 'sand' },
    // long ramp up to the catwalk's west end
    { x0: 4, y0: 23, x1: 14, y1: 25, zLow: 0, zHigh: 3.2, dir: '+x', mat: 'concrete' },
    // short ramp up onto the B platform's side
    { x0: 2, y0: 39, x1: 5, y1: 42, zLow: 0, zHigh: 2.0, dir: '+y', mat: 'concrete' },
  ],
  spawns: [
    [3, 8, 0], [6, 12, 0], [3, 18, 0], [8, 30, 0], [6, 44.5, 2.0], [14, 44, 0], [24, 44, 0], [30, 30, 0],
    [36, 24, 3.2], [44, 44, 0], [45, 30, 0], [38, 5, 1.6], [45, 9, 1.6], [26, 2, 0], [16, 8, 0], [24, 24, 3.2],
  ],
  levels: [
    { name: 'mid', at: [16, 8, 0] },
    { name: 'A plateau', at: [38, 5, 1.6] },
    { name: 'catwalk', at: [24, 24, 3.2] },
    { name: 'tower', at: [36, 24, 3.2] },
    { name: 'B platform', at: [6, 44.5, 2.0] },
  ],
};

/**
 * "Depot": an industrial freight yard. Shipping containers you can climb (crate steps), a gantry catwalk that
 * runs through the warehouse doorway to a wooden loft, and a raised loading dock with a ramp.
 */
const CW = 0.12; // thin wall / rail thickness
export const DEPOT: ArenaMap = {
  id: 'depot',
  name: 'Depot',
  w: 56,
  d: 44,
  sky: '#b9b2a0',
  fog: '#a69f8c',
  ground: 'concrete',
  solids: [
    ...perimeter(56, 44, 'metal'),
    // --- warehouse (NE corner, x 34..56, y 0..22): walls with doorways, roof left open to the sky
    box(34, 0, 35, 8, 7, 'plaster'), box(34, 12, 35, 22, 7, 'plaster'), box(34, 8, 35, 12, 7, 'plaster', 5.2),
    box(35, 21, 44, 22, 7, 'plaster'), box(48, 21, 56, 22, 7, 'plaster'), box(44, 21, 48, 22, 7, 'plaster', 3.5),
    // loft (wood deck at 3.3) along the back wall, stairs up from the warehouse floor, rail on its open edge
    box(46, 0, 56, 14, 3.3, 'wood', 3.0),
    ...stairs(40, 0, 46, 3, '+x', 8, 3.3, 'metal'),
    box(48, 14 - CW, 56, 14, 4.3, 'metal', 3.3),
    ...crates(50, 2, 1.2, 1, 3.3), ...crates(53, 9, 1.0, 1, 3.3),
    // warehouse floor cover
    ...crates(38, 14, 1.2, 2), ...crates(39.2, 14, 1.2), ...crates(42, 7, 1.0), box(50, 17, 54, 18, 1.1, 'sandbag'),
    // --- gantry catwalk at 3.3 from the yard, through the warehouse doorway, onto the loft
    box(20, 8.6, 46, 10.2, 3.3, 'metal', 3.0),
    box(20, 8.6, 34, 8.6 + CW, 4.2, 'metal', 3.3),
    box(23, 8.6, 23.3, 8.9, 3.0, 'metal'), box(29, 8.6, 29.3, 8.9, 3.0, 'metal'), box(40, 8.6, 40.3, 8.9, 3.0, 'metal'),
    // --- containers in the yard (2.6 tall); crate steps let you climb onto them
    box(6, 6, 12, 8.5, 2.6, 'container'), ...crates(12, 6, 1.0, 2), ...crates(13, 6, 1.0),
    box(14, 14, 20, 16.5, 2.6, 'container2'), box(20.5, 14, 26.5, 16.5, 2.6, 'container'),
    ...crates(25.5, 16.5, 1.0, 2), ...crates(26.5, 16.5, 1.0),
    box(8, 24, 10.5, 30, 2.6, 'container'), box(8, 24, 10.5, 30, 5.2, 'container2', 2.6),
    box(22, 30, 28, 32.5, 2.6, 'container2'), box(28.5, 30, 34.5, 32.5, 2.6, 'container'), box(28.5, 30, 34.5, 32.5, 5.2, 'container2', 2.6),
    ...crates(21, 30, 1.0, 2), ...crates(21, 31, 1.0),
    box(14, 37, 20, 39.5, 2.6, 'container'),
    // yard cover
    ...crates(3, 16, 1.2, 2), ...crates(4.2, 16, 1.2), ...crates(16, 24, 1.0), ...crates(30, 22, 1.2, 2),
    box(24, 22, 28, 22.8, 0.9, 'sandbag'), box(4, 36, 8, 36.8, 0.9, 'sandbag'),
    // --- loading dock (SE, 1.4 high) with a ramp from the yard
    box(40, 30, 56, 44, 1.4, 'concrete'),
    ...crates(46, 34, 1.2, 1, 1.4), ...crates(50, 38, 1.2, 2, 1.4), box(42, 41, 45, 41.8, 1.4 + 0.9, 'sandbag', 1.4),
  ],
  ramps: [
    { x0: 34, y0: 34, x1: 40, y1: 38, zLow: 0, zHigh: 1.4, dir: '+x', mat: 'concrete' },
    { x0: 12, y0: 8.6, x1: 20, y1: 10.2, zLow: 0, zHigh: 3.3, dir: '+x', mat: 'metal' },
  ],
  spawns: [
    [3, 3, 0], [3, 12, 0], [4, 22, 0], [3, 40, 0], [14, 42, 0], [24, 40, 0], [32, 26, 0], [18, 20, 0],
    [26, 4, 0], [38, 4, 0], [44, 18, 0], [52, 6, 3.3], [48, 36, 1.4], [53, 42, 1.4], [42, 26, 0], [36, 40, 0],
  ],
  levels: [
    { name: 'yard', at: [3, 3, 0] },
    { name: 'container top', at: [17, 15, 2.6] },
    { name: 'catwalk', at: [28, 9.4, 3.3] },
    { name: 'loft', at: [51, 7, 3.3] },
    { name: 'loading dock', at: [48, 40, 1.4] },
    { name: 'warehouse floor', at: [44, 12, 0] },
  ],
};

/**
 * "Office Block": a three-level office around an open atrium. Ground floor lobby and cubicles, a first floor
 * ring of offices with windows looking down into the atrium, and a mezzanine above the north side.
 * Two stairwells link the levels; desks and cubicle partitions are cover.
 */
const F1 = 3.5; // first-floor walking height
const MZ = 6.3; // mezzanine walking height
/** A wall with a row of window openings: solid sill up to `sill`, mullions every `pitch`, header from `head`. */
function windowWall(x0: number, y0: number, x1: number, y1: number, base: number, sill: number, head: number, top: number, pitch = 3): Solid[] {
  const alongX = x1 - x0 > y1 - y0;
  const out: Solid[] = [box(x0, y0, x1, y1, sill, 'drywall', base), box(x0, y0, x1, y1, top, 'drywall', head)];
  const len = alongX ? x1 - x0 : y1 - y0;
  for (let t = 0; t <= len + 1e-6; t += pitch) {
    const a = Math.min(t, len - 0.3);
    out.push(alongX ? box(x0 + a, y0, x0 + a + 0.3, y1, head, 'drywall', sill) : box(x0, y0 + a, x1, y0 + a + 0.3, head, 'drywall', sill));
  }
  return out;
}
const desk = (x: number, y: number, alongX = true): Solid[] => [alongX ? box(x, y, x + 1.6, y + 0.8, 0.8, 'wood') : box(x, y, x + 0.8, y + 1.6, 0.8, 'wood')];
const deskAt = (x: number, y: number, z: number, alongX = true): Solid[] => [alongX ? box(x, y, x + 1.6, y + 0.8, z + 0.8, 'wood', z) : box(x, y, x + 0.8, y + 1.6, z + 0.8, 'wood', z)];
const partition = (x0: number, y0: number, x1: number, y1: number, z = 0): Solid => box(x0, y0, x1, y1, z + 1.4, 'drywall', z);

export const OFFICE: ArenaMap = {
  id: 'office',
  name: 'Office Block',
  w: 44,
  d: 40,
  sky: '#c4b9a2',
  fog: '#b3a88f',
  ground: 'tile',
  solids: [
    ...perimeter(44, 40, 'drywall'),
    // --- first-floor slab (top 3.5) all round the atrium (x 16..28, y 12..28), with a hole over stairwell A
    box(0, 0, 2, 12, F1, 'carpet', F1 - 0.3), box(5, 0, 44, 12, F1, 'carpet', F1 - 0.3), box(2, 0, 5, 2, F1, 'carpet', F1 - 0.3), box(2, 10, 5, 12, F1, 'carpet', F1 - 0.3),
    box(0, 28, 44, 40, F1, 'carpet', F1 - 0.3),
    box(0, 12, 16, 28, F1, 'carpet', F1 - 0.3), box(28, 12, 44, 28, F1, 'carpet', F1 - 0.3),
    // stairwell A: ground floor -> first floor (SW corner)
    ...stairs(2, 2, 5, 10, '+y', 8, F1, 'concrete'),
    // --- atrium walls: ground-floor windows with a doorway on the south side, first-floor windows on south and east
    ...windowWall(16, 12 - CW, 20.5, 12, 0, 1.0, 2.2, F1 - 0.3), ...windowWall(23.5, 12 - CW, 28, 12, 0, 1.0, 2.2, F1 - 0.3),
    box(20.5, 12 - CW, 23.5, 12, F1 - 0.3, 'drywall', 2.4),
    ...windowWall(16, 12 - CW, 28, 12, F1, F1 + 1.0, F1 + 2.2, F1 + 2.8),
    ...windowWall(28, 12, 28 + CW, 28, F1, F1 + 1.0, F1 + 2.2, F1 + 2.8),
    // low railings on the open west and north edges of the first floor
    box(16 - CW, 12, 16, 28, F1 + 1.0, 'metal', F1),
    // --- stairwell B: first floor -> mezzanine (east side)
    ...stairs(40, 20, 43, 28, '+y', 7, MZ, 'concrete', F1),
    box(40 - CW, 20, 40, 28, F1 + 1.1, 'metal', F1),
    // --- mezzanine over the north band, overlooking the atrium
    box(0, 28, 44, 40, MZ, 'wood', MZ - 0.3),
    box(16, 28, 28, 28 + CW, MZ + 1.0, 'metal', MZ),
    ...deskAt(6, 32, MZ), ...deskAt(10, 34, MZ), ...deskAt(30, 33, MZ), ...deskAt(36, 31, MZ, false), box(20, 36, 24, 37, MZ + 1.2, 'crate', MZ),
    // --- ground floor: lobby desk and planters in the atrium, cubicles in the south band, more in the north
    box(20, 22, 24, 23, 1.1, 'wood'), box(17, 26, 18, 27, 0.7, 'sand'), box(26, 14, 27, 15, 0.7, 'sand'),
    ...desk(7, 3), ...desk(10, 3), ...desk(13, 3), partition(6.5, 4.4, 15, 4.5), ...desk(7, 6), ...desk(10, 6), partition(9.7, 3, 9.8, 7),
    ...desk(30, 4), ...desk(34, 4), ...desk(38, 6, false), partition(29.5, 5.6, 37, 5.7), box(32, 8, 36, 9, 1.4, 'crate'),
    ...desk(4, 31), ...desk(8, 33), partition(3, 30, 12, 30.1), ...desk(30, 33), ...desk(34, 31), partition(29, 35, 40, 35.1), ...crates(14, 36, 1.0, 2),
    ...desk(4, 16, false), ...desk(9, 20, false), partition(7, 14, 7.1, 25), ...desk(32, 16, false), ...desk(36, 22, false), partition(35, 14, 35.1, 20),
    // --- first floor: offices with desks and partitions
    ...deskAt(8, 3, F1), ...deskAt(12, 6, F1), partition(6, 5, 16, 5.1, F1), ...deskAt(30, 3, F1), ...deskAt(36, 7, F1, false), partition(33, 2, 33.1, 10, F1),
    ...deskAt(4, 16, F1, false), ...deskAt(10, 22, F1), partition(2, 20, 12, 20.1, F1),
    ...deskAt(31, 16, F1, false), ...deskAt(34, 24, F1), partition(30, 20, 38, 20.1, F1),
    ...deskAt(5, 31, F1), ...deskAt(20, 33, F1), ...deskAt(32, 36, F1), partition(14, 30, 14.1, 37, F1),
  ],
  ramps: [],
  spawns: [
    [3, 14, 0], [8, 9, 0], [22, 18, 0], [18, 25, 0], [26, 25, 0], [40, 9, 0], [40, 26, 0], [3, 37, 0], [24, 33, 0],
    [9, 9, F1], [24, 6, F1], [41, 14, F1], [3, 25, F1], [24, 31, F1], [38, 37, MZ], [3, 37, MZ],
  ],
  levels: [
    { name: 'ground floor', at: [8, 9, 0] },
    { name: 'atrium', at: [22, 18, 0] },
    { name: 'first floor', at: [24, 6, F1] },
    { name: 'first floor north', at: [24, 31, F1] },
    { name: 'mezzanine', at: [38, 37, MZ] },
  ],
};

export const MAPS: Record<string, ArenaMap> = { dunes: DUNES, depot: DEPOT, office: OFFICE };
/** Played in this order when nobody picks the next map. */
export const MAP_ROTATION = ['dunes', 'depot', 'office'];
export const isMapId = (id: unknown): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(MAPS, id);
export const DEFAULT_MAP_ID = 'dunes';
export const mapById = (id: unknown): ArenaMap => (isMapId(id) ? MAPS[id] : MAPS[DEFAULT_MAP_ID]);

/** Builds a flat map from an ASCII grid ('#' = a wall block `h` tall). Handy for tests and quick prototypes. */
export function gridMap(rows: string[], h = 4): ArenaMap {
  const solids: Solid[] = [];
  const spawns: Array<[number, number, number]> = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#') solids.push(box(x, y, x + 1, y + 1, h, 'concrete'));
    else if (c === 'S') spawns.push([x + 0.5, y + 0.5, 0]);
  }));
  return { id: 'grid', name: 'Grid', w: rows[0].length, d: rows.length, solids, ramps: [], spawns, sky: '#888', fog: '#888', ground: 'concrete' };
}
