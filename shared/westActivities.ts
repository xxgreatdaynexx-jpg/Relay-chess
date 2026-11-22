/**
 * West Chud things to do (server/westActivities.ts runs them, client/src/lib/worldWestActs.ts draws the sites):
 *  - Ironworks Steel Mill: smelt banked ore into bars, steel, beams and rebar. Inputs come out of your Chud City Warehouse
 *    storage, outputs go back into it (sell them through the usual house sale, with its daily cap, or the market).
 *    Every pour pays a furnace fee; hiring the shift crew doubles the fee per pour and halves the time. Two furnaces per
 *    player, MILL_MAX_BATCH pours per batch, MILL_DAILY_POURS pours per UTC day.
 *  - Cedar Lake Fishing Pier: FISH_PER_DAY casts a day, FISH_COOLDOWN_MS apart, one catch per cast.
 *  - Cedar Lake Campground: a short campfire rest; the first rest each UTC day pays CAMP_PAY.
 *  - Cedar Crossing Farmers' Market: sell harvested crops from storage at MARKET_PREMIUM x their listed price,
 *    MARKET_SALES_PER_DAY sales a day, at most MARKET_MAX_UNITS units each.
 *  - Millbrook U-Pick: PICK_PER_DAY baskets a day, PICK_COOLDOWN_MS apart, one basket find each.
 *  - Stadium Rodeo: RODEO_PER_DAY bull rides a day, RODEO_COOLDOWN_MS apart; pay by seconds on the bull.
 * Amounts are base chips before the price index. Activity payouts are keyed ledger rows (one per catch, basket, ride,
 * rest or sale), so the daily caps hold across restarts. Everything needs the player in Chud City, not jailed or disabled.
 */
import { WEST_HAMLETS, WEST_LAKES, WEST_LAKESIDE, WEST_STADIUM, WEST_FIELDS } from './westCity.js';
import type { OBB } from './worldLayout.js';

export interface WestSpot { id: WestSpotId; label: string; icon: string; color: number; blurb: string; x: number; z: number }
export type WestSpotId = 'w-mill' | 'w-pier' | 'w-camp' | 'w-market' | 'w-upick' | 'w-rodeo';

const lake = WEST_LAKES.find((l) => l.name === 'Cedar Lake')!;
const crossing = WEST_HAMLETS.find((h) => h.name === 'Cedar Crossing')!;
const millbrook = WEST_HAMLETS.find((h) => h.name === 'Millbrook')!;
const tents = WEST_LAKESIDE.tents.filter((t) => Math.hypot(t.x - lake.x, t.z - lake.z) < 120);
const crossStore = crossing.shops.find((s) => s.kind === 'store')!;
/** Nearest vineyard or orchard field to Millbrook: the U-Pick farm stand sits at its edge facing the hamlet. */
const upickField = [...WEST_FIELDS].filter((f) => f.kind === 'orchard' || f.kind === 'vineyard').sort((a, b) => Math.hypot(a.x - millbrook.x, a.z - millbrook.z) - Math.hypot(b.x - millbrook.x, b.z - millbrook.z))[0]!;
const towards = (from: { x: number; z: number }, to: { x: number; z: number }, d: number) => { const l = Math.hypot(to.x - from.x, to.z - from.z) || 1; return { x: from.x + ((to.x - from.x) / l) * d, z: from.z + ((to.z - from.z) / l) * d }; };
const stand = towards(upickField, millbrook, Math.max(upickField.w, upickField.d) / 2 + 6);

