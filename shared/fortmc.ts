/**
 * Fort McChud: an oil-sands boomtown on its own map, reached by plane from Chud Hub International (like Chud Resort).
 *
 * A Factorio-style oil & gas chain the player builds and keeps running:
 *   survey a tract -> lease it -> drill wells (+ pumpjacks) -> gathering pipeline -> separator
 *   separator: wellstream -> crude + raw gas (+ produced water, discarded)
 *   gas plant: raw gas -> natural gas + NGL + sulfur (sour gas)
 *   refinery (crude unit + hydrotreater): crude -> naphtha + diesel + gasoline + residue + sulfur (sour crude)
 *   reformer: naphtha -> gasoline        coker: residue -> diesel + petroleum coke
 *   steam cracker: NGL (or naphtha) -> ethylene        polymer plant: ethylene -> plastics
 *   gas turbine: burns natural gas -> power. Every unit draws MW; short power throttles the whole site.
 *   tank farm: every product has a storage cap; a full tank backs the chain up.
 *   maintenance: units wear while they run; under 60% condition they slow down, under 15% they stop until repaired.
 * Plus the Deep Ore Mine: a very expensive build that digs a fixed ore mix every hour (power-hungry).
 *
 * Products are sold at the Fort McChud Commodity Exchange (shared daily revenue tiers) or shipped into the player's
 * factory (ores, and petroleum coke as coal). All chip amounts below are BASE chips; the server applies px().
 * The sim is pure and deterministic: settle(state, now) advances in STEP_MS steps (catch-up capped at MAX_CATCHUP_MS).
 */
import { ORES, type OreId } from './mines.js';

export const FORTMC_TICKET_BASE = 1_500;
export const STEP_MS = 5 * 60_000;
export const MAX_CATCHUP_MS = 24 * 3600_000;
const STEP_H = STEP_MS / 3600_000;

// ---- products
export type Product = 'wellstream' | 'crude' | 'rawgas' | 'natgas' | 'ngl' | 'naphtha' | 'diesel' | 'gasoline' | 'residue' | 'petcoke' | 'sulfur' | 'ethylene' | 'plastic';
export interface ProductDef { id: Product; name: string; icon: string; price: number; color: string; sellable: boolean }
export const PRODUCTS: Record<Product, ProductDef> = {
  wellstream: { id: 'wellstream', name: 'Wellstream', icon: '🛢️', price: 0, color: '#3a2f25', sellable: false },
  crude:      { id: 'crude',      name: 'Crude oil',  icon: '🛢️', price: 10.9375, color: '#1d1a16', sellable: true },
  rawgas:     { id: 'rawgas',     name: 'Raw gas',    icon: '💨', price: 0, color: '#9aa4a8', sellable: false },
  natgas:     { id: 'natgas',     name: 'Natural gas', icon: '🔥', price: 3.125, color: '#6ab0ff', sellable: true },
  ngl:        { id: 'ngl',        name: 'NGL (ethane/propane)', icon: '🧪', price: 9.375, color: '#b48aff', sellable: true },
  naphtha:    { id: 'naphtha',    name: 'Naphtha',    icon: '⚗️', price: 12.5, color: '#e8d27a', sellable: true },
  diesel:     { id: 'diesel',     name: 'Diesel',     icon: '⛽', price: 26.5625, color: '#d89a3a', sellable: true },
  gasoline:   { id: 'gasoline',   name: 'Gasoline',   icon: '⛽', price: 29.6875, color: '#f2c84a', sellable: true },
  residue:    { id: 'residue',    name: 'Heavy residue', icon: '🟫', price: 3.125, color: '#4a3424', sellable: true },
  petcoke:    { id: 'petcoke',    name: 'Petroleum coke', icon: '⚫', price: 4.6875, color: '#2b2b2e', sellable: true },
  sulfur:     { id: 'sulfur',     name: 'Sulfur',     icon: '🟨', price: 6.25, color: '#f0e040', sellable: true },
  ethylene:   { id: 'ethylene',   name: 'Ethylene',   icon: '🧪', price: 23.4375, color: '#8ae0d0', sellable: true },
  plastic:    { id: 'plastic',    name: 'Plastics',   icon: '🧴', price: 43.75, color: '#f4f4f4', sellable: true },
};
export const PRODUCT_ORDER = Object.keys(PRODUCTS) as Product[];
export const isProduct = (v: unknown): v is Product => typeof v === 'string' && v in PRODUCTS;

