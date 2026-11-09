/**
 * Individual inventory locations (truck logistics, Dayne 2026-11-06). Every stack of goods sits at ONE physical place:
 *
 *   factory            the player's factory (exactly one per account). Backed by the existing banked store (mine_items /
 *                      Mines packs), so legacy banked stock is factory stock with no copy.
 *   warehouse          the Chud City Warehouse: the ONLY place goods sell, the Co-op / supply-contract / Market source.
 *   mine:<cave>        one Chud City cave: mine:mine, mine:frost, mine:magma, mine:quarry (hauls banked there; hired miners -> mine:mine).
 *   farm:<plotId>      one farm plot, city (f:/cf:...) or Chud Resort plantation (rf:...): each plot has its own stock.
 *   fishing:<spot>     one fishing spot (lake = city; reef / deep = resort). Fish are rows (species/weight kept).
 *   kitchen:<homeId>   the kitchen in one specific home you own (property, farm plot or trailer).
 *   coral              the player's Coral Grotto haul bin (one cave, building_inv 'coral'); Fort McChud keeps its own fort store.
 *   (legacy: the pooled resort plantation barn 'resort_farm' is migrated to the owner's factory and is no location any more)
 *
 * City legs (both ends on the same map) need a truck (own or hired); legs between maps keep the existing carriers.
 */
export type HubId = 'city' | 'resort' | 'fortmc';
export const FACTORY = 'factory';
export const WAREHOUSE = 'warehouse';
export const WAREHOUSE_LOC = WAREHOUSE;
/** Map pools (Dayne 2026-11-07): ONE inventory per owner per map. City = the Chud City Warehouse, resort = the Resort Warehouse.
 *  Everything produced on a map lands in its pool; only moves between maps need a ship or plane. */
export const RESORT_WAREHOUSE = 'resort';
export const poolOfHub = (h: HubId): string | null => (h === 'city' ? WAREHOUSE : h === 'resort' ? RESORT_WAREHOUSE : null);
export const isPool = (loc: string) => loc === WAREHOUSE || loc === RESORT_WAREHOUSE;
/** City caves (each its own mine): The Mine, Frostbite, Magma, Stone Quarry. Coral / Fort McChud keep their own bins. */
export const CITY_CAVES = ['mine', 'frost', 'magma', 'quarry'] as const;
/** Where NEW goods land (map pools): every producer writes to its map's warehouse. The per-place ids below
 *  ('mine:<cave>', 'farm:<plot>', 'fishing:<spot>', 'kitchen:<home>') are still parsed so legacy rows / in-flight legs
 *  stay readable; server/mapPools.ts folds them once. */
export const mineLoc = (cave: string) => (cave === 'coral' ? RESORT_WAREHOUSE : WAREHOUSE);
export const farmLoc = (plotId: string) => (plotId.startsWith('rf:') ? RESORT_WAREHOUSE : WAREHOUSE);
export const fishingLoc = (spot: string) => (spot === 'lake' ? WAREHOUSE : RESORT_WAREHOUSE);
/** Resort homes have ids 'r:<type>:<n>' (shared/resort.ts) and plantation plots 'rf:<n>'; every other home is in the city. */
export const kitchenLoc = (homeId: string) => (/^rf?:/.test(homeId) ? RESORT_WAREHOUSE : WAREHOUSE);
export type LocKind = 'factory' | 'warehouse' | 'resort' | 'mine' | 'farm' | 'fishing' | 'kitchen' | 'coral';
const REF = /^[A-Za-z0-9_.:-]{1,80}$/;
export interface Loc { kind: LocKind; ref: string; id: string }
/** Strict parser: anything else is "Unknown location." */
export function parseLoc(v: unknown): Loc {
  if (v === FACTORY || v === WAREHOUSE || v === 'resort' || v === 'coral') return { kind: v, ref: '', id: v };
  if (typeof v !== 'string') throw new Error('Unknown location.');
  const i = v.indexOf(':'); const kind = v.slice(0, i); const ref = v.slice(i + 1);
  if (i < 1 || !REF.test(ref)) throw new Error('Unknown location.');
  if (kind === 'mine' && (CITY_CAVES as readonly string[]).includes(ref)) return { kind, ref, id: v };
  if (kind === 'fishing' && (ref === 'lake' || ref === 'reef' || ref === 'deep')) return { kind, ref, id: v };
  if (kind === 'farm') return { kind, ref, id: v };
  if (kind === 'kitchen') return { kind, ref, id: v };
  throw new Error('Unknown location.');
}
export const isLoc = (v: unknown): v is string => { try { parseLoc(v); return true; } catch { return false; } };
/** Which map a location is on. Kitchens on the resort map pass resort=true (server resolves the home). */
export function hubOfLoc(loc: string, kitchenOnResort = false): HubId {
  const l = parseLoc(loc);
  if (l.kind === 'coral' || l.kind === 'resort') return 'resort';
  if (l.kind === 'farm') return l.ref.startsWith('rf:') ? 'resort' : 'city';
  if (l.kind === 'fishing') return l.ref === 'lake' ? 'city' : 'resort';
  if (l.kind === 'kitchen') return kitchenOnResort ? 'resort' : 'city';
  return 'city';
}
/** Map pools: each map's warehouse sells (pre-update goods sold wherever you were; now from your map inventory). */
export const canSellAt = (loc: string) => isPool(loc);
/** Where a truck can deliver to (sources: anywhere you hold stock). */
export const isDestKind = (k: LocKind) => k === 'factory' || k === 'warehouse' || k === 'resort';
export function locLabel(loc: string): string {
  try {
    const l = parseLoc(loc);
    switch (l.kind) {
      case 'factory': return 'My Factory';
      case 'warehouse': return 'Chud City Warehouse';
      case 'resort': return 'Resort Warehouse';
      case 'mine': return l.ref === 'frost' ? 'Frostbite Caverns' : l.ref === 'magma' ? 'Magma Depths' : l.ref === 'quarry' ? 'Stone Quarry' : 'The Mine';
      case 'farm': return l.ref.startsWith('rf:') ? `Plantation plot ${l.ref.slice(3)}` : `Farm plot ${l.ref}`;
      case 'fishing': return l.ref === 'lake' ? 'Lake dock' : l.ref === 'reef' ? 'Reef Pier' : 'Resort Marina (deep sea)';
      case 'kitchen': return `Kitchen · ${l.ref}`;
      case 'coral': return 'Coral Grotto';
    }
  } catch { /* fallthrough */ }
  return loc;
}
/** Bin item keys: 'ore:iron', 'bar:gold', 'good:gear', 'food:flour', 'crop:wheat'. Fish / dishes are rows, not bin keys. */
export const BIN_ITEM = /^(ore|bar|good|food|crop|gem):[A-Za-z0-9_]{1,40}$/;
/** A crop arriving at a factory becomes the factory's crop input (same conversion the old import used). */
export function arrivalKey(item: string, toKind: LocKind): string {
  if (item.startsWith('crop:')) { const c = item.slice(5); if (toKind === 'factory') return `good:crop_${c}`; if (toKind === 'kitchen') return `food:${c}`; }
  return item;
}