/** Steel Mill yard in Ironworks (east of the warehouse rows along the Ironworks road, between its two lanes). */
export const WEST_MILL = { x: -358, z: -4, w: 34, d: 30, rot: 0 } as const;
/** Fishing pier: off the open west shore of Cedar Lake, reaching east into the water. */
export const WEST_PIER = { x: lake.x - lake.rx - 4, z: lake.z + 2, len: 16 } as const;
export const WEST_CAMP = { x: tents.reduce((a, t) => a + t.x, 0) / Math.max(1, tents.length), z: tents.reduce((a, t) => a + t.z, 0) / Math.max(1, tents.length) };
/** Farmers' Market stalls: on the green behind Cedar Crossing's general store (the side away from the road). */
const hamletRoadSide = Math.sign(crossing.shops.find((s) => s.kind === 'church')!.x - crossStore.x) || -1;
export const WEST_MARKET = { x: crossStore.x - hamletRoadSide * 14, z: crossStore.z - 16, rot: crossStore.rot } as const;
export const WEST_UPICK = { x: stand.x, z: stand.z, field: { x: upickField.x, z: upickField.z, kind: upickField.kind } } as const;
export const WEST_RODEO = { x: WEST_STADIUM.x, z: WEST_STADIUM.z } as const;

export const WEST_SPOTS: WestSpot[] = [
  { id: 'w-mill', label: 'Steel Mill', icon: '🏭', color: 0xff7a2a, x: WEST_MILL.x, z: WEST_MILL.z, blurb: 'Ironworks blast furnace: smelt your ore into iron bars, steel, beams and rebar.' },
  { id: 'w-pier', label: 'Fishing Pier', icon: '🎣', color: 0x3aa0e0, x: WEST_PIER.x, z: WEST_PIER.z, blurb: 'Cast off the Cedar Lake pier: 6 casts a day, a catch every time.' },
  { id: 'w-camp', label: 'Campground', icon: '🏕️', color: 0xe08a3a, x: WEST_CAMP.x, z: WEST_CAMP.z, blurb: 'Sit by the campfire at Cedar Lake. The first rest each day pays a bonus.' },
  { id: 'w-market', label: "Farmers' Market", icon: '🧺', color: 0x8ac040, x: WEST_MARKET.x, z: WEST_MARKET.z, blurb: 'Cedar Crossing stalls buy your harvested crops at a premium, a few sales a day.' },
  { id: 'w-upick', label: 'U-Pick Farm', icon: '🍇', color: 0xb05ad8, x: WEST_UPICK.x, z: WEST_UPICK.z, blurb: 'Millbrook pick-your-own: 3 baskets a day, every basket a find.' },
  { id: 'w-rodeo', label: 'Rodeo', icon: '🤠', color: 0xd8a040, x: WEST_RODEO.x, z: WEST_RODEO.z, blurb: 'Bull riding at the West Chud stadium: 3 rides a day, paid by seconds on the bull.' },
];
export const westSpot = (id: string) => WEST_SPOTS.find((s) => s.id === id);
export const isWestSpotId = (id: unknown): id is WestSpotId => typeof id === 'string' && WEST_SPOTS.some((s) => s.id === id);
/** Ground the sites keep clear of trees (the stadium already is). */
export const WEST_ACTIVITY_SOLIDS: OBB[] = [
  { x: WEST_MILL.x, z: WEST_MILL.z, w: WEST_MILL.w + 6, d: WEST_MILL.d + 6, rot: 0 },
  { x: WEST_PIER.x - 5, z: WEST_PIER.z, w: 10, d: 10, rot: 0 },
  { x: WEST_MARKET.x, z: WEST_MARKET.z, w: 16, d: 10, rot: WEST_MARKET.rot },
  { x: WEST_UPICK.x, z: WEST_UPICK.z, w: 10, d: 10, rot: 0 },
];

