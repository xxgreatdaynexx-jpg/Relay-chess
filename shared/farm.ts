/**
 * Farm district (Chud Acres Farms): farmland plots on the east edge of the city map, outside the city plate, and the
 * FarmVille-style crop game played inside an owned plot. Plots are real-estate properties (type 'farmland', id `f:<n>`):
 * bought, taxed and repossessed by the real-estate system. All chip amounts here are BASE units: the server scales seed
 * costs and harvest payouts by the price index (px / priceIndex).
 *
 * Crops grow on the server clock. A crop is ready at plantedAt + grow, and withers at ready + ripeWindow (max of 36 h and WITHER_FACTOR x grow).
 * Harvest pays back the seed cost in full plus the crop's profit (sell - seed) through a per-player daily
 * daily tier (like the Mines): full up to 100,000, then nothing, so farming can never flood the
 * economy (at most 100,000 base chips of profit per player per day) and never pays less than the seeds cost.
 */
import { VIEW_Z1 } from './ocean.js';
import { PLATE, PARK_AREA, MINE_SITES, MINE_APRON, OUTSKIRTS, type OBB } from './worldLayout.js';
import { VENUE_BOUNDS } from './venues.js';
import { TROPICAL_CROPS } from './resort.js';

export const TILE = 2; // world units per farm tile
export const WITHER_FACTOR = 3;
/** Request #19 + carter2 follow-up: ripe crops always last at least 36 hours before withering. */
export const MIN_RIPE_MS = 36 * 60 * 60_000;
/** How long a ripe crop stays harvestable: the longer of 36 h or wither factor x grow time. */
export const ripeWindow = (grow: number, wither = WITHER_FACTOR) => Math.max(MIN_RIPE_MS, wither * grow);
export interface Crop { id: string; label: string; emoji: string; seed: number; grow: number; sell: number; color: number }
const M = 60_000, H = 60 * M;
/** Base chips. Fast crops pay little per hour unless you keep coming back; slow ones are the big money per click. */
export const CROPS: Crop[] = [
  { id: 'strawberry', label: 'Strawberries', emoji: '🍓', seed: 5, grow: 4 * M, sell: 8, color: 0xd84a5a },
  { id: 'wheat', label: 'Wheat', emoji: '🌾', seed: 10, grow: 10 * M, sell: 16, color: 0xd8b860 },
  { id: 'carrot', label: 'Carrots', emoji: '🥕', seed: 15, grow: 30 * M, sell: 26, color: 0xe08a3a },
  { id: 'corn', label: 'Corn', emoji: '🌽', seed: 25, grow: 60 * M, sell: 45, color: 0xe8d050 },
  { id: 'tomato', label: 'Tomatoes', emoji: '🍅', seed: 40, grow: 2 * H, sell: 74, color: 0xd8443a },
  { id: 'potato', label: 'Potatoes', emoji: '🥔', seed: 60, grow: 4 * H, sell: 115, color: 0xb08a5a },
  { id: 'pumpkin', label: 'Pumpkins', emoji: '🎃', seed: 90, grow: 8 * H, sell: 185, color: 0xe0782a },
  { id: 'grapes', label: 'Grapes', emoji: '🍇', seed: 150, grow: 16 * H, sell: 320, color: 0x8a4ac0 },
  { id: 'sunflower', label: 'Sunflowers', emoji: '🌻', seed: 250, grow: 24 * H, sell: 545, color: 0xf0c830 },
];
/** Farming profit -5% (Dayne, 2026-11-04): a harvest sells each crop at 95% of its listed value. Seed costs are unchanged. */
export const FARM_SELL_MUL = 0.95;
export const cropSellValue = (c: Pick<Crop, 'sell'>) => c.sell * FARM_SELL_MUL;
/** Base profit for one harvested crop (sale value minus seed), never negative. */
export const cropProfit = (c: Pick<Crop, 'sell' | 'seed'>) => Math.max(0, cropSellValue(c) - c.seed);
export const cropById = (id: unknown) => CROPS.find((c) => c.id === id) ?? TROPICAL_CROPS.find((c) => c.id === id);
export type Stage = 'growing' | 'ready' | 'withered';
export const stageOf = (c: Crop, plantedAt: number, now: number): Stage => {
  const ready = plantedAt + c.grow; return now < ready ? 'growing' : now < ready + ripeWindow(c.grow) ? 'ready' : 'withered';
};