// ---- land
export const TRACTS = 10;
export const SURVEY_COST = 2_500;
export const LEASE_BASE = 30_000;
export const WELLS_PER_TRACT = 4;
export const WELL_COST = 45_000, PUMPJACK_COST = 20_000;
export const WELL_RATE = 60;         // wellstream / hour at richness 1, full condition, no pumpjack (buffed Nov 9 2026)
export const PUMPJACK_MULT = 1.8;
export const WELL_MW = 0.3, PUMPJACK_MW = 0.5;
export const PIPES = [{ cap: 0, cost: 0 }, { cap: 120, cost: 15_000 }, { cap: 360, cost: 40_000 }] as const; // tier 1, tier 2 upgrade
export const WATER_CUT = 0.10;
export interface TractInfo { n: number; name: string; richness: number; gas: number; sour: number; lease: number; x: number; z: number }
const rnd = (i: number) => { const x = Math.sin(i * 91.7 + 17.3) * 43758.5453; return x - Math.floor(x); };
const TRACT_NAMES = ['Athabasca Flats', 'Muskeg Ridge', 'Clearwater Bend', 'Firebag North', 'Christina Lake', 'Steepbank', 'Horizon Sands', 'Kearl Muskeg', 'Birch Mountain', 'Peace Point'];
export function tractInfo(n: number): TractInfo {
  const richness = Math.round((0.6 + rnd(n) * 0.8) * 100) / 100, gas = Math.round((0.15 + rnd(n + 20) * 0.3) * 100) / 100, sour = Math.round(rnd(n + 40) * 0.3 * 100) / 100;
  const col = (n - 1) % 5, row = Math.floor((n - 1) / 5);
  return { n, name: TRACT_NAMES[n - 1] ?? `Tract ${n}`, richness, gas, sour, lease: Math.round((LEASE_BASE * richness) / 500) * 500, x: -110 + col * 44, z: -80 + row * 40 };
}
export const isTract = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= TRACTS;

// ---- plant units
export type UnitKind = 'separator' | 'gas_plant' | 'refinery' | 'reformer' | 'coker' | 'cracker' | 'polymer' | 'turbine' | 'tank';
export interface UnitDef { id: UnitKind; name: string; icon: string; cost: number; mw: number; cap: number; input?: Product; alt?: Product; out: Array<[Product, number]>; desc: string; max: number }
/** Sulfur yield per input unit is `sulfurK x sourness` (gas plant: sour gas; refinery: sour crude). */
export const SULFUR_K: Partial<Record<UnitKind, number>> = { gas_plant: 0.4, refinery: 0.3 };
export const UNITS: Record<UnitKind, UnitDef> = {
  separator: { id: 'separator', name: 'Separator', icon: '⚙️', cost: 60_000, mw: 1.5, cap: 240, input: 'wellstream', out: [], desc: 'Splits wellstream into crude and raw gas by each tract’s gas ratio; 10% produced water is discarded.', max: 6 },
  gas_plant: { id: 'gas_plant', name: 'Gas plant', icon: '🏭', cost: 180_000, mw: 3, cap: 150, input: 'rawgas', out: [['natgas', 0.65], ['ngl', 0.25]], desc: 'Raw gas -> 65% natural gas + 25% NGL, plus sulfur from sour gas.', max: 4 },
  refinery:  { id: 'refinery',  name: 'Refinery',  icon: '🏗️', cost: 280_000, mw: 3.5, cap: 120, input: 'crude', out: [['naphtha', 0.3], ['diesel', 0.28], ['gasoline', 0.12], ['residue', 0.25]], desc: 'Crude -> naphtha, diesel, gasoline and heavy residue; the hydrotreater pulls sulfur from sour crude.', max: 4 },
  reformer:  { id: 'reformer',  name: 'Catalytic reformer', icon: '⚗️', cost: 140_000, mw: 2, cap: 60, input: 'naphtha', out: [['gasoline', 0.85]], desc: 'Naphtha -> 85% gasoline.', max: 4 },
  coker:     { id: 'coker',     name: 'Delayed coker', icon: '🔥', cost: 160_000, mw: 2.5, cap: 50, input: 'residue', out: [['diesel', 0.45], ['petcoke', 0.45]], desc: 'Heavy residue -> 45% diesel + 45% petroleum coke (ships to your factory as coal).', max: 4 },
  cracker:   { id: 'cracker',   name: 'Steam cracker', icon: '🧪', cost: 450_000, mw: 6, cap: 50, input: 'ngl', alt: 'naphtha', out: [['ethylene', 0.75]], desc: 'NGL (or naphtha when NGL runs out) -> 75% ethylene.', max: 3 },
  polymer:   { id: 'polymer',   name: 'Polymer plant', icon: '🧴', cost: 260_000, mw: 3, cap: 40, input: 'ethylene', out: [['plastic', 0.9]], desc: 'Ethylene -> 90% plastics.', max: 3 },
  turbine:   { id: 'turbine',   name: 'Gas turbine', icon: '⚡', cost: 90_000, mw: 0, cap: 25, input: 'natgas', out: [], desc: 'Burns 25 natural gas / hour for 15 MW.', max: 8 },
  tank:      { id: 'tank',      name: 'Storage tank', icon: '🛢️', cost: 25_000, mw: 0, cap: 0, out: [], desc: '+1,500 storage for every product.', max: 10 },
};
export const UNIT_ORDER: UnitKind[] = ['separator', 'gas_plant', 'refinery', 'reformer', 'coker', 'cracker', 'polymer', 'turbine', 'tank'];
export const PROCESS_ORDER: UnitKind[] = ['separator', 'gas_plant', 'refinery', 'reformer', 'coker', 'cracker', 'polymer'];
export const isUnitKind = (v: unknown): v is UnitKind => typeof v === 'string' && v in UNITS;
export const TURBINE_MW = 15;
export const GRID_MW = 8; // free utility tie-in: enough for wells + separator + a starter refinery without throttling
export const TANK_BASE = 400, TANK_PER = 1_500;

