/**
 * Fishing at the lake dock (pt1214u). Pure rules shared by the server (authoritative) and the client (display):
 * species + rarities, catch value, the daily profit tiers, and the deterministic reel minigame.
 *
 * The server rolls every catch (species, weight) when you cast and keeps it secret until you land it. Reeling is a
 * tension game: hold to reel (the marker rises), let go (it sinks); keep the marker inside the fish's moving zone and
 * the catch bar fills, outside it drains. The client plays it live and sends its input timeline (one bit per 50 ms
 * step); the server replays the same simulation with the same seed and only pays out if it lands there too. The sim
 * uses only + - * / and a 32-bit integer RNG, so it is bit-for-bit identical in every JS engine.
 *
 * Sale values are BASE chips: the server scales them by the price index (px). Sales go through a per-player daily
 * daily tier like the farm: full price up to 115,000 base chips a day (pond; reef 230k, ocean 575k), then nothing.
 */
export type Rarity = 'junk' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
/** Where a species lives: 'lake' = the city dock (default), 'reef' = the Chud Resort pier (pt1304u). */
export type FishSpot = 'lake' | 'reef' | 'deep';
export const isFishSpot = (v: unknown): v is FishSpot => v === 'lake' || v === 'reef' || v === 'deep';
export interface Fish { id: string; label: string; emoji: string; rarity: Rarity; min: number; max: number; base: number; spot?: FishSpot; /** Deep sea only: 1 Outer Banks, 2 Blue Water, 3 The Abyss (boat range, shared/fleet.ts). */ zone?: 1 | 2 | 3; /** mu-coop3: only bites on a crewed fishing-fleet trip (server/fishFleet.ts). */ crew?: true }
/** Weights in kg; base = sale value (base chips) of an average-sized one. */
export const FISH: Fish[] = [
  { id: 'boot', label: 'Old Boot', emoji: '🥾', rarity: 'junk', min: 0.4, max: 1.2, base: 2 },
  { id: 'can', label: 'Rusty Can', emoji: '🥫', rarity: 'junk', min: 0.1, max: 0.4, base: 1 },
  { id: 'weeds', label: 'Lake Weeds', emoji: '🌿', rarity: 'junk', min: 0.2, max: 1, base: 1 },
  { id: 'bluegill', label: 'Bluegill', emoji: '🐟', rarity: 'common', min: 0.1, max: 0.6, base: 6 },
  { id: 'perch', label: 'Yellow Perch', emoji: '🐟', rarity: 'common', min: 0.1, max: 0.8, base: 8 },
  { id: 'sunfish', label: 'Pumpkinseed Sunfish', emoji: '🐠', rarity: 'common', min: 0.1, max: 0.5, base: 7 },
  { id: 'bass', label: 'Largemouth Bass', emoji: '🐟', rarity: 'uncommon', min: 0.5, max: 4.5, base: 18 },
  { id: 'trout', label: 'Rainbow Trout', emoji: '🐠', rarity: 'uncommon', min: 0.4, max: 3.5, base: 20 },
  { id: 'catfish', label: 'Channel Catfish', emoji: '🐡', rarity: 'uncommon', min: 1, max: 9, base: 24 },
  { id: 'walleye', label: 'Walleye', emoji: '🐟', rarity: 'rare', min: 1, max: 6, base: 40 },
  { id: 'pike', label: 'Northern Pike', emoji: '🐊', rarity: 'rare', min: 2, max: 12, base: 45 },
  { id: 'salmon', label: 'Chinook Salmon', emoji: '🍣', rarity: 'rare', min: 3, max: 16, base: 55 },
  { id: 'sturgeon', label: 'Lake Sturgeon', emoji: '🦈', rarity: 'epic', min: 10, max: 60, base: 120 },
  { id: 'goldcarp', label: 'Golden Carp', emoji: '🐉', rarity: 'epic', min: 2, max: 15, base: 140 },
  { id: 'koi', label: 'Crystal Koi', emoji: '💎', rarity: 'legendary', min: 2, max: 10, base: 450 },
  { id: 'oldchud', label: 'Old Chud, the Lake Monster', emoji: '🐋', rarity: 'legendary', min: 80, max: 250, base: 500 },
  // ---- Reef Pier at Chud Resort (pt1304u): tropical species, same rarity odds as the lake; values 2x the lake (mu-fishing: resort ≈ 2x pond chips/min after the ticket).
  { id: 'flipflop', label: 'Lost Flip-Flop', emoji: '🩴', rarity: 'junk', min: 0.1, max: 0.4, base: 2, spot: 'reef' },
  { id: 'coconutshell', label: 'Drift Coconut', emoji: '🥥', rarity: 'junk', min: 0.3, max: 1.2, base: 4, spot: 'reef' },
  { id: 'clownfish', label: 'Clownfish', emoji: '🐠', rarity: 'common', min: 0.05, max: 0.25, base: 14, spot: 'reef' },
  { id: 'bluetang', label: 'Blue Tang', emoji: '🐟', rarity: 'common', min: 0.1, max: 0.6, base: 16, spot: 'reef' },
  { id: 'damsel', label: 'Sergeant Major', emoji: '🐟', rarity: 'common', min: 0.05, max: 0.3, base: 12, spot: 'reef' },
  { id: 'parrotfish', label: 'Rainbow Parrotfish', emoji: '🐠', rarity: 'uncommon', min: 0.8, max: 6, base: 40, spot: 'reef' },
  { id: 'snapper', label: 'Red Snapper', emoji: '🐟', rarity: 'uncommon', min: 0.5, max: 8, base: 45, spot: 'reef' },
  { id: 'triggerfish', label: 'Picasso Triggerfish', emoji: '🐡', rarity: 'uncommon', min: 0.2, max: 2, base: 35, spot: 'reef' },
  { id: 'mahimahi', label: 'Mahi-Mahi', emoji: '🐬', rarity: 'rare', min: 3, max: 18, base: 100, spot: 'reef' },
  { id: 'barracuda', label: 'Great Barracuda', emoji: '🦈', rarity: 'rare', min: 2, max: 20, base: 90, spot: 'reef' },
  { id: 'grouper', label: 'Coral Grouper', emoji: '🐟', rarity: 'rare', min: 2, max: 25, base: 85, spot: 'reef' },
  { id: 'yellowfin', label: 'Yellowfin Tuna', emoji: '🐟', rarity: 'epic', min: 10, max: 90, base: 260, spot: 'reef' },
  { id: 'sailfish', label: 'Sailfish', emoji: '🗡️', rarity: 'epic', min: 15, max: 60, base: 270, spot: 'reef' },
  { id: 'marlin', label: 'Blue Marlin', emoji: '🐋', rarity: 'legendary', min: 60, max: 240, base: 960, spot: 'reef' },
  { id: 'manta', label: 'Sunset Manta', emoji: '🌅', rarity: 'legendary', min: 40, max: 200, base: 920, spot: 'reef' },
  // Deep sea (Millionaire Update #10c): only from a boat out of the Resort Marina. Zone = how far out the boat can go.
  // mu-fishing: values ≈ 3.1x the original so the skiff (zone 1) earns ≈ 5x the pond per minute; bigger boats a bit more.
  { id: 'ghostnet', label: 'Ghost Net', emoji: '🕸️', rarity: 'junk', min: 0.5, max: 4, base: 6, spot: 'deep', zone: 1 },
  { id: 'bonito', label: 'Atlantic Bonito', emoji: '🐟', rarity: 'common', min: 1, max: 6, base: 35, spot: 'deep', zone: 1 },
  { id: 'mackerel', label: 'Spanish Mackerel', emoji: '🐟', rarity: 'common', min: 0.8, max: 5, base: 45, spot: 'deep', zone: 1 },
  { id: 'skipjack', label: 'Skipjack Tuna', emoji: '🐟', rarity: 'common', min: 2, max: 14, base: 40, spot: 'deep', zone: 2 },
  { id: 'wahoo', label: 'Wahoo', emoji: '🐟', rarity: 'uncommon', min: 5, max: 40, base: 105, spot: 'deep', zone: 1 },
  { id: 'kingfish', label: 'Kingfish', emoji: '🐟', rarity: 'uncommon', min: 4, max: 30, base: 110, spot: 'deep', zone: 2 },
  { id: 'lanternfish', label: 'Lanternfish', emoji: '🏮', rarity: 'uncommon', min: 0.02, max: 0.1, base: 125, spot: 'deep', zone: 3 },
  { id: 'amberjack', label: 'Greater Amberjack', emoji: '🐟', rarity: 'rare', min: 8, max: 60, base: 220, spot: 'deep', zone: 1 },
  { id: 'swordfish', label: 'Swordfish', emoji: '🗡️', rarity: 'rare', min: 30, max: 200, base: 260, spot: 'deep', zone: 2 },
  { id: 'oarfish', label: 'Giant Oarfish', emoji: '🐉', rarity: 'rare', min: 20, max: 120, base: 290, spot: 'deep', zone: 3 },
  { id: 'bluefin', label: 'Bluefin Tuna', emoji: '🐟', rarity: 'epic', min: 60, max: 400, base: 650, spot: 'deep', zone: 1 },
  { id: 'mako', label: 'Mako Shark', emoji: '🦈', rarity: 'epic', min: 40, max: 300, base: 740, spot: 'deep', zone: 2 },
  { id: 'anglerfish', label: 'Abyssal Anglerfish', emoji: '🔦', rarity: 'epic', min: 2, max: 25, base: 810, spot: 'deep', zone: 3 },
  { id: 'blackmarlin', label: 'Black Marlin', emoji: '🐋', rarity: 'legendary', min: 100, max: 600, base: 2330, spot: 'deep', zone: 1 },
  { id: 'giantsquid', label: 'Giant Squid', emoji: '🦑', rarity: 'legendary', min: 80, max: 450, base: 2540, spot: 'deep', zone: 2 },
  { id: 'coelacanth', label: 'Coelacanth', emoji: '🦕', rarity: 'legendary', min: 30, max: 90, base: 2950, spot: 'deep', zone: 3 },
  // mu-coop3 crew-only deep-sea catches (a crewed fleet boat in The Abyss)
  { id: 'bigeye', label: 'Bigeye Tuna', emoji: '🐟', rarity: 'rare', min: 20, max: 180, base: 340, spot: 'deep', zone: 3, crew: true },
  { id: 'opah', label: 'Opah', emoji: '🌕', rarity: 'epic', min: 10, max: 80, base: 900, spot: 'deep', zone: 3, crew: true },
  { id: 'bluemarlin', label: 'Blue Marlin', emoji: '🐋', rarity: 'legendary', min: 120, max: 700, base: 3200, spot: 'deep', zone: 3, crew: true },
];
/** Species that can bite at a spot. */
export const fishPool = (spot: FishSpot = 'lake') => FISH.filter((f) => (f.spot ?? 'lake') === spot);
export const spotOf = (f: Fish): FishSpot => f.spot ?? 'lake';
export const fishById = (id: unknown) => FISH.find((f) => f.id === id);
/** Chance of each rarity per bite (percent, sums to 100). */
export const RARITY_ODDS: Record<Rarity, number> = { junk: 10, common: 46, uncommon: 26, rare: 12, epic: 5, legendary: 1 };
export const RARITY_COLOR: Record<Rarity, string> = { junk: '#8a8f98', common: '#d8dde8', uncommon: '#5ad17a', rare: '#4aa8ff', epic: '#b06bff', legendary: '#ffb020' };
const DIFF: Record<Rarity, number> = { junk: 0.05, common: 0.15, uncommon: 0.35, rare: 0.55, epic: 0.75, legendary: 0.9 };
/** Skill XP per landed catch (for the Fishing skill; see server/activity.ts). */
export const FISH_XP: Record<Rarity, number> = { junk: 2, common: 10, uncommon: 20, rare: 40, epic: 80, legendary: 200 };

