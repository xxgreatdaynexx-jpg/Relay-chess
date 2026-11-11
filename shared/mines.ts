/**
 * Mines: a shared first-person cave (same physics as Arena: shared/fps.ts) where players mine ore and sell it.
 * Items are generic stacks { type, id, qty } (type 'ore' now; 'bar' / 'good' for the Factory), never skins.
 */
import type { ArenaMap, Solid } from './arenaMaps.js';
import { foodInfo } from './cooking.js';

/** 'food' = cooking ingredients (groceries + crops harvested to the pantry): Market-tradeable, never house-sold. */
export type ItemType = 'ore' | 'bar' | 'good' | 'food';
export type OreId = 'stone' | 'coal' | 'copper' | 'iron' | 'silver' | 'gold' | 'gem' | 'diamond' | 'opal' | 'pearl' | 'oilsand' | 'shale' | 'tarrock' | 'condensate';
export interface OreDef { id: OreId; name: string; hits: number; respawnMs: number; /** house price per unit, in chips (fractional: stone is 1 chip per 10) */ price: number; color: string; weight: number; minDepth: number; spawnWeight: number; /** resort-only (#10d): spawns only in caves whose bias lists it */ exclusive?: boolean }

export const ORES: Record<OreId, OreDef> = {
  stone:   { id: 'stone',   name: 'Stone',      hits: 2,  respawnMs: 150_000,  price: 0.1, color: '#8a8580', weight: 1, minDepth: 0, spawnWeight: 40 },
  coal:    { id: 'coal',    name: 'Coal',       hits: 3,  respawnMs: 250_000,  price: 1,   color: '#2b2b2e', weight: 1, minDepth: 0, spawnWeight: 22 },
  copper:  { id: 'copper',  name: 'Copper Ore', hits: 4,  respawnMs: 450_000,  price: 2,   color: '#c4733b', weight: 1, minDepth: 0, spawnWeight: 16 },
  iron:    { id: 'iron',    name: 'Iron Ore',   hits: 5,  respawnMs: 360_000,  price: 4,   color: '#a98f7f', weight: 1, minDepth: 1, spawnWeight: 12 },
  silver:  { id: 'silver',  name: 'Silver Ore', hits: 6,  respawnMs: 1_200_000,  price: 8,   color: '#d5dbe2', weight: 1, minDepth: 1, spawnWeight: 7 },
  gold:    { id: 'gold',    name: 'Gold Ore',   hits: 7,  respawnMs: 1_800_000, price: 15,  color: '#f0c23a', weight: 1, minDepth: 2, spawnWeight: 5 },
  gem:     { id: 'gem',     name: 'Crystal',    hits: 9,  respawnMs: 3_000_000, price: 40,  color: '#b04df0', weight: 1, minDepth: 2, spawnWeight: 2.5 },
  diamond: { id: 'diamond', name: 'Diamond',    hits: 12, respawnMs: 4_800_000, price: 150, color: '#7ff3ff', weight: 1, minDepth: 3, spawnWeight: 0.6 },
  opal:    { id: 'opal',    name: 'Fire Opal',     hits: 10, respawnMs: 3_600_000, price: 60, color: '#ff6a3a', weight: 1, minDepth: 1, spawnWeight: 1.6, exclusive: true },
  pearl:   { id: 'pearl',   name: 'Abyssal Pearl', hits: 11, respawnMs: 4_200_000, price: 90, color: '#e8f0ff', weight: 1, minDepth: 2, spawnWeight: 1, exclusive: true },
  // Fort McChud Mine only (Nov 4): industrial ores. Unloaded at the fort they become plant feedstock (FORT_FEED, shared/fortmc.ts).
  oilsand:    { id: 'oilsand',    name: 'Oil Sand',       hits: 4, respawnMs: 400_000,   price: 5, color: '#3b2f22', weight: 1, minDepth: 0, spawnWeight: 14, exclusive: true },
  shale:      { id: 'shale',      name: 'Gas Shale',      hits: 5, respawnMs: 600_000,   price: 3, color: '#5f6b70', weight: 1, minDepth: 0, spawnWeight: 10, exclusive: true },
  tarrock:    { id: 'tarrock',    name: 'Tar Rock',       hits: 6, respawnMs: 900_000,   price: 4, color: '#1c1714', weight: 1, minDepth: 1, spawnWeight: 6, exclusive: true },
  condensate: { id: 'condensate', name: 'Condensate Geode', hits: 9, respawnMs: 2_400_000, price: 12, color: '#b48aff', weight: 1, minDepth: 2, spawnWeight: 2, exclusive: true },
};
export const ORE_ORDER: OreId[] = ['stone', 'coal', 'copper', 'iron', 'silver', 'gold', 'gem', 'diamond', 'opal', 'pearl', 'oilsand', 'shale', 'tarrock', 'condensate'];
export const isOre = (v: unknown): v is OreId => typeof v === 'string' && v in ORES;

// ---- mining rules (server-checked)
export const REACH = 3.0;          // eye -> node surface
export const NODE_R = 0.55;        // node "radius" (reach is measured to its centre minus this)
export const SWING_MS = 450;       // client swing period
export const SWING_MIN_MS = 380;   // server minimum between accepted hits (latency slack)
export const MAX_HITS_PER_10S = 26; // hard rate limit
/** Sanity limit per banked stack (market purchases and factory output chests both respect it). */
export const MAX_BANKED_STACK = 1_000_000;
export const BACKPACK_CAP = 120;   // total weight units

// ---- house selling: daily diminishing returns (per signed-in player, per UTC day)
/** House daily cap in base chips (pt1396u, restored to 100,000 in pt1398u): full price up to 100,000 base a day, then nothing. Payouts are × the daily price
 * index, so the effective chip cap is 100,000 × index and rises with inflation each UTC day. */
export const HOUSE_DAILY_BASE = 100_000;
export const houseCapChips = (index: number) => Math.floor(HOUSE_DAILY_BASE * index);
/** House-sell cap (pt1442u) follows total player assets, not the price index: capIndex = cap / 100K. Sales are tracked
 * in base units (chips / price index), so the cap in base units is 100K x capIndex / priceIndex. */
