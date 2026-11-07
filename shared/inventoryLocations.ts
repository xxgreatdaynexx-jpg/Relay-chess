/**
 * Individual inventory locations (truck-only logistics). Every stack of goods lives at ONE location id belonging to one
 * physical place: a specific farm plot, mine, fishing spot, home kitchen, the player's factory, the Chud City Warehouse,
 * Fort McChud, the Coral Grotto, a resort plot. Category/map buckets are not locations.
 *
 *   factory:<playerKey>     the player's factory (exactly one per account)
 *   warehouse:city          Chud City Warehouse (the ONLY place goods sell); stock is still per player
 *   mine:<mineId>           a specific mine (e.g. mine:city, mine:coral)
 *   farm:<plotId>           a specific farm plot (f:3, rf:2, field ids)
 *   fishing:<spotId>        a specific fishing spot
 *   kitchen:<propertyId>    the kitchen in a specific owned home
 *   fort:fortmc             Fort McChud tank farm / ore bin
 */
export type LocKind = 'factory' | 'warehouse' | 'mine' | 'farm' | 'fishing' | 'kitchen' | 'fort';
export const LOC_KINDS: readonly LocKind[] = ['factory', 'warehouse', 'mine', 'farm', 'fishing', 'kitchen', 'fort'];
export const WAREHOUSE_LOC = 'warehouse:city';
export const factoryLoc = (playerKey: string) => `factory:${playerKey}`;
const REF = /^[A-Za-z0-9_.:-]{1,80}$/;
export function parseLoc(v: unknown): { kind: LocKind; ref: string; id: string } {
  if (typeof v !== 'string') throw new Error('Unknown location.');
  const i = v.indexOf(':'); const kind = v.slice(0, i) as LocKind; const ref = v.slice(i + 1);
  if (i < 1 || !LOC_KINDS.includes(kind) || !REF.test(ref)) throw new Error('Unknown location.');
  if (kind === 'warehouse' && ref !== 'city') throw new Error('Unknown location.');
  if (kind === 'fort' && ref !== 'fortmc') throw new Error('Unknown location.');
  return { kind, ref, id: v };
}
/** Only the Chud City Warehouse sells. */
export const canSellAt = (loc: string) => loc === WAREHOUSE_LOC;
/** City station legs need a truck; island legs keep their existing carriers (server/logistics.ts). */
export const CITY_KINDS: readonly LocKind[] = ['factory', 'warehouse', 'mine', 'farm', 'fishing', 'kitchen'];
