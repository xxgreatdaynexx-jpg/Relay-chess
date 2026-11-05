/**
 * Mechanic Shop: performance upgrades + cosmetics for owned cars (pure rules shared by server and client).
 *
 * Performance: seven parts, tiers 0 (stock) .. 3 (race), bought in order. Gains are modest and multiplicative on the
 * car's own stats, on the car's (possibly engine-swapped) base. Without a swap a maxed cheap car stays
 * far behind; an engine swap (see ENGINE_SWAPS) is what turns any car into something worth having.
 * Cosmetics: paint (incl. metallic), rims, spoiler/body kit, underglow; visible to everyone (synced in the drive snapshot).
 * Prices: % of the car's base list price, run through px() by the server, with a small floor. Every purchase is a pure
 * chip sink: no refunds, no downgrade payouts, and upgrades add nothing to the car's sell-back value.
 */
import { carPhysics, type CarModel, type CarTier } from './cars.js';

export type PerfPart = 'engine' | 'turbo' | 'tires' | 'handling' | 'nitro' | 'trans' | 'weight';
export const PERF_PARTS: Array<{ id: PerfPart; label: string; icon: string; tiers: [string, string, string]; what: string }> = [
  { id: 'engine', label: 'Engine', icon: '🔧', tiers: ['Street tune', 'Sport cams', 'Race build'], what: 'Top speed' },
  { id: 'turbo', label: 'Turbo', icon: '🌀', tiers: ['Intake & exhaust', 'Turbo kit', 'Twin turbo'], what: 'Acceleration' },
  { id: 'tires', label: 'Tires', icon: '🛞', tiers: ['Sport tires', 'Semi-slicks', 'Racing slicks'], what: 'Grip in fast corners (+7% tyre grip per tier on the Speedway), less slowdown off-road' },
  { id: 'handling', label: 'Suspension', icon: '🏎️', tiers: ['Lowering springs', 'Coilovers', 'Race suspension'], what: 'Steering, less body roll and weight transfer' },
  { id: 'nitro', label: 'Nitro', icon: '🔥', tiers: ['Nitro (1 bottle)', 'Nitro (2 bottles)', 'Nitro (3 bottles)'], what: 'Hold Shift / N for a boost' },
  { id: 'trans', label: 'Transmission', icon: '⚙️', tiers: ['Short shifter', 'Close-ratio box', 'Sequential race box'], what: 'Acceleration' },
  { id: 'weight', label: 'Weight reduction', icon: '🪶', tiers: ['Strip interior', 'Carbon panels', 'Full race diet'], what: 'Acceleration and steering' },
];
export const MAX_TIER = 3;
/** Price per tier as a fraction of the car's base list price, and the floor in base chips. */
export const TIER_PCT = [0.05, 0.1, 0.18] as const;
export const TIER_FLOOR = [200, 450, 900] as const;
export const COSMETIC_PCT = 0.03, COSMETIC_FLOOR = 150;

/** Effect per tier (index = tier). */
export const ENGINE_TOP = [1, 1.04, 1.08, 1.12];
export const TURBO_ACCEL = [1, 1.08, 1.16, 1.25];
export const TIRES_GRIP = [0.45, 0.4, 0.35, 0.3]; // fraction of grip lost at top speed (stock 0.45)
export const TIRES_OFFROAD = [0.4, 0.46, 0.52, 0.58]; // off-road speed factor (stock 0.4)
export const HANDLING_STEER = [0, 0.1, 0.2, 0.3]; // added to the steering rate (rad/s), stock is 1.56..3.0
export const NITRO_SECONDS = [0, 2, 3, 4];
export const TRANS_ACCEL = [1, 1.05, 1.1, 1.15];
export const WEIGHT_ACCEL = [1, 1.04, 1.08, 1.12];
export const WEIGHT_STEER = [0, 0.05, 0.1, 0.15];
export const NITRO_TOP = 1.15, NITRO_ACCEL = 1.5, NITRO_RECHARGE = 0.2; // seconds of boost regained per second
/** Highest top-speed factor any upgrade combination can reach (engine × nitro): the server's speed check uses it. */
export const MAX_SPEED_FACTOR = ENGINE_TOP[3]! * NITRO_TOP;

/**
 * Engine swaps: a separate slot from the 3-tier engine tune. A swap REPLACES the car's base drivetrain: base top speed
 * becomes max(stock, swap.top × body factor for the car's tier), 0-100 becomes min(stock, swap.zero) and handling shifts
 * by swap.handling (heavy V8/V12/jet = penalty). The tune, turbo, transmission, weight and nitro then multiply on top.
 * Fixed chip costs (not % of the car), run through px(). Each car allows 3-5 swaps; null = stock engine.
 */
