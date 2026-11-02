/**
 * Factory v2: a Factorio-ish grid builder. Pure, deterministic tick sim shared by server (authoritative) and client (prediction).
 * Items are stack keys `type:id` (same as mine_items / stackKey), so input/output chests read and write banked storage directly.
 */
import { GOODS, ORES, MAX_BANKED_STACK, isOre, priceOf, nameOf, type ItemType } from './mines.js';

export const TICK_MS = 500;
export const MAX_CATCHUP_MS = 8 * 3600_000;
export type Dir = 0 | 1 | 2 | 3; // E S W N
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;
export type Kind = 'belt' | 'underground' | 'splitter' | 'inserter' | 'chest_in' | 'chest_out' | 'smelter' | 'press' | 'roller' | 'drawer' | 'assembler' | 'jeweler' | 'fabricator' | 'mill' | 'cannery';
export interface KindDef { id: Kind; name: string; size: 1 | 2; cost: number; minFloor: number; color: string; desc: string; machine?: boolean }
export const KINDS: Record<Kind, KindDef> = {
  belt:       { id: 'belt',       name: 'Conveyor Belt', size: 1, cost: 3,    minFloor: 1, color: '#c9a227', desc: 'Moves items 2 tiles/s. Drag to lay a line.' },
  underground: { id: 'underground', name: 'Underground Belt', size: 1, cost: 25, minFloor: 1, color: '#b08a20', desc: 'Place two facing the same way, up to 5 tiles apart: items tunnel under whatever is between.' },
  splitter:   { id: 'splitter',   name: 'Splitter',      size: 1, cost: 30,   minFloor: 1, color: '#d9b84a', desc: 'Round-robins items left / ahead / right.' },
  inserter:   { id: 'inserter',   name: 'Inserter',      size: 1, cost: 15,   minFloor: 1, color: '#e0c040', desc: 'Grabs from behind, drops in front (1 item/s).' },
  chest_in:   { id: 'chest_in',   name: 'Input Chest',   size: 1, cost: 50,   minFloor: 1, color: '#3f7fbf', desc: 'Pulls one item type from your banked storage onto the line.' },
  chest_out:  { id: 'chest_out',  name: 'Output Chest',  size: 1, cost: 50,   minFloor: 1, color: '#3fa060', desc: 'Anything delivered here goes into banked storage.' },
  smelter:    { id: 'smelter',    name: 'Smelter',       size: 2, cost: 200,  minFloor: 1, color: '#b0502a', desc: 'Ore + coal -> ingots, bricks, glass.', machine: true },
  press:      { id: 'press',      name: 'Press',         size: 2, cost: 400,  minFloor: 1, color: '#5a6a80', desc: 'Ingots -> plates and coins.', machine: true },
  roller:     { id: 'roller',     name: 'Roller',        size: 2, cost: 400,  minFloor: 1, color: '#6a5a80', desc: 'Ingots -> rods, sheet, gold leaf.', machine: true },
  drawer:     { id: 'drawer',     name: 'Wire Drawer',   size: 2, cost: 350,  minFloor: 1, color: '#806a40', desc: 'Ingots -> wire.', machine: true },
  assembler:  { id: 'assembler',  name: 'Assembler',     size: 2, cost: 800,  minFloor: 2, color: '#40708a', desc: 'Parts -> gears, screws, pipes, frames, circuits, tools.', machine: true },
  jeweler:    { id: 'jeweler',    name: "Jeweler's Bench", size: 2, cost: 1200, minFloor: 2, color: '#8a4090', desc: 'Gems + precious metal -> rings, chains, crowns.', machine: true },
  fabricator: { id: 'fabricator', name: 'Fabricator',    size: 2, cost: 4000, minFloor: 3, color: '#9a3a3a', desc: 'High tier: engines, computers, drills, generators, robots.', machine: true },
  mill:       { id: 'mill',       name: 'Mill & Press',  size: 2, cost: 350,  minFloor: 1, color: '#9a7a3a', desc: 'Crops -> flour, sugar, juice, oil, cocoa, coconut milk.', machine: true },
  cannery:    { id: 'cannery',    name: 'Food Line',     size: 2, cost: 900,  minFloor: 2, color: '#a04a5a', desc: 'Flour, fish and produce -> bread, chocolate, canned fish, pies, banquets.', machine: true },
};
export const KIND_ORDER: Kind[] = ['belt', 'underground', 'splitter', 'inserter', 'chest_in', 'chest_out', 'smelter', 'press', 'roller', 'drawer', 'assembler', 'jeweler', 'fabricator', 'mill', 'cannery'];
export const UG_MAX = 5;
/** Belt-like: holds one item and moves it on. */
export const isBeltish = (k: Kind) => k === 'belt' || k === 'splitter' || k === 'underground';
export const isKind = (v: unknown): v is Kind => typeof v === 'string' && v in KINDS;

