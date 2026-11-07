/**
 * Individual inventory locations (truck logistics, Dayne 2026-11-06). Every stack of goods sits at ONE physical place:
 *
 *   factory            the player's factory (exactly one per account). Backed by the existing banked store (mine_items /
 *                      Mines packs), so legacy banked stock is factory stock with no copy.
 *   warehouse          the Chud City Warehouse: the ONLY place goods sell, the Co-op / supply-contract / Market source.
 *   mine:<cave>        one Chud City cave: mine:mine, mine:frost, mine:magma (hauls banked there; hired miners -> mine:mine).
 *   farm:<plotId>      one city farm plot (each plot has its own bin).
 *   fishing:<spot>     one fishing spot (lake = city; reef / deep = resort). Fish are rows (species/weight kept).
 *   kitchen:<homeId>   the kitchen in one specific home you own (property, farm plot or trailer).
 *   coral, resort_farm the resort's Coral Grotto and plantation barn (existing building bins), fortmc = Fort McChud.
 *
 * City legs (both ends on the same map) need a truck (own or hired); legs between maps keep the existing carriers.
 */
export type HubId = 'city' | 'resort' | 'fortmc';
export const FACTORY = 'factory';
export const WAREHOUSE = 'warehouse';
export const WAREHOUSE_LOC = WAREHOUSE;
/** City caves (each its own mine): The Mine, Frostbite Caverns, Magma Depths. Coral / Fort McChud keep their own bins. */
export const CITY_CAVES = ['mine', 'frost', 'magma'] as const;
export const mineLoc = (cave: string) => `mine:${cave}`;
export const farmLoc = (plotId: string) => `farm:${plotId}`;
export const fishingLoc = (spot: string) => `fishing:${spot}`;
export const kitchenLoc = (homeId: string) => `kitchen:${homeId}`;
export type LocKind = 'factory' | 'warehouse' | 'mine' | 'farm' | 'fishing' | 'kitchen' | 'coral' | 'resort_farm';
const REF = /^[A-Za-z0-9_.:-]{1,80}$/;
export interface Loc { kind: LocKind; ref: string; id: string }
/** Strict parser: anything else is "Unknown location." */
export function parseLoc(v: unknown): Loc {
  if (v === FACTORY || v === WAREHOUSE || v === 'coral' || v === 'resort_farm') return { kind: v, ref: '', id: v };
  if (typeof v !== 'string') throw new Error('Unknown location.');
  const i = v.indexOf(':'); const kind = v.slice(0, i); const ref = v.slice(i + 1);
  if (i < 1 || !REF.test(ref)) throw new Error('Unknown location.');
  if (kind === 'mine' && (CITY_CAVES as readonly string[]).includes(ref)) return { kind, ref, id: v };
  if (kind === 'fishing' && (ref === 'lake' || ref === 'reef' || ref === 'deep')) return { kind, ref, id: v };
  if (kind === 'farm' && !ref.startsWith('rf:')) return { kind, ref, id: v }; // resort plots harvest into the plantation barn
  if (kind === 'kitchen') return { kind, ref, id: v };
  throw new Error('Unknown location.');
}
export const isLoc = (v: unknown): v is string => { try { parseLoc(v); return true; } catch { return false; } };
/** Which map a location is on. Kitchens on the resort map pass resort=true (server resolves the home). */
export function hubOfLoc(loc: string, kitchenOnResort = false): HubId {
  const l = parseLoc(loc);
  if (l.kind === 'coral' || l.kind === 'resort_farm') return 'resort';
  if (l.kind === 'fishing') return l.ref === 'lake' ? 'city' : 'resort';
  if (l.kind === 'kitchen') return kitchenOnResort ? 'resort' : 'city';
  return 'city';
}
/** Only the Chud City Warehouse sells. */
export const canSellAt = (loc: string) => loc === WAREHOUSE;
/** Where a truck can deliver to (sources: anywhere you hold stock). */
export const isDestKind = (k: LocKind) => k === 'factory' || k === 'warehouse' || k === 'kitchen';
export function locLabel(loc: string): string {
  try {
    const l = parseLoc(loc);
    switch (l.kind) {
      case 'factory': return 'My Factory';
      case 'warehouse': return 'Chud City Warehouse';
      case 'mine': return l.ref === 'frost' ? 'Frostbite Caverns' : l.ref === 'magma' ? 'Magma Depths' : 'The Mine';
      case 'farm': return `Farm plot ${l.ref}`;
      case 'fishing': return l.ref === 'lake' ? 'Lake dock' : l.ref === 'reef' ? 'Reef Pier' : 'Resort Marina (deep sea)';
      case 'kitchen': return `Kitchen · ${l.ref}`;
      case 'coral': return 'Coral Grotto';
      case 'resort_farm': return 'Resort plantation barn';
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