/** Pick a species from two uniform draws in [0,1). */
export function rollFish(u1: number, u2: number, spot: FishSpot = 'lake', maxZone = 3, crew = false): Fish {
  let acc = 0; let rar: Rarity = 'common';
  for (const r of Object.keys(RARITY_ODDS) as Rarity[]) { acc += RARITY_ODDS[r]; if (u1 * 100 < acc) { rar = r; break; } }
  const pool = fishPool(spot).filter((f) => f.rarity === rar && (f.zone ?? 1) <= Math.max(1, maxZone) && (!f.crew || crew)); return pool[Math.min(pool.length - 1, Math.floor(u2 * pool.length))]!;
}
/** Weight (grams) from a uniform draw: big ones are rarer (u^2). */
export const rollWeight = (f: Fish, u: number) => Math.round((f.min + (f.max - f.min) * u * u) * 1000);
/** 0..1 where this weight sits in the species range. */
export const sizeFrac = (f: Fish, grams: number) => Math.max(0, Math.min(1, (grams / 1000 - f.min) / (f.max - f.min || 1)));
/** Base sale value: 0.6x for the smallest to 1.8x for the biggest (never below 1). */
export const fishValue = (f: Fish, grams: number) => Math.max(1, Math.round(f.base * (0.6 + 1.2 * sizeFrac(f, grams))));
/** Reel difficulty 0..1 from rarity and size. */
export const fishDiff = (f: Fish, grams: number) => Math.min(1, DIFF[f.rarity] + 0.1 * sizeFrac(f, grams));
export const fmtKg = (g: number) => (g >= 10_000 ? `${(g / 1000).toFixed(1)} kg` : `${(g / 1000).toFixed(2)} kg`);