/** Daily profit tiers (base chips of profit, per player, reset at 00:00 UTC): full up to 100,000, then zero. */
export const FARM_TIERS: Array<{ upTo: number; rate: number }> = [{ upTo: 100_000, rate: 1 }, { upTo: Infinity, rate: 0 }];
/** Profit paid for `gross` base profit when `already` base profit was harvested today (floored once). */
export function farmPayout(gross: number, already: number): number {
  let left = gross, at = already, pay = 0, lo = 0;
  for (const t of FARM_TIERS) { if (left <= 0) break; const take = Math.min(left, Math.max(0, t.upTo - Math.max(at, lo))); pay += take * t.rate; left -= take; at += take; lo = t.upTo; }
  return Math.floor(pay + 1e-9);
}

// ---- layout: a grass apron east of the plate; two columns of fenced fields along dirt lanes.
export const FARM_X0 = PLATE, FARM_X1 = PLATE + 70, FARM_Z0 = -PLATE, FARM_Z1 = 62;
/** Dirt lanes: both run north out of the farm to a T on the outskirts' north road (z = -PLATE - 8); the west lane meets
 * Magma Depths' haul track at its south end, the middle lane runs on to Magma Depths' apron (no dead ends). */
export const FARM_LANES: Array<[number, number][]> = [[[PLATE + 5, -PLATE - 8], [PLATE + 5, FARM_Z1 - 2]], [[PLATE + 37, -PLATE - 8], [PLATE + 37, 96 - 17]]];
export const FARM_LANE_W = 4;
export interface FarmPlot extends OBB { n: number; cols: number; rows: number }
const SIZES: [number, number][] = [[4, 4], [6, 5], [5, 4], [8, 6], [4, 4], [10, 8], [6, 6], [12, 10], [5, 5], [7, 6], [4, 4], [9, 8], [6, 4], [8, 8], [11, 9], [5, 4]];
/** Fixed plot price (base chips) from the tile count: 180 per tile + 500, rounded to 500. A 4x4 = 3,500. */
export const farmPrice = (tiles: number) => Math.max(500, Math.round((180 * tiles + 500) / 500) * 500);
let plotCache: FarmPlot[] | null = null;
export function farmPlots(): FarmPlot[] {
  if (plotCache) return plotCache;
  const out: FarmPlot[] = []; const cols = [{ x0: PLATE + 8, x1: PLATE + 34.5 }, { x0: PLATE + 40, x1: FARM_X1 - 2 }];
  let k = 0;
  for (const c of cols) {
    let z = FARM_Z0 + 4;
    for (;;) {
      const [a, b] = SIZES[k % SIZES.length]; const w = a * TILE + 2, d = b * TILE + 2;
      if (z + d > FARM_Z1 - 14) break; // leave room for the barnyard at the south end
      out.push({ n: out.length + 1, cols: a, rows: b, w, d, rot: 0, x: c.x0 + w / 2, z: z + d / 2 }); z += d + 2.5; k++;
    }
  }
  plotCache = out; return out;
}
/** Decorative barns and silos (barnyard at the south end of each column). */
export const BARNS: OBB[] = [{ x: PLATE + 18, z: FARM_Z1 - 7, w: 10, d: 7, rot: 0 }, { x: PLATE + 52, z: FARM_Z1 - 7, w: 12, d: 8, rot: 0 }];
export const SILOS: [number, number][] = [[PLATE + 27, FARM_Z1 - 8], [PLATE + 62, FARM_Z1 - 8], [PLATE + 65.5, FARM_Z1 - 6]];
export const plotId = (n: number) => `f:${n}`;
/** Tile centre in world space (tile index = row * cols + col). */
export const tileXZ = (p: FarmPlot, i: number): [number, number] => [p.x - (p.cols * TILE) / 2 + TILE * ((i % p.cols) + 0.5), p.z - (p.rows * TILE) / 2 + TILE * (Math.floor(i / p.cols) + 0.5)];