/* ---------------- Steel Mill ---------------- */
export type MillItem = { type: 'ore' | 'bar' | 'good'; id: string; qty: number };
export type MillRecipeId = 'pig' | 'steel' | 'beam' | 'rebar';
export interface MillRecipe { id: MillRecipeId; label: string; icon: string; inputs: MillItem[]; output: MillItem; secs: number; fee: number; blurb: string }
/** Per pour. Prices for reference (house, base): iron ore 4, coal 1, iron bar 25, steel 61, steel beam 159, iron rod 15. */
export const MILL_RECIPES: MillRecipe[] = [
  { id: 'pig', label: 'Pig Iron', icon: '🧱', inputs: [{ type: 'ore', id: 'iron', qty: 3 }, { type: 'ore', id: 'coal', qty: 1 }], output: { type: 'bar', id: 'iron_bar', qty: 1 }, secs: 4, fee: 1, blurb: 'Iron ore and coal into iron bars, twice as fast as a factory smelter.' },
  { id: 'steel', label: 'Bessemer Steel', icon: '🔥', inputs: [{ type: 'ore', id: 'iron', qty: 5 }, { type: 'ore', id: 'coal', qty: 3 }], output: { type: 'bar', id: 'steel', qty: 1 }, secs: 8, fee: 3, blurb: 'Straight from ore to steel ingots in the converter: no iron bars needed.' },
  { id: 'beam', label: 'Steel Beams', icon: '🏗️', inputs: [{ type: 'bar', id: 'steel', qty: 2 }, { type: 'ore', id: 'coal', qty: 1 }], output: { type: 'good', id: 'steel_beam', qty: 1 }, secs: 10, fee: 4, blurb: 'Reheat and roll steel into I-beams for girders and construction.' },
  { id: 'rebar', label: 'Rebar', icon: '🪛', inputs: [{ type: 'bar', id: 'iron_bar', qty: 1 }], output: { type: 'good', id: 'iron_rod', qty: 3 }, secs: 5, fee: 2, blurb: 'Draw iron bars into rods: three per bar on the mill line (two in a factory roller).' },
];
export const millRecipe = (id: unknown) => MILL_RECIPES.find((r) => r.id === id);
export const MILL_FURNACES = 2;
export const MILL_MAX_BATCH = 50;
export const MILL_DAILY_POURS = 200;
/** Shift crew: wage per pour = fee x MILL_CREW_WAGE_X, time / 2. */
export const MILL_CREW_WAGE_X = 2;
export const millBatchMs = (r: MillRecipe, qty: number, crew: boolean) => Math.round(r.secs * 1000 * qty / (crew ? 2 : 1));
export const millCost = (r: MillRecipe, qty: number, crew: boolean, px: (n: number) => number = (n) => n) => px(r.fee) * qty + (crew ? px(r.fee * MILL_CREW_WAGE_X) * qty : 0);
export const MILL_GAME = 'westchud_mill';

/* ---------------- Fishing pier ---------------- */
export interface Find { id: string; label: string; emoji: string; pay: number; odds: number }
const pickOf = (list: Find[]) => (u: number): Find => { let acc = 0; for (const f of list) { acc += f.odds; if (u * 100 < acc) return f; } return list[list.length - 1]!; };
export const evOf = (list: Find[]) => list.reduce((a, f) => a + (f.odds / 100) * f.pay, 0);
export const FISH_PER_DAY = 6;
export const FISH_COOLDOWN_MS = 40_000;
/** Expected about 457 per cast (about 2,740 a day). */
export const FISH_CATCHES: Find[] = [
  { id: 'perch', label: 'Yellow Perch', emoji: '🐟', pay: 150, odds: 40 },
  { id: 'bluegill', label: 'Bluegill', emoji: '🐠', pay: 220, odds: 25 },
  { id: 'bass', label: 'Largemouth Bass', emoji: '🐟', pay: 400, odds: 18 },
  { id: 'trout', label: 'Rainbow Trout', emoji: '🌈', pay: 750, odds: 10 },
  { id: 'pike', label: 'Northern Pike', emoji: '🦈', pay: 1_500, odds: 5 },
  { id: 'carp', label: 'Golden Carp', emoji: '✨', pay: 6_000, odds: 2 },
];
export const fishOf = pickOf(FISH_CATCHES);

/* ---------------- Campground ---------------- */
export const CAMP_MS = 45_000;
export const CAMP_PAY = 1_200;

