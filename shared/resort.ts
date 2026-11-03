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
 * Tropical crops (coconut, pineapple, mango, banana, cacao) grow only on resort plots and share the city farm's
 * daily profit tiers (shared/farm.ts FARM_TIERS) — the cap is per player across both maps.
 */
import type { OBB } from './worldLayout.js';
import type { Crop } from './farm.js';

export type Location = 'city' | 'resort';
export const RESORT_TICKET_BASE = 500;
export const isLocation = (v: unknown): v is Location => v === 'city' || v === 'resort';

// ---- map
export const RESORT_X0 = -130, RESORT_X1 = 130, RESORT_Z0 = -100, RESORT_Z1 = 70;
export const SHORE_Z = 38; // sand from ~22 to 38, ocean beyond
export const BOARDWALK_Z = 20;
export const clampResortTarget = (x: number, z: number): [number, number] => [Math.min(RESORT_X1 - 10, Math.max(RESORT_X0 + 10, x)), Math.min(RESORT_Z1 - 10, Math.max(RESORT_Z0 + 10, z))];

/** Clickable resort landmarks (not properties). */
export interface ResortSpot { id: string; label: string; icon: string; blurb: string; x: number; z: number; w: number; d: number; h: number; color: number }
export const RESORT_SPOTS: ResortSpot[] = [
  { id: 'r-casino', label: 'Palms Resort Casino', icon: '🎰', blurb: 'Tiki Lagoon, Yacht Club and Pearl Diver slots, plus blackjack and roulette on white-and-gold tables.', x: 0, z: -18, w: 30, d: 18, h: 16, color: 0xf4d58a },
  { id: 'r-airstrip', label: 'Chud Resort Airfield', icon: '✈️', blurb: 'Fly home to Chud Hub. The return flight is included with your ticket.', x: -100, z: -78, w: 34, d: 12, h: 6, color: 0x9ad0ff },
  { id: 'r-mine', label: 'Coral Grotto', icon: '🐚', blurb: 'A sea cave under the volcano: coral pillars, rich in gems and gold.', x: 100, z: -72, w: 22, d: 22, h: 14, color: 0xff8a7a },
  { id: 'r-farm', label: 'Paradise Plantation', icon: '🥥', blurb: 'Buy a plot and grow coconuts, pineapples, mangoes, bananas and cacao.', x: -74, z: -32, w: 12, d: 8, h: 6, color: 0x7ed08a },
  { id: 'r-pier', label: 'Reef Pier', icon: '🎣', blurb: 'Fish the reef at sunset: clownfish, parrotfish, mahi-mahi, yellowfin, sailfish, and the rare Blue Marlin or Sunset Manta.', x: -60, z: 50, w: 8, d: 26, h: 4, color: 0x3ad8c8 },
  { id: 'r-marina', label: 'Marina', icon: '🛥️', blurb: 'Superyachts at the docks. Pure vibes.', x: 92, z: 48, w: 30, d: 14, h: 2, color: 0xffffff },
];

// ---- properties
export const RESORT_TYPES: Record<string, { label: string; price: number; floors: [number, number]; floorH: number; color: number }> = {
  beachhouse: { label: 'Beach house', price: 45_000, floors: [1, 2], floorH: 3.2, color: 0xf6efe2 },
  condo: { label: 'Oceanview condo', price: 80_000, floors: [4, 6], floorH: 3, color: 0xe8f1f2 },
  villa: { label: 'Hillside villa', price: 140_000, floors: [2, 2], floorH: 3.4, color: 0xfff6e6 },
  hotel: { label: 'Beachfront hotel', price: 450_000, floors: [9, 13], floorH: 3, color: 0xf3e6cf },
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
  for (const x of [-60, -40, 40, 60]) add('condo', x, -14, 12, 10);
  // Hillside villas.
  for (const x of [-60, -40, -20, 20, 40, 60, 80]) add('villa', x, -48 - (Math.abs(x) % 3) * 2, 13, 11);
  lotCache = out; return out;
}

// ---- plantation (farm plots)
export const RF_TILE = 2;
export interface ResortPlot extends OBB { n: number; cols: number; rows: number }
const RF_SIZES: [number, number][] = [[5, 4], [6, 5], [4, 4], [8, 6], [6, 6], [7, 5]];
export const resortFarmPrice = (tiles: number) => round500(300 * tiles + 2000);
let plotCache: ResortPlot[] | null = null;
export function resortPlots(): ResortPlot[] {
  if (plotCache) return plotCache;
  const out: ResortPlot[] = []; let z = -40;
  RF_SIZES.forEach(([c, r], i) => {
    const col = i % 2, w = c * RF_TILE + 2, d = r * RF_TILE + 2;
    if (col === 0 && i > 0) z += 18;
    out.push({ n: i + 1, cols: c, rows: r, w, d, rot: 0, x: col === 0 ? -118 + w / 2 : -100 + w / 2 + 4, z: z + d / 2 });
  });
  plotCache = out; return out;
}
export const resortPlotId = (n: number) => `rf:${n}`;
export const resortPlotOf = (id: unknown) => (typeof id === 'string' && /^rf:\d+$/.test(id) ? resortPlots().find((p) => resortPlotId(p.n) === id) : undefined);
export const rfTileXZ = (p: ResortPlot, i: number): [number, number] => [p.x - (p.cols * RF_TILE) / 2 + RF_TILE * ((i % p.cols) + 0.5), p.z - (p.rows * RF_TILE) / 2 + RF_TILE * (Math.floor(i / p.cols) + 0.5)];

const M = 60_000, H = 60 * M;
/** Tropical crops (base chips). Margins match the city's slow crops (~2.1-2.2x), so the daily cap does the limiting. */
export const TROPICAL_CROPS: Crop[] = [
  { id: 'pineapple', label: 'Pineapples', emoji: '🍍', seed: 30, grow: 20 * M, sell: 53, color: 0xf2c230 },
  { id: 'banana', label: 'Bananas', emoji: '🍌', seed: 50, grow: 1 * H, sell: 93, color: 0xf6dc4a },
  { id: 'mango', label: 'Mangoes', emoji: '🥭', seed: 80, grow: 3 * H, sell: 160, color: 0xf28a2a },
  { id: 'coconut', label: 'Coconuts', emoji: '🥥', seed: 140, grow: 6 * H, sell: 290, color: 0x8a5a32 },
  { id: 'cacao', label: 'Cacao', emoji: '🍫', seed: 240, grow: 12 * H, sell: 525, color: 0x6a3a22 },
];
export const isTropical = (id: unknown) => TROPICAL_CROPS.some((c) => c.id === id);