/** What the client gets for one plot. `now` is the server clock (clients never send timestamps). */
export interface FarmTile { tile: number; crop: string; plantedAt: number; stage: Stage; readyAt: number; witherAt: number; fert?: string }
export interface FarmView { id: string; owner: string | null; mine: boolean; cols: number; rows: number; tiles: FarmTile[]; now: number; today: { gross: number; paid: number }; index: number; upgrades?: import('./farmUpgrades.js').FarmUpgradeLevels; farmingLevel?: number; growMul?: number; profitMul?: number; yieldBonus?: number; plowed?: number[]; machines?: import('./farmWork.js').MachineSet }
/** #33: what one tile of `c` really takes and earns after Farming XP + upgrades (base chips; seed comes back on harvest). */
/** Expected per-tile outcome; yieldBonus = farming level bonus crops (each extra crop is worth its full sell price). */
export const cropOutlook = (c: Crop, growMul = 1, profitMul = 1, yieldBonus = 0) => ({ grow: Math.round(c.grow * growMul), profit: Math.floor((cropSellValue(c) * (1 + yieldBonus) - c.seed) * profitMul) });

/** Where the camera may look: the whole plate (incl. the Trailer Park), the farm district on the east edge, the outskirts mines and the Airport / Speedway (shared/venues.ts). */
const SITES = Object.values(MINE_SITES); const HALF = MINE_APRON / 2;
export const MAP_BOUNDS = {
  x0: Math.min(-PLATE, OUTSKIRTS.x0 + 10, VENUE_BOUNDS.x0, PARK_AREA.x - PARK_AREA.w / 2, ...SITES.map((s) => s.x - HALF)) - 6, x1: Math.max(FARM_X1, OUTSKIRTS.x1 - 10, VENUE_BOUNDS.x1, ...SITES.map((s) => s.x + HALF)) + 4,
  z0: Math.min(-PLATE, FARM_Z0, OUTSKIRTS.z0 + 10, VENUE_BOUNDS.z0, PARK_AREA.z - PARK_AREA.d / 2, ...SITES.map((s) => s.z - HALF)) - 6, z1: Math.max(PLATE, FARM_Z1, OUTSKIRTS.z1 - 10, VENUE_BOUNDS.z1, PARK_AREA.z + PARK_AREA.d / 2, ...SITES.map((s) => s.z + HALF)) + 6,
};
/** Camera bounds = MAP_BOUNDS plus the ocean coast + harbour to the south (mu-visuals). MAP_BOUNDS stays as it was. */
export const MAP_VIEW = { ...MAP_BOUNDS, z1: Math.max(MAP_BOUNDS.z1, VIEW_Z1) };
/** Zoom-aware pan inset: the further out the camera is, the more of the view already shows the edges, so the target must stay nearer the middle
 *  (QA r7: at full zoom-out you could drag the city almost off screen). 0 when close in, ~half the half-extent at max distance. */
export const panInset = (dist: number, minD = 30, maxD = 360) => {
  const k = Math.min(1, Math.max(0, (dist - minD) / (maxD - minD)));
  return k * 0.55 * Math.min(MAP_BOUNDS.x1 - MAP_BOUNDS.x0, MAP_BOUNDS.z1 - MAP_BOUNDS.z0) / 2;
};
export const clampMapTarget = (x: number, z: number, inset = 0): [number, number] => {
  const cx = (MAP_VIEW.x0 + MAP_VIEW.x1) / 2, cz = (MAP_VIEW.z0 + MAP_VIEW.z1) / 2;
  const x0 = Math.min(cx, MAP_VIEW.x0 + inset), x1 = Math.max(cx, MAP_VIEW.x1 - inset), z0 = Math.min(cz, MAP_VIEW.z0 + inset), z1 = Math.max(cz, MAP_VIEW.z1 - inset);
  return [Math.min(x1, Math.max(x0, x)), Math.min(z1, Math.max(z0, z))];
};
