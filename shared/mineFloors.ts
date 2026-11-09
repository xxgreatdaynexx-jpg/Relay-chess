/**
 * Mine floors (Millionaire Update #13, Dayne): The Mine is now a Stardew-style descent of MAX_FLOOR floors.
 * Floor 1 is the classic tunnel, unchanged (same layout, same ore mix). Every deeper floor is generated from a fixed
 * seed (so every player sees the same floor N), keeps the same spawn pocket / EXIT lift on the left, and has a ladder
 * down at the far right end. Deeper floors shift the mix toward Gold Ore, Crystal and Diamond (no new ore types).
 * The elevator in the lift stops every ELEVATOR_EVERY floors; a stop opens once you've reached that floor.
 * Every cave gets the same descent (Dayne, Nov 4): Frostbite, Magma and the resort's Coral Grotto have MAX_FLOOR floors,
 * an elevator and creatures too, but each keeps its own ore table (Coral-only ores stay Coral-only; no new ores appear).
 */
import { CAVES, CELL, buildCave, caveOf, mineHash, type Cave, type CaveDef, type CaveId, type CaveTheme, type OreId } from './mines.js';

export const MAX_FLOOR = 40;
export const ELEVATOR_EVERY = 5;
/** Ladder-down zone (world units), the dead end at the far right of every floor: cells x 46-47, y 4-7. */
export const LADDER = { x0: 92, y0: 8, x1: 96, y1: 16, cx: 94, cy: 12 };
export const inLadder = (x: number, y: number) => x >= LADDER.x0 && x <= LADDER.x1 && y >= LADDER.y0 && y <= LADDER.y1;
export const clampFloor = (f: unknown) => (typeof f === 'number' && Number.isInteger(f) && f >= 1 && f <= MAX_FLOOR ? f : 1);
export const hasFloors = (cave: CaveId) => cave === 'mine' || cave === 'frost' || cave === 'magma' || cave === 'coral' || cave === 'fortmc' || cave === 'quarry';
/** Map key for per-floor server state: The Mine keeps the bare floor number (back-compat), other caves are 'cave:floor'. */
export const floorKey = (cave: CaveId, floor: number): number | string => (cave === 'mine' ? floor : `${cave}:${floor}`);

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
const GROW: Partial<Record<OreId, number>> = { silver: 0.05, gold: 0.07, gem: 0.15, opal: 0.08, pearl: 0.06, tarrock: 0.04, condensate: 0.08 };
const THIN: Partial<Record<OreId, [number, number]>> = { stone: [0.02, 0.3], copper: [0.02, 0.3], iron: [0.015, 0.4], coal: [0.01, 0.5] };
/** Deeper-floor mix for a non-Mine cave: only ores already in that cave's table (never adds one), common ores thin out,
 *  rich ones grow; Diamond grows only where the cave already has some. */
export function caveFloorBias(cave: CaveId, f: number): Partial<Record<OreId, number>> {
  if (cave === 'quarry') {
    // Only stone, denser deeper — never introduce other ores.
    const stone = 1 + 0.015 * Math.max(0, f - 1);
    return { stone, coal: 0, copper: 0, iron: 0, silver: 0, gold: 0, gem: 0, diamond: 0, opal: 0, pearl: 0, oilsand: 0, shale: 0, tarrock: 0, condensate: 0 };
  }
  if (cave === 'mine') return floorBias(f);
  const base = CAVES[cave].bias; const out: Partial<Record<OreId, number>> = {}; const k = Math.max(0, f - 1);
  for (const [o, v] of Object.entries(base) as Array<[OreId, number]>) {
    if (!v) { out[o] = 0; continue; }
    const t = THIN[o], g = GROW[o];
    out[o] = t ? v * Math.max(t[1], 1 - t[0] * k) : g ? v * (1 + g * k) : o === 'diamond' ? v * (1 + 0.12 * k) : v;
  }
  return out;
}
export function floorBias(f: number): Record<OreId, number> {
  if (f <= 1) return { ...MINE_BIAS };
  const k = f - 1;
  return {
    stone: MINE_BIAS.stone * Math.max(0.3, 1 - 0.02 * k), coal: MINE_BIAS.coal, copper: MINE_BIAS.copper * Math.max(0.3, 1 - 0.02 * k),
    iron: MINE_BIAS.iron * Math.max(0.4, 1 - 0.015 * k), silver: MINE_BIAS.silver * (1 + 0.05 * k), gold: MINE_BIAS.gold * (1 + 0.07 * k),
    gem: MINE_BIAS.gem * (1 + 0.15 * k), diamond: MINE_BIAS.diamond + 0.12 * k,
    opal: 0, pearl: 0, // Coral Grotto exclusives never spawn in the city mine floors
    oilsand: 0, shale: 0, tarrock: 0, condensate: 0, // nor do the Fort McChud Mine's
  };
}