// ---- maintenance
export const WEAR_PER_H = 0.25;          // condition points / hour at full load
export const SLOW_BELOW = 60, BROKEN_BELOW = 15;
export const REPAIR_K = 0.10;            // full repair 0 -> 100 costs 10% of the build price
export const efficiency = (cond: number) => (cond < BROKEN_BELOW ? 0 : cond >= SLOW_BELOW ? 1 : cond / SLOW_BELOW);
export const repairCost = (build: number, cond: number) => Math.ceil(build * REPAIR_K * Math.max(0, 100 - cond) / 100);

// ---- Deep Ore Mine (very expensive on purpose)
export const MINE_LEVELS = [
  { cost: 2_500_000, rate: 400, mw: 10 },
  { cost: 3_000_000, rate: 800, mw: 16 },
  { cost: 5_000_000, rate: 1_400, mw: 24 },
] as const;
export const MINE_MIX: Array<[OreId, number]> = [['stone', 0.25], ['coal', 0.25], ['copper', 0.18], ['iron', 0.17], ['silver', 0.08], ['gold', 0.05], ['gem', 0.015], ['diamond', 0.005]];
export const mineBuildCost = (level: number) => MINE_LEVELS.slice(0, level).reduce((a, l) => a + l.cost, 0);
export const ORE_VALUE_PER_UNIT = MINE_MIX.reduce((a, [id, w]) => a + ORES[id].price * w, 0);

// ---- selling: daily revenue tiers (per player, base chips, Alberta day)
export const SELL_TIERS: Array<{ upTo: number; rate: number }> = [{ upTo: 150_000, rate: 1 }, { upTo: 400_000, rate: 0.4 }, { upTo: Infinity, rate: 0.1 }];
export function sellPayout(gross: number, already: number): number {
  let left = gross, at = already, pay = 0, lo = 0;
  for (const t of SELL_TIERS) { if (left <= 0) break; const take = Math.min(left, Math.max(0, t.upTo - Math.max(at, lo))); pay += take * t.rate; left -= take; at += take; lo = t.upTo; }
  return Math.floor(pay + 1e-9);
}

// ---- state
export interface Well { jack: boolean; cond: number }
export interface TractState { leased: boolean; pipe: number; wells: Well[] }
export interface Unit { id: number; k: UnitKind; cond: number; on: boolean }
export interface FortState {
  v: 1; at: number; seq: number;
  surveyed: number[]; tracts: Record<string, TractState>;
  units: Unit[]; stock: Partial<Record<Product, number>>; ore: Partial<Record<OreId, number>>;
  /** running sourness of the crude and raw-gas tanks (0..0.3) */ sc: number; sg: number;
  mine: { level: number; cond: number; on: boolean } | null;
  made: Partial<Record<Product | OreId, number>>;
  power: { supply: number; demand: number };
  /** Volume-weighted gas ratio / sourness of the wellstream tank. */ gr: number; sw: number;
}
export function newFort(now: number): FortState {
  return { v: 1, at: now, seq: 0, surveyed: [], tracts: {}, units: [], stock: {}, ore: {}, sc: 0, sg: 0, gr: 0.3, sw: 0, mine: null, made: {}, power: { supply: GRID_MW, demand: 0 } };
}
export const tankCap = (s: FortState) => TANK_BASE + TANK_PER * s.units.filter((u) => u.k === 'tank').length;
export const unitCount = (s: FortState, k: UnitKind) => s.units.filter((u) => u.k === k).length;
const st = (s: FortState, p: Product) => s.stock[p] ?? 0;
const add = (s: FortState, p: Product, n: number) => { s.stock[p] = Math.max(0, st(s, p) + n); if (n > 0) s.made[p] = (s.made[p] ?? 0) + n; };

