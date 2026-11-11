/**
 * Farm district (Chud Acres Farms): farmland plots on the east edge of the city map, outside the city plate, and the
 * FarmVille-style crop game played inside an owned plot. Plots are real-estate properties (type 'farmland', id `f:<n>`):
 * bought, taxed and repossessed by the real-estate system. All chip amounts here are BASE units: the server scales seed
 * costs and harvest payouts by the price index (px / priceIndex).
 *
 * Crops grow on the server clock. A crop is ready at plantedAt + grow, and withers at ready + ripeWindow (max of 36 h and WITHER_FACTOR x grow).
 * Harvest pays back the seed cost in full plus the crop's profit (sell - seed), with no daily farm profit cap,
 * and never pays less than the seeds cost.
 */
import { VIEW_Z1 } from './ocean.js';
import { BIG_FARM_AREA } from './bigFarms.js';
import { EXPANSION_BOUNDS, RIG_BERTHS, RIG_DOCK } from './mapExpansion.js';
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
/** Dayne 2026-11-05: crops grow 30% faster (duration ×0.7). Applied at definition so client display + server readyAt stay in sync. */
const GROW_SCALE = 0.7;
export const growMs = (ms: number) => Math.round(ms * GROW_SCALE);
/** Raw farm output over seed: harvest pays ~seed x CROP_SEED_MUL after FARM_SELL_MUL. */
export const CROP_SEED_MUL = 1.35;
/** Farming profit -5% (Dayne, 2026-11-04): a harvest sells each crop at 95% of its listed value. Seed costs are unchanged. */
export const FARM_SELL_MUL = 0.95;
/** Listed sell so cropSellValue (= sell x FARM_SELL_MUL) ≈ seed x CROP_SEED_MUL. */
export const cropListSell = (seed: number) => Math.round((seed * CROP_SEED_MUL) / FARM_SELL_MUL * 100) / 100;