/** Building floor: level 1..3 match the old factory levels (same chips), 4..5 are new expansions. */
export const FLOOR_LEVELS = [
  { level: 1, size: 12, cost: 250 },
  { level: 2, size: 16, cost: 750 },
  { level: 3, size: 20, cost: 2000 },
  { level: 4, size: 26, cost: 5000 },
  { level: 5, size: 32, cost: 12000 },
];
export const floorSize = (level: number) => FLOOR_LEVELS[Math.max(0, Math.min(FLOOR_LEVELS.length, level) - 1)]?.size ?? 0;
export const MAX_ENTS = 900;

export interface FRecipe { id: string; machine: Kind; name: string; in: Array<[string, number]>; out: [string, number]; secs: number }
const R = (id: string, machine: Kind, inp: Array<[string, number]>, out: [string, number], secs: number): FRecipe => ({ id, machine, name: nameOfKey(out[0]), in: inp, out, secs });
export function nameOfKey(k: string) { const [t, id] = k.split(':'); return nameOf({ type: t as ItemType, id }); }
export function priceOfKey(k: string) { const [t, id] = k.split(':'); return priceOf({ type: t as ItemType, id }); }
export function colorOfKey(k: string) { const [t, id] = k.split(':'); return t === 'ore' && isOre(id) ? ORES[id].color : GOODS[id]?.color ?? '#ccc'; }