/** Tess QA #6: what the power header says about turbines. 'idle' = built and switched on but no natural gas to burn. */
export function turbineStatus(s: FortState): { built: number; running: number; idle: boolean } {
  const on = s.units.filter((u) => u.k === 'turbine' && u.on && efficiency(u.cond) > 0); const gas = st(s, 'natgas') > 1e-6;
  return { built: s.units.filter((u) => u.k === 'turbine').length, running: gas ? on.length : 0, idle: on.length > 0 && !gas };
}
/**
 * Power the site actually draws this step. Only equipment with work to do pulls its MW: a well needs its pipeline and room
 * in the wellstream tank; a process unit needs input in its tank (or a running upstream unit feeding it) and room for its
 * outputs; the mine needs ore room. Previously every switched-on unit was billed at full load even when idle (e.g. a
 * refinery with no crude, a cracker with no NGL), so a starter site showed "11.6 of 4 MW" and the idle units throttled the
 * ones that did have work.
 */
export function powerDemand(s: FortState): number {
  const cap = tankCap(s); const room = (p: Product) => cap - st(s, p) > 1e-6;
  let mw = 0; let wellsFlow = false;
  if (room('wellstream')) for (const t of Object.values(s.tracts)) if (t.leased && t.pipe > 0) for (const w of t.wells) if (efficiency(w.cond) > 0) { mw += WELL_MW + (w.jack ? PUMPJACK_MW : 0); wellsFlow = true; }
  const fed = new Set<Product>(); if (wellsFlow) fed.add('wellstream');
  for (const k of PROCESS_ORDER) {
    const d = UNITS[k]; const list = s.units.filter((u) => u.k === k && u.on && efficiency(u.cond) > 0); if (!list.length) continue;
    const has = (p: Product | undefined) => !!p && (st(s, p) > 1e-6 || fed.has(p));
    if (!has(d.input) && !has(d.alt)) continue;
    const outs: Product[] = k === 'separator' ? ['crude', 'rawgas'] : d.out.map(([p]) => p);
    if (outs.length && !outs.some(room)) continue;
    // only the wellstream counts as "fed" (wells flow straight in); downstream units need product actually in the tank
    mw += d.mw * list.length;
  }
  if (s.mine?.on && efficiency(s.mine.cond) > 0 ) {
    const full = MINE_MIX.every(([id]) => (s.ore[id] ?? 0) >= cap - 1e-6);
    if (!full) mw += MINE_LEVELS[s.mine.level - 1]!.mw;
  }
  return Math.round(mw * 100) / 100;
}