export type SwapId = 'i4t' | 'rotary' | 'flat6' | 'hemi' | 'scv8' | 'ttv6' | 'v12' | 'ev2' | 'ev4' | 'mower' | 'jet';
export interface EngineSwap { id: SwapId; label: string; icon: string; top: number; zero: number; handling: number; price: number; blurb: string }
export const ENGINE_SWAPS: EngineSwap[] = [
  { id: 'i4t', label: 'I4 Turbo', icon: '🌀', top: 215, zero: 7.5, handling: 0.5, price: 3500, blurb: 'Light, cheap, revs forever.' },
  { id: 'rotary', label: 'Rotary', icon: '🔺', top: 235, zero: 6.5, handling: 0.6, price: 7000, blurb: 'Brap brap. Bring spare apex seals.' },
  { id: 'hemi', label: 'Hemi V8', icon: '🐏', top: 255, zero: 5.0, handling: -0.8, price: 12000, blurb: 'Big block torque, nose-heavy.' },
  { id: 'flat6', label: 'Flat-6', icon: '🥞', top: 250, zero: 5.2, handling: 0.4, price: 12000, blurb: 'Low and balanced. Sounds expensive.' },
  { id: 'ttv6', label: 'Twin-turbo V6', icon: '🌪️', top: 270, zero: 4.5, handling: 0, price: 16000, blurb: 'Modern muscle in a small package.' },
  { id: 'scv8', label: 'Supercharged V8', icon: '😈', top: 280, zero: 4.2, handling: -1.0, price: 18000, blurb: 'Whine, smoke, regret.' },
  { id: 'ev2', label: 'Dual-motor EV', icon: '🔋', top: 260, zero: 3.6, handling: 0.2, price: 20000, blurb: 'Instant torque, silent menace.' },
  { id: 'v12', label: 'V12', icon: '👑', top: 300, zero: 3.8, handling: -0.6, price: 35000, blurb: 'Twelve cylinders of bad decisions.' },
  { id: 'ev4', label: 'Quad-motor EV', icon: '⚡', top: 315, zero: 2.4, handling: -0.5, price: 50000, blurb: 'A motor per wheel. Heavy, brutal.' },
  { id: 'mower', label: 'Lawnmower engine', icon: '🌱', top: 45, zero: 25, handling: 1.0, price: 300, blurb: 'Pull-start. 45 km/h of pure comedy.' },
  { id: 'jet', label: 'Jet engine', icon: '✈️', top: 330, zero: 3.0, handling: -2.5, price: 40000, blurb: 'Steering is a suggestion.' },
];
export const SWAP_BY_ID = new Map(ENGINE_SWAPS.map((s) => [s.id, s]));
/** How much of a swap's top speed each body can use (aero, gearing, tyres). */
export const SWAP_BODY: Record<CarTier, number> = { beater: 0.95, silly: 0.8, sedan: 0.9, suv: 0.88, muscle: 1.0, sports: 1.0, luxury: 0.95, super: 1.0 };
/** Allowed swaps per car (3-5 each). */
export const CAR_SWAPS: Record<string, SwapId[]> = {
  cart: ['mower', 'i4t', 'ev2', 'jet'],
  rustbucket: ['i4t', 'rotary', 'hemi', 'mower'],
  wagon: ['i4t', 'hemi', 'scv8', 'mower'],
  pizza: ['i4t', 'rotary', 'flat6', 'ev2'],
  hotdog: ['mower', 'hemi', 'scv8', 'jet'],
  commuter: ['i4t', 'ttv6', 'ev2', 'hemi'],
  taxi: ['hemi', 'scv8', 'ttv6', 'ev2'],
  exec: ['ttv6', 'scv8', 'v12', 'ev2'],
  trailblazer: ['hemi', 'scv8', 'ttv6', 'ev2'],
  hauler: ['hemi', 'scv8', 'ev2', 'v12'],
  thunderhorse: ['hemi', 'scv8', 'ttv6', 'ev2'],
  blacktop: ['scv8', 'v12', 'ev4', 'jet'],
  zipline: ['i4t', 'rotary', 'flat6', 'ttv6'],
  neonfang: ['rotary', 'flat6', 'ttv6', 'ev2', 'v12'],
  aurelia: ['flat6', 'ttv6', 'v12', 'ev2'],
  monster: ['hemi', 'scv8', 'jet', 'mower'],
  regent: ['scv8', 'v12', 'ev2', 'ev4'],
  hypervolt: ['ev4', 'v12', 'jet'],
  phantom: ['v12', 'ev4', 'jet'],
  chudmobile: ['v12', 'ev4', 'jet'],
};
export const allowedSwaps = (c: CarModel): EngineSwap[] => (CAR_SWAPS[c.id] ?? []).map((id) => SWAP_BY_ID.get(id)!).filter(Boolean);
export const swapAllowed = (c: CarModel, id: unknown) => typeof id === 'string' && (CAR_SWAPS[c.id] ?? []).includes(id as SwapId);
/** Base stats after an engine swap (stock when none). Joke engines (mower) replace the top speed outright. */
export function swappedBase(c: CarModel, swap: string | null | undefined): { topKmh: number; zeroTo100: number; handling: number } {
  const s = swap && swapAllowed(c, swap) ? SWAP_BY_ID.get(swap as SwapId)! : null;
  if (!s) return { topKmh: c.topKmh, zeroTo100: c.zeroTo100, handling: c.handling };
  if (s.id === 'mower') return { topKmh: s.top, zeroTo100: s.zero, handling: Math.min(10, c.handling + s.handling) };
  return { topKmh: Math.round(Math.max(c.topKmh, s.top * SWAP_BODY[c.tier])), zeroTo100: Math.min(c.zeroTo100, s.zero), handling: Math.max(1, Math.min(10, +(c.handling + s.handling).toFixed(1))) };
}
/** Highest base top speed this car can reach with any allowed swap (for the lap-time floor). */
export const maxSwapTopKmh = (c: CarModel) => Math.max(c.topKmh, ...allowedSwaps(c).map((s) => swappedBase(c, s.id).topKmh));
export const swapPriceBase = (id: string) => SWAP_BY_ID.get(id as SwapId)?.price ?? null;