export const houseCapBase = (capIndex: number, priceIdx: number) => (HOUSE_DAILY_BASE * (capIndex > 0 ? capIndex : 1)) / (priceIdx > 0 ? priceIdx : 1);
export const SELL_TIERS: Array<{ upTo: number; rate: number }> = [{ upTo: HOUSE_DAILY_BASE, rate: 1 }, { upTo: Infinity, rate: 0 }];
export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Chips paid for `gross` full-price value when `already` gross was sold today. Fractions floor at the end. */
export function payoutFor(gross: number, already: number, cap: number = HOUSE_DAILY_BASE): number {
  let left = gross, at = already, pay = 0, lo = -Infinity; // already < 0 (sink room, pt1405u) widens the first tier
  const tiers = cap === HOUSE_DAILY_BASE ? SELL_TIERS : [{ upTo: cap, rate: 1 }, { upTo: Infinity, rate: 0 }];
  for (const t of tiers) {
    if (left <= 0) break;
    const room = Math.max(0, t.upTo - Math.max(at, lo));
    const take = Math.min(left, room);
    pay += take * t.rate; left -= take; at += take; lo = t.upTo;
  }
  return Math.floor(pay + 1e-9);
}

// ---- map: a long cave running +x (deeper = rarer), with side chambers. Each grid cell is CELL units.
export const CELL = 2;
export const CEIL = 4.2;
const ROWS = [
  '##################################################',
  '#######.....####......######......####.....#######',
  '#SS.....###.....##.......##...........##.......###',
  '#S......###..........###.......###..............##',
  '#SS..........##..........##.........###.....##..##',
  '####.....######.....######......####.....#####..##',
  '#####...#######....#######.....#####....######..##',
  '####.....######.....######......####.....#####..##',
  '###.......###.........##..........##.........#..##',
  '###.......###.....##........##..........##......##',
  '####....................##.........##...........##',
  '##################################################',
];
export const DEPTH_X = [0, 12, 24, 36]; // cell-x where depth tier 0..3 starts

export interface MineNode { id: number; x: number; y: number; z: number; ore: OreId; depth: number }

function hash(n: number): number { let h = Math.imul(n, 2654435761) >>> 0; h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0; return h / 2 ** 32; }

export const mineHash = (n: number) => hash(n);
export function depthAt(x: number): number { const cx = x / CELL; let d = 0; for (let i = 0; i < DEPTH_X.length; i++) if (cx >= DEPTH_X[i]) d = i; return d; }

/** Ore for a node slot: weighted among ores unlocked at this depth; rarer ores get a boost deeper. */
export function oreFor(depth: number, r: number, bias: Partial<Record<OreId, number>> = {}, anyDepth: OreId[] = []): OreId {
  const pool = ORE_ORDER.filter((o) => (!ORES[o].exclusive || bias[o] != null) && (ORES[o].minDepth <= depth || anyDepth.includes(o))).map((o) => [o, (bias[o] ?? 1) * ORES[o].spawnWeight * (ORES[o].minDepth > 0 ? 1 + depth * 0.5 : 1) * (o === 'stone' ? Math.max(0.4, 1 - depth * 0.2) : 1)] as const);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let t = r * total;
  for (const [o, w] of pool) { t -= w; if (t <= 0) return o; }
  return pool[pool.length - 1][0];
}