/** One sim step of `h` hours. Mutates s. */
export function step(s: FortState, h = STEP_H): void {
  const cap = tankCap(s);
  const space = (p: Product) => Math.max(0, cap - st(s, p));
  // 1. power: grid + turbines (fuelled from the natural-gas tank)
  const turbines = s.units.filter((u) => u.k === 'turbine' && u.on && efficiency(u.cond) > 0);
  const fuelNeed = turbines.reduce((a, u) => a + UNITS.turbine.cap * efficiency(u.cond) * h, 0);
  const fuelR = fuelNeed > 0 ? Math.min(1, st(s, 'natgas') / fuelNeed) : 0;
  add(s, 'natgas', -fuelNeed * fuelR);
  const supply = GRID_MW + turbines.reduce((a, u) => a + TURBINE_MW * efficiency(u.cond) * fuelR, 0);
  for (const u of turbines) u.cond = Math.max(0, u.cond - WEAR_PER_H * h * fuelR);
  const demand = powerDemand(s);
  const pr = demand > 0 ? Math.min(1, supply / demand) : 1;
  s.power = { supply: Math.round(supply * 100) / 100, demand };
  // 2. wells -> pipeline -> wellstream tank (gas ratio + sourness mix in)
  let flowTotal = 0, gasW = 0, sourW = 0;
  for (const [key, t] of Object.entries(s.tracts)) {
    if (!t.leased || t.pipe <= 0 || !t.wells.length) continue;
    const info = tractInfo(Number(key));
    const pot = t.wells.reduce((a, w) => a + WELL_RATE * info.richness * (w.jack ? PUMPJACK_MULT : 1) * efficiency(w.cond), 0) * pr * h;
    const flow = Math.min(pot, PIPES[t.pipe]!.cap * h, space('wellstream') - flowTotal);
    if (flow <= 0) continue;
    const load = pot > 0 ? flow / pot : 0;
    for (const w of t.wells) w.cond = Math.max(0, w.cond - WEAR_PER_H * h * load * pr);
    flowTotal += flow; gasW += flow * info.gas; sourW += flow * info.sour;
  }
  if (flowTotal > 0) {
    const old = st(s, 'wellstream');
    s.gr = (s.gr * old + gasW) / (old + flowTotal);
    // sourness rides along with the wellstream; we fold it straight into the crude/gas averages when separated
    s.sw = ((s.sw ?? 0) * old + sourW) / (old + flowTotal);
    add(s, 'wellstream', flowTotal);
  }
  const sw = s.sw ?? 0;
  // 3. processing units, upstream to downstream
  for (const k of PROCESS_ORDER) {
    const d = UNITS[k]; const list = s.units.filter((u) => u.k === k && u.on && efficiency(u.cond) > 0); if (!list.length) continue;
    const capH = list.reduce((a, u) => a + d.cap * efficiency(u.cond), 0) * pr * h; if (capH <= 0) continue;
    let src: Product = d.input!; if (d.alt && st(s, src) < 1e-6) src = d.alt;
    let amt = Math.min(capH, st(s, src));
    // output room: every output must fit
    const outs: Array<[Product, number]> = k === 'separator' ? [['crude', 1 - WATER_CUT - s.gr], ['rawgas', s.gr]] : [...d.out];
    const sk = SULFUR_K[k]; if (sk) outs.push(['sulfur', sk * (k === 'gas_plant' ? s.sg : s.sc)]);
    for (const [p, y] of outs) if (y > 0) amt = Math.min(amt, space(p) / y);
    if (amt <= 1e-9) continue;
    add(s, src, -amt);
    for (const [p, y] of outs) {
      if (y <= 0) continue;
      if (k === 'separator' && p === 'crude') { const o = st(s, 'crude'); s.sc = (s.sc * o + sw * amt * y) / (o + amt * y || 1); }
      if (k === 'separator' && p === 'rawgas') { const o = st(s, 'rawgas'); s.sg = (s.sg * o + sw * amt * y) / (o + amt * y || 1); }
      add(s, p, amt * y);
    }
    const load = amt / capH;
    for (const u of list) u.cond = Math.max(0, u.cond - WEAR_PER_H * h * load * pr);
  }
  // 4. Deep Ore Mine
  if (s.mine?.on && efficiency(s.mine.cond) > 0) {
    const lv = MINE_LEVELS[s.mine.level - 1]!; const dug = lv.rate * efficiency(s.mine.cond) * pr * h; let used = 0;
    for (const [id, w] of MINE_MIX) { const n = Math.min(dug * w, Math.max(0, cap - (s.ore[id] ?? 0))); s.ore[id] = (s.ore[id] ?? 0) + n; s.made[id] = (s.made[id] ?? 0) + n; used += n; }
    s.mine.cond = Math.max(0, s.mine.cond - WEAR_PER_H * h * (dug > 0 ? used / dug : 0) * pr);
  }
}

/** Advance to `now` (whole steps only; leftover time carries over). Returns steps run. */
export function settle(s: FortState, now: number): number {
  if (now <= s.at) return 0;
  if (now - s.at > MAX_CATCHUP_MS) s.at = now - MAX_CATCHUP_MS; // crews only run a day unattended
  const n = Math.floor((now - s.at) / STEP_MS);
  for (let i = 0; i < n; i++) step(s);
  s.at += n * STEP_MS; return n;
}

