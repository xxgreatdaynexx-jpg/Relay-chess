/**
 * Mine floors (Millionaire Update #13, Dayne): The Mine is now a Stardew-style descent of MAX_FLOOR floors.
 * Floor 1 is the classic tunnel, unchanged (same layout, same ore mix). Every deeper floor is generated from a fixed
 * seed (so every player sees the same floor N), keeps the same spawn pocket / EXIT lift on the left, and has a ladder
 * down at the far right end. Deeper floors shift the mix toward Gold Ore, Crystal and Diamond (no new ore types).
 * The elevator in the lift stops every ELEVATOR_EVERY floors; a stop opens once you've reached that floor.
 * Other caves (Frostbite, Magma, Coral) are single-floor, as before.
 */
import { CAVES, CELL, buildCave, caveOf, mineHash, type Cave, type CaveDef, type CaveId, type CaveTheme, type OreId } from './mines.js';

export const MAX_FLOOR = 40;
export const ELEVATOR_EVERY = 5;
/** Ladder-down zone (world units), the dead end at the far right of every floor: cells x 46-47, y 4-7. */
export const LADDER = { x0: 92, y0: 8, x1: 96, y1: 16, cx: 94, cy: 12 };
export const inLadder = (x: number, y: number) => x >= LADDER.x0 && x <= LADDER.x1 && y >= LADDER.y0 && y <= LADDER.y1;
export const clampFloor = (f: unknown) => (typeof f === 'number' && Number.isInteger(f) && f >= 1 && f <= MAX_FLOOR ? f : 1);
export const hasFloors = (cave: CaveId) => cave === 'mine';

/** Elevator stops open for a player whose deepest floor reached is `deepest`: 1, 5, 10, ... up to deepest. */
export function elevatorStops(deepest: number): number[] {
  const out = [1];
  for (let f = ELEVATOR_EVERY; f <= Math.min(MAX_FLOOR, deepest); f += ELEVATOR_EVERY) out.push(f);
  return out;
}
export const canRideTo = (to: number, deepest: number) => elevatorStops(deepest).includes(to);
/** Where you wake up after dying on `floor`: the nearest elevator stop at or above it. */
export const respawnFloor = (floor: number) => Math.max(1, Math.floor(floor / ELEVATOR_EVERY) * ELEVATOR_EVERY);

const MINE_BIAS = CAVES.mine.bias as Record<OreId, number>;
/** Ore bias for floor f: stone thins out, Silver/Gold/Crystal grow, Iron thins slowly, Diamond grows fastest. Floor 1 = the classic mix. */
export function floorBias(f: number): Record<OreId, number> {
  if (f <= 1) return { ...MINE_BIAS };
  const k = f - 1;
  return {
    stone: MINE_BIAS.stone * Math.max(0.3, 1 - 0.02 * k), coal: MINE_BIAS.coal, copper: MINE_BIAS.copper * Math.max(0.3, 1 - 0.02 * k),
    iron: MINE_BIAS.iron * Math.max(0.4, 1 - 0.015 * k), silver: MINE_BIAS.silver * (1 + 0.05 * k), gold: MINE_BIAS.gold * (1 + 0.07 * k),
    gem: MINE_BIAS.gem * (1 + 0.15 * k), diamond: MINE_BIAS.diamond + 0.12 * k,
    opal: 0, pearl: 0, // Coral Grotto exclusives never spawn in the city mine floors
  };
}

const THEMES: Array<{ upTo: number; name: string; theme: CaveTheme }> = [
  { upTo: 9, name: 'Upper Shafts', theme: CAVES.mine.theme },
  { upTo: 19, name: 'Frozen Seams', theme: { ...CAVES.frost.theme } },
  { upTo: 29, name: 'Molten Veins', theme: { ...CAVES.magma.theme } },
  { upTo: MAX_FLOOR, name: 'The Abyss', theme: { sky: '#07040d', fog: '#0d0618', ambient: '#8a6ab8', wall: '#4a3a62', floor: '#2a2038', lamp: '#b070ff', hazard: 'lava' } },
];
export const bandOf = (f: number) => THEMES.find((t) => f <= t.upTo) ?? THEMES[THEMES.length - 1];

