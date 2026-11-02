/**
 * Home kitchen cooking (pt1247u). Pure rules shared by the server (authoritative) and the client (display).
 *
 * You cook a raw fish from your cooler in a pan on your home stove. The pan is a deterministic sim run in 100 ms
 * steps: you set the burner (0 off … 3 high, the pan's heat lags behind the dial) and flip the fish. Each side has a
 * doneness that rises with the pan's heat; plate it when both sides are done. Too little → undercooked, too much →
 * burnt. The client plays it live and sends its input timeline; the server replays the same sim with the same seed
 * (pan quirk) and decides the dish. Higher Cooking level widens the "done" window (fewer burns) and unlocks rarer fish.
 *
 * Economy: cooking moves no chips. It rewrites the fish's base value in the cooler (good ×1.3, perfect ×1.5,
 * undercooked ×1, burnt ×0.2), which then sells through the normal fish market path: daily tiers (max 1,350 base
 * chips a day) and the price index. So cooking can make a catch worth a bit more, never more chips than the cap.
 */
import type { Rarity } from './fishing.js';

export const COOK_DT = 0.1; export const COOK_HZ = 10; export const COOK_MAX_STEPS = 90 * COOK_HZ;
export type Outcome = 'perfect' | 'good' | 'undercooked' | 'burnt';
export const OUTCOME_MULT: Record<Outcome, number> = { perfect: 1.5, good: 1.3, undercooked: 1, burnt: 0.2 };
export const OUTCOME_XP: Record<Outcome, number> = { perfect: 1.25, good: 1, undercooked: 0.5, burnt: 0.25 };
export const COOK_XP: Record<Exclude<Rarity, 'junk'>, number> = { common: 30, uncommon: 60, rare: 110, epic: 200, legendary: 450 };
/** Cooking level needed for each rarity (recipes unlock as you level). */
export const COOK_LEVEL: Record<Exclude<Rarity, 'junk'>, number> = { common: 1, uncommon: 10, rare: 25, epic: 45, legendary: 65 };
export const cookable = (r: Rarity): r is Exclude<Rarity, 'junk'> => r !== 'junk';
export const RECIPE: Record<Exclude<Rarity, 'junk'>, string> = { common: 'Pan-fried', uncommon: 'Butter-basted', rare: 'Herb-crusted', epic: 'Chef\'s seared', legendary: 'Legendary feast of' };
export function dishName(label: string, rarity: Rarity, o: Outcome): string {
  if (o === 'burnt') return `Burnt ${label}`;
  if (o === 'undercooked') return `Undercooked ${label}`;
  return `${o === 'perfect' ? '⭐ ' : ''}${cookable(rarity) ? RECIPE[rarity] : 'Cooked'} ${label}`;
}
export const cookedValue = (raw: number, o: Outcome) => Math.max(1, Math.floor(raw * OUTCOME_MULT[o]));
/** Half-width of the "done" window around 1.0: 0.10 at level 1 → 0.25 at 99. */
export const doneWindow = (level: number) => 0.1 + 0.15 * (Math.max(1, Math.min(99, level)) - 1) / 98;
export const BURN_OVER = 0.15; // past the window by this much = burnt

/** mulberry32. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export interface PanState { step: number; dial: number; heat: number; down: number; up: number; flips: number }
/** thick 0..1 (fish size in its species range) slows cooking. */
export class Pan {
  s: PanState = { step: 0, dial: 0, heat: 0, down: 0, up: 0, flips: 0 };
  readonly rate: number;
  constructor(seed: number, thick: number) { const r = rng(seed); this.rate = (0.0072 * (0.88 + 0.24 * r())) / (0.8 + 0.5 * Math.max(0, Math.min(1, thick))); }
  /** One 100 ms step: c is '0'..'3' (dial) or 'f' (flip). */
  tick(c: string) {
    const s = this.s;
    if (c === 'f') { const t = s.down; s.down = s.up; s.up = t; s.flips++; } else s.dial = c.charCodeAt(0) - 48;
    s.heat += (s.dial - s.heat) * 0.08;
    s.down += s.heat * this.rate; s.up += s.heat * this.rate * 0.06; // the top side warms a little
    s.step++;
  }
}
export function judge(s: PanState, level: number): Outcome {
  const w = doneWindow(level); const hi = Math.max(s.down, s.up), lo = Math.min(s.down, s.up);
  if (hi > 1 + w + BURN_OVER) return 'burnt';
  if (lo < 1 - w || s.flips < 1) return 'undercooked';
  if (hi > 1 + w) return 'burnt';
  if (Math.abs(s.down - 1) <= w / 2 && Math.abs(s.up - 1) <= w / 2) return 'perfect';
  return 'good';
}
/** Replay a timeline. 'invalid' for malformed input. */
export function replayCook(seed: number, thick: number, level: number, inputs: unknown): Outcome | 'invalid' {
  if (typeof inputs !== 'string' || !inputs.length || inputs.length > COOK_MAX_STEPS || !/^[0-3f]+$/.test(inputs)) return 'invalid';
  const p = new Pan(seed, thick); for (const c of inputs) p.tick(c); return judge(p.s, level);
}
