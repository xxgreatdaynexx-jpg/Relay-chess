/** Test helpers: stock in the Chud City Warehouse (map pools: its ore/bar/good/food ARE the banked Mines store). */
import { getLocStore, packed } from '../../server/locstock';
import { getMines } from '../../server/mines';
import { WAREHOUSE } from '../../shared/inventoryLocations';
import type { ItemType } from '../../shared/mines';
export const whAdd = (name: string, type: string, id: string, qty: number) => packed(WAREHOUSE, `${type}:${id}`)
  ? void getMines().adjustStack(name, type as ItemType, id, qty)
  : getLocStore().applyMem(name, [{ loc: WAREHOUSE, item: `${type}:${id}`, delta: qty }]);
export const whQty = (name: string, type: string, id: string) => getLocStore().qty(name, WAREHOUSE, `${type}:${id}`);