export const FRECIPES: FRecipe[] = [
  // Smelter: ore (+ coal fuel) -> ingots
  R('s_brick', 'smelter', [['ore:stone', 10], ['ore:coal', 1]], ['bar:brick', 1], 8),
  R('s_glass', 'smelter', [['ore:stone', 20], ['ore:coal', 1]], ['bar:glass', 1], 8),
  R('s_copper', 'smelter', [['ore:copper', 3], ['ore:coal', 1]], ['bar:copper_bar', 1], 6),
  R('s_iron', 'smelter', [['ore:iron', 3], ['ore:coal', 1]], ['bar:iron_bar', 1], 8),
  R('s_silver', 'smelter', [['ore:silver', 3], ['ore:coal', 1]], ['bar:silver_bar', 1], 10),
  R('s_gold', 'smelter', [['ore:gold', 3], ['ore:coal', 2]], ['bar:gold_bar', 1], 14),
  // Press
  R('p_iron_plate', 'press', [['bar:iron_bar', 1]], ['good:iron_plate', 1], 3),
  R('p_copper_plate', 'press', [['bar:copper_bar', 1]], ['good:copper_plate', 1], 3),
  R('p_silver_coin', 'press', [['bar:silver_bar', 1]], ['good:silver_coin', 2], 4),
  R('p_gold_coin', 'press', [['bar:gold_bar', 1]], ['good:gold_coin', 2], 5),
  // Roller
  R('r_iron_rod', 'roller', [['bar:iron_bar', 1]], ['good:iron_rod', 2], 3),
  R('r_iron_sheet', 'roller', [['good:iron_plate', 1]], ['good:iron_sheet', 1], 3),
  R('r_gold_leaf', 'roller', [['bar:gold_bar', 1]], ['good:gold_leaf', 4], 6),
  R('r_lens', 'roller', [['bar:glass', 1]], ['good:lens', 1], 3),
  // Wire drawer
  R('d_wire', 'drawer', [['bar:copper_bar', 1]], ['good:wire', 1], 3),
  R('d_silver_wire', 'drawer', [['bar:silver_bar', 1]], ['good:silver_wire', 2], 4),
  // Assembler
  R('a_screw', 'assembler', [['good:iron_rod', 1]], ['good:screw', 4], 2),
  R('a_gear', 'assembler', [['good:iron_plate', 2]], ['good:gear', 1], 4),
  R('a_pipe', 'assembler', [['good:iron_sheet', 1]], ['good:pipe', 1], 3),
  R('a_frame', 'assembler', [['good:iron_rod', 4], ['good:screw', 4]], ['good:frame', 1], 6),
  R('a_circuit', 'assembler', [['good:copper_plate', 1], ['good:wire', 3]], ['good:circuit', 1], 6),
  R('a_tool', 'assembler', [['good:iron_plate', 2], ['good:iron_rod', 1], ['good:copper_plate', 1]], ['good:tool', 1], 6),
  R('a_machine_part', 'assembler', [['good:gear', 2], ['good:wire', 2]], ['good:machine_part', 1], 10),
  // Jeweler
  R('j_cut_crystal', 'jeweler', [['ore:gem', 1]], ['good:cut_crystal', 1], 6),
  R('j_cut_diamond', 'jeweler', [['ore:diamond', 1]], ['good:cut_diamond', 1], 8),
  R('j_silver_ring', 'jeweler', [['good:silver_wire', 2]], ['good:silver_ring', 1], 5),
  R('j_gold_ring', 'jeweler', [['bar:gold_bar', 1], ['good:cut_crystal', 1]], ['good:gold_ring', 1], 8),
  R('j_gold_chain', 'jeweler', [['good:gold_leaf', 4]], ['good:gold_chain', 1], 6),
  R('j_crown', 'jeweler', [['good:gold_leaf', 8], ['good:cut_diamond', 2], ['good:gold_coin', 2]], ['good:crown', 1], 15),
  // Fabricator (top tier)
  R('f_engine', 'fabricator', [['good:machine_part', 2], ['good:circuit', 1], ['good:pipe', 2], ['good:frame', 1]], ['good:engine', 1], 20),
  R('f_computer', 'fabricator', [['good:circuit', 4], ['good:frame', 2], ['good:cut_crystal', 1], ['good:silver_wire', 4]], ['good:computer', 1], 20),
  R('f_drill', 'fabricator', [['good:engine', 1], ['good:tool', 2], ['good:cut_diamond', 1]], ['good:drill', 1], 25),
  // pt1252u: game resources in (ore from every cave, farm + plantation crops, fish from the cooler, cooked dishes)
  R('s_steel', 'smelter', [['bar:iron_bar', 2], ['ore:coal', 2]], ['bar:steel', 1], 6),
  R('a_bearing', 'assembler', [['bar:steel', 1], ['good:screw', 2]], ['good:bearing', 1], 6),
  R('a_motor', 'assembler', [['good:wire', 4], ['good:gear', 1], ['good:bearing', 1]], ['good:motor', 1], 10),
  R('f_generator', 'fabricator', [['good:motor', 2], ['good:frame', 1], ['good:pipe', 1]], ['good:generator', 1], 20),
  R('f_robot', 'fabricator', [['good:computer', 1], ['good:motor', 2], ['bar:steel', 2]], ['good:robot', 1], 30),
  R('j_bracelet', 'jeweler', [['good:cut_crystal', 2], ['good:silver_wire', 2]], ['good:bracelet', 1], 10),
  R('m_flour', 'mill', [['good:crop_wheat', 2]], ['good:flour', 1], 3),
  R('m_cornmeal', 'mill', [['good:crop_corn', 1]], ['good:cornmeal', 1], 3),
  R('m_sugar', 'mill', [['good:crop_corn', 1]], ['good:sugar', 1], 4),
  R('m_juice', 'mill', [['good:crop_strawberry', 3]], ['good:berry_juice', 1], 3),
  R('m_tropical', 'mill', [['good:crop_pineapple', 1], ['good:crop_banana', 1], ['good:crop_mango', 1]], ['good:tropical_juice', 1], 5),
  R('m_oil', 'mill', [['good:crop_sunflower', 1]], ['good:sunflower_oil', 1], 6),
  R('m_cocoa', 'mill', [['good:crop_cacao', 1]], ['good:cocoa', 1], 6),
  R('m_coconut', 'mill', [['good:crop_coconut', 1]], ['good:coconut_milk', 1], 5),
  R('k_wine', 'cannery', [['good:crop_grapes', 2]], ['good:wine', 1], 12),
  R('k_bread', 'cannery', [['good:flour', 2]], ['good:bread', 1], 5),
  R('k_chocolate', 'cannery', [['good:cocoa', 1], ['good:sugar', 1], ['good:coconut_milk', 1]], ['good:chocolate', 2], 10),
  R('k_canned', 'cannery', [['good:fish_fillet', 6], ['good:iron_sheet', 1]], ['good:canned_fish', 2], 6),
  R('k_fish_oil', 'cannery', [['good:fish_fillet', 8]], ['good:fish_oil', 1], 6),
  R('k_pie', 'cannery', [['good:crop_pumpkin', 1], ['good:flour', 1], ['good:sugar', 1]], ['good:pumpkin_pie', 1], 8),
  R('k_salsa', 'cannery', [['good:crop_tomato', 2], ['bar:glass', 1]], ['good:salsa', 1], 5),
  R('k_soup', 'cannery', [['good:crop_carrot', 1], ['good:crop_potato', 1], ['good:crop_tomato', 1], ['good:iron_sheet', 1]], ['good:veggie_soup', 2], 8),
  R('k_banquet', 'cannery', [['good:fish_portion', 6], ['good:bread', 1], ['good:wine', 1]], ['good:banquet', 1], 15),
];
export const frecipe = (id: unknown) => FRECIPES.find((r) => r.id === id);
export const recipesFor = (k: Kind) => FRECIPES.filter((r) => r.machine === k);
/** Ticks per craft; `mul` (0.75..1) is the owner's Engineering perk (shared/skillPerks.ts). */
export const recipeTicks = (r: FRecipe, mul = 1) => Math.max(1, Math.round((r.secs * 1000 * Math.max(0.5, Math.min(1, Number(mul) || 1))) / TICK_MS));
/** Everything an input chest may be filtered to: ores + all registered bars/goods. */
export const CHEST_ITEMS: string[] = [...Object.keys(ORES).map((o) => `ore:${o}`), ...Object.values(GOODS).map((g) => `${g.type}:${g.id}`)];
export const isItemKey = (v: unknown): v is string => typeof v === 'string' && CHEST_ITEMS.includes(v);

