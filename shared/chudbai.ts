/**
 * Chudbai: a Gulf oil-boom city on its own map (glass skyscrapers, a marina, the Palm Chudeirah island), reached by a
 * premium plane ticket from Chud Hub International (same travel system as Chud Resort and Fort McChud).
 *
 * Its oil is the opposite of Fort McChud's heavy sour bitumen: LIGHT SWEET desert crude. No sulfur, almost no residue,
 * and a refinery that makes mostly high-value light products. Everything costs several times Fort McChud's prices, and
 * output is worth correspondingly more, so paybacks land in the same 10–30 day band.
 *
 *   survey a concession -> sign it -> drill desert wells (onshore blocks) or offshore platform wells (offshore blocks)
 *   -> (optional) ESP pump on a well -> gathering pipeline -> stabilizer
 *   stabilizer: wellstream -> light sweet crude + associated gas (5% produced water discarded)
 *   LNG train: associated gas -> LNG + condensate
 *   premium refinery: crude -> jet fuel + premium gasoline + naphtha + fuel oil
 *   aromatics complex: naphtha (or condensate) -> paraxylene
 *   solar farm: free daytime-averaged power; the grid tie covers a starter site. Short power throttles everything.
 *   storage tanks: every product has a cap; a full tank backs the chain up.
 *   maintenance: same wear / repair rules as Fort McChud (slow under 60%, stop under 15%, full repair = 10% of build).
 *
 * Products sell in person at the Chudbai Mercantile Exchange (3% export levy). Sales use the same daily revenue tiers
 * as Fort McChud's Commodity Exchange (SELL_TIERS), on their own per-player daily ledger. All chip amounts are BASE
 * chips; the server applies px(). The sim is pure and deterministic, stepped exactly like Fort McChud.
 */
import { SELL_TIERS, sellPayout, efficiency, repairCost, REPAIR_K, WEAR_PER_H, SLOW_BELOW, BROKEN_BELOW } from './fortmc.js';

export { SELL_TIERS, sellPayout, efficiency, repairCost, REPAIR_K, WEAR_PER_H, SLOW_BELOW, BROKEN_BELOW };
export const CHUDBAI_NAME = 'Chudbai';
export const CHUDBAI_TICKET_BASE = 12_000;
export const STEP_MS = 5 * 60_000;
export const MAX_CATCHUP_MS = 24 * 3600_000;
const STEP_H = STEP_MS / 3600_000;
/** Export levy on every sale at the Mercantile Exchange (stands in for Fort McChud's freight fee). */
export const EXPORT_LEVY = 0.03;

// ---- products
export type GProduct = 'wellstream' | 'crude' | 'assocgas' | 'lng' | 'condensate' | 'jetfuel' | 'gasoline' | 'naphtha' | 'fueloil' | 'paraxylene';
export interface GProductDef { id: GProduct; name: string; icon: string; price: number; color: string; sellable: boolean }
export const G_PRODUCTS: Record<GProduct, GProductDef> = {
  wellstream: { id: 'wellstream', name: 'Desert wellstream', icon: '🛢️', price: 0, color: '#5a4426', sellable: false },
  crude:      { id: 'crude',      name: 'Chudbai Light Sweet', icon: '🛢️', price: 25, color: '#b07a2a', sellable: true },
  assocgas:   { id: 'assocgas',   name: 'Associated gas', icon: '💨', price: 0, color: '#c8d0d4', sellable: false },
  lng:        { id: 'lng',        name: 'LNG',          icon: '❄️', price: 32, color: '#7ad0ff', sellable: true },
  condensate: { id: 'condensate', name: 'Condensate',   icon: '💧', price: 27, color: '#e6e0a8', sellable: true },
  jetfuel:    { id: 'jetfuel',    name: 'Jet fuel (Jet A-1)', icon: '✈️', price: 46, color: '#e9c36a', sellable: true },
  gasoline:   { id: 'gasoline',   name: 'Premium gasoline (98)', icon: '⛽', price: 50, color: '#f2c84a', sellable: true },
  naphtha:    { id: 'naphtha',    name: 'Light naphtha', icon: '⚗️', price: 27, color: '#f0e2a0', sellable: true },
  fueloil:    { id: 'fueloil',    name: 'Bunker fuel oil', icon: '🟫', price: 9, color: '#4a3424', sellable: true },
  paraxylene: { id: 'paraxylene', name: 'Paraxylene',   icon: '🧪', price: 62, color: '#f4f4f4', sellable: true },
};
export const G_PRODUCT_ORDER = Object.keys(G_PRODUCTS) as GProduct[];
export const isGProduct = (v: unknown): v is GProduct => typeof v === 'string' && v in G_PRODUCTS;