export interface Paint { id: string; label: string; color: number; metallic?: boolean }
export const PAINTS: Paint[] = [
  { id: 'red', label: 'Race Red', color: 0xd62828 }, { id: 'orange', label: 'Sunset Orange', color: 0xf77f00 }, { id: 'yellow', label: 'Taxi Yellow', color: 0xffcc00 },
  { id: 'lime', label: 'Toxic Lime', color: 0x8ac926 }, { id: 'teal', label: 'Teal', color: 0x2a9d8f }, { id: 'blue', label: 'Royal Blue', color: 0x1d4ed8 },
  { id: 'purple', label: 'Grape', color: 0x7b2cbf }, { id: 'pink', label: 'Hot Pink', color: 0xff3cac }, { id: 'white', label: 'Arctic White', color: 0xf1faee },
  { id: 'black', label: 'Gloss Black', color: 0x16181d }, { id: 'mgold', label: 'Metallic Gold', color: 0xd4af37, metallic: true },
  { id: 'msilver', label: 'Metallic Silver', color: 0xc0c6d0, metallic: true }, { id: 'mblue', label: 'Metallic Ocean', color: 0x2563eb, metallic: true },
  { id: 'mred', label: 'Metallic Candy Red', color: 0xb5171e, metallic: true }, { id: 'mgreen', label: 'Metallic Emerald', color: 0x0f9d58, metallic: true },
  { id: 'mpurple', label: 'Metallic Amethyst', color: 0x8e44ad, metallic: true }, { id: 'mgraph', label: 'Metallic Graphite', color: 0x3d4350, metallic: true },
];
export const RIMS = [
  { id: 'stock', label: 'Stock' }, { id: 'chrome', label: 'Chrome', color: 0xdfe3ea }, { id: 'black', label: 'Matte Black', color: 0x1b1d22 },
  { id: 'gold', label: 'Gold', color: 0xd4af37 }, { id: 'neon', label: 'Neon Blue', color: 0x00e5ff }, { id: 'red', label: 'Red', color: 0xe63946 },
] as const;
export const KITS = [
  { id: 'none', label: 'Stock body' }, { id: 'lip', label: 'Front lip & skirts' }, { id: 'ducktail', label: 'Ducktail spoiler' },
  { id: 'wing', label: 'GT wing' }, { id: 'widebody', label: 'Widebody kit + wing' },
] as const;
export const GLOWS = [
  { id: 'none', label: 'None' }, { id: 'cyan', label: 'Cyan', color: 0x00e5ff }, { id: 'pink', label: 'Pink', color: 0xff2fd6 },
  { id: 'green', label: 'Green', color: 0x39ff14 }, { id: 'purple', label: 'Purple', color: 0x9d4edd }, { id: 'red', label: 'Red', color: 0xff2a2a }, { id: 'white', label: 'White', color: 0xffffff },
] as const;
export type CosmeticSlot = 'paint' | 'rims' | 'kit' | 'glow';
export const COSMETIC_SLOTS: Array<{ id: CosmeticSlot; label: string; icon: string }> = [
  { id: 'paint', label: 'Paint', icon: '🎨' }, { id: 'rims', label: 'Rims', icon: '⚙️' }, { id: 'kit', label: 'Spoilers & kits', icon: '🪽' }, { id: 'glow', label: 'Underglow', icon: '💡' },
];
const OPTIONS: Record<CosmeticSlot, ReadonlyArray<{ id: string }>> = { paint: PAINTS, rims: RIMS, kit: KITS, glow: GLOWS };
export const cosmeticOptions = (slot: CosmeticSlot) => OPTIONS[slot];