/** Crop margins: raw harvest profits 35% of seed (after FARM_SELL_MUL). Factory food steps add +8% on inputs separately. */
/** Base chips. Fast crops pay little per hour unless you keep coming back; slow ones are the big money per click. */
export const CROPS: Crop[] = [
  { id: 'strawberry', label: 'Strawberries', emoji: '🍓', seed: 5, grow: growMs(4 * M), sell: cropListSell(5), color: 0xd84a5a },
  { id: 'wheat', label: 'Wheat', emoji: '🌾', seed: 10, grow: growMs(10 * M), sell: cropListSell(10), color: 0xd8b860 },
  { id: 'carrot', label: 'Carrots', emoji: '🥕', seed: 15, grow: growMs(30 * M), sell: cropListSell(15), color: 0xe08a3a },
  { id: 'corn', label: 'Corn', emoji: '🌽', seed: 25, grow: growMs(60 * M), sell: cropListSell(25), color: 0xe8d050 },
  { id: 'tobacco', label: 'Tobacco', emoji: '🌿', seed: 30, grow: growMs(90 * M), sell: cropListSell(30), color: 0x8a6a3a },
  { id: 'tomato', label: 'Tomatoes', emoji: '🍅', seed: 40, grow: growMs(2 * H), sell: cropListSell(40), color: 0xd8443a },
  { id: 'potato', label: 'Potatoes', emoji: '🥔', seed: 60, grow: growMs(4 * H), sell: cropListSell(60), color: 0xb08a5a },
  { id: 'pumpkin', label: 'Pumpkins', emoji: '🎃', seed: 90, grow: growMs(8 * H), sell: cropListSell(90), color: 0xe0782a },
  { id: 'grapes', label: 'Grapes', emoji: '🍇', seed: 150, grow: growMs(16 * H), sell: cropListSell(150), color: 0x8a4ac0 },
  { id: 'sunflower', label: 'Sunflowers', emoji: '🌻', seed: 250, grow: growMs(24 * H), sell: cropListSell(250), color: 0xf0c830 },
];
export const cropSellValue = (c: Pick<Crop, 'sell'>) => c.sell * FARM_SELL_MUL;
/** Base profit for one harvested crop (sale value minus seed), never negative. */
export const cropProfit = (c: Pick<Crop, 'sell' | 'seed'>) => Math.max(0, cropSellValue(c) - c.seed);
/** Flowers and other difficult crops. Only plantable on a finished hyper farm. */
export const HYPER_CROPS: Crop[] = [
  { id: 'tulips', label: 'Tulips', emoji: '🌷', seed: 420, grow: growMs(20 * H), sell: cropListSell(420), color: 0xe04080 },
  { id: 'roses', label: 'Roses', emoji: '🌹', seed: 520, grow: growMs(22 * H), sell: cropListSell(520), color: 0xc01830 },
  { id: 'orchids', label: 'Orchids', emoji: '🌸', seed: 780, grow: growMs(28 * H), sell: cropListSell(780), color: 0xd890d0 },
  { id: 'saffron', label: 'Saffron', emoji: '🌼', seed: 1_200, grow: growMs(36 * H), sell: cropListSell(1_200), color: 0xe8b020 },
  { id: 'wasabi', label: 'Wasabi', emoji: '🌱', seed: 640, grow: growMs(24 * H), sell: cropListSell(640), color: 0x3aaa4a },
  { id: 'vanilla', label: 'Vanilla', emoji: '🌾', seed: 900, grow: growMs(32 * H), sell: cropListSell(900), color: 0xf0e0c0 },
];
export const isHyperCrop = (id: unknown) => HYPER_CROPS.some((c) => c.id === id);
/**
 * Fruit trees for Orchard Ridge. `seed` is the one-time sapling cost (house-cap planting bonus applies).
 * `grow` is sapling → first fruit (several real days after GROW_SCALE). `cycle` is the repeating
 * fruiting interval once the tree is mature — harvest does not remove the tree and no replant is needed.
 * `sell` is priced off a fruit basis (not the sapling), at the same +35% raw margin as other crops.
 */
export interface OrchardTree extends Crop { cycle: number }
export const ORCHARD_TREES: OrchardTree[] = [
  { id: 'apple',  label: 'Apples',   emoji: '🍎', seed: 520, grow: growMs(7 * 24 * H),  cycle: growMs(24 * H), sell: cropListSell(200), color: 0xc83030 },
  { id: 'cherry', label: 'Cherries', emoji: '🍒', seed: 480, grow: growMs(5 * 24 * H),  cycle: growMs(18 * H), sell: cropListSell(160), color: 0xc01830 },
  { id: 'peach',  label: 'Peaches',  emoji: '🍑', seed: 640, grow: growMs(8 * 24 * H),  cycle: growMs(24 * H), sell: cropListSell(220), color: 0xf07850 },
  { id: 'orange', label: 'Oranges',  emoji: '🍊', seed: 780, grow: growMs(10 * 24 * H), cycle: growMs(30 * H), sell: cropListSell(260), color: 0xf0a020 },
  { id: 'pear',   label: 'Pears',    emoji: '🍐', seed: 560, grow: growMs(7 * 24 * H),  cycle: growMs(24 * H), sell: cropListSell(190), color: 0x8aaa3a },
  { id: 'plum',   label: 'Plums',    emoji: '🫐', seed: 500, grow: growMs(6 * 24 * H),  cycle: growMs(20 * H), sell: cropListSell(170), color: 0x6a3a8a },
];
export const isOrchardCrop = (id: unknown) => ORCHARD_TREES.some((c) => c.id === id);
export const orchardTree = (id: unknown) => ORCHARD_TREES.find((c) => c.id === id);
/** Factory raw-crop unit used for GOODS pricing: fruit basis for trees, sapling/seed for everything else. */
export const cropUnitSeed = (c: Crop) => {
  if (!isOrchardCrop(c.id)) return c.seed;
  return Math.round(cropSellValue(c) / CROP_SEED_MUL);
};
export const cropById = (id: unknown) => CROPS.find((c) => c.id === id) ?? TROPICAL_CROPS.find((c) => c.id === id) ?? HYPER_CROPS.find((c) => c.id === id) ?? orchardTree(id);
for (const c of TROPICAL_CROPS) c.sell = cropListSell(c.seed);
export type Stage = 'growing' | 'ready' | 'withered';
/** Grow time for a tile: sapling `grow` until the tree has matured, then the repeating `cycle`. */
export const cropGrowMs = (c: Crop, matured = false) => {
  const tree = orchardTree(c.id);
  return tree && matured ? tree.cycle : c.grow;
};
export const stageOf = (c: Crop, plantedAt: number, now: number, matured = false): Stage => {
  const grow = cropGrowMs(c, matured);
  const ready = plantedAt + grow;
  if (now < ready) return 'growing';
  if (isOrchardCrop(c.id)) return 'ready'; // fruit stays on the tree until picked; the tree never dies
  return now < ready + ripeWindow(grow) ? 'ready' : 'withered';
};
/** 0–99 while still growing so a nearly-ripe bar never looks finished; 100 only once `now` reaches readyAt. */
export const growProgressPct = (plantedAt: number, readyAt: number, now: number): number => {
  if (now >= readyAt) return 100;
  const span = readyAt - plantedAt;
  if (!(span > 0)) return 0;
  return Math.min(99, Math.max(0, Math.floor((100 * (now - plantedAt)) / span)));
};