/** Whole units available (stocks are fractional internally). */
export const whole = (n: number | undefined) => Math.floor((n ?? 0) + 1e-9);
/** Total base build cost of a fort (tracts, pipes, wells/jacks, plant units, Deep Ore Mine) at list prices. */
export function fortBuildValue(s: FortState): number {
  let v = 0;
  for (const [k, t] of Object.entries(s.tracts)) { if (t.leased) v += tractInfo(Number(k)).lease; v += PIPES.slice(1, t.pipe + 1).reduce((a, p) => a + p.cost, 0); for (const w of t.wells) v += WELL_COST + (w.jack ? PUMPJACK_COST : 0); }
  for (const u of s.units) v += UNITS[u.k].cost;
  if (s.mine) v += mineBuildCost(s.mine.level);
  return v;
}
/** Sellable tank-farm crude & products at house list sell prices (no sell-buff; same spirit as priceOf for ore NW). Wear is not marked down — property-style paid/list basis, repairs are separate upkeep. */
export function fortStockValue(s: FortState): number {
  let v = 0;
  for (const [id, qty] of Object.entries(s.stock ?? {})) {
    if (!isProduct(id)) continue; const p = PRODUCTS[id]; if (!p.sellable || !(p.price > 0)) continue;
    v += p.price * whole(qty);
  }
  return v;
}
/** Net-worth value of a fort: build basis + sellable stock. Does not include ore-bin feedstock (already valued when mined elsewhere) or survey sunk costs. */
export function fortWorth(s: FortState): number { return fortBuildValue(s) + fortStockValue(s); }

// ---- Fort McChud Mine (walk-in cave 'fortmc'): its exclusive industrial ores, unloaded at the fort, become feedstock.
/** ore -> [fort product, units per ore]. Each product is an existing unit input (refinery, gas plant, coker, steam cracker). */
export const FORT_FEED: Partial<Record<OreId, readonly [Product, number]>> = {
  oilsand: ['crude', 1],     // -> Refinery
  shale: ['rawgas', 2],      // -> Gas plant
  tarrock: ['residue', 2],   // -> Coker
  condensate: ['ngl', 2],    // -> Steam cracker
};
/** Unload a walk-in mine haul (item keys `ore:<id>` / `<type>:<id>`) into a fort state: feed ores -> stock, other ores -> ore bin. Returns what was taken. */
export function unloadHaul(s: FortState, haul: Map<string, number>): Array<[string, number]> {
  const took: Array<[string, number]> = [];
  for (const [key, q] of haul) {
    const n = Math.floor(q); if (!(n > 0)) continue; const [t, id] = key.split(':') as [string, string];
    if (t !== 'ore' || !(id in ORES)) continue; const o = id as OreId; const f = FORT_FEED[o];
    if (f) s.stock[f[0]] = (s.stock[f[0]] ?? 0) + n * f[1]; else s.ore[o] = (s.ore[o] ?? 0) + n;
    took.push([key, n]);
  }
  return took;
}

// ---- map spots (landmarks on the Fort McChud 3D map; x east, z south)
export const FORT_X0 = -140, FORT_X1 = 140, FORT_Z0 = -110, FORT_Z1 = 100;
export interface FortSpot { id: string; label: string; icon: string; blurb: string; x: number; z: number; w: number; d: number; h: number }
export const FORT_SPOTS: FortSpot[] = [
  { id: 'f-airport', label: 'Fort McChud Airport', icon: '✈️', blurb: 'Fly home to Chud Hub. The return flight is free.', x: -105, z: 70, w: 40, d: 14, h: 6 },
  { id: 'f-plant', label: 'Upgrader & Refinery Complex', icon: '🏭', blurb: 'Build separators, a gas plant, refinery, reformer, coker, steam cracker, polymer plant, turbines and tanks.', x: 10, z: 35, w: 60, d: 36, h: 24 },
  { id: 'f-exchange', label: 'Commodity Exchange', icon: '💹', blurb: 'Sell crude, gas, fuels, sulfur, ethylene, plastics and ore. Ship ore and petcoke to your factory.', x: 80, z: 70, w: 18, d: 14, h: 18 },
  { id: 'f-shaft', label: 'Fort McChud Mine (walk-in)', icon: '🪨', blurb: 'Walk in and dig: 40 floors of Oil Sand, Gas Shale, Tar Rock and Condensate. Unload your haul here to feed the plant.', x: -70, z: 26, w: 24, d: 18, h: 16 },
  { id: 'f-mine', label: 'Deep Ore Mine', icon: '⛏️', blurb: 'A very expensive open-pit + shaft mine: 400 ore/hour at level 1, power-hungry.', x: 105, z: 20, w: 34, d: 34, h: 20 },
];
