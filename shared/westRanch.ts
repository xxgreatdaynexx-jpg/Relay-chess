/**
 * West Chud ranches: six of the countryside pastures are buyable ranch deeds (ranch:1..6), priced like West Chud farms
 * of the same tile count (expansionFarmPrice). The owner stocks animals that produce on timers:
 *   cow → milk, chicken → eggs, pig → bacon (all into the Chud City Warehouse pantry as food stacks, the same items the
 *   grocery sells and kitchens cook with); sheep → wool, sold on collection to the Cedar Crossing wool buyer for chips.
 * Each animal takes pasture room (units); a ranch holds one unit per tile. Every animal type yields about
 * RANCH_UNIT_DAY base chips of goods per unit per day. Output waits in the ranch barn for up to BARN_HOURS of
 * production, or HAND_BARN_HOURS while a hired ranch hand is on the payroll (their daily wage is HAND_WAGE_SHARE of the
 * ranch's full-day output). Animals sell back for ANIMAL_SELL_BACK of their price. Amounts are base chips (price index applies).
 */
import { WEST_FIELDS } from './westCity.js';
import { expansionFarmPrice } from './mapExpansion.js';

export type AnimalId = 'cow' | 'sheep' | 'pig' | 'chicken';
export interface AnimalDef { id: AnimalId; label: string; emoji: string; units: number; price: number; product: { kind: 'food' | 'wool'; id: string; label: string; emoji: string; base: number }; everyMs: number }
const H = 3_600_000;
export const ANIMALS: AnimalDef[] = [
  { id: 'chicken', label: 'Chicken', emoji: '🐔', units: 1, price: 60, product: { kind: 'food', id: 'eggs', label: 'Eggs', emoji: '🥚', base: 3 }, everyMs: 2 * H },
  { id: 'sheep', label: 'Sheep', emoji: '🐑', units: 2, price: 120, product: { kind: 'wool', id: 'wool', label: 'Wool', emoji: '🧶', base: 12 }, everyMs: 4 * H },
  { id: 'pig', label: 'Pig', emoji: '🐖', units: 3, price: 180, product: { kind: 'food', id: 'bacon', label: 'Bacon', emoji: '🥓', base: 9 }, everyMs: 2 * H },
  { id: 'cow', label: 'Dairy Cow', emoji: '🐄', units: 4, price: 240, product: { kind: 'food', id: 'milk', label: 'Milk', emoji: '🥛', base: 3 }, everyMs: H / 2 },
];
export const animalById = (id: unknown) => ANIMALS.find((a) => a.id === id);
/** Base chips of product per animal per day. */
export const animalDay = (a: AnimalDef) => (86_400_000 / a.everyMs) * a.product.base;
/** Every animal yields this per unit of pasture per day (cows 144/4, pigs 108/3, sheep 72/2, chickens 36/1). */
export const RANCH_UNIT_DAY = 36;
export const BARN_HOURS = 12;
export const HAND_BARN_HOURS = 48;
export const HAND_WAGE_SHARE = 0.25;
export const HAND_MAX_DAYS = 7;
export const ANIMAL_SELL_BACK = 0.5;
export const RANCH_BUY_MAX = 50;

export interface RanchPlot { n: number; id: string; x: number; z: number; w: number; d: number; rot: number; cols: number; rows: number; tiles: number; price: number; label: string }
const ranchName = ['Cedar Creek', 'Ridgeview', 'Sunset', 'Hollow Oak', 'Maple Run', 'Prairie Rose'];
let cache: RanchPlot[] | null = null;
/** The six largest West Chud pastures, in a fixed order (deterministic layout → stable ids). */
export function westRanches(): RanchPlot[] {
  if (cache) return cache;
  const big = WEST_FIELDS.filter((f) => f.kind === 'pasture').map((f) => ({ f, a: f.w * f.d })).sort((a, b) => b.a - a.a || a.f.x - b.f.x).slice(0, 6).map((o) => o.f).sort((a, b) => a.x - b.x || a.z - b.z);
  cache = big.map((f, i) => { const cols = Math.floor(f.w / 2), rows = Math.floor(f.d / 2); const n = i + 1;
    return { n, id: ranchId(n), x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rot, cols, rows, tiles: cols * rows, price: expansionFarmPrice({ cols, rows }), label: `${ranchName[i] ?? 'West Chud'} Ranch` }; });
  return cache;
}
export const ranchId = (n: number) => `ranch:${n}`;
export const isRanchId = (id: unknown): id is string => typeof id === 'string' && /^ranch:\d+$/.test(id) && westRanches().some((r) => r.id === id);
export const ranchById = (id: unknown) => westRanches().find((r) => r.id === id);
/** Pasture room in animal units: one per tile. */
export const ranchCapacity = (r: Pick<RanchPlot, 'tiles'>) => r.tiles;

export type Herd = Record<AnimalId, number>;
export interface RanchState { herd: Herd; /** produced but not collected, per animal type (whole items) */ barn: Record<AnimalId, number>; /** production clock per type */ t: Record<AnimalId, number>; handUntil: number }
export const emptyHerd = (): Herd => ({ cow: 0, sheep: 0, pig: 0, chicken: 0 });
export const newRanch = (now: number): RanchState => ({ herd: emptyHerd(), barn: emptyHerd(), t: { cow: now, sheep: now, pig: now, chicken: now }, handUntil: 0 });
export const unitsUsed = (h: Herd) => ANIMALS.reduce((a, x) => a + (h[x.id] ?? 0) * x.units, 0);
/** Barn room per animal type: BARN_HOURS (or HAND_BARN_HOURS with a hand) of that herd's production. */
export const barnCap = (s: RanchState, a: AnimalDef, now: number) => Math.floor(((s.handUntil > now ? HAND_BARN_HOURS : BARN_HOURS) * H / a.everyMs) * (s.herd[a.id] ?? 0));
/**
 * Advance production to `now` (pure; mutates s). Each type makes one item per animal per everyMs; the barn stops filling
 * at its cap (time spent full is lost). A hand's longer barn only counts while the hand is on the payroll.
 */
export function settle(s: RanchState, now: number): RanchState {
  for (const a of ANIMALS) {
    const n = s.herd[a.id] ?? 0; const t0 = s.t[a.id] ?? now;
    if (n <= 0 || now <= t0) { if (n <= 0) s.t[a.id] = now; continue; }
    const cycles = Math.floor((now - t0) / a.everyMs); const cap = barnCap(s, a, now);
    s.barn[a.id] = Math.min(cap, (s.barn[a.id] ?? 0) + cycles * n);
    s.t[a.id] = s.barn[a.id] >= cap ? now : t0 + cycles * a.everyMs;
  }
  return s;
}
/** Ranch hand wage per day: a share of the full-stock daily output of the current herd (base chips, at least 10). */
export const handWagePerDay = (h: Herd) => Math.max(10, Math.round(ANIMALS.reduce((a, x) => a + animalDay(x) * (h[x.id] ?? 0), 0) * HAND_WAGE_SHARE));
export const RANCH_MIGRATION = `CREATE TABLE IF NOT EXISTS westchud_ranches (ranch_id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL, updated_at BIGINT NOT NULL);`;

export interface RanchView {
  id: string; label: string; tiles: number; capacity: number; used: number; owner: boolean; here: boolean;
  herd: Herd; barn: Herd; cap: Herd; handUntil: number; handWage: number;
  animals: Array<{ id: AnimalId; price: number; sell: number; product: number }>;
}