// ---- caves (pt1201u): three mines on the city outskirts, one engine. Same spawn pocket / EXIT lift in each,
// different layout, ore mix and look. '~' is a hazard (lava pool / ice pillar): impassable, rendered per theme.
export type CaveId = 'mine' | 'frost' | 'magma' | 'coral' | 'fortmc' | 'quarry';
export interface CaveTheme { sky: string; fog: string; ambient: string; wall: string; floor: string; lamp: string; hazard: 'lava' | 'ice' | null }
export interface CaveDef { id: CaveId; name: string; blurb: string; rows: string[]; depthX: number[]; bias: Partial<Record<OreId, number>>; /** signature ores allowed from the first section on (ignore minDepth) */ anyDepth?: OreId[]; density: number; theme: CaveTheme }
export const CAVE_DEFS: CaveDef[] = [
  { id: 'mine', name: 'The Mine', blurb: 'The classic shaft: one long tunnel. Mostly Iron Ore, Stone & Gold Ore. Deeper is richer.', rows: ROWS, depthX: DEPTH_X, bias: { stone: 1.184, coal: 0.013, copper: 0.733, iron: 11.173, silver: 1.55, gold: 6.959, gem: 2.862, diamond: 0.013 }, density: 0.42,
    theme: { sky: '#07070a', fog: '#0b0a0d', ambient: '#8a7a6a', wall: '#9a8f86', floor: '#6e6258', lamp: '#ff9a40', hazard: null } },
  { id: 'frost', name: 'Frostbite Caverns', anyDepth: ['silver'], blurb: 'Wide frozen halls and ice pillars. Mostly Silver Ore, with some Crystal.', depthX: [0, 12, 24, 36], density: 0.4,
    bias: { stone: 1.177, coal: 0.038, copper: 0.081, iron: 2.5, silver: 16.959, gold: 0.007, gem: 0.424, diamond: 0.063 },
    theme: { sky: '#060b14', fog: '#0a1626', ambient: '#8fb4d8', wall: '#9ec4dc', floor: '#c8dceb', lamp: '#8fd8ff', hazard: 'ice' },
    rows: [
      '##################################################',
      '#####.......~~.......####........~.........#######',
      '#SS.......................##.................~..##',
      '#S.....~.......~~.....~......~~........~.........#',
      '#SS........~.........~~..........##......~~......#',
      '####...........~...........~...........~.........#',
      '#####..~~......................~~.........~.....##',
      '####.......~.........~~.............~...........##',
      '###...~~.........~..........~~..........##......##',
      '###..........~~.........~...........~.........####',
      '####......................~~...........~......####',
      '##################################################',
    ] },
  { id: 'magma', name: 'Magma Depths', blurb: 'A winding, narrow lava tube with pools you can’t cross. Mostly Coal & Copper Ore.', depthX: [0, 12, 24, 36], density: 0.46,
    bias: { stone: 0.379, coal: 3.07, copper: 5.425, iron: 0.745, silver: 0.114, gold: 0.008, gem: 1.959, diamond: 1.394 },
    theme: { sky: '#120604', fog: '#1a0703', ambient: '#a86a4a', wall: '#5a3a32', floor: '#3a2622', lamp: '#ff6a20', hazard: 'lava' },
    rows: [
      '##################################################',
      '####...~~...######.........####.......~~##########',
      '#SS.........######..######..####..##....###.....##',
      '#S....###...######..######..........##..###....~##',
      '#SS...###...........######..####....##.........~##',
      '###########.####.##########.####.######.####.#####',
      '###########.####.##########......######.####.#####',
      '####.........###...........####...........##...###',
      '####..#####..###.###########..##.######...##.#.###',
      '####..#####......###.......................#.#..##',
      '####........~###.....######.###....~~###.....#.~##',
      '##################################################',
    ] },
  // Stone Quarry (chessguy2): north of the Big Farms, stone only; workers allowed (ordinary miner job).
  { id: 'quarry', name: 'Stone Quarry', blurb: 'A cut-stone pit north of the Big Farms (top-right). Only Stone — steady supply for community projects. Hire a Miner · Stone Quarry at the Employment Office.', depthX: DEPTH_X, density: 0.55,
    bias: { stone: 1, coal: 0, copper: 0, iron: 0, silver: 0, gold: 0, gem: 0, diamond: 0 },
    theme: { sky: '#0a0a0c', fog: '#121214', ambient: '#a8a098', wall: '#8a8580', floor: '#6e6a64', lamp: '#d8c8a0', hazard: null },
    rows: [
      '##################################################',
      '#######............######............######.######',
      '#SS......................##......................##',
      '#S.........####.................####..............#',
      '#SS........####.................####..............#',
      '####..............####.................####.......#',
      '#####.............####.................####.......#',
      '####.......####..............####.................#',
      '###........####..............####..........####...#',
      '###.................####...................####...#',
      '####...............####..........................##',
      '##################################################',
    ] },
  // Chud Resort only (server-gated on location): a sea cave under the volcano. Wide open grottos (no single-tile
  // corridors), coral pillars '~' as the hazard. Rich in gems and gold, light on coal.
  { id: 'coral', name: 'Coral Grotto', blurb: 'A turquoise sea cave under the resort volcano. Premium haul: Gold Ore, Crystal and Diamond, plus two ores found nowhere else, Fire Opal and Abyssal Pearl.', depthX: [0, 12, 24, 36], density: 0.4,
    bias: { stone: 0.7, coal: 0.45, copper: 0.85, silver: 1.4, gold: 1.4, gem: 1.3, diamond: 0.8, opal: 1.3, pearl: 2 },
    theme: { sky: '#03141a', fog: '#06303a', ambient: '#7fe0e0', wall: '#e89a8a', floor: '#e8d8b0', lamp: '#7ff0ff', hazard: 'ice' },
    rows: [
      '##################################################',
      '####.......####.........~.......####......########',
      '#SS.................~..............~..........####',
      '#S......~.......####.......~~.........####.....###',
      '#SS.............####...............~..####......##',
      '###.....~~..........~......####...........~.....##',
      '####..........~.............##........~~........##',
      '###.....####.........~~...........~.............##',
      '###.....####....~..........####..........~~....###',
      '####.........~.............####.....~..........###',
      '#####.......~~......~................####...######',
      '##################################################',
    ] },
  // Fort McChud only (server-gated on location): an oil-sands shaft under the boomtown. Steel-braced drifts, pipe
  // runs '~' as the hazard. Industrial ores (oil sand, gas shale, tar rock, condensate) feed the fort's plant.
  { id: 'fortmc', name: 'Fort McChud Mine', blurb: 'An oil-sands shaft under the boomtown. Oil Sand, Gas Shale, Tar Rock and Condensate Geodes (unload them at the fort to feed your refinery, gas plant, coker and steam cracker), plus Coal, Iron and Copper Ore.', depthX: [0, 12, 24, 36], density: 0.44,
    bias: { stone: 0.8, coal: 1.2, copper: 0.7, iron: 1.1, silver: 0.3, gold: 0.15, gem: 0.2, oilsand: 1.4, shale: 1.3, tarrock: 1.2, condensate: 1.1 },
    theme: { sky: '#0c0a06', fog: '#17130c', ambient: '#b0a080', wall: '#6a5a44', floor: '#3e3428', lamp: '#ffd040', hazard: 'lava' },
    rows: [
      '##################################################',
      '####......####.............####.......####...#####',
      '#SS.................~..........................###',
      '#S......####...........####..............##.....##',
      '#SS.....####...........####..............##.....##',
      '####...............##...............####.....~..##',
      '#####..............##...........................##',
      '####.....####.............####.......####.......##',
      '###......####.............####..................##',
      '###...............####...................####..###',
      '####..............####.........................###',
      '##################################################',
    ] },
];
/** window event (detail = CaveId) the world map fires to open a given mine. */
export const MINE_CAVE_EVENT = 'relay-mine-cave';
export const isCave = (v: unknown): v is CaveId => v === 'mine' || v === 'frost' || v === 'magma' || v === 'coral' || v === 'fortmc' || v === 'quarry';

