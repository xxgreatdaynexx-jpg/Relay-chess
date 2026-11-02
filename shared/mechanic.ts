/**
 * Mechanic Shop: performance upgrades + cosmetics for owned cars (pure rules shared by server and client).
 *
 * Performance: five parts, tiers 0 (stock) .. 3 (race), bought in order. Gains are modest and multiplicative on the
 * car's own stats, so a maxed cheap car stays well behind a stock top car (Rustbucket maxed ≈ 123 km/h, +15% for a
 * nitro burst ≈ 142 km/h, vs a stock Phantom X at 370).
 * Cosmetics: paint (incl. metallic), rims, spoiler/body kit, underglow; visible to everyone (synced in the drive snapshot).
 * Prices: % of the car's base list price, run through px() by the server, with a small floor. Every purchase is a pure
 * chip sink: no refunds, no downgrade payouts, and upgrades add nothing to the car's sell-back value.
 */
import { carPhysics, type CarModel } from './cars.js';

export type PerfPart = 'engine' | 'turbo' | 'tires' | 'handling' | 'nitro';
export const PERF_PARTS: Array<{ id: PerfPart; label: string; icon: string; tiers: [string, string, string]; what: string }> = [
  { id: 'engine', label: 'Engine', icon: '🔧', tiers: ['Street tune', 'Sport cams', 'Race build'], what: 'Top speed' },
  { id: 'turbo', label: 'Turbo', icon: '🌀', tiers: ['Intake & exhaust', 'Turbo kit', 'Twin turbo'], what: 'Acceleration' },
  { id: 'tires', label: 'Tires', icon: '🛞', tiers: ['Sport tires', 'Semi-slicks', 'Racing slicks'], what: 'Grip in fast corners, less slowdown off-road' },
  { id: 'handling', label: 'Suspension', icon: '🏎️', tiers: ['Lowering springs', 'Coilovers', 'Race suspension'], what: 'Steering' },
  { id: 'nitro', label: 'Nitro', icon: '🔥', tiers: ['Nitro (1 bottle)', 'Nitro (2 bottles)', 'Nitro (3 bottles)'], what: 'Hold Shift / N for a boost' },
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
export const NITRO_TOP = 1.15, NITRO_ACCEL = 1.5, NITRO_RECHARGE = 0.2; // seconds of boost regained per second
/** Highest top-speed factor any upgrade combination can reach (engine × nitro): the server's speed check uses it. */
export const MAX_SPEED_FACTOR = ENGINE_TOP[3]! * NITRO_TOP;

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

export interface CarMods { engine: number; turbo: number; tires: number; handling: number; nitro: number; paint: string | null; rims: string; kit: string; glow: string }
export const STOCK_MODS: CarMods = { engine: 0, turbo: 0, tires: 0, handling: 0, nitro: 0, paint: null, rims: 'stock', kit: 'none', glow: 'none' };
const tierOk = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_TIER;
/** Parse stored / wire mods, dropping anything invalid back to stock. */
export function normMods(raw: unknown): CarMods {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}; const out: CarMods = { ...STOCK_MODS };
  for (const p of PERF_PARTS) if (tierOk(r[p.id])) out[p.id] = r[p.id] as number;
  if (typeof r.paint === 'string' && PAINTS.some((x) => x.id === r.paint)) out.paint = r.paint;
  for (const s of ['rims', 'kit', 'glow'] as const) if (typeof r[s] === 'string' && OPTIONS[s].some((x) => x.id === r[s])) out[s] = r[s] as string;
  return out;
}
/** Base (pre-px) price of the next tier of a part, or null if maxed. */
export function perfPriceBase(car: CarModel, tier: number): number | null {
  if (tier < 1 || tier > MAX_TIER) return null;
  return Math.max(TIER_FLOOR[tier - 1]!, Math.round(car.price * TIER_PCT[tier - 1]!));
}
export const cosmeticPriceBase = (car: CarModel) => Math.max(COSMETIC_FLOOR, Math.round(car.price * COSMETIC_PCT));

/** Upgraded display stats + arcade physics. `nitro` = seconds of boost in a full tank. */
export function moddedStats(c: CarModel, mods: CarMods) {
  const topKmh = Math.round(c.topKmh * ENGINE_TOP[mods.engine]!);
  const zeroTo100 = +(c.zeroTo100 / TURBO_ACCEL[mods.turbo]!).toFixed(1);
  const handling = +(c.handling + mods.handling * 0.6).toFixed(1);
  return { topKmh, zeroTo100, handling, nitro: NITRO_SECONDS[mods.nitro]! };
}
export function moddedPhysics(c: CarModel, mods: CarMods) {
  const base = carPhysics(c); const vmax = base.vmax * ENGINE_TOP[mods.engine]!;
  return { ...base, vmax, accel: base.accel * TURBO_ACCEL[mods.turbo]!, steer: base.steer + HANDLING_STEER[mods.handling]!, gripLoss: TIRES_GRIP[mods.tires]!, offroad: TIRES_OFFROAD[mods.tires]!, nitro: NITRO_SECONDS[mods.nitro]! };
}
/** Fastest the server should accept for this car with these mods (km/h, before the relay's slack). */
export const maxKmh = (c: CarModel, mods: CarMods) => c.topKmh * ENGINE_TOP[mods.engine]! * (mods.nitro > 0 ? NITRO_TOP : 1);

/** Compact look code for the drive snapshot: "paint|rims|kit|glow" ('' = all stock). */
export function lookCode(m: CarMods): string { return m.paint || m.rims !== 'stock' || m.kit !== 'none' || m.glow !== 'none' ? `${m.paint ?? ''}|${m.rims}|${m.kit}|${m.glow}` : ''; }
export function parseLook(code: unknown): Pick<CarMods, 'paint' | 'rims' | 'kit' | 'glow'> {
  const [paint, rims, kit, glow] = typeof code === 'string' ? code.split('|') : []; const m = normMods({ paint, rims, kit, glow });
  return { paint: m.paint, rims: m.rims, kit: m.kit, glow: m.glow };
}
