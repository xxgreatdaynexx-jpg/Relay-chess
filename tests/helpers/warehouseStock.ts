/** Test helpers: per-location stock at the Warehouse (the only place that sells / lists / donates). */
import { getLocStore } from '../../server/locstock';
import { WAREHOUSE } from '../../shared/inventoryLocations';
export const whAdd = (name: string, type: string, id: string, qty: number) => getLocStore().applyMem(name, [{ loc: WAREHOUSE, item: `${type}:${id}`, delta: qty }]);
export const whQty = (name: string, type: string, id: string) => getLocStore().qty(name, WAREHOUSE, `${type}:${id}`);
