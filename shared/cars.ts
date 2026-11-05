import { drivable } from './venues.js';
/**
 * Car Dealership catalog + the pure rules shared by server and client: prices, resale/depreciation, arcade handling,
 * and the sanity limits the server uses to reject absurd driving updates (teleports / impossible speeds).
 */
export type CarTier = 'beater' | 'sedan' | 'sports' | 'muscle' | 'suv' | 'luxury' | 'super' | 'silly';
export type CarStyle = 'hatch' | 'wagon' | 'sedan' | 'taxi' | 'coupe' | 'muscle' | 'suv' | 'pickup' | 'monster' | 'limo' | 'super' | 'cart' | 'van';
export interface CarModel {
  id: string; name: string; tier: CarTier; style: CarStyle; price: number; blurb: string;
  /** Display stats: km/h, 0-100 seconds, handling 1-10. */
  topKmh: number; zeroTo100: number; handling: number;
  colors: number[];
  /** Body dimensions in map units (length, width, height). */
  dims: [number, number, number];
}

export const TIER_LABEL: Record<CarTier, string> = { beater: 'Beaters', sedan: 'Sedans', sports: 'Sports', muscle: 'Muscle', suv: 'SUVs & trucks', luxury: 'Luxury', super: 'Supercars', silly: 'Just silly' };

const C = (id: string, name: string, tier: CarTier, style: CarStyle, price: number, topKmh: number, zeroTo100: number, handling: number, colors: number[], dims: [number, number, number], blurb: string): CarModel =>
  ({ id, name, tier, style, price, topKmh, zeroTo100, handling, colors, dims, blurb });

export const CARS: CarModel[] = [
  C('cart', 'Stolen Shopping Cart', 'silly', 'cart', 800, 35, 30, 3, [0xc0c6d0, 0xff3b3b], [1.3, 0.8, 0.9], 'Squeaky wheel included. Free tetanus.'),
  C('rustbucket', 'Rustbucket 88', 'beater', 'hatch', 1500, 110, 16, 4, [0x8a5a3a, 0x6f7d6a, 0xa9a28c], [1.7, 0.9, 0.75], 'Three doors, two working. Starts most days.'),
  C('wagon', "Grandma's Wagon", 'beater', 'wagon', 2500, 125, 14, 5, [0x6b8e9e, 0xd9ccb0, 0x7a4b3a], [2.1, 0.95, 0.8], 'Wood panelling and the smell of butterscotch.'),
  C('pizza', 'Pizza Hatch', 'beater', 'hatch', 3500, 140, 12, 6, [0xe63946, 0xffffff, 0x2a9d8f], [1.8, 0.9, 0.78], 'Roof sign lights up. Delivers in 30 min or less.'),
  C('hotdog', 'Hot Dog Van', 'silly', 'van', 6000, 115, 17, 4, [0xffb703, 0xe63946], [2.3, 1.05, 1.2], 'A giant wiener on the roof. Turns heads.'),
  C('commuter', 'Commuter LX', 'sedan', 'sedan', 7000, 170, 10, 6, [0xd0d4da, 0x1d3557, 0x2f2f33, 0x8a1c1c], [2.0, 0.95, 0.75], 'The car nobody remembers. Very reliable.'),
  C('taxi', 'Yellow Cab', 'sedan', 'taxi', 8500, 175, 10, 6, [0xffcc00], [2.05, 0.95, 0.78], 'Comes with a roof light and zero manners.'),
  C('exec', 'Executive 500', 'sedan', 'sedan', 12000, 210, 8, 7, [0x111418, 0x7b8794, 0xf1faee, 0x274060], [2.2, 1.0, 0.75], 'Leather seats, middle-manager energy.'),
  C('trailblazer', 'Trailblazer SUV', 'suv', 'suv', 14000, 185, 9, 5, [0x2d6a4f, 0x3d405b, 0xe0e1dd, 0x9c6644], [2.2, 1.1, 1.05], 'Seats seven. Has never seen a trail.'),
  C('hauler', 'Hauler 2500 Pickup', 'suv', 'pickup', 16000, 180, 9, 5, [0xb5171e, 0x1d3557, 0xf1faee, 0x2f2f33], [2.4, 1.1, 1.0], 'Tow hitch, truck nuts optional.'),
  C('thunderhorse', 'Thunderhorse V8', 'muscle', 'muscle', 20000, 250, 5.5, 5, [0x1d9bf0, 0xe63946, 0x111418, 0xffb703], [2.25, 1.0, 0.7], 'Racing stripes and a loud opinion.'),
  C('blacktop', 'Blacktop Hellcharger', 'muscle', 'muscle', 28000, 280, 4.4, 5, [0x111418, 0x5a189a, 0xb5171e], [2.35, 1.05, 0.72], 'Supercharger whine you can hear from the Casino.'),
  C('zipline', 'Zipline GT', 'sports', 'coupe', 24000, 260, 5, 8, [0xf77f00, 0x1d9bf0, 0xf1faee, 0x2f2f33], [2.0, 0.95, 0.62], 'Light, twitchy and happiest on the ring road.'),
  C('neonfang', 'Neon Fang RS', 'sports', 'coupe', 34000, 295, 4, 9, [0x39ff14, 0xff2fd6, 0x00e5ff], [2.05, 0.98, 0.6], 'Underglow standard. Subtlety optional.'),
  C('aurelia', 'Aurelia Coupe', 'luxury', 'coupe', 45000, 270, 4.8, 7, [0xd4af37, 0xf1faee, 0x274060, 0x5c0a1e], [2.2, 1.0, 0.66], 'Gold trim, hand-stitched everything.'),
  C('monster', 'Big Chud Monster Truck', 'suv', 'monster', 55000, 160, 7, 3, [0x7b2cbf, 0xff5400, 0x38b000], [2.4, 1.4, 1.2], 'Wheels taller than your house. Parking is your problem.'),
  C('regent', 'Regent Stretch Limo', 'luxury', 'limo', 65000, 200, 9, 3, [0x111418, 0xf1faee, 0xff69b4], [3.6, 1.05, 0.78], 'Mini bar in the back. Turning circle of a cruise ship.'),
  C('hypervolt', 'Hypervolt EV', 'super', 'super', 90000, 340, 2.5, 9, [0xf1faee, 0x00b4d8, 0x111418], [2.15, 1.05, 0.55], 'Silent, instant, and smug about it.'),
  C('phantom', 'Phantom X', 'super', 'super', 140000, 370, 2.3, 9, [0xb5171e, 0x111418, 0xffd60a, 0x7b2cbf], [2.25, 1.08, 0.52], 'Scissor doors. The neighbours hate you.'),
  C('chudmobile', 'Chudmobile Hypercar', 'super', 'super', 250000, 420, 2.0, 10, [0xe8c26a, 0x111418, 0xff3cac], [2.35, 1.1, 0.5], 'The richest chud in town drives this. Be that chud.'),
];
export const CAR_BY_ID = new Map(CARS.map((c) => [c.id, c]));