export interface Ent {
  id: number; k: Kind; x: number; y: number; d: Dir;
  r?: string;            // machine recipe
  f?: string;            // input chest filter
  it?: string | null;    // item on belt / splitter / in inserter hand
  m?: number;            // transient: 1+dir the item arrived travelling (render interpolation)
  p?: number;            // machine progress ticks (0 idle)
  ib?: Record<string, number>; // machine input buffer
  ob?: number;           // machine output buffer (qty of recipe output)
  rr?: number;           // round-robin cursor
  w?: [number, number, number]; // splitter output weights [left, ahead, right] (absent = 1:1:1)
  t?: number;            // inserter swing timer
}
export interface FState { v: 1; floor: number; tick: number; at: number; seen?: number; ents: Ent[]; kit: Partial<Record<Kind, number>>; seq: number; made: Record<string, number>; stored: Record<string, number>; /** Engineering perk craft-time multiplier (server-set) */ spd?: number }
/** Splitter ratios (pt1301u): integer weight 0..MAX_SPLIT_W per output [left, ahead, right]; at least one > 0. */
export const MAX_SPLIT_W = 9;
export const isSplitWeights = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_SPLIT_W) && v.some((n) => n > 0);
export const splitWeights = (e: { w?: unknown }): [number, number, number] => (isSplitWeights(e.w) ? e.w : [1, 1, 1]);
const SEQ = new Map<string, number[]>();
/** Deterministic smooth weighted round-robin order of output slots (0 left, 1 ahead, 2 right). 1:1:1 -> [0,1,2]. */
export function splitSeq(w: [number, number, number]): number[] {
  const key = w.join(':'); let seq = SEQ.get(key); if (seq) return seq;
  seq = []; const cur = [0, 0, 0]; const tot = w[0] + w[1] + w[2];
  for (let n = 0; n < tot; n++) { let b = -1; for (let i = 0; i < 3; i++) { if (!w[i]) continue; cur[i] += w[i]; if (b < 0 || cur[i] > cur[b]) b = i; } cur[b] -= tot; seq.push(b); }
  SEQ.set(key, seq); return seq;
}
export const splitLabel = (e: { w?: unknown }) => splitWeights(e).join(':');
export interface Storage { get(key: string): number; add(key: string, delta: number): void }

