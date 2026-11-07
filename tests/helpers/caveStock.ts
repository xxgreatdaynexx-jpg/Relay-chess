/** Test helper: the production cave-stock hooks (server/locmoves.ts wireLocMoves) on a test MinesWorld, backed by a
 *  LocStore on the same pool (rows commit in the bank transaction; memory mirrors only after commit). */
import { LocStore, setLocStore, type LocPool } from '../../server/locstock';
import { mineLoc } from '../../shared/inventoryLocations';
import type { MinesWorld } from '../../server/mines';
export async function wireCaves(w: MinesWorld, pool: unknown = null): Promise<LocStore> {
  const ls = new LocStore(pool as LocPool | null); await ls.init(); setLocStore(ls);
  const d = (st: Array<{ type: string; id: string; qty: number }>, cave: string) => st.filter((x) => x.qty > 0).map((x) => ({ loc: mineLoc(cave), item: `${x.type}:${x.id}`, delta: x.qty }));
  w.cityBin = (a, st, cave) => ls.rowsFor(a, d(st, cave));
  w.cityBinDone = (a, st, cave) => ls.applyMem(a, d(st, cave));
  return ls;
}
/** Haul everything banked at the caves to the Warehouse (stock move, as a delivered truck leg would) and sell it there
 *  through the production house-sale path (Mines.houseSale + Warehouse debit in one transaction, as LocMoves.sell). */
export async function sellAtWarehouse(w: MinesWorld, ls: LocStore, name: string, now = Date.now()): Promise<void> {
  await w.flush(); // cave stock shows once the bank committed
  const items: Array<{ type: string; id: string; qty: number }> = [];
  for (const [loc, it] of ls.locs(name)) {
    if (loc !== 'resort') continue; // (city caves bank straight into the city store)
    for (const x of it) { const r = ls.adjust(name, [{ loc, item: x.item, delta: -x.qty }, { loc: 'warehouse', item: x.item, delta: x.qty }]); if (r) await r; const i = x.item.indexOf(':'); items.push({ type: x.item.slice(0, i), id: x.item.slice(i + 1), qty: x.qty }); }
  }
  if (!items.length) throw new Error('Nothing to sell.');
  const sale = w.houseSale(name, now, items as never);
  const r = ls.adjust(name, items.map((x) => ({ loc: 'warehouse', item: `${x.type}:${x.id}`, delta: -x.qty })), sale.stmts, { after: sale.w.after });
  if (r === false) { sale.w.revert(); throw new Error('short'); }
  sale.w.bind(r); await r; sale.apply();
}
