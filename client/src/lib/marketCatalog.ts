/** Market catalog filtering/sorting (pure; shared by the Skins and Resources sub-tabs). */
export interface CatEntry { what: string; name: string; kind?: string; weapon?: string; rarity?: 'common' | 'rare' | 'ultra'; type?: string; id?: string; color?: string; listings: number; lowest: number | null; last: number | null; lastAt: number | null }
export type SortKey = 'low' | 'high' | 'name' | 'rarity' | 'most' | 'recent';
const RANK = { common: 0, rare: 1, ultra: 2 } as const;
export const PAGE = 60;
/** Filter + sort the full catalog (pure, tested). Unlisted entries sort after listed ones on price sorts. */
export function sortCatalog(rows: CatEntry[], o: { q?: string; listedOnly?: boolean; sort: SortKey; match?: (e: CatEntry) => boolean }) {
  const q = (o.q ?? '').trim().toLowerCase();
  const out = rows.filter((e) => (!o.listedOnly || e.listings > 0) && (!q || e.name.toLowerCase().includes(q)) && (!o.match || o.match(e)));
  const price = (e: CatEntry, dir: 1 | -1) => (e.lowest == null ? Infinity : dir * e.lowest);
  const cmp: Record<SortKey, (a: CatEntry, b: CatEntry) => number> = {
    low: (a, b) => price(a, 1) - price(b, 1), high: (a, b) => price(a, -1) - price(b, -1), name: () => 0,
    rarity: (a, b) => (b.rarity ? RANK[b.rarity] : -1) - (a.rarity ? RANK[a.rarity] : -1), most: (a, b) => b.listings - a.listings, recent: (a, b) => (b.lastAt ?? -1) - (a.lastAt ?? -1),
  };
  return out.sort((a, b) => cmp[o.sort](a, b) || a.name.localeCompare(b.name));
}
