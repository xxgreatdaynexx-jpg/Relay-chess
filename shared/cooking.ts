/**
 * Cooking (pt1312u): a kitchen in every home you own (city / resort properties, farmhouses, your Trailer Park trailer).
 * Pure rules shared by the server (authoritative) and the client (display): staples, the recipe book, dish value,
 * the burn rule and the deterministic four-step timing minigame (heat, flip, stir, plate).
 *
 * Ingredients: fish from your fishing cooler, crops you harvest "to the pantry" (farm + resort plantation), and a few
 * cheap staples bought in the kitchen. Values are BASE chips; the server scales by the price index (px).
 * A dish's base value is ~1.35x its raw ingredients (x0.8..1.2 for quality). Sales go through a per-player daily tier
 * like fishing: full price up to 100,000 base chips of dishes a day, then nothing.
 */
import { CROPS } from './farm.js';
import { TROPICAL_CROPS } from './resort.js';

export interface Staple { id: string; label: string; emoji: string; base: number }
/** Groceries (Grocery Store + Market). kind groups them on the shelves. */
export type GroceryKind = 'staple' | 'protein' | 'veg' | 'spice' | 'sauce' | 'dairy';
export const STAPLES: Array<Staple & { kind: GroceryKind }> = [
  { id: 'salt', label: 'Salt', emoji: '🧂', base: 1, kind: 'staple' },
  { id: 'oil', label: 'Cooking Oil', emoji: '🫒', base: 2, kind: 'staple' },
  { id: 'flour', label: 'Flour', emoji: '🌾', base: 2, kind: 'staple' },
  { id: 'sugar', label: 'Sugar', emoji: '🍬', base: 2, kind: 'staple' },
  { id: 'rice', label: 'Rice', emoji: '🍚', base: 3, kind: 'staple' },
  { id: 'pasta', label: 'Dry Pasta', emoji: '🍝', base: 3, kind: 'staple' },
  { id: 'bread', label: 'Bread Rolls', emoji: '🥖', base: 3, kind: 'staple' },
  { id: 'eggs', label: 'Eggs', emoji: '🥚', base: 3, kind: 'dairy' },
  { id: 'milk', label: 'Milk', emoji: '🥛', base: 3, kind: 'dairy' },
  { id: 'butter', label: 'Butter', emoji: '🧈', base: 4, kind: 'dairy' },
  { id: 'cheese', label: 'Cheese', emoji: '🧀', base: 6, kind: 'dairy' },
  { id: 'chicken', label: 'Chicken', emoji: '🍗', base: 10, kind: 'protein' },
  { id: 'beef', label: 'Beef', emoji: '🥩', base: 14, kind: 'protein' },
  { id: 'bacon', label: 'Bacon', emoji: '🥓', base: 9, kind: 'protein' },
  { id: 'tofu', label: 'Tofu', emoji: '🧊', base: 6, kind: 'protein' },
  { id: 'shrimp', label: 'Shrimp', emoji: '🦐', base: 12, kind: 'protein' },
  { id: 'onion', label: 'Onions', emoji: '🧅', base: 2, kind: 'veg' },
  { id: 'garlic', label: 'Garlic', emoji: '🧄', base: 2, kind: 'veg' },
  { id: 'lettuce', label: 'Lettuce', emoji: '🥬', base: 3, kind: 'veg' },
  { id: 'pepper_bell', label: 'Bell Peppers', emoji: '🫑', base: 3, kind: 'veg' },
  { id: 'mushroom', label: 'Mushrooms', emoji: '🍄', base: 4, kind: 'veg' },
  { id: 'lemon', label: 'Lemons', emoji: '🍋', base: 2, kind: 'veg' },
  { id: 'black_pepper', label: 'Black Pepper', emoji: '⚫', base: 1, kind: 'spice' },
  { id: 'chili', label: 'Chili Flakes', emoji: '🌶️', base: 2, kind: 'spice' },
  { id: 'herbs', label: 'Fresh Herbs', emoji: '🌿', base: 2, kind: 'spice' },
  { id: 'curry_powder', label: 'Curry Powder', emoji: '🟡', base: 3, kind: 'spice' },
  { id: 'cinnamon', label: 'Cinnamon', emoji: '🟤', base: 2, kind: 'spice' },
  { id: 'soy_sauce', label: 'Soy Sauce', emoji: '🍶', base: 2, kind: 'sauce' },
  { id: 'tomato_sauce', label: 'Tomato Sauce', emoji: '🥫', base: 3, kind: 'sauce' },
  { id: 'honey', label: 'Honey', emoji: '🍯', base: 4, kind: 'sauce' },
];
export const stapleById = (id: unknown) => STAPLES.find((s) => s.id === id);
/** Fish ingredients are generic: 'fish' = any non-junk fish, 'fish_fine' = rare or better. The cheapest match is used. */
export const FISH_ING = { fish: { label: 'Fish (any)', emoji: '🐟', base: 8, rarities: ['common', 'uncommon', 'rare', 'epic', 'legendary'] }, fish_fine: { label: 'Fine fish (rare+)', emoji: '🍣', base: 50, rarities: ['rare', 'epic', 'legendary'] } } as const;
export type FishIng = keyof typeof FISH_ING;
/** pt1299u: a cooler fish is cut into fillets for the kitchen: 1 fillet per `base` chips of the fish's base value
 *  (8 for any fish, 50 for fine fish), at least 1, at most FILLET_CAP. A fillet is worth `base`, so a fish worth 8+
 *  never makes more fillet value than it sells for (n * base <= value). Leftover fillets wait on the cutting board. */