/** Exported for the floor generator (shared/mineFloors.ts). `seed` shifts the node hash so generated floors don't repeat. */
export function buildCave(def: CaveDef, seed0 = 0): { map: ArenaMap; nodes: MineNode[] } {
  const ROWS = def.rows.map((r) => r.padEnd(def.rows[0].length, '#'));
  const solids: Solid[] = [];
  const spawns: Array<[number, number, number]> = [];
  const W = ROWS[0].length, D = ROWS.length;
  const wall = (x: number, y: number) => y < 0 || y >= D || x < 0 || x >= W || ROWS[y][x] === '#' || ROWS[y][x] === '~';
  ROWS.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#') solids.push({ x0: x * CELL, y0: y * CELL, x1: (x + 1) * CELL, y1: (y + 1) * CELL, z0: 0, z1: CEIL + 1, mat: 'concrete' });
    else if (c === '~') solids.push({ x0: x * CELL, y0: y * CELL, x1: (x + 1) * CELL, y1: (y + 1) * CELL, z0: 0, z1: CEIL + 1, mat: 'metal' });
    else if (c === 'S') spawns.push([x * CELL + 1, y * CELL + 1, 0]);
  }));
  // ceiling slab over the whole cave
  solids.push({ x0: 0, y0: 0, x1: W * CELL, y1: D * CELL, z0: CEIL, z1: CEIL + 1, mat: 'concrete' });
  const nodes: MineNode[] = [];
  let id = 0;
  const depthOf = (x: number) => { const cx = x / CELL; let d = 0; for (let i = 0; i < def.depthX.length; i++) if (cx >= def.depthX[i]) d = i; return d; };
  ROWS.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#' || c === '~' || c === 'S' || x < 3) return;
    const adj: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => wall(x + dx, y + dy)) as Array<[number, number]>;
    if (!adj.length) return;
    const seed = x * 131 + y * 17 + seed0;
    if (hash(seed) > def.density) return;
    const [dx, dy] = adj[Math.floor(hash(seed + 7) * adj.length)];
    // sit against the wall, half embedded
    const nx = x * CELL + 1 + dx * 0.75, ny = y * CELL + 1 + dy * 0.75;
    const depth = depthOf(nx);
    const nz = 0.35 + hash(seed + 3) * 1.4;
    nodes.push({ id: id++, x: nx, y: ny, z: nz, ore: oreFor(depth, hash(seed + 11), def.bias, def.anyDepth), depth });
  }));
  const map: ArenaMap = { id: def.id === 'mine' ? 'mine' : `mine-${def.id}`, name: def.name, w: W * CELL, d: D * CELL, solids, ramps: [], spawns, sky: def.theme.sky, fog: def.theme.fog, ground: 'sand' };
  return { map, nodes };
}

/** Each cave's main ores, by the names players see (pt1357u): mine picker, map tiles, job list. */
export const CAVE_MAIN_ORES: Record<CaveId, string> = { mine: 'Iron Ore, Stone & Gold Ore', frost: 'Silver Ore & Crystal', magma: 'Coal & Copper Ore', coral: 'Mixed ores', fortmc: 'Oil Sand, Gas Shale & Tar Rock', quarry: 'Stone only' };

export interface Cave extends CaveDef { map: ArenaMap; nodes: MineNode[] }
export const CAVES: Record<CaveId, Cave> = Object.fromEntries(CAVE_DEFS.map((d) => [d.id, { ...d, ...buildCave(d) }])) as Record<CaveId, Cave>;
export const caveOf = (id: unknown): Cave => CAVES[isCave(id) ? id : 'mine'];
export const MINE_MAP: ArenaMap = CAVES.mine.map;
export const MINE_NODES: MineNode[] = CAVES.mine.nodes;
/** Average house value of one node's ore (balance check across caves). */
export function caveNodeValue(c: Cave): number {
  const ev = (depth: number) => { const pool = ORE_ORDER.filter((o) => ORES[o].minDepth <= depth); const w = pool.map((o) => (c.bias[o] ?? 1) * ORES[o].spawnWeight); const t = w.reduce((a, b) => a + b, 0); return pool.reduce((a, o, i) => a + (w[i] / t) * ORES[o].price, 0); };
  return c.nodes.reduce((t, n) => t + ev(n.depth), 0) / Math.max(1, c.nodes.length);
}
/** Expected house value per minute a cave pays out (all nodes on respawn cycle) — used to keep the three caves balanced. */
export function caveValueRate(c: Cave): number { return caveNodeValue(c) * c.nodes.length; }

export interface Stack { type: ItemType; id: string; qty: number }
export const stackKey = (s: { type: ItemType; id: string }) => `${s.type}:${s.id}`;

// ---------------------------------------------------------------- Factory (stage 2)
// Bars ('bar') and crafted goods ('good') live in the same generic stack table as ore.
export type MachineId = 'furnace' | 'workbench';
export interface ItemDef { type: ItemType; id: string; name: string; price: number; color: string; /** imported raw input (crops, fish): valued for recipes, never sold raw to the house */ raw?: true; /** food: crafting it gives Cooking XP instead of Engineering */ food?: true }
export interface Recipe { id: string; machine: MachineId; name: string; in: Array<{ type: ItemType; id: string; qty: number }>; out: { type: ItemType; id: string; qty: number }; ms: number }