/** Profit paid for `gross` base profit. There is no daily farm profit cap: the full (floored) amount is paid.
 *  `already` is ignored and kept so existing harvest call sites stay unchanged. */
export function farmPayout(gross: number, _already = 0): number {
  void _already;
  return Math.max(0, Math.floor(gross + 1e-9));
}

/** Chips paid for a harvest (or a crop shipment sold like a harvest). Profit is floor(payout × index),
 *  but the total is never below the same per-seed indexed price (`px`) charged when those seeds were planted. */
export function farmHarvestChips(seedsBase: number, profitPayout: number, index: number, seedIndexed: number): number {
  const idx = Number.isFinite(index) && index > 0 ? index : 1;
  return Math.max(seedIndexed, Math.floor((seedsBase + profitPayout) * idx));
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
export interface FarmTile { tile: number; crop: string; plantedAt: number; stage: Stage; readyAt: number; witherAt: number; fert?: string; matured?: boolean }
export interface FarmAuto { harvest: boolean; /** When harvest is on: send ripe crops to the kitchen pantry instead of selling. */ pantry: boolean; plant: boolean; crop: string }
export interface FarmView { id: string; owner: string | null; mine: boolean; cols: number; rows: number; tiles: FarmTile[]; now: number; today: { gross: number; paid: number }; index: number; upgrades?: import('./farmUpgrades.js').FarmUpgradeLevels; farmingLevel?: number; growMul?: number; profitMul?: number; yieldBonus?: number; plowed?: number[]; machines?: import('./farmWork.js').MachineSet; auto?: FarmAuto }
/** #33: what one tile of `c` really takes and earns after Farming XP + upgrades (base chips; seed comes back on harvest). */
/** Expected per-tile outcome; yieldBonus = farming level bonus crops (each extra crop is worth its full sell price). */
export const cropOutlook = (c: Crop, growMul = 1, profitMul = 1, yieldBonus = 0) => ({ grow: Math.round(c.grow * growMul), profit: Math.floor((cropSellValue(c) * (1 + yieldBonus) - c.seed) * profitMul) });

/** Where the camera may look: the whole plate (incl. the Trailer Park), the farm district on the east edge, the outskirts mines and the Airport / Speedway (shared/venues.ts). */
const SITES = Object.values(MINE_SITES); const HALF = MINE_APRON / 2;
export const MAP_BOUNDS = {
  x0: Math.min(-PLATE, OUTSKIRTS.x0 + 10, VENUE_BOUNDS.x0, PARK_AREA.x - PARK_AREA.w / 2, EXPANSION_BOUNDS.x0, ...SITES.map((s) => s.x - HALF)) - 6, x1: Math.max(FARM_X1, OUTSKIRTS.x1 - 10, BIG_FARM_AREA.x1, VENUE_BOUNDS.x1, EXPANSION_BOUNDS.x1, ...SITES.map((s) => s.x + HALF)) + 4,
  z0: Math.min(-PLATE, FARM_Z0, OUTSKIRTS.z0 + 10, BIG_FARM_AREA.z0, VENUE_BOUNDS.z0, PARK_AREA.z - PARK_AREA.d / 2, EXPANSION_BOUNDS.z0, ...SITES.map((s) => s.z - HALF)) - 6, z1: Math.max(PLATE, FARM_Z1, OUTSKIRTS.z1 - 10, BIG_FARM_AREA.z1, VENUE_BOUNDS.z1, PARK_AREA.z + PARK_AREA.d / 2, EXPANSION_BOUNDS.z1, ...SITES.map((s) => s.z + HALF)) + 6,
};
/** Camera bounds = MAP_BOUNDS plus the ocean coast, harbour, and launched-rig berths. MAP_BOUNDS stays land-side of the shore. */
export const MAP_VIEW = {
  x0: Math.min(MAP_BOUNDS.x0, RIG_DOCK.x - 40),
  x1: Math.max(MAP_BOUNDS.x1, RIG_DOCK.x + 40),
  z0: MAP_BOUNDS.z0,
  z1: Math.max(MAP_BOUNDS.z1, VIEW_Z1, RIG_DOCK.z + 20, ...RIG_BERTHS.map(([, z]) => z + 20)),
};
/** Closest and furthest the city camera may sit from its pan target. Max is large enough that a 38° vertical FOV can frame the whole expanded map (city plate + East Estates + Goldwood + ocean berths) with a little margin for the minimum tilt. */
export const MAP_CAM_MIN = 30;
export const MAP_CAM_MAX = Math.max(360, Math.ceil((Math.max(MAP_VIEW.x1 - MAP_VIEW.x0, MAP_VIEW.z1 - MAP_VIEW.z0) / 2) / Math.tan((38 * Math.PI) / 180 / 2) * 1.2));
/** Perspective far plane: past max zoom, plus room for fog and the map corners. */
export const MAP_CAM_FAR = Math.max(900, Math.ceil(MAP_CAM_MAX * 2.5));
/** Zoom-aware pan inset: the further out the camera is, the more of the view already shows the edges, so the target must stay nearer the middle
 *  (QA r7: at full zoom-out you could drag the city almost off screen). 0 when close in, ~half the half-extent at max distance. */
export const panInset = (dist: number, minD = MAP_CAM_MIN, maxD = MAP_CAM_MAX) => {
  const k = Math.min(1, Math.max(0, (dist - minD) / (maxD - minD)));
  return k * 0.55 * Math.min(MAP_BOUNDS.x1 - MAP_BOUNDS.x0, MAP_BOUNDS.z1 - MAP_BOUNDS.z0) / 2;
};
export const clampMapTarget = (x: number, z: number, inset = 0): [number, number] => {
  const cx = (MAP_VIEW.x0 + MAP_VIEW.x1) / 2, cz = (MAP_VIEW.z0 + MAP_VIEW.z1) / 2;
  const x0 = Math.min(cx, MAP_VIEW.x0 + inset), x1 = Math.max(cx, MAP_VIEW.x1 - inset), z0 = Math.min(cz, MAP_VIEW.z0 + inset), z1 = Math.max(cz, MAP_VIEW.z1 - inset);
  return [Math.min(x1, Math.max(x0, x)), Math.min(z1, Math.max(z0, z))];
};