const W = 50, D = 12;
/** Generated rows for floor f >= 2. Fully connected from the spawn pocket; the ladder cells are always open. */
export function floorRows(f: number): string[] {
  const base = CAVES.mine.rows;
  const g: string[][] = Array.from({ length: D }, () => Array(W).fill('#'));
  const r = (n: number) => mineHash(f * 7919 + n);
  // spawn pocket: columns 0-7 copied from the classic tunnel
  for (let y = 0; y < D; y++) for (let x = 0; x < 8; x++) g[y][x] = base[y][x];
  // random chambers, then one smoothing pass for a cave look
  for (let y = 1; y < D - 1; y++) for (let x = 8; x < W - 2; x++) if (r(y * 97 + x) < 0.5) g[y][x] = '.';
  const snap = g.map((row) => row.slice());
  for (let y = 1; y < D - 1; y++) for (let x = 8; x < W - 2; x++) {
    let open = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (snap[y + dy][x + dx] !== '#') open++;
    g[y][x] = open >= 5 ? '.' : '#';
  }
  // a guaranteed winding corridor (2 tall) from the pocket to the ladder
  let cy = 4; const path = new Set<string>();
  for (let x = 4; x <= 47; x++) {
    if (x > 8 && x < 44) { const t = r(5000 + x); if (t < 0.25 && cy > 2) cy--; else if (t > 0.75 && cy < 8) cy++; }
    if (x >= 44) cy += cy < 4 ? 1 : cy > 4 ? -1 : 0;
    for (const yy of [cy, cy + 1]) { if (x >= 8) g[yy][x] = '.'; path.add(`${x},${yy}`); }
  }
  for (let y = 3; y <= 8; y++) for (const x of [46, 47]) { g[y][x] = '.'; path.add(`${x},${y}`); }
  // hazards (lava / ice) off the corridor, more on deeper floors
  const hz = bandOf(f).theme.hazard ? 0.04 + f * 0.001 : 0;
  for (let y = 1; y < D - 1; y++) for (let x = 10; x < 44; x++) if (g[y][x] === '.' && !path.has(`${x},${y}`) && r(9000 + y * 97 + x) < hz) g[y][x] = '~';
  // anything not reachable from the spawn pocket is filled in (keeps "every open cell is reachable")
  const seen = new Set<string>(); const q: Array<[number, number]> = [[2, 3]];
  while (q.length) { const [x, y] = q.pop()!; const k = `${x},${y}`; if (seen.has(k) || x < 0 || y < 0 || x >= W || y >= D) continue; if (g[y][x] === '#' || g[y][x] === '~') continue; seen.add(k); q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
  for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) if (g[y][x] !== '#' && g[y][x] !== '~' && !seen.has(`${x},${y}`)) g[y][x] = '#';
  return g.map((row) => row.join(''));
}

export interface Level extends Cave { floor: number; band: string }
const cache = new Map<string, Level>();
/** The playable level for a cave + floor. Floor 1 (and every non-Mine cave) is exactly CAVES[cave]. */
export function levelOf(cave: CaveId, floor = 1): Level {
  const f = hasFloors(cave) ? clampFloor(floor) : 1;
  const key = `${cave}:${f}`;
  const hit = cache.get(key); if (hit) return hit;
  let lvl: Level;
  if (f === 1) lvl = { ...caveOf(cave), floor: 1, band: hasFloors(cave) ? THEMES[0].name : caveOf(cave).name };
  else {
    const band = bandOf(f);
    const def: CaveDef = { ...CAVES.mine, name: `The Mine · Floor ${f}`, rows: floorRows(f), depthX: f >= 10 ? [0, 0, 0, 0] : [0, 0, 12, 24], bias: floorBias(f), density: Math.min(0.55, 0.42 + f * 0.003), theme: band.theme };
    const built = buildCave(def, f * 100_003);
    lvl = { ...def, ...built, floor: f, band: band.name };
  }
  cache.set(key, lvl);
  return lvl;
}
export const CELL_SIZE = CELL;