/** Daily tiers on base sale value (per player, reset 00:00 UTC): full up to 115,000, then zero. */
/** Fishing buff (Millionaire Update): raw fish sell for +15% at every spot (pond, resort reef, ocean skiff..superyacht).
 *  Applied at the sale (and in the UI), not to the stored catch value, so fillets / factory imports are unchanged. */
export const FISH_SELL_MUL = 1.15;
export const fishSellValue = (value: number) => (value * 115) / 100; // = value x FISH_SELL_MUL, exact for integers
export const FISH_TIERS: Array<{ upTo: number; rate: number }> = [{ upTo: 115_000, rate: 1 }, { upTo: Infinity, rate: 0 }];
export const FISH_DAILY_MAX = FISH_TIERS.reduce((a, t, i) => a + (Number.isFinite(t.upTo) ? (t.upTo - (i ? FISH_TIERS[i - 1]!.upTo : 0)) * t.rate : 0), 0);
/** Separate per-spot daily caps (mu-fishing): each spot is tracked on its own (fish_daily row per spot). */
export const FISH_SPOT_CAP: Record<FishSpot, number> = { lake: 115_000, reef: 230_000, deep: 575_000 };
export const fishTiers = (spot: FishSpot = 'lake'): Array<{ upTo: number; rate: number }> => [{ upTo: FISH_SPOT_CAP[spot], rate: 1 }, { upTo: Infinity, rate: 0 }];
/** fish_daily.player_key for a spot: the plain player key for the lake (back-compatible), `key#reef` / `key#deep` otherwise. */
export const fishDailyKey = (key: string, spot: FishSpot = 'lake') => (spot === 'lake' ? key : `${key}#${spot}`);
export function fishPayout(gross: number, already: number, spot: FishSpot = 'lake'): number {
  let left = gross, at = already, pay = 0, lo = 0;
  for (const t of fishTiers(spot)) { if (left <= 0) break; const take = Math.min(left, Math.max(0, t.upTo - Math.max(at, lo))); pay += take * t.rate; left -= take; at += take; lo = t.upTo; }
  return Math.floor(pay + 1e-9);
}

