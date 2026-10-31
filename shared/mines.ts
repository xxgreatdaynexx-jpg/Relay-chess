/**
 * Mines: a shared first-person cave (same physics as Arena: shared/fps.ts) where players mine ore and sell it.
 * Items are generic stacks { type, id, qty } (type 'ore' now; 'bar' / 'good' for the Factory), never skins.
 */
import type { ArenaMap, Solid } from './arenaMaps.js';

export type ItemType = 'ore' | 'bar' | 'good';
export type OreId = 'stone' | 'coal' | 'copper' | 'iron' | 'silver' | 'gold' | 'gem' | 'diamond';
export interface OreDef { id: OreId; name: string; hits: number; respawnMs: number; /** house price per unit, in chips (fractional: stone is 1 chip per 10) */ price: number; color: string; weight: number; minDepth: number; spawnWeight: number }

export const ORES: Record<OreId, OreDef> = {
  stone:   { id: 'stone',   name: 'Stone',      hits: 2,  respawnMs: 20_000,  price: 0.1, color: '#8a8580', weight: 1, minDepth: 0, spawnWeight: 40 },
  coal:    { id: 'coal',    name: 'Coal',       hits: 3,  respawnMs: 30_000,  price: 1,   color: '#2b2b2e', weight: 1, minDepth: 0, spawnWeight: 22 },
  copper:  { id: 'copper',  name: 'Copper Ore', hits: 4,  respawnMs: 45_000,  price: 2,   color: '#c4733b', weight: 1, minDepth: 0, spawnWeight: 16 },
  iron:    { id: 'iron',    name: 'Iron Ore',   hits: 5,  respawnMs: 60_000,  price: 4,   color: '#a98f7f', weight: 1, minDepth: 1, spawnWeight: 12 },
  silver:  { id: 'silver',  name: 'Silver Ore', hits: 6,  respawnMs: 90_000,  price: 8,   color: '#d5dbe2', weight: 1, minDepth: 1, spawnWeight: 7 },
  gold:    { id: 'gold',    name: 'Gold Ore',   hits: 7,  respawnMs: 120_000, price: 15,  color: '#f0c23a', weight: 1, minDepth: 2, spawnWeight: 5 },
  gem:     { id: 'gem',     name: 'Crystal',    hits: 9,  respawnMs: 180_000, price: 40,  color: '#b04df0', weight: 1, minDepth: 2, spawnWeight: 2.5 },
  diamond: { id: 'diamond', name: 'Diamond',    hits: 12, respawnMs: 300_000, price: 150, color: '#7ff3ff', weight: 1, minDepth: 3, spawnWeight: 0.6 },
};
export const ORE_ORDER: OreId[] = ['stone', 'coal', 'copper', 'iron', 'silver', 'gold', 'gem', 'diamond'];
export const isOre = (v: unknown): v is OreId => typeof v === 'string' && v in ORES;

// ---- mining rules (server-checked)
export const REACH = 3.0;          // eye -> node surface
export const NODE_R = 0.55;        // node "radius" (reach is measured to its centre minus this)
export const SWING_MS = 450;       // client swing period
export const SWING_MIN_MS = 380;   // server minimum between accepted hits (latency slack)
export const MAX_HITS_PER_10S = 26; // hard rate limit
export const BACKPACK_CAP = 120;   // total weight units

// ---- house selling: daily diminishing returns (per signed-in player, per UTC day)
/** Gross chips earned (at full price) per day; tiers pay full, half, then a fifth. */
export const SELL_TIERS: Array<{ upTo: number; rate: number }> = [{ upTo: 600, rate: 1 }, { upTo: 1200, rate: 0.5 }, { upTo: Infinity, rate: 0.2 }];
export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Chips paid for `gross` full-price value when `already` gross was sold today. Fractions floor at the end. */
export function payoutFor(gross: number, already: number): number {
  let left = gross, at = already, pay = 0, lo = 0;
  for (const t of SELL_TIERS) {
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

export function depthAt(x: number): number { const cx = x / CELL; let d = 0; for (let i = 0; i < DEPTH_X.length; i++) if (cx >= DEPTH_X[i]) d = i; return d; }

/** Ore for a node slot: weighted among ores unlocked at this depth; rarer ores get a boost deeper. */
export function oreFor(depth: number, r: number): OreId {
  const pool = ORE_ORDER.filter((o) => ORES[o].minDepth <= depth).map((o) => [o, ORES[o].spawnWeight * (ORES[o].minDepth > 0 ? 1 + depth * 0.5 : 1) * (o === 'stone' ? Math.max(0.4, 1 - depth * 0.2) : 1)] as const);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let t = r * total;
  for (const [o, w] of pool) { t -= w; if (t <= 0) return o; }
  return pool[pool.length - 1][0];
}

function build(): { map: ArenaMap; nodes: MineNode[] } {
  const solids: Solid[] = [];
  const spawns: Array<[number, number, number]> = [];
  const W = ROWS[0].length, D = ROWS.length;
  const wall = (x: number, y: number) => y < 0 || y >= D || x < 0 || x >= W || ROWS[y][x] === '#';
  ROWS.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#') solids.push({ x0: x * CELL, y0: y * CELL, x1: (x + 1) * CELL, y1: (y + 1) * CELL, z0: 0, z1: CEIL + 1, mat: 'concrete' });
    else if (c === 'S') spawns.push([x * CELL + 1, y * CELL + 1, 0]);
  }));
  // ceiling slab over the whole cave
  solids.push({ x0: 0, y0: 0, x1: W * CELL, y1: D * CELL, z0: CEIL, z1: CEIL + 1, mat: 'concrete' });
  const nodes: MineNode[] = [];
  let id = 0;
  ROWS.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#' || c === 'S' || x < 3) return;
    const adj: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => wall(x + dx, y + dy)) as Array<[number, number]>;
    if (!adj.length) return;
    const seed = x * 131 + y * 17;
    if (hash(seed) > 0.42) return;
    const [dx, dy] = adj[Math.floor(hash(seed + 7) * adj.length)];
    // sit against the wall, half embedded
    const nx = x * CELL + 1 + dx * 0.75, ny = y * CELL + 1 + dy * 0.75;
    const depth = depthAt(nx);
    const nz = 0.35 + hash(seed + 3) * 1.4;
    nodes.push({ id: id++, x: nx, y: ny, z: nz, ore: oreFor(depth, hash(seed + 11)), depth });
  }));
  const map: ArenaMap = { id: 'mine', name: 'The Mine', w: W * CELL, d: D * CELL, solids, ramps: [], spawns, sky: '#07070a', fog: '#0b0a0d', ground: 'sand' };
  return { map, nodes };
}

