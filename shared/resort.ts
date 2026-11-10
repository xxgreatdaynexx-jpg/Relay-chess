/**
 * Chud Resort: a premium beachfront resort town on its own map, reachable only by plane from Chud Hub International.
 *
 * Travel: a ticket costs px(RESORT_TICKET_BASE) chips (base 500, one atomic ledger row 'resort_ticket'); the return
 * flight to the city is included (free). The server keeps each player's location ('city' | 'resort') and gates every
 * resort feature on it (resort slots, resort property purchases, resort farming, the Coral Grotto mine).
 *
 * Map space is separate from the city: x east, z south, ocean to the south (z > SHORE_Z).
 *
 * Properties (base chips, x price index on the server; same 0.5%/day tax, 70% sell-back, 3-day repossession as the city):
 *   Beach house 45,000 · Condo 80,000 · Villa 140,000 · Hotel 450,000 (size factor 0.9..1.2, rounded to 500).
 *   City equivalents: detached home 15,000, apartment block 60,000, residential tower 150,000.
 * Plantation plots (ids `rf:<n>`): 300 per tile + 2,000, rounded to 500 (vs 180/tile + 500 in the city).
 *   #10e estate plots rf:7..12: 900 per tile + 25,000. Estates 650K, clifftop mansions 1.1M, penthouse skyrises 1.8M.
 * Tropical crops (coconut, pineapple, mango, banana, cacao) grow only on resort plots and use the same harvest
 * payout as city farms (no daily farm profit cap).
 * Harvest yield is ×RESORT_HARVEST_MUL (2) vs city farms; fertilizer still adds on top.
 */
import type { OBB } from './worldLayout.js';
import type { Crop } from './farm.js';

export type Location = 'city' | 'resort' | 'fortmc';
/** Places you fly to from Chud Hub International (everything except the city). */
export type Destination = Exclude<Location, 'city'>;
export const RESORT_TICKET_BASE = 500;
export const isLocation = (v: unknown): v is Location => v === 'city' || v === 'resort' || v === 'fortmc';
export const isDestination = (v: unknown): v is Destination => v === 'resort' || v === 'fortmc';
/** Ticket price (base chips, x price index), ledger game and display name for every destination. */
export const DESTINATIONS: Record<Destination, { name: string; ticket: number; game: string }> = {
  resort: { name: 'Chud Resort', ticket: RESORT_TICKET_BASE, game: 'resort_ticket' },
  fortmc: { name: 'Fort McChud', ticket: 1_500, game: 'fortmc_ticket' },
};

// ---- map
export const RESORT_X0 = -200, RESORT_X1 = 200, RESORT_Z0 = -130, RESORT_Z1 = 70; // #10e: was ±130 / -100 (Banyan Bay west, Sapphire Heights east)
export const SHORE_Z = 38; // sand from ~22 to 38, ocean beyond
export const BOARDWALK_Z = 20;
export const clampResortTarget = (x: number, z: number): [number, number] => [Math.min(RESORT_X1 - 10, Math.max(RESORT_X0 + 10, x)), Math.min(RESORT_Z1 - 10, Math.max(RESORT_Z0 + 10, z))];

/** Asphalt avenues + cross streets (matches client/src/lib/resort3d.ts). Boardwalk/promenade are walkways, not truck roads. */
export type ResortRoad = { x: number; z: number; w: number; d: number };
export const RESORT_ROADS: ResortRoad[] = [
  { x: 0, z: -32, w: RESORT_X1 - RESORT_X0 - 20, d: 5 },
  { x: 0, z: -64, w: RESORT_X1 - RESORT_X0 - 20, d: 6 },
  ...([-136, -40, 40, 136] as const).map((x) => ({ x, z: -24, w: 5, d: 82 })),
];
export const resortAabbHit = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }, pad = 0) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d + pad * 2;
/** True when an AABB overlaps any asphalt resort road (optional inflate for roofs / palm trunks). */
export const overlapsResortRoad = (box: { x: number; z: number; w: number; d: number }, pad = 1, inflate = 0) =>
  RESORT_ROADS.some((r) => resortAabbHit({ ...box, w: box.w + inflate * 2, d: box.d + inflate * 2 }, r, pad));