/** Map units/sec for a car's top speed (the city is ~230 units across). */
export const unitsPerSec = (kmh: number) => kmh / 8.5;
/** Arcade handling for the client: max speed (u/s), acceleration (u/s²), steering rate (rad/s at speed). */
export function carPhysics(c: CarModel) {
  const vmax = unitsPerSec(c.topKmh);
  return { vmax, accel: unitsPerSec(100) / c.zeroTo100 * 1.6, steer: 1.4 + c.handling * 0.16, reverse: Math.min(8, vmax * 0.35) };
}

/** Resale/asset value: 60% of list on day one, then -0.5%/day of list down to a 40% floor. */
export const RESALE_START = 0.6, RESALE_FLOOR = 0.4, RESALE_DAILY = 0.005;
export function carValue(price: number, boughtAt: number, now = Date.now()): number {
  const days = Math.max(0, (now - boughtAt) / 86_400_000);
  return Math.round(price * Math.max(RESALE_FLOOR, RESALE_START - RESALE_DAILY * days));
}

/** Driving relay limits. */
export const DRIVE_HZ = 8; // client send rate
export const DRIVE_BROADCAST_MS = 125; // server snapshot rate (8 Hz)
export const DRIVE_IDLE_MS = 8000; // no update this long = parked/gone
export const DRIVE_MAX_VISIBLE = 30;
/** Fastest base top (km/h) any car reaches incl. engine swaps: Chudmobile 420 + 10% jet swap = 462 (was 420 before super swaps). */
export const FASTEST_BASE_KMH = 462;
export const DRIVE_SPEED_CAP = unitsPerSec(FASTEST_BASE_KMH) * 1.35; // fastest swapped car + slack

export interface DriveState { x: number; z: number; a: number; v: number }
/**
 * Server check for one update. `prev` is the last accepted state and `dtMs` the time since. Rejects NaN, out-of-bounds,
 * over-speed, or a jump further than the car could travel (with slack for jitter).
 */
export function validDrive(s: unknown, prev: (DriveState & { t: number }) | null, now: number, carTopKmh: number): s is DriveState {
  if (!s || typeof s !== 'object') return false;
  const { x, z, a, v } = s as Record<string, unknown>;
  if (![x, z, a, v].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (!drivable(x as number, z as number, -2)) return false; // city plate or a venue's grounds (+2 slack)
  const cap = Math.min(DRIVE_SPEED_CAP, unitsPerSec(carTopKmh) * 1.35 + 2);
  if (Math.abs(v as number) > cap) return false;
  if (prev) {
    const dt = Math.max(0.05, Math.min(3, (now - prev.t) / 1000));
    if (Math.hypot((x as number) - prev.x, (z as number) - prev.z) > cap * dt + 3) return false;
  }
  return true;
}