/** A machine holds at most one finished craft; while it holds any output it stops (backs up) until a belt/inserter/chest takes it. Over-cap legacy buffers just drain. */
export const OUT_CAP_CRAFTS = 1;
export const backedUp = (e: { ob?: number }) => (e.ob ?? 0) > 0;
export const INSERTER_TICKS = 2;

export function newState(floor: number, now: number): FState {
  return { v: 1, floor, tick: 0, at: now, seen: now, ents: [], kit: { belt: 24, chest_in: 2, chest_out: 1, smelter: 1, inserter: 2 }, seq: 0, made: {}, stored: {} };
}

export function cells(e: { k: Kind; x: number; y: number }): Array<[number, number]> {
  const s = KINDS[e.k].size; const out: Array<[number, number]> = [];
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) out.push([e.x + dx, e.y + dy]);
  return out;
}
export type Grid = Map<number, Ent>;
export const cellId = (x: number, y: number) => y * 1000 + x;
export function gridOf(s: FState): Grid { const g: Grid = new Map(); for (const e of s.ents) for (const [x, y] of cells(e)) g.set(cellId(x, y), e); return g; }

/** Placement check (server-authoritative): inside floor, no overlap, valid dir. */
export function canPlace(s: FState, g: Grid, k: Kind, x: number, y: number, d: number, ignore?: number): string | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(d) || d < 0 || d > 3) return 'Bad spot.';
  const size = floorSize(s.floor);
  for (const [cx, cy] of cells({ k, x, y })) {
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) return 'That is outside the building. Expand the floor.';
    const o = g.get(cellId(cx, cy)); if (o && o.id !== ignore) return 'Something is already there.';
  }
  return null;
}

/** Machine output front cells (the side it faces). */
export function frontCells(e: Ent): Array<[number, number]> {
  const s = KINDS[e.k].size;
  if (s === 1) return [[e.x + DX[e.d], e.y + DY[e.d]]];
  switch (e.d) {
    case 0: return [[e.x + 2, e.y], [e.x + 2, e.y + 1]];
    case 1: return [[e.x, e.y + 2], [e.x + 1, e.y + 2]];
    case 2: return [[e.x - 1, e.y], [e.x - 1, e.y + 1]];
    default: return [[e.x, e.y - 1], [e.x + 1, e.y - 1]];
  }
}

function accepts(e: Ent, key: string, st?: Storage): boolean {
  if (KINDS[e.k].machine) {
    const r = frecipe(e.r); if (!r) return false;
    const need = r.in.find(([k]) => k === key); if (!need) return false;
    return (e.ib?.[key] ?? 0) < need[1] * 2;
  }
  // output chests back up (instead of overflowing) once that banked stack hits the storage limit; "Only accept" filter
  return e.k === 'chest_out' && (!e.f || e.f === key) && (!st || st.get(key) < MAX_BANKED_STACK);
}
function give(s: FState, st: Storage, e: Ent, key: string) {
  if (e.k === 'chest_out') { st.add(key, 1); s.stored[key] = (s.stored[key] ?? 0) + 1; return; }
  e.ib = e.ib ?? {}; e.ib[key] = (e.ib[key] ?? 0) + 1;
}

