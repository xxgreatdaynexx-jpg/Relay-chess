/** Recipe search for the factory: fuzzy item lookup + "used in / made by". Read-only over FRECIPES. */
import { FRECIPES, nameOfKey, type FRecipe } from './factory.js';

/** Every item that appears in a recipe (input or output). */
export const RECIPE_ITEMS: string[] = [...new Set(FRECIPES.flatMap((r) => [...r.in.map(([k]) => k), r.out[0]]))];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Score how well `q` matches `name`: exact > prefix > word-prefix > substring > in-order letters (fuzzy). 0 = no match. */
export function matchScore(q: string, name: string): number {
  const a = norm(q), b = norm(name);
  if (!a) return 0;
  if (a === b) return 100;
  if (b.startsWith(a)) return 80;
  if (b.split(' ').some((w) => w.startsWith(a))) return 60;
  if (b.includes(a)) return 40;
  const words = a.split(' ');
  if (words.length > 1 && words.every((w) => b.includes(w))) return 30;
  const flat = a.replace(/ /g, ''); let i = 0;
  for (const ch of b) if (ch === flat[i]) i++;
  return i === flat.length && flat.length >= 2 ? 10 : 0;
}

/** Items matching the query, best first (ties by name). */
export function searchItems(q: string, limit = 8): string[] {
  return RECIPE_ITEMS.map((k) => ({ k, s: matchScore(q, nameOfKey(k)) })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || nameOfKey(x.k).localeCompare(nameOfKey(y.k))).slice(0, limit).map((x) => x.k);
}

export interface ItemRecipes { key: string; usedIn: FRecipe[]; madeBy: FRecipe[] }
export const recipesOfItem = (key: string): ItemRecipes => ({
  key,
  usedIn: FRECIPES.filter((r) => r.in.some(([k]) => k === key)),
  madeBy: FRECIPES.filter((r) => r.out[0] === key),
});