// ---- land: 6 onshore desert blocks + 4 offshore blocks in the Gulf
export const G_TRACTS = 10;
export const OFFSHORE_FROM = 7; // blocks 7..10 are offshore
export const G_SURVEY_COST = 15_000;
export const G_LEASE_BASE = 150_000, G_LEASE_OFFSHORE = 300_000;
export const G_WELLS_PER_TRACT = 4;
export const DESERT_WELL_COST = 210_000, OFFSHORE_WELL_COST = 450_000, ESP_COST = 90_000;
export const DESERT_WELL_RATE = 100, OFFSHORE_WELL_RATE = 170; // wellstream / hour at richness 1, full condition
export const ESP_MULT = 1.6;
export const DESERT_WELL_MW = 0.6, OFFSHORE_WELL_MW = 1.0, ESP_MW = 0.6;
export const G_PIPES = [{ cap: 0, cost: 0 }, { cap: 320, cost: 60_000 }, { cap: 1_000, cost: 170_000 }] as const;
export const G_WATER_CUT = 0.05;
export interface GTractInfo { n: number; name: string; offshore: boolean; richness: number; gas: number; lease: number; x: number; z: number }
const rnd = (i: number) => { const x = Math.sin(i * 57.3 + 4.1) * 43758.5453; return x - Math.floor(x); };
const G_TRACT_NAMES = ['Rub al Chudi', 'Dune Sea North', 'Oasis Flats', 'Camel Ridge', 'Liwa Sands', 'Mirage Basin', 'Pearl Bank', 'Coral Deep', 'Gulf Crown', 'Golden Shoal'];
const OFFSHORE_POS = [{ x: -200, z: 170 }, { x: -130, z: 215 }, { x: 120, z: 200 }, { x: 210, z: 165 }];
export const isOffshore = (n: number) => n >= OFFSHORE_FROM;
export function gTractInfo(n: number): GTractInfo {
  const off = isOffshore(n);
  const richness = Math.round((0.8 + rnd(n) * 0.6) * 100) / 100, gas = Math.round((0.12 + rnd(n + 20) * 0.18) * 100) / 100;
  const base = off ? G_LEASE_OFFSHORE : G_LEASE_BASE;
  // onshore blocks sit in two rows in the desert (north-west), offshore blocks out in the Gulf either side of the Palm
  const pos = off ? OFFSHORE_POS[n - OFFSHORE_FROM]! : { x: -160 + ((n - 1) % 3) * 44, z: -125 + Math.floor((n - 1) / 3) * 40 };
  return { n, name: G_TRACT_NAMES[n - 1] ?? `Block ${n}`, offshore: off, richness, gas, lease: Math.round((base * richness) / 1000) * 1000, ...pos };
}
export const isGTract = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= G_TRACTS;
export const wellCost = (n: number) => (isOffshore(n) ? OFFSHORE_WELL_COST : DESERT_WELL_COST);
export const wellRate = (n: number) => (isOffshore(n) ? OFFSHORE_WELL_RATE : DESERT_WELL_RATE);
export const wellMw = (n: number) => (isOffshore(n) ? OFFSHORE_WELL_MW : DESERT_WELL_MW);

