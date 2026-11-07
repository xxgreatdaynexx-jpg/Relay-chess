/** Real PostgreSQL (disposable LOCAL DB via MAYOR_LAWS_TEST_DATABASE_URL): location inventory, truck legs, legacy migration. */
import { expect, it } from 'vitest';
import pg from 'pg';
import { Inventory, INVENTORY_MIGRATION } from '../server/inventory';
import { MINES_MIGRATION } from '../server/mines';
import { canSellAt, parseLoc, WAREHOUSE_LOC } from '../shared/inventoryLocations';
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const LEGACY = `CREATE TABLE fish_catches (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, species TEXT NOT NULL, weight_g INTEGER NOT NULL, value INTEGER NOT NULL, caught_at BIGINT NOT NULL, sold_at BIGINT);
CREATE TABLE kitchen_fillets (player_key TEXT NOT NULL, kind TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0), PRIMARY KEY (player_key, kind));`;
async function withDb(fn: (pool: pg.Pool, clock: { now: number }) => Promise<void>) {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Only a disposable local test DB is allowed.');
  const schema = `inv_test_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = new pg.Pool({ connectionString: url }); await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 24, options: `-c search_path=${schema}` });
  try { for (const s of MINES_MIGRATION) await pool.query(s); await pool.query(LEGACY); await pool.query(INVENTORY_MIGRATION); await fn(pool, { now: 1_000_000 }); }
  finally { await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); }
}
const seed = async (pool: pg.Pool) => {
  await pool.query("INSERT INTO mine_factories VALUES ('ann','Ann',2,0),('bob','Bob',1,0)");
  await pool.query("INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ('ann','Ann','ore','iron',50),('ann','Ann','food','crop_wheat',7),('ann','Ann','good','gear',3),('bob','Bob','bar','gold',2),('bob','Bob','ore','iron',0)");
  await pool.query("INSERT INTO fish_catches VALUES ('f1','ann','Ann','trout',900,40,1,NULL),('f2','ann','Ann','trout',800,35,2,NULL),('f3','bob','Bob','bass',500,20,3,NULL),('f4','bob','Bob','bass',400,15,4,5)");
  await pool.query("INSERT INTO kitchen_fillets VALUES ('bob','white',3)");
};
const own = (p: string, l: string) => { const x = parseLoc(l); return x.kind === 'warehouse' || (x.kind === 'factory' ? x.ref === p : x.ref.startsWith(`${p}-`) || x.ref === 'city'); };

it.skipIf(!url)('legacy -> factory migration: conservation, fish/fillets, idempotent, concurrent, explicit confirmation', async () => {
  await withDb(async (pool, c) => {
    await seed(pool);
    const inv = new Inventory(pool, () => c.now);
    await expect(inv.migrateLegacyToFactory(undefined as never)).rejects.toThrow('explicit confirmation');
    const runs = await Promise.allSettled(Array.from({ length: 6 }, () => new Inventory(pool, () => c.now).migrateLegacyToFactory({ confirmedBy: 'test' })));
    const ok = runs.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ status: string }>).value.status);
    expect(ok.filter((s) => s === 'done')).toHaveLength(1); expect(ok.filter((s) => s === 'already')).toHaveLength(5);
    expect(await inv.at('ann', 'factory:ann')).toEqual([{ type: 'food', id: 'crop_wheat', qty: 7 }, { type: 'good', id: 'gear', qty: 3 }, { type: 'ore', id: 'iron', qty: 50 }]);
    expect(await inv.at('bob', 'factory:bob')).toEqual([{ type: 'bar', id: 'gold', qty: 2 }, { type: 'fillet', id: 'white', qty: 3 }]);
    expect((await pool.query('SELECT fish_id, loc_id FROM inv_fish_loc ORDER BY 1')).rows).toEqual([{ fish_id: 'f1', loc_id: 'factory:ann' }, { fish_id: 'f2', loc_id: 'factory:ann' }, { fish_id: 'f3', loc_id: 'factory:bob' }]);
    expect((await pool.query("SELECT report FROM inv_migrations")).rows[0].report).toMatchObject({ holders: 2, units: 65, fish: 3 });
    // Legacy rows untouched (not deleted); re-run is a no-op.
    expect((await pool.query('SELECT sum(qty)::int AS s FROM mine_items')).rows[0].s).toBe(62);
    expect((await inv.migrateLegacyToFactory({ confirmedBy: 'again' })).status).toBe('already');
    expect(await inv.qty('ann', 'factory:ann', { type: 'ore', id: 'iron' })).toBe(50);
  });
}, 60000);

it.skipIf(!url)('legacy migration fails closed when a holder has no factory (nothing written)', async () => {
  await withDb(async (pool, c) => {
    await seed(pool); await pool.query("INSERT INTO fish_catches VALUES ('f9','cat','Cat','pike',1,1,1,NULL)");
    const inv = new Inventory(pool, () => c.now);
    await expect(inv.migrateLegacyToFactory({ confirmedBy: 't' })).rejects.toThrow(/held: 1 holder.*cat\(0\)/);
    expect((await pool.query('SELECT count(*)::int AS n FROM inv_stock')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM inv_fish_loc')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM inv_migrations')).rows[0].n).toBe(0);
  });
}, 60000);

it.skipIf(!url)('truck legs: atomic debit+dispatch, arrival-only credit exactly once, capacity, busy truck, ownership, sell gate, restart, races', async () => {
  await withDb(async (pool, c) => {
    const inv = new Inventory(pool, () => c.now);
    const iron = { type: 'ore', id: 'iron' }; const T = (id: string, cap = 100) => ({ id, cap, travelMs: 60_000 });
    await inv.produce('ann', 'mine:city', [[iron, 150]]);
    await inv.produce('ann', 'farm:ann-f3', [[{ type: 'crop', id: 'wheat' }, 20]]);
    expect(canSellAt('mine:city')).toBe(false); expect(canSellAt(WAREHOUSE_LOC)).toBe(true);
    // ownership / validation
    await expect(inv.dispatch('ann', { from: 'farm:bob-f1', to: 'factory:ann', type: 'crop', id: 'wheat', qty: 1, truck: T('t1') }, own)).rejects.toThrow('your own places');
    await expect(inv.dispatch('ann', { from: 'mine:city', to: 'factory:bob', type: 'ore', id: 'iron', qty: 1, truck: T('t1') }, own)).rejects.toThrow('your own places');
    await expect(inv.dispatch('ann', { from: 'mine:city', to: 'mine:city', type: 'ore', id: 'iron', qty: 1, truck: T('t1') }, own)).rejects.toThrow('different');
    await expect(inv.dispatch('ann', { from: 'bogus', to: 'factory:ann', type: 'ore', id: 'iron', qty: 1, truck: T('t1') }, own)).rejects.toThrow('Unknown location');
    await expect(inv.dispatch('ann', { from: 'mine:city', to: 'factory:ann', type: 'ore', id: 'iron', qty: 101, truck: T('t1') }, own)).rejects.toThrow('at most 100');
    await expect(inv.dispatch('ann', { from: 'mine:city', to: 'factory:ann', type: 'ore', id: 'iron', qty: 0, truck: T('t1') }, own)).rejects.toThrow('quantity');
    // race: same truck dispatched 10x concurrently -> exactly one load, one debit
    const r = await Promise.allSettled(Array.from({ length: 10 }, () => inv.dispatch('ann', { from: 'mine:city', to: 'factory:ann', type: 'ore', id: 'iron', qty: 100, truck: T('t1') }, own)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await inv.qty('ann', 'mine:city', iron)).toBe(50);
    // race: two trucks over-draw the remaining 50 -> one wins, never negative
    const r2 = await Promise.allSettled([inv.dispatch('ann', { from: 'mine:city', to: WAREHOUSE_LOC, type: 'ore', id: 'iron', qty: 40, truck: T('t2') }, own), inv.dispatch('ann', { from: 'mine:city', to: WAREHOUSE_LOC, type: 'ore', id: 'iron', qty: 40, truck: T('t3') }, own)]);
    expect(r2.filter((x) => x.status === 'fulfilled')).toHaveLength(1); expect(await inv.qty('ann', 'mine:city', iron)).toBe(10);
    // not usable before arrival
    expect(await inv.qty('ann', 'factory:ann', iron)).toBe(0); expect(await inv.arrive()).toBe(0);
    c.now += 59_999; expect(await inv.arrive()).toBe(0);
    // restart (new instance) + concurrent arrival from 5 instances -> credited exactly once
    c.now += 1; const inst = Array.from({ length: 5 }, () => new Inventory(pool, () => c.now));
    const n = await Promise.all(inst.map((x) => x.arrive())); expect(n.reduce((a, b) => a + b, 0)).toBe(2);
    expect(await inv.qty('ann', 'factory:ann', iron)).toBe(100); expect(await inv.qty('ann', WAREHOUSE_LOC, iron)).toBe(40);
    expect(await inv.arrive()).toBe(0);
    // truck free again after arrival; sell only from warehouse
    await inv.dispatch('ann', { from: 'factory:ann', to: WAREHOUSE_LOC, type: 'ore', id: 'iron', qty: 100, truck: T('t1') }, own);
    const cl = await pool.connect();
    try { await cl.query('BEGIN'); await expect(Inventory.takeForSale(cl, 'ann', 'factory:ann', iron, 1)).rejects.toThrow('only sell at the Chud City Warehouse'); await cl.query('ROLLBACK');
      await cl.query('BEGIN'); await Inventory.takeForSale(cl, 'ann', WAREHOUSE_LOC, iron, 40); await cl.query('COMMIT'); } finally { cl.release(); }
    expect(await inv.qty('ann', WAREHOUSE_LOC, iron)).toBe(0);
    // conservation across everything: produced 150 iron = mine 10 + factory 0 + warehouse 0 + sold 40 + in flight 100
    const flight = Number((await pool.query("SELECT coalesce(sum(qty),0)::int AS q FROM inv_loads WHERE status='moving' AND item_id='iron'")).rows[0].q);
    expect(10 + (await inv.qty('ann', 'factory:ann', iron)) + (await inv.qty('ann', WAREHOUSE_LOC, iron)) + 40 + flight).toBe(150);
    await expect(pool.query("UPDATE inv_stock SET qty = -1 WHERE player_key='ann' AND loc_id='mine:city'")).rejects.toThrow();
  });
}, 60000);