export const FILLET_CAP = 12;
export const filletsFrom = (ing: FishIng, value: number) => Math.max(1, Math.min(FILLET_CAP, Math.floor((Number(value) || 0) / FISH_ING[ing].base)));
export const isFishIng = (id: string): id is FishIng => id in FISH_ING;
const ALL_CROPS = [...CROPS, ...TROPICAL_CROPS];
export const cropIng = (id: string) => ALL_CROPS.find((c) => c.id === id);
export const PANTRY_MAX = 999; // per item
/** A pantry/Market food item: a grocery or a crop. */
export function foodInfo(id: string): { label: string; emoji: string; base: number; kind: 'crop' | 'staple' } | null {
  const s = stapleById(id); if (s) return { label: s.label, emoji: s.emoji, base: s.base, kind: 'staple' };
  const c = cropIng(id); return c ? { label: c.label, emoji: c.emoji, base: c.sell, kind: 'crop' } : null;
}
export const isFood = (id: unknown): id is string => typeof id === 'string' && !!foodInfo(id);
/** Base value + display of any ingredient id. */
export function ingInfo(id: string): { label: string; emoji: string; base: number; kind: 'fish' | 'crop' | 'staple' } | null {
  if (isFishIng(id)) return { label: FISH_ING[id].label, emoji: FISH_ING[id].emoji, base: FISH_ING[id].base, kind: 'fish' };
  const s = stapleById(id); if (s) return { label: s.label, emoji: s.emoji, base: s.base, kind: 'staple' };
  const c = cropIng(id); if (c) return { label: c.label, emoji: c.emoji, base: c.sell, kind: 'crop' };
  return null;
}

