/**
 * Factory sell buff (Millionaire Update): non-farm factory goods sell to the house for +5% (first tier) up to +30%
 * (deepest final products), linear in production-chain depth computed from the real recipe graphs
 * (mines RECIPES + factory FRECIPES for ore/metal goods, fort plant UNITS for oil & gas).
 * Depth: raw inputs (ore, wellstream) = 0; a product = 1 + the deepest input of its shallowest recipe.
 * Excluded: anything whose tree takes a farm crop, fish or other food/animal product at any level.
 * SELL side only. priceOf() (recipe inputs, net worth, donations, buy prices) is untouched.
 */
import { GOODS, RECIPES, priceOf, type ItemType } from './mines.js';
import { FRECIPES } from './factory.js';
import { PRODUCTS, UNITS, type Product } from './fortmc.js';

export const SELL_BUFF_MIN = 0.05, SELL_BUFF_MAX = 0.30;
type Edge = { out: string; in: string[] };
const edges: Edge[] = [
  ...RECIPES.map((r) => ({ out: `${r.out.type}:${r.out.id}`, in: r.in.map((i) => `${i.type}:${i.id}`) })),
  ...FRECIPES.map((r) => ({ out: r.out[0], in: r.in.map(([k]) => k) })),
  // oil & gas plant: wellstream -> separator -> crude + raw gas -> ...
  { out: 'fort:crude', in: ['fort:wellstream'] }, { out: 'fort:rawgas', in: ['fort:wellstream'] },
  ...Object.values(UNITS).flatMap((u) => u.input ? u.out.flatMap(([p]) => [{ out: `fort:${p}`, in: [`fort:${u.input}`] }, ...(u.alt ? [{ out: `fort:${p}`, in: [`fort:${u.alt}`] }] : [])]) : []),
  ...['gas_plant', 'refinery'].map((u) => ({ out: 'fort:sulfur', in: [`fort:${UNITS[u as 'refinery'].input}`] })),
];
const isRawKey = (k: string) => k.startsWith('ore:') || k === 'fort:wellstream' || !edges.some((e) => e.out === k);
/** Farm / animal / food inputs: crops, fish, and any GOODS flagged food or raw-farm. */
export const isFarmKey = (k: string) => { const [t, id] = k.split(':'); return t === 'crop' || t === 'food' || /^(crop_|fish|egg|milk|wool|meat|honey)/.test(id) || (t !== 'ore' && t !== 'fort' && !!GOODS[id]?.food); };

const depthMemo = new Map<string, number>(); const farmMemo = new Map<string, boolean>();
export function chainDepth(k: string, seen = new Set<string>()): number {
  if (depthMemo.has(k)) return depthMemo.get(k)!; if (isRawKey(k)) return 0; if (seen.has(k)) return Infinity; seen.add(k);
  let best = Infinity; for (const e of edges) if (e.out === k) best = Math.min(best, 1 + Math.max(0, ...e.in.map((i) => chainDepth(i, seen))));
  seen.delete(k); depthMemo.set(k, best); return best;
}
export function farmTree(k: string, seen = new Set<string>()): boolean {
  if (farmMemo.has(k)) return farmMemo.get(k)!; if (isFarmKey(k)) return true; if (seen.has(k)) return false; seen.add(k);
  const r = edges.some((e) => e.out === k && e.in.some((i) => farmTree(i, seen))); seen.delete(k); farmMemo.set(k, r); return r;
}
const sellableKey = (k: string) => { const [t, id] = k.split(':'); return t === 'fort' ? PRODUCTS[id as Product]?.sellable && PRODUCTS[id as Product].price > 0 : priceOf({ type: t as ItemType, id }) > 0 && !GOODS[id]?.raw; };
/** Every buffed item key -> chain depth. */
export const BUFF_DEPTH: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const k of new Set(edges.map((e) => e.out))) { if (!sellableKey(k) || farmTree(k)) continue; const d = chainDepth(k); if (Number.isFinite(d) && d >= 1) m.set(k, d); }
  return m;
})();
export const MAX_DEPTH = Math.max(...BUFF_DEPTH.values());
export const buffForDepth = (d: number) => (d < 1 ? 0 : SELL_BUFF_MIN + (SELL_BUFF_MAX - SELL_BUFF_MIN) * (Math.min(d, MAX_DEPTH) - 1) / Math.max(1, MAX_DEPTH - 1));
export const sellBuffOf = (key: string) => { const d = BUFF_DEPTH.get(key); return d ? buffForDepth(d) : 0; };
/** House SELL price of one unit (mines/factory items). */
export const houseSellPrice = (s: { type: ItemType | string; id: string }) => { const p = priceOf({ type: s.type as ItemType, id: s.id }); return p * (1 + sellBuffOf(`${s.type}:${s.id}`)); };
/** House SELL price of one unit of a Fort McChud product. */
export const fortSellPrice = (id: Product) => PRODUCTS[id].price * (1 + sellBuffOf(`fort:${id}`));
