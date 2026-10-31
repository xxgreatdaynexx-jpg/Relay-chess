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

// ---------------------------------------------------------------- Factory (stage 2) – schema planned now
// Items: bars ('bar') and crafted goods ('good') reuse the same stack table as ore (generic item type field).
export type MachineId = 'furnace' | 'workbench';
export interface Recipe { id: string; machine: MachineId; name: string; in: Array<{ type: ItemType; id: string; qty: number }>; out: { type: ItemType; id: string; qty: number }; ms: number; /** house price per output unit */ price: number }