export interface Recipe { id: string; label: string; emoji: string; level: number; ings: Record<string, number>; diff: number }
export const RECIPES: Recipe[] = [
  { id: 'fried_fish', label: 'Pan-Fried Fish', emoji: '🐟', level: 1, ings: { fish: 1, oil: 1, salt: 1, lemon: 1 }, diff: 0.1 },
  { id: 'scrambled_eggs', label: 'Cheesy Scrambled Eggs', emoji: '🍳', level: 3, ings: { eggs: 2, butter: 1, cheese: 1 }, diff: 0.12 },
  { id: 'jam_toast', label: 'Strawberry Jam Toast', emoji: '🍓', level: 6, ings: { strawberry: 2, sugar: 1, bread: 1 }, diff: 0.15 },
  { id: 'farm_bread', label: 'Farmhouse Bread', emoji: '🍞', level: 10, ings: { wheat: 2, butter: 1, milk: 1, salt: 1 }, diff: 0.2 },
  { id: 'fish_tacos', label: 'Fish Tacos', emoji: '🌮', level: 14, ings: { fish: 1, corn: 1, flour: 1, lettuce: 1, chili: 1 }, diff: 0.24 },
  { id: 'carrot_soup', label: 'Carrot & Herb Soup', emoji: '🥕', level: 18, ings: { carrot: 2, onion: 1, butter: 1, herbs: 1 }, diff: 0.28 },
  { id: 'blt', label: 'BLT Sandwich', emoji: '🥪', level: 22, ings: { bacon: 1, lettuce: 1, tomato: 1, bread: 1 }, diff: 0.32 },
  { id: 'tomato_pasta', label: 'Tomato Pasta', emoji: '🍝', level: 26, ings: { pasta: 1, tomato_sauce: 1, garlic: 1, cheese: 1 }, diff: 0.35 },
  { id: 'chicken_stirfry', label: 'Chicken Stir-Fry', emoji: '🥢', level: 30, ings: { chicken: 1, pepper_bell: 1, soy_sauce: 1, rice: 1, garlic: 1 }, diff: 0.38 },
  { id: 'fish_chips', label: 'Fish & Chips', emoji: '🍟', level: 34, ings: { fish: 1, potato: 1, flour: 1, oil: 1 }, diff: 0.41 },
  { id: 'mushroom_risotto', label: 'Mushroom Risotto', emoji: '🍄', level: 38, ings: { rice: 1, mushroom: 1, butter: 1, cheese: 1, onion: 1 }, diff: 0.44 },
  { id: 'pineapple_rice', label: 'Pineapple Fried Rice', emoji: '🍍', level: 42, ings: { pineapple: 1, rice: 1, eggs: 1, soy_sauce: 1 }, diff: 0.47 },
  { id: 'beef_burger', label: 'Smash Burger', emoji: '🍔', level: 46, ings: { beef: 1, bread: 1, cheese: 1, onion: 1, lettuce: 1 }, diff: 0.5 },
  { id: 'pumpkin_pie', label: 'Pumpkin Pie', emoji: '🥧', level: 50, ings: { pumpkin: 1, flour: 1, butter: 1, sugar: 1, cinnamon: 1 }, diff: 0.53 },
  { id: 'banana_bread', label: 'Honey Banana Bread', emoji: '🍌', level: 55, ings: { banana: 2, flour: 1, eggs: 1, honey: 1 }, diff: 0.56 },
  { id: 'garlic_shrimp', label: 'Garlic Butter Shrimp', emoji: '🦐', level: 60, ings: { shrimp: 1, garlic: 1, butter: 1, lemon: 1, herbs: 1 }, diff: 0.6 },
  { id: 'mango_salmon', label: 'Mango-Glazed Fine Fish', emoji: '🥭', level: 65, ings: { fish_fine: 1, mango: 1, rice: 1, honey: 1 }, diff: 0.64 },
  { id: 'coconut_curry', label: 'Coconut Fish Curry', emoji: '🍛', level: 72, ings: { coconut: 1, fish: 1, rice: 1, curry_powder: 1, onion: 1 }, diff: 0.7 },
  { id: 'beef_stew', label: 'Harvest Beef Stew', emoji: '🍲', level: 78, ings: { beef: 1, potato: 1, carrot: 1, onion: 1, herbs: 1 }, diff: 0.75 },
  { id: 'grape_tart', label: 'Grape Tart', emoji: '🍇', level: 84, ings: { grapes: 1, flour: 1, butter: 1, sugar: 1 }, diff: 0.8 },
  { id: 'cacao_souffle', label: 'Chocolate Soufflé', emoji: '🍫', level: 92, ings: { cacao: 1, eggs: 1, sugar: 1, butter: 1, milk: 1 }, diff: 0.9 },
];
export const recipeById = (id: unknown) => RECIPES.find((r) => r.id === id);
export const rawValue = (r: Recipe) => Object.entries(r.ings).reduce((a, [id, n]) => a + (ingInfo(id)?.base ?? 0) * n, 0);
export const DISH_MARKUP = 1.35;
/** Base value of a dish at quality q (0..1): 0.8x..1.2x of markup x raw. */
export const dishValue = (r: Recipe, q: number) => Math.max(1, Math.round(rawValue(r) * DISH_MARKUP * (0.8 + 0.4 * Math.max(0, Math.min(1, q)))));
/** XP for a cooked dish (burnt = a fifth). */
export const cookXp = (r: Recipe, q: number, burnt: boolean) => Math.max(1, Math.round((12 + r.level * 2.2) * (burnt ? 0.2 : 0.6 + 0.4 * q)));
/** Chance a dish burns: high when you are near the recipe's unlock level or played badly, zero 30 levels past it. */
export function burnChance(level: number, r: Recipe, q: number): number {
  const over = Math.max(0, level - r.level);
  const skill = Math.max(0, 0.3 - 0.01 * over);
  const sloppy = q < 0.35 ? (over >= 30 ? 0.15 : 0.6) : 0;
  return Math.min(0.95, skill * (1.2 - q) + sloppy);
}