/** Bars and goods. House price per unit, in chips. */
export const GOODS: Record<string, ItemDef> = {
  brick:        { type: 'bar',  id: 'brick',        name: 'Stone Brick',   price: 3,    color: '#9c8f84' },
  copper_bar:   { type: 'bar',  id: 'copper_bar',   name: 'Copper Bar',    price: 13,   color: '#d9793d' },
  iron_bar:     { type: 'bar',  id: 'iron_bar',     name: 'Iron Bar',      price: 25,   color: '#b8b8c0' },
  silver_bar:   { type: 'bar',  id: 'silver_bar',   name: 'Silver Bar',    price: 49,   color: '#e8edf2' },
  gold_bar:     { type: 'bar',  id: 'gold_bar',     name: 'Gold Bar',      price: 89,  color: '#ffcf3a' },
  wire:         { type: 'good', id: 'wire',         name: 'Copper Wire',   price: 27,   color: '#e08a4a' },
  gear:         { type: 'good', id: 'gear',         name: 'Iron Gear',     price: 76,   color: '#9aa0a8' },
  tool:         { type: 'good', id: 'tool',         name: 'Steel Pickaxe', price: 115,  color: '#7a8a9a' },
  cut_crystal:  { type: 'good', id: 'cut_crystal',  name: 'Cut Crystal',   price: 89,  color: '#c070ff' },
  silver_ring:  { type: 'good', id: 'silver_ring',  name: 'Silver Ring',   price: 105,  color: '#f0f4f8' },
  gold_ring:    { type: 'good', id: 'gold_ring',    name: 'Crystal Ring',  price: 305,  color: '#ffd860' },
  machine_part: { type: 'good', id: 'machine_part', name: 'Machine Part',  price: 320,  color: '#6f8fa8' },
  crown:        { type: 'good', id: 'crown',        name: 'Diamond Crown', price: 980, color: '#9ff6ff' },
  // Factory v2 (grid builder) intermediates and goods. Registered here so Market / priceOf / nameOf see them.
  glass:        { type: 'bar',  id: 'glass',        name: 'Glass',         price: 4,    color: '#a8e0e8' },
  iron_plate:   { type: 'good', id: 'iron_plate',   name: 'Iron Plate',    price: 30,   color: '#9fa6ae' },
  copper_plate: { type: 'good', id: 'copper_plate', name: 'Copper Plate',  price: 15,   color: '#d08850' },
  silver_coin:  { type: 'good', id: 'silver_coin',  name: 'Silver Coin',   price: 27,   color: '#e4e9ee' },
  gold_coin:    { type: 'good', id: 'gold_coin',    name: 'Gold Coin',     price: 50,   color: '#f6c840' },
  iron_rod:     { type: 'good', id: 'iron_rod',     name: 'Iron Rod',      price: 15,   color: '#8c939b' },
  iron_sheet:   { type: 'good', id: 'iron_sheet',   name: 'Iron Sheet',    price: 36,   color: '#b4bcc4' },
  gold_leaf:    { type: 'good', id: 'gold_leaf',    name: 'Gold Leaf',     price: 25,   color: '#ffe27a' },
  silver_wire:  { type: 'good', id: 'silver_wire',  name: 'Silver Wire',   price: 27,   color: '#dfe6ee' },
  screw:        { type: 'good', id: 'screw',        name: 'Screw',         price: 4,    color: '#7d858d' },
  pipe:         { type: 'good', id: 'pipe',         name: 'Iron Pipe',     price: 43,   color: '#7f8a94' },
  frame:        { type: 'good', id: 'frame',        name: 'Steel Frame',   price: 89,  color: '#6a737c' },
  circuit:      { type: 'good', id: 'circuit',      name: 'Circuit Board', price: 110,  color: '#3fae5a' },
  lens:         { type: 'good', id: 'lens',         name: 'Glass Lens',    price: 8,    color: '#bff2ff' },
  cut_diamond:  { type: 'good', id: 'cut_diamond',  name: 'Cut Diamond',   price: 170,  color: '#c8fbff' },
  gold_chain:   { type: 'good', id: 'gold_chain',   name: 'Gold Chain',    price: 125,  color: '#ffd24a' },
  engine:       { type: 'good', id: 'engine',       name: 'Engine',        price: 1250, color: '#c0563a' },
  computer:     { type: 'good', id: 'computer',     name: 'Computer',      price: 1030, color: '#4a7fd0' },
  drill:        { type: 'good', id: 'drill',        name: 'Mining Drill',  price: 2140, color: '#e0a030' },
  // Factory inputs brought in from the rest of the game (pt1252u). raw = can't be sold to the house as-is: craft it.
  // Crops: seed x 1.35 (= raw harvest value after FARM_SELL_MUL). Fish fillets/portions: base chips per unit.
  // Farm/fish food products below are placeholders; shared/factory.ts applyRawCropPrices() then
  // applyFarmFishFoodPrices() sets food crafts to (sum of input bases / out qty) x 1.08 in topological order.
  crop_strawberry: { type: 'good', id: 'crop_strawberry', name: 'Strawberries', price: 6.75,  color: '#d84a5a', raw: true },
  crop_wheat:      { type: 'good', id: 'crop_wheat',      name: 'Wheat',        price: 13.5,   color: '#d8b860', raw: true },
  crop_carrot:     { type: 'good', id: 'crop_carrot',     name: 'Carrots',      price: 20.25, color: '#e08a3a', raw: true },
  crop_corn:       { type: 'good', id: 'crop_corn',       name: 'Corn',         price: 33.75, color: '#e8d050', raw: true },
  crop_tobacco:    { type: 'good', id: 'crop_tobacco',    name: 'Tobacco',      price: 40.5,  color: '#8a6a3a', raw: true },
  crop_tomato:     { type: 'good', id: 'crop_tomato',     name: 'Tomatoes',     price: 54,   color: '#d8443a', raw: true },
  crop_potato:     { type: 'good', id: 'crop_potato',     name: 'Potatoes',     price: 81,   color: '#b08a5a', raw: true },
  crop_pumpkin:    { type: 'good', id: 'crop_pumpkin',    name: 'Pumpkins',     price: 121.5,  color: '#e0782a', raw: true },
  crop_grapes:     { type: 'good', id: 'crop_grapes',     name: 'Grapes',       price: 202.5,  color: '#8a4ac0', raw: true },
  crop_sunflower:  { type: 'good', id: 'crop_sunflower',  name: 'Sunflowers',   price: 337.5,  color: '#f0c830', raw: true },
  crop_pineapple:  { type: 'good', id: 'crop_pineapple',  name: 'Pineapples',   price: 40.5,   color: '#f2c230', raw: true },
  crop_banana:     { type: 'good', id: 'crop_banana',     name: 'Bananas',      price: 67.5,   color: '#f6dc4a', raw: true },
  crop_mango:      { type: 'good', id: 'crop_mango',      name: 'Mangoes',      price: 108,  color: '#f28a2a', raw: true },
  crop_coconut:    { type: 'good', id: 'crop_coconut',    name: 'Coconuts',     price: 189,  color: '#8a5a32', raw: true },
  crop_cacao:      { type: 'good', id: 'crop_cacao',      name: 'Cacao Pods',   price: 324,  color: '#6a3a22', raw: true },
  fish_fillet:     { type: 'good', id: 'fish_fillet',     name: 'Fish Fillet',  price: 8,   color: '#f0a090', raw: true },
  fish_portion:    { type: 'good', id: 'fish_portion',    name: 'Cooked Fish Portion', price: 10, color: '#d88a50', raw: true },
  // Factory products made from them
  flour:           { type: 'good', id: 'flour',           name: 'Flour',            price: 26,   color: '#f2ead8', food: true },
  cornmeal:        { type: 'good', id: 'cornmeal',        name: 'Cornmeal',         price: 32.5,   color: '#f0d470', food: true },
  sugar:           { type: 'good', id: 'sugar',           name: 'Sugar',            price: 32.5,   color: '#fafafa', food: true },
  berry_juice:     { type: 'good', id: 'berry_juice',     name: 'Berry Juice',      price: 19.5,   color: '#e04060', food: true },
  tropical_juice:  { type: 'good', id: 'tropical_juice',  name: 'Tropical Juice',   price: 208,  color: '#ffb030', food: true },
  sunflower_oil:   { type: 'good', id: 'sunflower_oil',   name: 'Sunflower Oil',    price: 325,  color: '#ffe060', food: true },
  cocoa:           { type: 'good', id: 'cocoa',           name: 'Cocoa Powder',     price: 312,  color: '#5a3020', food: true },
  coconut_milk:    { type: 'good', id: 'coconut_milk',    name: 'Coconut Milk',     price: 182,  color: '#f4f0e8', food: true },
  wine:            { type: 'good', id: 'wine',            name: 'Wine',             price: 700,  color: '#7a1a3a', food: true },
  bread:           { type: 'good', id: 'bread',           name: 'Bread',            price: 52,   color: '#c8904a', food: true },
  chocolate:       { type: 'good', id: 'chocolate',       name: 'Chocolate Bar',    price: 263.25,  color: '#4a2416', food: true },
  canned_fish:     { type: 'good', id: 'canned_fish',     name: 'Canned Fish',      price: 48,   color: '#9ab0c0', food: true },
  fish_oil:        { type: 'good', id: 'fish_oil',        name: 'Fish Oil',         price: 74,   color: '#d8c060', food: true },
  pumpkin_pie:     { type: 'good', id: 'pumpkin_pie',     name: 'Pumpkin Pie',      price: 175.5,  color: '#d87a30', food: true },
  salsa:           { type: 'good', id: 'salsa',           name: 'Salsa Jar',        price: 108.2,  color: '#c83a2a', food: true },
  veggie_soup:     { type: 'good', id: 'veggie_soup',     name: 'Canned Veggie Soup', price: 95.15, color: '#d0703a', food: true },
  banquet:         { type: 'good', id: 'banquet',         name: 'Banquet Platter',  price: 812, color: '#e0b060', food: true },
  steel:           { type: 'bar',  id: 'steel',           name: 'Steel Ingot',      price: 61,   color: '#8ea0b0' },
  bearing:         { type: 'good', id: 'bearing',         name: 'Ball Bearing',     price: 82,   color: '#a8b4c0' },
  motor:           { type: 'good', id: 'motor',           name: 'Electric Motor',   price: 305,  color: '#4a90a0' },
  generator:       { type: 'good', id: 'generator',       name: 'Generator',        price: 890, color: '#a07a30' },
  robot:           { type: 'good', id: 'robot',           name: 'Robot',            price: 2060, color: '#60a0d0' },
  bracelet:        { type: 'good', id: 'bracelet',        name: 'Grotto Bracelet',  price: 275,  color: '#40d0c0' },
  // Millionaire Update (pt1466u): doubled factory recipes. Prices = inputs x ~1.3-1.5 (same premium band as v2).
  bronze: { type: 'bar', id: 'bronze', name: 'Bronze Ingot', price: 21, color: '#b5803a' },
  electrum: { type: 'bar', id: 'electrum', name: 'Electrum Ingot', price: 46, color: '#e6d58a' },
  tempered_glass: { type: 'bar', id: 'tempered_glass', name: 'Tempered Glass', price: 13, color: '#7fc8d8' },
  concrete: { type: 'bar', id: 'concrete', name: 'Concrete Block', price: 6, color: '#a8a49c' },
  stainless: { type: 'bar', id: 'stainless', name: 'Stainless Steel', price: 105, color: '#c4d0dc' },
  crystal_glass: { type: 'bar', id: 'crystal_glass', name: 'Crystal Glass', price: 61, color: '#d8b0ff' },
  steel_plate: { type: 'good', id: 'steel_plate', name: 'Steel Plate', price: 79, color: '#7a8c9c' },
  bronze_medal: { type: 'good', id: 'bronze_medal', name: 'Bronze Medal', price: 14, color: '#c08a40' },
  electrum_coin: { type: 'good', id: 'electrum_coin', name: 'Electrum Coin', price: 31, color: '#ecdc90' },
  floor_tile: { type: 'good', id: 'floor_tile', name: 'Floor Tile', price: 9, color: '#b86a4a' },
  steel_beam: { type: 'good', id: 'steel_beam', name: 'Steel I-Beam', price: 159, color: '#5f6f7f' },
  copper_foil: { type: 'good', id: 'copper_foil', name: 'Copper Foil', price: 11, color: '#e89a60' },
  silver_leaf: { type: 'good', id: 'silver_leaf', name: 'Silver Leaf', price: 22, color: '#eef2f6' },
  bronze_sheet: { type: 'good', id: 'bronze_sheet', name: 'Bronze Sheet', price: 28, color: '#a87430' },
  mirror: { type: 'good', id: 'mirror', name: 'Mirror', price: 47, color: '#d0eef8' },
  steel_cable: { type: 'good', id: 'steel_cable', name: 'Steel Cable', price: 41, color: '#6a7a8a' },
  gold_wire: { type: 'good', id: 'gold_wire', name: 'Gold Wire', price: 40, color: '#ffcc40' },
  spring: { type: 'good', id: 'spring', name: 'Spring', price: 21, color: '#9aa4ae' },
  fiber_optic: { type: 'good', id: 'fiber_optic', name: 'Fiber Optic Cable', price: 41, color: '#c890ff' },
  valve: { type: 'good', id: 'valve', name: 'Valve', price: 155, color: '#8a6a5a' },
  hinge: { type: 'good', id: 'hinge', name: 'Hinge', price: 27, color: '#8a929a' },
  battery: { type: 'good', id: 'battery', name: 'Battery', price: 68, color: '#3aa060' },
  sensor: { type: 'good', id: 'sensor', name: 'Sensor', price: 213, color: '#4ac0c0' },
  microchip: { type: 'good', id: 'microchip', name: 'Microchip', price: 339, color: '#2a6a3a' },
  solar_panel: { type: 'good', id: 'solar_panel', name: 'Solar Panel', price: 213, color: '#2a4aa0' },
  padlock: { type: 'good', id: 'padlock', name: 'Padlock', price: 103, color: '#b08a3a' },
  pump: { type: 'good', id: 'pump', name: 'Water Pump', price: 710, color: '#3a70a0' },
  girder: { type: 'good', id: 'girder', name: 'Steel Girder', price: 434, color: '#5a6470' },
  lantern: { type: 'good', id: 'lantern', name: 'Lantern', price: 106, color: '#e8b040' },
  electrum_ring: { type: 'good', id: 'electrum_ring', name: 'Electrum Ring', price: 182, color: '#e6d58a' },
  diamond_necklace: { type: 'good', id: 'diamond_necklace', name: 'Diamond Necklace', price: 398, color: '#c8fbff' },
  pocket_watch: { type: 'good', id: 'pocket_watch', name: 'Pocket Watch', price: 209, color: '#e0b850' },
  tiara: { type: 'good', id: 'tiara', name: 'Silver Tiara', price: 359, color: '#e8eef6' },
  trophy: { type: 'good', id: 'trophy', name: 'Trophy Cup', price: 129, color: '#d8a830' },
  scepter: { type: 'good', id: 'scepter', name: 'Royal Scepter', price: 532, color: '#ffd040' },
  earrings: { type: 'good', id: 'earrings', name: 'Crystal Earrings', price: 228, color: '#ffd860' },
  tractor: { type: 'good', id: 'tractor', name: 'Tractor', price: 2267, color: '#3a9a3a' },
  turbine: { type: 'good', id: 'turbine', name: 'Wind Turbine', price: 1997, color: '#d8e0e8' },
  server_rack: { type: 'good', id: 'server_rack', name: 'Server Rack', price: 2900, color: '#2a3a5a' },
  satellite: { type: 'good', id: 'satellite', name: 'Satellite', price: 2105, color: '#c0c8e0' },
  drone: { type: 'good', id: 'drone', name: 'Drone', price: 2204, color: '#505a64' },
  telescope: { type: 'good', id: 'telescope', name: 'Telescope', price: 568, color: '#4a5aa0' },
  excavator: { type: 'good', id: 'excavator', name: 'Excavator', price: 5535, color: '#f0b020' },
  mech_suit: { type: 'good', id: 'mech_suit', name: 'Mech Suit', price: 3442, color: '#a03a3a' },
  starch: { type: 'good', id: 'starch', name: 'Potato Starch', price: 78, color: '#f4f0e0', food: true },
  carrot_juice: { type: 'good', id: 'carrot_juice', name: 'Carrot Juice', price: 58.5, color: '#f08a30', food: true },
  mango_puree: { type: 'good', id: 'mango_puree', name: 'Mango Puree', price: 104, color: '#f6a030', food: true },
  grape_juice: { type: 'good', id: 'grape_juice', name: 'Grape Juice', price: 195, color: '#7a3ab0', food: true },
  pumpkin_seeds: { type: 'good', id: 'pumpkin_seeds', name: 'Roasted Pumpkin Seeds', price: 117, color: '#e8d8a0', food: true },
  tomato_paste: { type: 'good', id: 'tomato_paste', name: 'Tomato Paste', price: 104, color: '#b82a20', food: true },
  pasta_dinner: { type: 'good', id: 'pasta_dinner', name: 'Pasta Dinner', price: 156, color: '#e8c860', food: true },
  choc_cake: { type: 'good', id: 'choc_cake', name: 'Chocolate Cake', price: 380.25, color: '#5a2a18', food: true },
  jam_jar: { type: 'good', id: 'jam_jar', name: 'Strawberry Jam', price: 75.7, color: '#d8304a', food: true },
  cornbread: { type: 'good', id: 'cornbread', name: 'Cornbread', price: 97.5, color: '#e0b040', food: true },
  smoothie: { type: 'good', id: 'smoothie', name: 'Tropical Smoothie', price: 188.5, color: '#f0a0b0', food: true },
  fish_pie: { type: 'good', id: 'fish_pie', name: 'Fish Pie', price: 152, color: '#e8c890', food: true },
  // Coral Grotto exclusives (#10d)
  cut_opal:        { type: 'good', id: 'cut_opal',        name: 'Cut Fire Opal',    price: 70,   color: '#ff7a4a' },
  pearl_necklace:  { type: 'good', id: 'pearl_necklace',  name: 'Pearl Necklace',   price: 370,  color: '#eef2ff' },
  tidecrown:       { type: 'good', id: 'tidecrown',       name: 'Tidecrown',        price: 1600, color: '#7ff0ff' },
  // Prestige factory line (Billionaire Update)
  gold_cufflinks:  { type: 'good', id: 'gold_cufflinks',  name: 'Gold Cufflinks',        price: 211,  color: '#e8c860' },
  signet_ring:     { type: 'good', id: 'signet_ring',     name: 'Signet Ring',           price: 440,  color: '#c9a227' },
  imperial_diadem: { type: 'good', id: 'imperial_diadem', name: 'Imperial Diadem',       price: 773,  color: '#f0e0a0' },
  chandelier:      { type: 'good', id: 'chandelier',      name: 'Crystal Chandelier',    price: 558,  color: '#efe8ff' },
  limousine:       { type: 'good', id: 'limousine',       name: 'Coachbuilt Limousine',  price: 2080, color: '#1a1a1a' },
  city_seal:       { type: 'good', id: 'city_seal',       name: 'City Seal',             price: 1049, color: '#d4af37' },
  grand_clock:     { type: 'good', id: 'grand_clock',     name: 'Grand Clock',           price: 534,  color: '#8a5a2a' },
  vault_door:      { type: 'good', id: 'vault_door',      name: 'Vault Door',            price: 5055, color: '#4a4a52' },
  sovereign_laurel:{ type: 'good', id: 'sovereign_laurel',name: 'Sovereign Laurel',      price: 716,  color: '#d4af37' },
  cigarette:      { type: 'good', id: 'cigarette',      name: 'Cigarette',       price: 43.74, color: '#d8c8b0' },
};