/** Advance one tick. Returns true if anything changed (false = quiescent: every later tick is identical too). */
export function step(s: FState, g: Grid, st: Storage): boolean {
  let ch = false;
  const at = (x: number, y: number) => g.get(cellId(x, y));
  for (const e of s.ents) if (e.m) { e.m = 0; ch = true; }
  // 1) machines craft and push output out of the front side
  for (const e of s.ents) {
    if (!KINDS[e.k].machine) continue;
    const r = frecipe(e.r); if (!r) continue;
    if (!e.p) {
      if (!backedUp(e) && r.in.every(([k, q]) => (e.ib?.[k] ?? 0) >= q)) {
        for (const [k, q] of r.in) { e.ib![k] -= q; if (!e.ib![k]) delete e.ib![k]; }
        e.p = 1; ch = true;
      }
    } else if (++e.p >= recipeTicks(r, s.spd)) { e.p = 0; e.ob = (e.ob ?? 0) + r.out[1]; s.made[r.out[0]] = (s.made[r.out[0]] ?? 0) + r.out[1]; ch = true; }
    else ch = true;
    if (e.ob) {
      const fc = frontCells(e);
      for (let i = 0; i < fc.length && e.ob; i++) {
        const idx = ((e.rr ?? 0) + i) % fc.length; const t = at(fc[idx][0], fc[idx][1]);
        if (!t || t === e) continue;
        if (isBeltish(t.k) && !t.it) { t.it = r.out[0]; t.m = 0; e.ob--; e.rr = idx + 1; ch = true; break; }
        if (t.k !== 'inserter' && accepts(t, r.out[0], st)) { give(s, st, t, r.out[0]); e.ob--; e.rr = idx + 1; ch = true; break; }
      }
    }
  }
  // 2) input chests push their filter item forward (belt or machine), 1/tick
  for (const e of s.ents) {
    if (e.k !== 'chest_in' || !e.f || st.get(e.f) < 1) continue;
    const t = at(e.x + DX[e.d], e.y + DY[e.d]); if (!t) continue;
    if (isBeltish(t.k) && !t.it) { st.add(e.f, -1); t.it = e.f; t.m = 0; ch = true; }
    else if (KINDS[t.k].machine && accepts(t, e.f, st)) { st.add(e.f, -1); give(s, st, t, e.f); ch = true; }
  }
  // 3) inserters
  for (const e of s.ents) {
    if (e.k !== 'inserter') continue;
    const src = at(e.x - DX[e.d], e.y - DY[e.d]); const dst = at(e.x + DX[e.d], e.y + DY[e.d]);
    if (e.t) { e.t--; ch = true; continue; }
    if (e.it) {
      if (!dst) continue;
      if (isBeltish(dst.k) && !dst.it) { dst.it = e.it; dst.m = 0; e.it = null; ch = true; }
      else if (dst.k !== 'inserter' && !isBeltish(dst.k) && accepts(dst, e.it, st)) { give(s, st, dst, e.it); e.it = null; ch = true; }
      continue;
    }
    if (!src || !dst) continue;
    const want = (k: string) => (!e.f || e.f === k) && ( isBeltish(dst.k) ? !dst.it : dst.k !== 'inserter' && accepts(dst, k, st));
    let got: string | null = null;
    if (isBeltish(src.k) && src.it && want(src.it)) { got = src.it; src.it = null; }
    else if (src.k === 'chest_in' && src.f && st.get(src.f) > 0 && want(src.f)) { got = src.f; st.add(src.f, -1); }
    else if (KINDS[src.k].machine && src.ob) { const r = frecipe(src.r); if (r && want(r.out[0])) { got = r.out[0]; src.ob--; } }
    if (got) { e.it = got; e.t = INSERTER_TICKS - 1; ch = true; }
  }
  // 4) belts (downstream first so a full line flows as a block)
  const ug = undergroundPairs(s, g); const ugOut = new Set([...ug.values()].map((x) => x.id));
  const done = new Set<number>();
  const move = (e: Ent, depth: number) => {
    if (done.has(e.id)) return; done.add(e.id);
    if (!e.it) return;
    if (e.k === 'underground') {
      const out = ug.get(e.id);
      if (out) { if (out.it && !done.has(out.id) && depth < 2000) move(out, depth + 1); if (!out.it) { out.it = e.it; out.m = 0; e.it = null; done.add(out.id); ch = true; } return; }
    }
    let dirs: number[] = [e.d];
    let adv = 0;
    if (e.k === 'splitter') {
      const seq = splitSeq(splitWeights(e)); const c = (e.rr ?? 0) % seq.length; adv = (c + 1) % seq.length;
      const order: number[] = []; for (let i = 0; i < seq.length; i++) { const sl = seq[(c + i) % seq.length]; if (!order.includes(sl)) order.push(sl); }
      dirs = order.map((sl) => (e.d + [3, 0, 1][sl]) % 4);
    }
    for (const d of dirs) {
      const t = at(e.x + DX[d], e.y + DY[d]); if (!t) continue;
      if (isBeltish(t.k)) {
        if (t.it && !done.has(t.id) && depth < 2000) move(t, depth + 1);
        if (!t.it && !(t.k !== 'splitter' && t.d === (d + 2) % 4) && !(t.k === 'underground' && ugOut.has(t.id) && d === t.d)) { t.it = e.it; t.m = 1 + d; e.it = null; done.add(t.id); ch = true; if (e.k === 'splitter') e.rr = adv; return; }
      } else if (t.k !== 'inserter' && t.k !== 'chest_in' && accepts(t, e.it, st)) { give(s, st, t, e.it); e.it = null; ch = true; if (e.k === 'splitter') e.rr = adv; return; }
    }
  };
  for (const e of s.ents) if (isBeltish(e.k)) move(e, 0);
  s.tick++;
  return ch;
}