// ---- plant units
export type GUnitKind = 'stabilizer' | 'lng' | 'refinery' | 'aromatics' | 'solar' | 'tank';
export interface GUnitDef { id: GUnitKind; name: string; icon: string; cost: number; mw: number; cap: number; input?: GProduct; alt?: GProduct; out: Array<[GProduct, number]>; desc: string; max: number }
export const G_UNITS: Record<GUnitKind, GUnitDef> = {
  stabilizer: { id: 'stabilizer', name: 'Crude stabilizer', icon: '⚙️', cost: 240_000, mw: 2, cap: 600, input: 'wellstream', out: [], desc: 'Splits wellstream into light sweet crude and associated gas by each block’s gas ratio; 5% produced water is discarded.', max: 6 },
  lng:        { id: 'lng',        name: 'LNG train',        icon: '❄️', cost: 650_000, mw: 5, cap: 220, input: 'assocgas', out: [['lng', 0.72], ['condensate', 0.2]], desc: 'Associated gas -> 72% LNG + 20% condensate. Sweet gas: no sulfur.', max: 4 },
  refinery:   { id: 'refinery',   name: 'Premium refinery', icon: '🏗️', cost: 900_000, mw: 6, cap: 300, input: 'crude', out: [['jetfuel', 0.33], ['gasoline', 0.3], ['naphtha', 0.25], ['fueloil', 0.07]], desc: 'Light sweet crude -> jet fuel, premium gasoline, light naphtha and a little bunker fuel oil.', max: 6 },
  aromatics:  { id: 'aromatics',  name: 'Aromatics complex', icon: '🧪', cost: 800_000, mw: 4, cap: 140, input: 'naphtha', alt: 'condensate', out: [['paraxylene', 0.8]], desc: 'Light naphtha (or condensate when naphtha runs out) -> 80% paraxylene.', max: 4 },
  solar:      { id: 'solar',      name: 'Solar farm',       icon: '☀️', cost: 420_000, mw: 0, cap: 0, out: [], desc: 'Desert sun: +10 MW (day/night averaged), no fuel.', max: 8 },
  tank:       { id: 'tank',       name: 'Storage tank',     icon: '🛢️', cost: 110_000, mw: 0, cap: 0, out: [], desc: '+4,000 storage for every product.', max: 10 },
};
export const G_UNIT_ORDER: GUnitKind[] = ['stabilizer', 'lng', 'refinery', 'aromatics', 'solar', 'tank'];
export const G_PROCESS_ORDER: GUnitKind[] = ['stabilizer', 'lng', 'refinery', 'aromatics'];
export const isGUnitKind = (v: unknown): v is GUnitKind => typeof v === 'string' && v in G_UNITS;
export const SOLAR_MW = 10;
export const G_GRID_MW = 12; // utility tie-in: one well + stabilizer + a refinery fit without throttling
export const G_TANK_BASE = 1_200, G_TANK_PER = 4_000;

// ---- state
export interface GWell { esp: boolean; cond: number }
export interface GTractState { leased: boolean; pipe: number; wells: GWell[] }
export interface GUnit { id: number; k: GUnitKind; cond: number; on: boolean }
export interface GulfState {
  v: 1; at: number; seq: number;
  surveyed: number[]; tracts: Record<string, GTractState>;
  units: GUnit[]; stock: Partial<Record<GProduct, number>>;
  /** volume-weighted gas ratio of the wellstream tank */ gr: number;
  /** Gold Souk: 10-tola bars held, and bars sold on `goldDay.day` (UTC). */ gold?: number; goldDay?: { day: string; sold: number };
  /** At the Top observation deck visits. */ deck?: number;
  made: Partial<Record<GProduct, number>>;
  power: { supply: number; demand: number };
}
export function newGulf(now: number): GulfState {
  return { v: 1, at: now, seq: 0, surveyed: [], tracts: {}, units: [], stock: {}, gr: 0.2, made: {}, power: { supply: G_GRID_MW, demand: 0 } };
}
export const gTankCap = (s: GulfState) => G_TANK_BASE + G_TANK_PER * s.units.filter((u) => u.k === 'tank').length;
export const gUnitCount = (s: GulfState, k: GUnitKind) => s.units.filter((u) => u.k === k).length;
const st = (s: GulfState, p: GProduct) => s.stock[p] ?? 0;
const add = (s: GulfState, p: GProduct, n: number) => { s.stock[p] = Math.max(0, st(s, p) + n); if (n > 0) s.made[p] = (s.made[p] ?? 0) + n; };
export const gSupply = (s: GulfState) => G_GRID_MW + s.units.filter((u) => u.k === 'solar' && u.on).reduce((a, u) => a + SOLAR_MW * efficiency(u.cond), 0);