const o = (id: OreId, qty: number) => ({ type: 'ore' as const, id, qty });
const b = (id: string, qty: number) => ({ type: 'bar' as const, id, qty });
const g = (id: string, qty: number) => ({ type: 'good' as const, id, qty });
export const RECIPES: Recipe[] = [
  { id: 'brick',        machine: 'furnace',   name: 'Stone Brick',   in: [o('stone', 10), o('coal', 1)],              out: b('brick', 1),        ms: 10_000 },
  { id: 'copper_bar',   machine: 'furnace',   name: 'Copper Bar',    in: [o('copper', 3), o('coal', 1)],              out: b('copper_bar', 1),   ms: 15_000 },
  { id: 'iron_bar',     machine: 'furnace',   name: 'Iron Bar',      in: [o('iron', 3), o('coal', 1)],                out: b('iron_bar', 1),     ms: 20_000 },
  { id: 'silver_bar',   machine: 'furnace',   name: 'Silver Bar',    in: [o('silver', 3), o('coal', 1)],              out: b('silver_bar', 1),   ms: 30_000 },
  { id: 'gold_bar',     machine: 'furnace',   name: 'Gold Bar',      in: [o('gold', 3), o('coal', 2)],                out: b('gold_bar', 1),     ms: 45_000 },
  { id: 'wire',         machine: 'workbench', name: 'Copper Wire',   in: [b('copper_bar', 1)],                        out: g('wire', 1),         ms: 15_000 },
  { id: 'gear',         machine: 'workbench', name: 'Iron Gear',     in: [b('iron_bar', 2)],                          out: g('gear', 1),         ms: 25_000 },
  { id: 'tool',         machine: 'workbench', name: 'Steel Pickaxe', in: [b('iron_bar', 2), b('copper_bar', 1)],      out: g('tool', 1),         ms: 40_000 },
  { id: 'cut_crystal',  machine: 'workbench', name: 'Cut Crystal',   in: [o('gem', 1)],                               out: g('cut_crystal', 1),  ms: 30_000 },
  { id: 'silver_ring',  machine: 'workbench', name: 'Silver Ring',   in: [b('silver_bar', 1)],                        out: g('silver_ring', 1),  ms: 30_000 },
  { id: 'gold_ring',    machine: 'workbench', name: 'Crystal Ring',  in: [b('gold_bar', 1), g('cut_crystal', 1)],     out: g('gold_ring', 1),    ms: 45_000 },
  { id: 'machine_part', machine: 'workbench', name: 'Machine Part',  in: [g('gear', 2), g('wire', 2)],                out: g('machine_part', 1), ms: 60_000 },
  { id: 'crown',        machine: 'workbench', name: 'Diamond Crown', in: [b('gold_bar', 3), o('diamond', 2)],         out: g('crown', 1),        ms: 60_000 },
];
export const recipeById = (id: unknown) => RECIPES.find((r) => r.id === id);
/** House price of one unit of any item (0 = not sellable). */
export function priceOf(s: { type: ItemType; id: string }): number {
  if (s.type === 'food') return 0;
  if (s.type === 'ore') return isOre(s.id) ? ORES[s.id].price : 0;
  const d = GOODS[s.id]; return d && d.type === s.type ? d.price : 0;
}
/** Can the house buy this as-is? (Raw factory imports can't be: craft them first.) */
export const sellable = (s: { type: ItemType; id: string }) => priceOf(s) > 0 && !(s.type !== 'ore' && GOODS[s.id]?.raw);
export const isFood = (s: { type: ItemType; id: string }) => s.type !== 'ore' && !!GOODS[s.id]?.food;
export function nameOf(s: { type: ItemType; id: string }): string { if (s.type === 'food') return foodInfo(s.id)?.label ?? s.id; return s.type === 'ore' && isOre(s.id) ? ORES[s.id].name : GOODS[s.id]?.name ?? s.id; }
export const inputValue = (r: Recipe) => r.in.reduce((t, i) => t + i.qty * priceOf(i), 0);