/** Underground pairs: entrance id -> exit. An underground pairs with the nearest same-facing underground 1..UG_MAX tiles ahead that is not already an entrance's exit. */
export function undergroundPairs(s: FState, g: Grid): Map<number, Ent> {
  const pairs = new Map<number, Ent>(); const taken = new Set<number>();
  const ugs = s.ents.filter((e) => e.k === 'underground').sort((a, b) => a.id - b.id);
  for (const e of ugs) {
    if (taken.has(e.id)) continue;
    for (let i = 1; i <= UG_MAX + 1; i++) {
      const t = g.get(cellId(e.x + DX[e.d] * i, e.y + DY[e.d] * i));
      if (t && t.k === 'underground' && t.d === e.d) { if (!taken.has(t.id) && !pairs.has(t.id) && i > 1) { pairs.set(e.id, t); taken.add(t.id); } break; }
    }
  }
  return pairs;
}

/** Catch the sim up to `now` (capped). Stops early when quiescent. Returns ticks actually simulated. */
export function advance(s: FState, st: Storage, now: number, cap = MAX_CATCHUP_MS): number {
  if (now < s.at) return 0;
  let n = Math.floor((now - s.at) / TICK_MS);
  if (n <= 0) return 0;
  const capT = Math.floor(cap / TICK_MS);
  const skipped = n > capT ? n - capT : 0; n -= skipped;
  const g = gridOf(s); let ran = 0;
  for (; ran < n; ran++) if (!step(s, g, st)) { ran++; s.tick += n - ran; break; }
  s.at += (n + skipped) * TICK_MS;
  return ran;
}

/** Items held inside entities (returned to storage when picked up). */
export function contents(e: Ent): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  if (e.it) out.push([e.it, 1]);
  for (const [k, q] of Object.entries(e.ib ?? {})) if (q > 0) out.push([k, q]);
  const r = frecipe(e.r); if (r && e.ob) out.push([r.out[0], e.ob]);
  return out;
}

/** Value multiplier check used by tests/balance: each recipe's output is worth more than its inputs. */
/** Recipes that consume this item (for the recipe browser's chain view). */
export const usedIn = (key: string) => FRECIPES.filter((r) => r.in.some(([k]) => k === key));
/** Recipe that makes this item, if any. */
export const madeBy = (key: string) => FRECIPES.find((r) => r.out[0] === key);
/** Chain depth: 0 = raw input (ore / imported), 1 = made from raw only, ... */
export function tierOf(key: string, seen = new Set<string>()): number {
  const r = madeBy(key); if (!r || seen.has(key)) return 0; seen.add(key);
  return 1 + Math.max(...r.in.map(([k]) => tierOf(k, seen)));
}
export const recipeIn = (r: FRecipe) => r.in.reduce((t, [k, q]) => t + q * priceOfKey(k), 0);
export const recipeOut = (r: FRecipe) => r.out[1] * priceOfKey(r.out[0]);