export const COOK_TIERS: Array<{ upTo: number; rate: number }> = [{ upTo: 100_000, rate: 1 }, { upTo: Infinity, rate: 0 }];
export const COOK_DAILY_MAX = COOK_TIERS.reduce((a, t, i) => a + (Number.isFinite(t.upTo) ? (t.upTo - (i ? COOK_TIERS[i - 1]!.upTo : 0)) * t.rate : 0), 0);
export function cookPayout(gross: number, already: number): number {
  let left = gross, at = already, pay = 0, lo = 0;
  for (const t of COOK_TIERS) { if (left <= 0) break; const take = Math.min(left, Math.max(0, t.upTo - Math.max(at, lo))); pay += take * t.rate; left -= take; at += take; lo = t.upTo; }
  return Math.floor(pay + 1e-9);
}
export const DISHES_MAX = 40;

// ---- Timing minigame: four steps; in each a needle sweeps 0..1..0 and you press inside the sweet zone. ----
export const STEPS = [{ id: 'heat', label: 'Heat the pan', emoji: '🔥' }, { id: 'flip', label: 'Flip', emoji: '🍳' }, { id: 'stir', label: 'Stir', emoji: '🥄' }, { id: 'plate', label: 'Plate it', emoji: '🍽️' }] as const;
export const STEP_MIN_MS = 250, STEP_MAX_MS = 12_000, COOK_EXPIRE_MS = 120_000;
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export interface StepSpec { period: number; phase: number; center: number; half: number }
/** The four steps' needle speed (ms per sweep), start phase, sweet-zone centre and half-width. */
export function cookSteps(seed: number, diff: number): StepSpec[] {
  const r = rng(seed); const out: StepSpec[] = [];
  for (let i = 0; i < 4; i++) { const half = 0.11 - 0.06 * diff; out.push({ period: Math.round(1500 - 700 * diff + r() * 500), phase: r(), center: half + 0.05 + r() * (0.9 - 2 * half), half }); }
  return out;
}
/** Needle position 0..1 (triangle wave) t ms into a step. */
export const needleAt = (s: StepSpec, t: number) => { const u = (((t / s.period + s.phase) % 1) + 1) % 1; return u < 0.5 ? u * 2 : 2 - u * 2; };
/** 1 in the zone, falling to 0 at two zone-widths outside. */
export const stepScore = (s: StepSpec, t: number) => { const d = Math.abs(needleAt(s, t) - s.center); return d <= s.half ? 1 : Math.max(0, 1 - (d - s.half) / (2 * s.half)); };
/** Quality 0..1 from the four press times (ms after each step started), or null if the timeline is impossible. */
export function judgeCook(seed: number, diff: number, presses: unknown): number | null {
  if (!Array.isArray(presses) || presses.length !== 4 || !presses.every((p) => Number.isInteger(p) && p >= STEP_MIN_MS && p <= STEP_MAX_MS)) return null;
  const st = cookSteps(seed, diff); return (presses as number[]).reduce((a, p, i) => a + stepScore(st[i]!, p), 0) / 4;
}
export const qualityLabel = (q: number) => (q >= 0.95 ? 'Perfect' : q >= 0.8 ? 'Great' : q >= 0.6 ? 'Good' : q >= 0.35 ? 'OK' : 'Sloppy');

export interface Dish { id: string; recipe: string; quality: number; value: number; at: number }
export interface KitchenView { pantry: Record<string, number>; fish: { fish: number; fish_fine: number }; fillets?: { fish: number; fish_fine: number }; dishes: Dish[]; today: { gross: number; paid: number }; index: number; level: number; xp: number; hasHome: boolean }
