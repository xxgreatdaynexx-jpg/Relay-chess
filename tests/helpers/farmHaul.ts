/** Test helper: city harvests land at the plot (farm:<plotId>). Old pay-on-harvest tests now truck the crops to the
 *  Warehouse and sell them there, the only way crops earn chips; the payout must equal the old instant price. */
import { getLocStore, locStmt } from '../../server/locstock';
import { farmLoc, WAREHOUSE } from '../../shared/inventoryLocations';
import type { Farm } from '../../server/farm';
type Q = { query: (sql: string, args?: unknown[]) => Promise<unknown> };
const key = (n: string) => n.trim().toLowerCase();
export async function haulAndSell(farm: Farm, pool: Q, name: string, pid: string): Promise<number> {
  const ls = getLocStore(); const at = farmLoc(pid); let paid = 0;
  for (const [loc, items] of ls.locs(name)) {
    if (loc !== at) continue;
    for (const x of items) {
      if (!x.item.startsWith('crop:') || x.qty <= 0) continue;
      for (const s of [locStmt(key(name), name, at, x.item, -x.qty), locStmt(key(name), name, WAREHOUSE, x.item, x.qty)]) await pool.query(s.sql, s.args);
      ls.applyMem(name, [{ loc: at, item: x.item, delta: -x.qty }, { loc: WAREHOUSE, item: x.item, delta: x.qty }]);
      const d = [{ loc: WAREHOUSE, item: x.item, delta: -x.qty }]; ls.applyMem(name, d);
      paid += await farm.sellShipped({ id: `t-${Math.random()}`, ownerName: name, itemId: x.item.slice(5), qty: x.qty }, ls.rowsFor(name, d), 'test');
    }
  }
  return paid;
}
export function harvestSells(farm: Farm, pool: Q, bank: () => { account: (n: string) => { chips: number } }): Farm {
  const h0 = farm.harvest.bind(farm);
  farm.harvest = (async (name: string, pid: string, ...rest: unknown[]) => {
    const r = await (h0 as (...a: unknown[]) => Promise<Record<string, unknown>>)(name, pid, ...rest);
    const paid = await haulAndSell(farm, pool, name, pid); return { ...r, paid, chips: bank().account(name).chips };
  }) as Farm['harvest'];
  return farm;
}