/** Factory levels: chips to reach the level, slots per machine (parallel jobs) and max batch size. */
export const FACTORY_LEVELS = [
  { level: 1, cost: 250,  slots: 1, batch: 5 },
  { level: 2, cost: 750,  slots: 2, batch: 10 },
  { level: 3, cost: 2000, slots: 3, batch: 20 },
];
export const MAX_JOBS_PER_MACHINE = 3;
export interface Job { id: string; machine: MachineId; recipe: string; qty: number; startAt: number; doneAt: number }

// ---------------------------------------------------------------- Extraction
/** The lift at the entrance (the spawn pocket). Ore you mine is carried; it only banks when you walk back in here. */
export const MINE_EXIT = { x0: 2, y0: 4, x1: 6.2, y1: 10, sign: { x: 2.03, y: 7, z: 2.4 } };
export const inExit = (x: number, y: number) => x >= MINE_EXIT.x0 && x <= MINE_EXIT.x1 && y >= MINE_EXIT.y0 && y <= MINE_EXIT.y1;
/** Auto-unstick after staying inside solid this long (client). */
export const UNSTICK_AUTO_MS = 500;
/** Manual Unstick / /stuck cooldown (server). */
export const UNSTICK_COOLDOWN_MS = 15_000;
/** Disconnect / closing the tab without exiting: the carried haul is kept this long for a reconnect, then lost. */
export const CARRY_GRACE_MS = 60_000;
export const weightOf = (s: Stack) => s.qty * (s.type === 'ore' && isOre(s.id) ? ORES[s.id].weight : 1);