export const COOLER_MAX = 40;
export const CAST_COOLDOWN_MS = 1200;
export const BITE_MIN_MS = 1500, BITE_MAX_MS = 6500;
/** How long after the bite you can still set the hook (server side, latency included). */
export const HOOK_WINDOW_MS = 1800;

// ---- Reel minigame (deterministic) ----
export const REEL_HZ = 20; export const REEL_DT = 1 / REEL_HZ; export const REEL_MAX_STEPS = 30 * REEL_HZ;
export interface ReelState { step: number; x: number; v: number; c: number; prog: number; done: 'caught' | 'lost' | null; h: number }
/** mulberry32: 32-bit integer RNG (identical everywhere). */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export class Reel {
  s: ReelState; private r: () => number; private from = 0.5; private to = 0.5; private seg = 0; private segLen = 1;
  constructor(seed: number, readonly diff: number) {
    this.r = rng(seed); const h = 0.2 - 0.08 * diff;
    this.s = { step: 0, x: 0.15, v: 0, c: 0.5, prog: 0.3, done: null, h }; this.next();
  }
  private next() { const { h } = this.s; this.from = this.to; this.to = h + this.r() * (1 - 2 * h); this.seg = 0; this.segLen = Math.max(4, Math.round((2.2 - 1.2 * this.diff + this.r() * 1.2) * REEL_HZ)); }
  /** Advance one 50 ms step with the reel held (true) or not. */
  tick(hold: boolean): ReelState {
    const s = this.s; if (s.done) return s;
    this.seg++; if (this.seg > this.segLen) this.next();
    const u = this.seg / this.segLen; const e = u * u * (3 - 2 * u); s.c = this.from + (this.to - this.from) * e;
    s.v = (s.v + (hold ? 2.2 : -1.9) * REEL_DT) * 0.92; s.x += s.v * REEL_DT;
    if (s.x < 0) { s.x = 0; s.v = 0; } if (s.x > 1) { s.x = 1; s.v = 0; }
    const inZone = Math.abs(s.x - s.c) <= s.h;
    s.prog += inZone ? (0.2 - 0.07 * this.diff) * REEL_DT : -(0.1 + 0.12 * this.diff) * REEL_DT;
    s.step++;
    if (s.prog >= 1) { s.prog = 1; s.done = 'caught'; } else if (s.prog <= 0) { s.prog = 0; s.done = 'lost'; } else if (s.step >= REEL_MAX_STEPS) s.done = 'lost';
    return s;
  }
}
/** Replay a whole input timeline ('1' = holding). Caught only if it lands exactly on the last step. */
export function replayReel(seed: number, diff: number, inputs: string): 'caught' | 'lost' | 'invalid' {
  if (typeof inputs !== 'string' || !/^[01]{1,600}$/.test(inputs)) return 'invalid';
  const r = new Reel(seed, diff);
  for (let i = 0; i < inputs.length; i++) { const st = r.tick(inputs[i] === '1'); if (st.done) return i === inputs.length - 1 ? st.done : 'invalid'; }
  return 'invalid'; // timeline stopped before the game ended
}

export interface FishCatch { id: string; fish: string; grams: number; value: number; at: number }
export interface FishView { cooler: FishCatch[]; today: { gross: number; paid: number }; /** per-spot sold today (base gross) */ todayBySpot?: Record<FishSpot, { gross: number; paid: number }>; index: number; best: { fish: string; grams: number } | null; totals: { caught: number } }

/** What other players see of an angler at the dock (pt242u). Derived on the server from fish_* actions only:
 *  'cast' = line out (bobber floats; the bite time stays secret), 'reel' = fighting a fish, 'catch' = just landed one. */
export type AnglerPose = 'idle' | 'cast' | 'reel' | 'catch';
export interface AnglerState { name: string; pose: AnglerPose; since: number; yaw: number; power: number; fish?: string }
/** Clamp a client-sent aim/power pair (cosmetic only) into the ranges the 3D scene uses. */
export function anglerAim(yaw: unknown, power: unknown): { yaw: number; power: number } {
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  return { yaw: n(yaw, -0.75, 0.75, 0), power: n(power, 0, 1, 0.5) };
}