const THEMES: Array<{ upTo: number; name: string; theme: CaveTheme }> = [
  { upTo: 9, name: 'Upper Shafts', theme: CAVES.mine.theme },
  { upTo: 19, name: 'Frozen Seams', theme: { ...CAVES.frost.theme } },
  { upTo: 29, name: 'Molten Veins', theme: { ...CAVES.magma.theme } },
  { upTo: MAX_FLOOR, name: 'The Abyss', theme: { sky: '#07040d', fog: '#0d0618', ambient: '#8a6ab8', wall: '#4a3a62', floor: '#2a2038', lamp: '#b070ff', hazard: 'lava' } },
];
export const bandOf = (f: number) => THEMES.find((t) => f <= t.upTo) ?? THEMES[THEMES.length - 1];
const dim = (hex: string, k: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const CAVE_BANDS: Record<Exclude<CaveId, 'mine'>, [string, string, string]> = {
  frost: ['Frost Halls', 'Glacier Deeps', 'Frozen Core'], magma: ['Lava Tubes', 'Ember Vaults', 'Magma Heart'], coral: ['Tide Pools', 'Kelp Trenches', 'The Sunken Deep'], fortmc: ['Upper Drifts', 'Tar Galleries', 'The Sour Pit'], quarry: ['Cut Face', 'Bench Levels', 'Deep Cut'],
};
/** Band (name + look) for floor f of any cave: The Mine uses its own bands; other caves keep their look, darker deeper, Abyss at the bottom. */
export function caveBandOf(cave: CaveId, f: number): { name: string; theme: CaveTheme } {
  if (cave === 'mine') return bandOf(f);
  const t = CAVES[cave].theme, names = CAVE_BANDS[cave];
  if (f >= 30) return { name: 'The Abyss', theme: THEMES[THEMES.length - 1].theme };
  const i = f <= 9 ? 0 : f <= 19 ? 1 : 2, k = [1, 0.78, 0.6][i];
  return { name: names[i], theme: { ...t, ambient: dim(t.ambient, k), wall: dim(t.wall, k), floor: dim(t.floor, k) } };
}

const W = 50, D = 12;
/** Generated rows for floor f >= 2. Fully connected from the spawn pocket; the ladder cells are always open. */
export function floorRows(f: number, cave: CaveId = 'mine'): string[] {
  const base = CAVES[cave].rows; const seed = cave === 'mine' ? 0 : ({ frost: 1, magma: 2, coral: 3, fortmc: 4, quarry: 5 } as const)[cave] * 1_000_003;
  const open0 = cave === 'mine' ? 8 : 3; // other caves' spawn pockets are walled in differently: always cut the corridor out of the pocket
  const g: string[][] = Array.from({ length: D }, () => Array(W).fill('#'));
  const r = (n: number) => mineHash(f * 7919 + n + seed);
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
    for (const yy of [cy, cy + 1]) { if (x >= open0) g[yy][x] = '.'; path.add(`${x},${yy}`); }
  }
  for (let y = 3; y <= 8; y++) for (const x of [46, 47]) { g[y][x] = '.'; path.add(`${x},${y}`); }
  // hazards (lava / ice) off the corridor, more on deeper floors
  const hz = caveBandOf(cave, f).theme.hazard ? 0.04 + f * 0.001 : 0;
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
  if (f === 1) lvl = { ...caveOf(cave), floor: 1, band: cave === 'mine' ? THEMES[0].name : CAVE_BANDS[cave as Exclude<CaveId, 'mine'>][0] };
  else {
    const band = caveBandOf(cave, f); const src = CAVES[cave];
    const def: CaveDef = { ...src, name: `${src.name} · Floor ${f}`, rows: floorRows(f, cave), depthX: f >= 10 ? [0, 0, 0, 0] : [0, 0, 12, 24], bias: cave === 'mine' ? floorBias(f) : caveFloorBias(cave, f), density: Math.min(0.55, src.density + f * 0.003), theme: band.theme };
    const built = buildCave(def, f * 100_003 + (cave === 'mine' ? 0 : cave.length * 7_777_777 + cave.charCodeAt(0)));
    lvl = { ...def, ...built, floor: f, band: band.name };
  }
  cache.set(key, lvl);
  return lvl;
}
export const CELL_SIZE = CELL;