/** Power actually drawn: only equipment with work to do (same rule as Fort McChud's powerDemand). */
export function gPowerDemand(s: GulfState): number {
  const cap = gTankCap(s); const room = (p: GProduct) => cap - st(s, p) > 1e-6;
  let mw = 0; let wellsFlow = false;
  if (room('wellstream')) for (const [key, t] of Object.entries(s.tracts)) if (t.leased && t.pipe > 0) for (const w of t.wells) if (efficiency(w.cond) > 0) { mw += wellMw(Number(key)) + (w.esp ? ESP_MW : 0); wellsFlow = true; }
  const fed = new Set<GProduct>(); if (wellsFlow) fed.add('wellstream');
  for (const k of G_PROCESS_ORDER) {
    const d = G_UNITS[k]; const list = s.units.filter((u) => u.k === k && u.on && efficiency(u.cond) > 0); if (!list.length) continue;
    const has = (p: GProduct | undefined) => !!p && (st(s, p) > 1e-6 || fed.has(p));
    if (!has(d.input) && !has(d.alt)) continue;
    const outs: GProduct[] = k === 'stabilizer' ? ['crude', 'assocgas'] : d.out.map(([p]) => p);
    if (outs.length && !outs.some(room)) continue;
    mw += d.mw * list.length;
  }
  return Math.round(mw * 100) / 100;
}

/** One sim step of `h` hours. Mutates s. */
export function gStep(s: GulfState, h = STEP_H): void {
  const cap = gTankCap(s);
  const space = (p: GProduct) => Math.max(0, cap - st(s, p));
  for (const u of s.units) if (u.k === 'solar' && u.on) u.cond = Math.max(0, u.cond - WEAR_PER_H * 0.5 * h); // panels soil slowly
  const supply = gSupply(s);
  const demand = gPowerDemand(s);
  const pr = demand > 0 ? Math.min(1, supply / demand) : 1;
  s.power = { supply: Math.round(supply * 100) / 100, demand };
  // wells -> pipeline -> wellstream tank
  let flowTotal = 0, gasW = 0;
  for (const [key, t] of Object.entries(s.tracts)) {
    if (!t.leased || t.pipe <= 0 || !t.wells.length) continue;
    const n = Number(key); const info = gTractInfo(n);
    const pot = t.wells.reduce((a, w) => a + wellRate(n) * info.richness * (w.esp ? ESP_MULT : 1) * efficiency(w.cond), 0) * pr * h;
    const flow = Math.min(pot, G_PIPES[t.pipe]!.cap * h, space('wellstream') - flowTotal);
    if (flow <= 0) continue;
    const load = pot > 0 ? flow / pot : 0;
    for (const w of t.wells) w.cond = Math.max(0, w.cond - WEAR_PER_H * h * load * pr);
    flowTotal += flow; gasW += flow * info.gas;
  }
  if (flowTotal > 0) { const old = st(s, 'wellstream'); s.gr = (s.gr * old + gasW) / (old + flowTotal); add(s, 'wellstream', flowTotal); }
  for (const k of G_PROCESS_ORDER) {
    const d = G_UNITS[k]; const list = s.units.filter((u) => u.k === k && u.on && efficiency(u.cond) > 0); if (!list.length) continue;
    const capH = list.reduce((a, u) => a + d.cap * efficiency(u.cond), 0) * pr * h; if (capH <= 0) continue;
    let src: GProduct = d.input!; if (d.alt && st(s, src) < 1e-6) src = d.alt;
    let amt = Math.min(capH, st(s, src));
    const outs: Array<[GProduct, number]> = k === 'stabilizer' ? [['crude', 1 - G_WATER_CUT - s.gr], ['assocgas', s.gr]] : [...d.out];
    for (const [p, y] of outs) if (y > 0) amt = Math.min(amt, space(p) / y);
    if (amt <= 1e-9) continue;
    add(s, src, -amt);
    for (const [p, y] of outs) if (y > 0) add(s, p, amt * y);
    const load = amt / capH;
    for (const u of list) u.cond = Math.max(0, u.cond - WEAR_PER_H * h * load * pr);
  }
}
/** Advance to `now` (whole steps only). Returns steps run. */
export function gSettle(s: GulfState, now: number): number {
  if (now <= s.at) return 0;
  if (now - s.at > MAX_CATCHUP_MS) s.at = now - MAX_CATCHUP_MS;
  const n = Math.floor((now - s.at) / STEP_MS);
  for (let i = 0; i < n; i++) gStep(s);
  s.at += n * STEP_MS; return n;
}
export const gWhole = (n: number | undefined) => Math.floor((n ?? 0) + 1e-9);