/* ---------------- Farmers' market ---------------- */
export const MARKET_SALES_PER_DAY = 5;
export const MARKET_MAX_UNITS = 10;
export const MARKET_PREMIUM = 1.1;
/** Field and orchard crops only (not flowers or tropical plantation crops). */
export const MARKET_CROPS = ['crop_strawberry', 'crop_wheat', 'crop_carrot', 'crop_corn', 'crop_tomato', 'crop_potato', 'crop_pumpkin', 'crop_grapes', 'crop_sunflower', 'crop_apple', 'crop_cherry', 'crop_peach', 'crop_orange', 'crop_pear', 'crop_plum'] as const;
export const isMarketCrop = (id: unknown): id is (typeof MARKET_CROPS)[number] => typeof id === 'string' && (MARKET_CROPS as readonly string[]).includes(id);
/** Pay for `qty` units of a crop listed at `price` base chips (rounded down after the price index). */
export const marketPay = (price: number, qty: number, px: (n: number) => number = (n) => n) => Math.floor(px(price * MARKET_PREMIUM) * qty);

/* ---------------- U-Pick ---------------- */
export const PICK_PER_DAY = 3;
export const PICK_COOLDOWN_MS = 60_000;
/** Expected about 535 per basket (about 1,600 a day). */
export const PICK_FINDS: Find[] = [
  { id: 'apples', label: 'Basket of Apples', emoji: '🍎', pay: 300, odds: 45 },
  { id: 'pears', label: 'Basket of Pears', emoji: '🍐', pay: 450, odds: 30 },
  { id: 'plums', label: 'Basket of Plums', emoji: '🫐', pay: 700, odds: 15 },
  { id: 'grapes', label: 'Crate of Grapes', emoji: '🍇', pay: 1_000, odds: 8 },
  { id: 'golden', label: 'Golden Apple', emoji: '🍏', pay: 4_000, odds: 2 },
];
export const pickFindOf = pickOf(PICK_FINDS);

/* ---------------- Rodeo ---------------- */
export const RODEO_PER_DAY = 3;
export const RODEO_COOLDOWN_MS = 90_000;
/** Seconds on the bull (1..8; 8 is a full ride). Expected about 633 per ride (about 1,900 a day). */
export const RODEO_TABLE: Array<{ secs: number; pay: number; odds: number }> = [
  { secs: 1, pay: 100, odds: 20 }, { secs: 2, pay: 200, odds: 20 }, { secs: 3, pay: 350, odds: 18 }, { secs: 4, pay: 600, odds: 15 },
  { secs: 5, pay: 900, odds: 12 }, { secs: 6, pay: 1_400, odds: 8 }, { secs: 7, pay: 2_000, odds: 5 }, { secs: 8, pay: 5_000, odds: 2 },
];
export const rodeoOf = (u: number) => { let acc = 0; for (const r of RODEO_TABLE) { acc += r.odds; if (u * 100 < acc) return r; } return RODEO_TABLE[RODEO_TABLE.length - 1]!; };
export const rodeoEV = () => RODEO_TABLE.reduce((a, r) => a + (r.odds / 100) * r.pay, 0);

export const westDayKey = (kind: 'fish' | 'camp' | 'mkt' | 'pick' | 'rodeo', player: string, day: string, n: number | string) => `wc_${kind}:${player}:${day}:${n}`;

/* ---------------- what the panels get (server/westActivities.ts westActState) ---------------- */
export interface MillView {
  furnaces: number; maxBatch: number; dailyPours: number; poursToday: number;
  jobs: Array<{ id: string; recipe: MillRecipeId; qty: number; crew: boolean; startAt: number; doneAt: number; ready: boolean }>;
  recipes: Array<{ id: MillRecipeId; fee: number; wage: number; canPour: number }>;
}
export interface WestActState {
  day: string; here: boolean;
  fish: { used: number; max: number; catches: Array<{ id: string; label: string; emoji: string; pay: number }>; readyIn: number };
  camp: { claimed: boolean; pay: number; restingFor: number | null; ms: number };
  market: { used: number; max: number; maxUnits: number; crops: Array<{ id: string; name: string; have: number; each: number }> };
  pick: { used: number; max: number; finds: Array<{ id: string; label: string; emoji: string; pay: number }>; readyIn: number };
  rodeo: { used: number; max: number; rides: Array<{ secs: number; pay: number }>; readyIn: number };
  mill: MillView;
}
