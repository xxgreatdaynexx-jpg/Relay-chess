/**
 * Data-driven 3D arena maps. A map is a list of axis-aligned solids (boxes) and ramps on a flat
 * ground plane at z = 0. Coordinates: x/y are the horizontal plane (same as the old 2D arena),
 * z is up. One unit is roughly one metre; a player is 1.7 tall.
 *
 * Adding a map = adding a new ArenaMap definition to MAPS. Physics, hit detection, spawns,
 * the minimap and the 3D renderer all read the same data.
 */

export type Material = 'sand' | 'plaster' | 'concrete' | 'crate' | 'metal' | 'sandbag' | 'wood';

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
}

// ---- tiny builders so map definitions stay readable
const box = (x0: number, y0: number, x1: number, y1: number, z1: number, mat: Material, z0 = 0): Solid => ({ x0, y0, x1, y1, z0, z1, mat });
/** A cube crate (size s) at (x,y) corner, stacked `n` high. */
const crates = (x: number, y: number, s: number, n = 1, z = 0): Solid[] =>
  Array.from({ length: n }, (_, i) => box(x, y, x + s, y + s, z + s * (i + 1), 'crate', z + s * i));
/** Straight stairs: `n` steps of `rise` from z=base, each `run` deep, going in `dir` starting at the given edge. */
function stairs(x0: number, y0: number, x1: number, y1: number, dir: Ramp['dir'], n: number, top: number, mat: Material = 'concrete'): Solid[] {
  const out: Solid[] = [];
  const along = dir === '+x' || dir === '-x' ? x1 - x0 : y1 - y0;
  const run = along / n;
  for (let i = 0; i < n; i++) {
    const h = (top * (i + 1)) / n;
    // step i occupies the slice that is i steps up the stairs (and everything uphill of it is higher)
    if (dir === '+x') out.push(box(x0 + run * i, y0, x0 + run * (i + 1), y1, h, mat));
    if (dir === '-x') out.push(box(x1 - run * (i + 1), y0, x1 - run * i, y1, h, mat));
    if (dir === '+y') out.push(box(x0, y0 + run * i, x1, y0 + run * (i + 1), h, mat));
    if (dir === '-y') out.push(box(x0, y1 - run * (i + 1), x1, y1 - run * i, h, mat));
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
    ...crates(33, 3, 1.2, 2), ...crates(34.2, 3, 1.2), ...crates(40, 6, 1.2), box(37, 9, 41, 9.8, 1.6 + 0.9, 'sandbag', 1.6),
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
};

export const MAPS: Record<string, ArenaMap> = { dunes: DUNES };
export const DEFAULT_MAP_ID = 'dunes';
export const mapById = (id: unknown): ArenaMap => (typeof id === 'string' && MAPS[id]) || MAPS[DEFAULT_MAP_ID];

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