/** Total base build cost at list prices (concessions, pipes, wells/ESPs, plant units). */
export function gulfBuildValue(s: GulfState): number {
  let v = 0;
  for (const [k, t] of Object.entries(s.tracts)) { const n = Number(k); if (t.leased) v += gTractInfo(n).lease; v += G_PIPES.slice(1, t.pipe + 1).reduce((a, p) => a + p.cost, 0); for (const w of t.wells) v += wellCost(n) + (w.esp ? ESP_COST : 0); }
  for (const u of s.units) v += G_UNITS[u.k].cost;
  return v;
}
export function gulfStockValue(s: GulfState): number {
  let v = 0; for (const [id, q] of Object.entries(s.stock ?? {})) { if (!isGProduct(id)) continue; const p = G_PRODUCTS[id]; if (p.sellable) v += p.price * gWhole(q); } return v;
}
export const gulfWorth = (s: GulfState) => gulfBuildValue(s) + gulfStockValue(s);
/** Gross (pre-tier) chips for selling `qty` of a product, after the export levy. */
export const exchangeGross = (id: GProduct, qty: number) => Math.floor(qty * G_PRODUCTS[id].price * (1 - EXPORT_LEVY));

// ---- map (x east, z south; the Gulf is to the south, desert to the north). The street grid, districts and every
// building footprint live in shared/chudbaiCity.ts; the spots below are the clickable landmarks it reserves.
export const GULF_X0 = -320, GULF_X1 = 320, GULF_Z0 = -160, GULF_Z1 = 260;
export const GULF_SHORE_Z = 90;
export type GulfSpotId = 'g-airport' | 'g-plant' | 'g-exchange' | 'g-burj' | 'g-fountain' | 'g-mall' | 'g-marina' | 'g-palm' | 'g-souk' | 'g-dhow' | 'g-sail' | 'g-port';
/** `face`: the side the entrance is on (n = toward -z). Footprints are axis-aligned; x/z is the centre. */
export interface GulfSpot { id: GulfSpotId; label: string; icon: string; blurb: string; x: number; z: number; w: number; d: number; h: number; face: 'n' | 's' | 'e' | 'w'; water?: boolean }
const sp = (id: GulfSpotId, label: string, icon: string, blurb: string, x0: number, z0: number, x1: number, z1: number, h: number, face: GulfSpot['face'], water = false): GulfSpot =>
  ({ id, label, icon, blurb, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h, face, ...(water ? { water } : {}) });
export const GULF_SPOTS: GulfSpot[] = [
  sp('g-airport', 'Chudbai International', '✈️', 'Fly home to Chud Hub. The return flight is included.', 105, -119, 175, -101, 20, 's'),
  sp('g-plant', 'Desert Refining & LNG Complex', '🏭', 'Build stabilizers, LNG trains, premium refineries, an aromatics complex, solar farms and tanks.', -55, -137, 75, -73, 26, 's'),
  sp('g-exchange', 'Chudbai Mercantile Exchange', '💹', 'Sell light sweet crude, LNG, jet fuel, premium gasoline and paraxylene in person (3% export levy).', -2, 11.5, 22, 32, 92, 'n'),
  sp('g-burj', 'Burj Chudifa', '🏙️', 'The tallest tower in the game. Ride up to the At the Top observation deck.', -68, 17, -42, 43, 220, 'n'),
  sp('g-fountain', 'Chudbai Fountain', '⛲', 'The dancing fountain lake at the foot of the Burj.', -72, 46, -38, 66, 3, 's'),
  sp('g-mall', 'The Chudbai Mall', '🛍️', 'Twelve hundred shops, an aquarium and an indoor ski slope. Window shopping only.', -92, 12, -74, 64, 16, 'w'),
  sp('g-marina', 'Chudbai Marina', '🛥️', 'Superyachts in the marina basin. Marina towers line the promenade.', 115, 85, 175, 115, 4, 'n', true),
  sp('g-palm', 'Palm Chudeirah', '🌴', 'A palm-shaped island of villas and a golden arch hotel. Two villas on the fronds are for sale.', -70, 112.5, 50, 226, 22, 'n', true),
  sp('g-souk', 'Gold Souk', '🪙', 'Buy and sell gold bars at the day\'s price.', -142, 11.5, -108, 32, 10, 'n'),
  sp('g-dhow', 'Creek Dhow Wharf', '⛵', 'Fish the Gulf from a wooden dhow: hammour, kingfish and the Golden Hammour.', -242, 84.5, -208, 106, 6, 'n', true),
  sp('g-sail', 'Burj al Chud', '⛵', 'The sail-shaped hotel on its own islet. Seven and a half stars.', 59, 119, 81, 141, 56, 'n', true),
  sp('g-port', 'Port Jebel Chud', '🚢', 'Container terminal, gantry cranes and the dry docks: the industrial edge of town.', 258.5, 11.5, 318, 104, 30, 'w', true),
];
export const gulfSpot = (id: GulfSpotId): GulfSpot => GULF_SPOTS.find((s) => s.id === id)!;