/** Clickable resort landmarks (not properties). */
export interface ResortSpot { id: string; label: string; icon: string; blurb: string; x: number; z: number; w: number; d: number; h: number; color: number }
export const RESORT_SPOTS: ResortSpot[] = [
  { id: 'r-casino', label: 'Palms Resort Casino', icon: '🎰', blurb: 'Tiki Lagoon, Yacht Club and Pearl Diver slots, plus blackjack and roulette on white-and-gold tables.', x: 0, z: -18, w: 30, d: 18, h: 16, color: 0xf4d58a },
  { id: 'r-airstrip', label: 'Chud Resort Airfield', icon: '✈️', blurb: 'Fly home to Chud Hub. The return flight is included with your ticket.', x: -100, z: -78, w: 34, d: 12, h: 6, color: 0x9ad0ff },
  { id: 'r-mine', label: 'Coral Grotto', icon: '🐚', blurb: 'A sea cave under the volcano: coral pillars, rich in gems and gold.', x: 100, z: -80, w: 22, d: 22, h: 14, color: 0xff8a7a },
  { id: 'r-farm', label: 'Paradise Plantation', icon: '🥥', blurb: 'Buy a plot and grow coconuts, pineapples, mangoes, bananas and cacao.', x: -74, z: -44, w: 12, d: 8, h: 6, color: 0x7ed08a },
  { id: 'r-pier', label: 'Reef Pier', icon: '🎣', blurb: 'Fish the reef at sunset: clownfish, parrotfish, mahi-mahi, yellowfin, sailfish, and the rare Blue Marlin or Sunset Manta.', x: -60, z: 50, w: 8, d: 26, h: 4, color: 0x3ad8c8 },
  { id: 'r-marina', label: 'Marina', icon: '🛥️', blurb: 'Buy a skiff, sportfisher, yacht, superyacht or megayacht. Boats unlock deep-sea fishing and count toward your net worth.', x: 92, z: 48, w: 30, d: 14, h: 2, color: 0xffffff },
];

// ---- properties
export const RESORT_TYPES: Record<string, { label: string; price: number; floors: [number, number]; floorH: number; color: number }> = {
  beachhouse: { label: 'Beach house', price: 45_000, floors: [1, 2], floorH: 3.2, color: 0xf6efe2 },
  condo: { label: 'Oceanview condo', price: 80_000, floors: [4, 6], floorH: 3, color: 0xe8f1f2 },
  villa: { label: 'Hillside villa', price: 140_000, floors: [2, 2], floorH: 3.4, color: 0xfff6e6 },
  hotel: { label: 'Beachfront hotel', price: 450_000, floors: [9, 13], floorH: 3, color: 0xf3e6cf },
  // #10e expansion: the expensive end of the island
  oceanestate: { label: 'Oceanfront estate', price: 650_000, floors: [2, 3], floorH: 3.6, color: 0xfaf3e4 },
  clifftop: { label: 'Clifftop mansion', price: 1_100_000, floors: [2, 3], floorH: 4, color: 0xf4efe8 },
  skyrise: { label: 'Penthouse skyrise', price: 1_800_000, floors: [18, 24], floorH: 3, color: 0xdfe9f0 },
};
export interface ResortLot extends OBB { id: string; type: string; label: string; price: number; h: number; n: number }
const round500 = (n: number) => Math.max(500, Math.round(n / 500) * 500);
const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
let lotCache: ResortLot[] | null = null;
export function resortLots(): ResortLot[] {
  if (lotCache) return lotCache;
  const out: ResortLot[] = []; let n = 0;
  const add = (type: string, x: number, z: number, w: number, d: number, rot = 0) => {
    const t = RESORT_TYPES[type]!; n++; const f = t.floors[0] + Math.floor(rnd(n) * (t.floors[1] - t.floors[0] + 1));
    const size = Math.min(1.2, Math.max(0.9, 0.9 + rnd(n + 50) * 0.3));
    out.push({ id: `r:${type}:${n}`, n, type, label: `${t.label} #${n}`, price: round500(t.price * size), x, z, w, d, rot, h: f * t.floorH });
  };
  // Beach houses on the sand, east and west of the casino promenade.
  for (const x of [-78, -64, -50, -36, 36, 50, 64]) add('beachhouse', x, 29, 9, 8);
  // Hotels along the boardwalk.
  for (const x of [-56, -26, 26, 56]) add('hotel', x, 6, 18, 12);
  // Condos behind the hotels.
  // Off the x=±40 cross streets (was -40/40 — sat on asphalt). IDs unchanged (same add order).
  for (const x of [-60, -28, 28, 60]) add('condo', x, -14, 12, 10);
  // Hillside villas.
  // ±40 cross streets: place those two villas south of both avenues (ids keep add order).
  for (const [x, z] of [[-60, -48], [-28, -78], [-20, -52], [20, -52], [28, -78], [60, -48], [80, -52]] as const) add('villa', x, z, 13, 11);
  // #10e (appended so existing ids never shift): Banyan Bay (west) and Sapphire Heights (east).
  for (const x of [-176, -152, 152, 176]) add('oceanestate', x, 28, 14, 9);
  for (const x of [-176, -152, 152, 176]) add('clifftop', x, -46, 16, 14);
  for (const x of [150, 178]) add('skyrise', x, 2, 16, 14);
  lotCache = out; return out;
}