const built = build();
export const MINE_MAP: ArenaMap = built.map;
export const MINE_NODES: MineNode[] = built.nodes;

export interface Stack { type: ItemType; id: string; qty: number }
export const stackKey = (s: { type: ItemType; id: string }) => `${s.type}:${s.id}`;

// ---------------------------------------------------------------- Factory (stage 2)
// Bars ('bar') and crafted goods ('good') live in the same generic stack table as ore.
export type MachineId = 'furnace' | 'workbench';
export interface ItemDef { type: ItemType; id: string; name: string; price: number; color: string }
export interface Recipe { id: string; machine: MachineId; name: string; in: Array<{ type: ItemType; id: string; qty: number }>; out: { type: ItemType; id: string; qty: number }; ms: number }

/** Bars and goods. House price per unit, in chips. */
export const GOODS: Record<string, ItemDef> = {
  brick:        { type: 'bar',  id: 'brick',        name: 'Stone Brick',   price: 4,    color: '#9c8f84' },
  copper_bar:   { type: 'bar',  id: 'copper_bar',   name: 'Copper Bar',    price: 14,   color: '#d9793d' },
  iron_bar:     { type: 'bar',  id: 'iron_bar',     name: 'Iron Bar',      price: 28,   color: '#b8b8c0' },
  silver_bar:   { type: 'bar',  id: 'silver_bar',   name: 'Silver Bar',    price: 55,   color: '#e8edf2' },
  gold_bar:     { type: 'bar',  id: 'gold_bar',     name: 'Gold Bar',      price: 100,  color: '#ffcf3a' },
  wire:         { type: 'good', id: 'wire',         name: 'Copper Wire',   price: 30,   color: '#e08a4a' },
  gear:         { type: 'good', id: 'gear',         name: 'Iron Gear',     price: 85,   color: '#9aa0a8' },
  tool:         { type: 'good', id: 'tool',         name: 'Steel Pickaxe', price: 130,  color: '#7a8a9a' },
  cut_crystal:  { type: 'good', id: 'cut_crystal',  name: 'Cut Crystal',   price: 100,  color: '#c070ff' },
  silver_ring:  { type: 'good', id: 'silver_ring',  name: 'Silver Ring',   price: 120,  color: '#f0f4f8' },
  gold_ring:    { type: 'good', id: 'gold_ring',    name: 'Crystal Ring',  price: 340,  color: '#ffd860' },
  machine_part: { type: 'good', id: 'machine_part', name: 'Machine Part',  price: 360,  color: '#6f8fa8' },
  crown:        { type: 'good', id: 'crown',        name: 'Diamond Crown', price: 1100, color: '#9ff6ff' },
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
  if (s.type === 'ore') return isOre(s.id) ? ORES[s.id].price : 0;
  const d = GOODS[s.id]; return d && d.type === s.type ? d.price : 0;
}
export function nameOf(s: { type: ItemType; id: string }): string { return s.type === 'ore' && isOre(s.id) ? ORES[s.id].name : GOODS[s.id]?.name ?? s.id; }
export const inputValue = (r: Recipe) => r.in.reduce((t, i) => t + i.qty * priceOf(i), 0);

/** Factory levels: chips to reach the level, slots per machine (parallel jobs) and max batch size. */
export const FACTORY_LEVELS = [
  { level: 1, cost: 250,  slots: 1, batch: 5 },
  { level: 2, cost: 750,  slots: 2, batch: 10 },
  { level: 3, cost: 2000, slots: 3, batch: 20 },
];
export const MAX_JOBS_PER_MACHINE = 3;
export interface Job { id: string; machine: MachineId; recipe: string; qty: number; startAt: number; doneAt: number }