export interface CarMods { engine: number; turbo: number; tires: number; handling: number; nitro: number; trans: number; weight: number; swap: SwapId | null; paint: string | null; rims: string; kit: string; glow: string }
export const STOCK_MODS: CarMods = { engine: 0, turbo: 0, tires: 0, handling: 0, nitro: 0, trans: 0, weight: 0, swap: null, paint: null, rims: 'stock', kit: 'none', glow: 'none' };
const tierOk = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_TIER;
/** Parse stored / wire mods, dropping anything invalid back to stock. Old saves (no trans/weight/swap keys) load as stock
 *  for those slots. Pass the car to also drop a swap that car doesn't allow; without it any known swap id is kept. */
export function normMods(raw: unknown, car?: CarModel): CarMods {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}; const out: CarMods = { ...STOCK_MODS };
  for (const p of PERF_PARTS) if (tierOk(r[p.id])) out[p.id] = r[p.id] as number;
  if (typeof r.paint === 'string' && PAINTS.some((x) => x.id === r.paint)) out.paint = r.paint;
  for (const s of ['rims', 'kit', 'glow'] as const) if (typeof r[s] === 'string' && OPTIONS[s].some((x) => x.id === r[s])) out[s] = r[s] as string;
  if (typeof r.swap === 'string' && SWAP_BY_ID.has(r.swap as SwapId) && (!car || swapAllowed(car, r.swap))) out.swap = r.swap as SwapId;
  return out;
}
/** The pre-expansion JSON shape (new slots dropped while at stock): matches rows saved before engine swaps existed. */
export function legacyModsJson(m: CarMods): string {
  const { trans, weight, swap, ...old } = m; return trans || weight || swap ? JSON.stringify(m) : JSON.stringify(old);
}
/** Base (pre-px) price of the next tier of a part, or null if maxed. */
export function perfPriceBase(car: CarModel, tier: number): number | null {
  if (tier < 1 || tier > MAX_TIER) return null;
  return Math.max(TIER_FLOOR[tier - 1]!, Math.round(car.price * TIER_PCT[tier - 1]!));
}
export const cosmeticPriceBase = (car: CarModel) => Math.max(COSMETIC_FLOOR, Math.round(car.price * COSMETIC_PCT));

/** Upgraded display stats + arcade physics. `nitro` = seconds of boost in a full tank. */
const accelMul = (m: CarMods) => TURBO_ACCEL[m.turbo ?? 0]! * TRANS_ACCEL[m.trans ?? 0]! * WEIGHT_ACCEL[m.weight ?? 0]!;
export function moddedStats(c: CarModel, mods: CarMods) {
  const b = swappedBase(c, mods.swap);
  const topKmh = Math.round(b.topKmh * ENGINE_TOP[mods.engine]!);
  const zeroTo100 = +(b.zeroTo100 / accelMul(mods)).toFixed(1);
  const handling = +(b.handling + mods.handling * 0.6 + (mods.weight ?? 0) * 0.3).toFixed(1);
  return { topKmh, zeroTo100, handling, nitro: NITRO_SECONDS[mods.nitro]! };
}
export function moddedPhysics(c: CarModel, mods: CarMods) {
  const sb = swappedBase(c, mods.swap); const base = carPhysics({ ...c, ...sb }); const vmax = base.vmax * ENGINE_TOP[mods.engine]!;
  return { ...base, vmax, accel: base.accel * accelMul(mods), steer: base.steer + HANDLING_STEER[mods.handling]! + WEIGHT_STEER[mods.weight ?? 0]!, gripLoss: TIRES_GRIP[mods.tires]!, offroad: TIRES_OFFROAD[mods.tires]!, nitro: NITRO_SECONDS[mods.nitro]! };
}
/** Fastest the server should accept for this car with these mods (km/h, before the relay's slack). */
export const maxKmh = (c: CarModel, mods: CarMods) => swappedBase(c, mods.swap).topKmh * ENGINE_TOP[mods.engine]! * (mods.nitro > 0 ? NITRO_TOP : 1);

/** Compact look code for the drive snapshot: "paint|rims|kit|glow" ('' = all stock). */
export function lookCode(m: CarMods): string { return m.paint || m.rims !== 'stock' || m.kit !== 'none' || m.glow !== 'none' ? `${m.paint ?? ''}|${m.rims}|${m.kit}|${m.glow}` : ''; }
export function parseLook(code: unknown): Pick<CarMods, 'paint' | 'rims' | 'kit' | 'glow'> {
  const [paint, rims, kit, glow] = typeof code === 'string' ? code.split('|') : []; const m = normMods({ paint, rims, kit, glow });
  return { paint: m.paint, rims: m.rims, kit: m.kit, glow: m.glow };
}