// ---- plantation (farm plots)
/** Resort plantation harvest yield multiplier (stacks with fertilizer; seed/sell prices unchanged). */
export const RESORT_HARVEST_MUL = 2;
export const RF_TILE = 2;
export interface ResortPlot extends OBB { n: number; cols: number; rows: number; /** #10e estate plots: bigger, pricier */ estate?: true }
const RF_SIZES: [number, number][] = [[5, 4], [6, 5], [4, 4], [8, 6], [6, 6], [7, 5]];
export const resortFarmPrice = (tiles: number) => round500(300 * tiles + 2000);
/** #10e estate plantations: 900 per tile + 25,000 (3x the per-tile price of the original plots). */
export const resortEstateFarmPrice = (tiles: number) => round500(900 * tiles + 25_000);
export const resortPlotPrice = (p: Pick<ResortPlot, 'cols' | 'rows' | 'estate'>) => (p.estate ? resortEstateFarmPrice : resortFarmPrice)(p.cols * p.rows);
/** Estate plots (n 7..12): [cols, rows, x, z]. */
const RF_ESTATES: [number, number, number, number][] = [[8, 6, -184, -112], [10, 7, -158, -112], [8, 7, -184, -86], [10, 6, -158, -86], [8, 6, 150, -92], [10, 7, 178, -92]];
let plotCache: ResortPlot[] | null = null;
/** Extra regular plantations filling empty east grass (appended; never renumbers 1..12). [cols, rows, x, z] */
const RF_FILL: [number, number, number, number][] = [
  [5, 4, 96, -52], [6, 5, 112, -52], [4, 4, 74, -20], [7, 5, 90, -20],
  [6, 6, 108, -18], [8, 5, 78, -4], [5, 5, 124, -20], [6, 4, 98, -2],
];
export function resortPlots(): ResortPlot[] {
  if (plotCache) return plotCache;
  const out: ResortPlot[] = []; let z = -48; // was -40: rf:1/2 sat on the z=-32 avenue
  RF_SIZES.forEach(([c, r], i) => {
    const col = i % 2, w = c * RF_TILE + 2, d = r * RF_TILE + 2;
    if (col === 0 && i > 0) z += 18;
    out.push({ n: i + 1, cols: c, rows: r, w, d, rot: 0, x: col === 0 ? -118 + w / 2 : -100 + w / 2 + 4, z: z + d / 2 });
  });
  // Push any of the original six that still sit on asphalt fully off the avenue (ids unchanged).
  for (const p of out) {
    if (p.n > 6) continue;
    if (!overlapsResortRoad(p, 1.5)) continue;
    let best: number | null = null;
    for (let step = 1; step <= 40; step++) {
      for (const dir of [1, -1]) { // +z toward shore, -z toward ridge
        const z = p.z + dir * step;
        const cand = { ...p, z };
        if (overlapsResortRoad(cand, 1.5)) continue;
        if (out.some((o) => o !== p && resortAabbHit(cand, o, 2))) continue;
        if (RESORT_SPOTS.some((s) => resortAabbHit(cand, s, 2))) continue;
        best = z; break;
      }
      if (best != null) break;
    }
    if (best != null) p.z = best;
  }
  RF_ESTATES.forEach(([c, r, x, z], i) => out.push({ n: RF_SIZES.length + i + 1, cols: c, rows: r, w: c * RF_TILE + 2, d: r * RF_TILE + 2, rot: 0, x, z, estate: true }));
  RF_FILL.forEach(([c, r, x, z], i) => out.push({ n: RF_SIZES.length + RF_ESTATES.length + i + 1, cols: c, rows: r, w: c * RF_TILE + 2, d: r * RF_TILE + 2, rot: 0, x, z }));
  plotCache = out; return out;
}
export const resortPlotId = (n: number) => `rf:${n}`;
export const resortPlotOf = (id: unknown) => (typeof id === 'string' && /^rf:\d+$/.test(id) ? resortPlots().find((p) => resortPlotId(p.n) === id) : undefined);
export const rfTileXZ = (p: ResortPlot, i: number): [number, number] => [p.x - (p.cols * RF_TILE) / 2 + RF_TILE * ((i % p.cols) + 0.5), p.z - (p.rows * RF_TILE) / 2 + RF_TILE * (Math.floor(i / p.cols) + 0.5)];

const M = 60_000, H = 60 * M;
/** Dayne 2026-11-05: same ×0.7 grow scale as shared/farm.ts (keep in sync; avoid circular import of growMs). */
const GROW_SCALE = 0.7;
const growMs = (ms: number) => Math.round(ms * GROW_SCALE);
/** Tropical crops (base chips). Listed sell matches city crops: seed x 1.5 / FARM_SELL_MUL (50% over seed after the 0.95 mul). */
export const TROPICAL_CROPS: Crop[] = [
  { id: 'pineapple', label: 'Pineapples', emoji: '🍍', seed: 30, grow: growMs(40 * M), sell: 47.37, color: 0xf2c230 },
  { id: 'banana', label: 'Bananas', emoji: '🍌', seed: 50, grow: growMs(2 * H), sell: 78.95, color: 0xf6dc4a },
  { id: 'mango', label: 'Mangoes', emoji: '🥭', seed: 80, grow: growMs(6 * H), sell: 126.32, color: 0xf28a2a },
  { id: 'coconut', label: 'Coconuts', emoji: '🥥', seed: 140, grow: growMs(12 * H), sell: 221.05, color: 0x8a5a32 },
  { id: 'cacao', label: 'Cacao', emoji: '🍫', seed: 240, grow: growMs(24 * H), sell: 378.95, color: 0x6a3a22 },
];
export const isTropical = (id: unknown) => TROPICAL_CROPS.some((c) => c.id === id);