// ---- Gold Souk: buy and sell 10-tola gold bars at the day's price (a store of value, not an income).
/** Base price of one 10-tola bar (before the price index). The day's price is BASE × f, f in [0.85, 1.15]. */
export const GOLD_BAR_BASE = 12_000;
export const GOLD_SPREAD = 0.02; // buy 2% over the day's price, sell 2% under: a 4% round trip
export const GOLD_F_MIN = 0.85, GOLD_F_MAX = 1.15, GOLD_STEP = 0.03, GOLD_REVERT = 0.15;
export const GOLD_MAX_BARS = 100;
export const GOLD_SELL_PER_DAY = 25;
/** Next day's price factor from the last one and a uniform u in [0,1): a step of up to ±3% plus 15% pull back toward 1. */
export function goldNextF(prev: number, u: number): number {
  const p = Number.isFinite(prev) ? prev : 1; const n = p * (1 + (u * 2 - 1) * GOLD_STEP) + (1 - p) * GOLD_REVERT;
  return Math.round(Math.min(GOLD_F_MAX, Math.max(GOLD_F_MIN, n)) * 10_000) / 10_000;
}
/** Per-bar chips (pass the price-indexed base). */
export const goldAsk = (base: number, f: number) => Math.ceil(base * f * (1 + GOLD_SPREAD));
export const goldBid = (base: number, f: number) => Math.floor(base * f * (1 - GOLD_SPREAD));

// ---- At the Top: the Burj Chudifa observation deck (a sightseeing ticket; a sink).
export const DECK_TICKET_BASE = 2_500;
export const DECK_FLOOR = 148;

// ---- public site snapshot
export interface GulfSiteLease { key: string; name: string; mine: boolean }
export interface GulfSiteTractView { n: number; lease: GulfSiteLease | null; wells: Array<{ ownerKey: string; esp: boolean; cond: number }>; pipe: number }
export interface GulfSite { now: number; leases: Record<string, GulfSiteLease>; tracts: GulfSiteTractView[]; players: Array<{ key: string; name: string; units: Array<{ k: GUnitKind; on: boolean }> }> }
export function buildGulfSite(now: number, official: Record<string, { key: string; name: string }>, players: Array<{ key: string; name: string; state: GulfState }>): GulfSite {
  const sorted = [...players].sort((a, b) => a.key.localeCompare(b.key));
  const leases: Record<string, GulfSiteLease> = {}; const tracts: GulfSiteTractView[] = [];
  for (let n = 1; n <= G_TRACTS; n++) {
    const hold = official[String(n)]; const lease = hold ? { key: hold.key, name: hold.name, mine: false } : null; if (lease) leases[String(n)] = lease;
    const t = hold ? sorted.find((p) => p.key === hold.key)?.state.tracts[String(n)] : undefined;
    tracts.push({ n, lease, wells: (t?.wells ?? []).map((w) => ({ ownerKey: hold!.key, esp: w.esp, cond: w.cond })), pipe: t?.pipe ?? 0 });
  }
  return { now, leases, tracts, players: sorted.map((p) => ({ key: p.key, name: p.name, units: p.state.units.map((u) => ({ k: u.k, on: u.on })) })) };
}
