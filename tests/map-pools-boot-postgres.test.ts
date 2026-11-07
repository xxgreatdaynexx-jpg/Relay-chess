/**
 * Real PostgreSQL (disposable local DBs on MAYOR_LAWS_TEST_DATABASE_URL): the map-pool fold at boot.
 *  - two real OS processes race the fold: exactly one folds, the other sees the marker, data conserved once;
 *  - a deliberately lost COMMIT reply: the fold committed, the caller saw an error; the re-run (next boot) is a no-op;
 *  - the irreversible compatibility boundary: after the fold a boot failure does NOT hand the fence back to the old
 *    (cdcea58) writer, the old writer's writes are refused, and an old server cannot take the fence on boot;
 *  - boot order: fold -> stores load (the city pool shows the banked store) -> legacy migration skipped (held stays held).
 */
import { afterAll, expect, it } from 'vitest';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { foldToMapPools, FOLD_PREP } from '../server/mapPools.js';
import { FENCE_SQL, initInventoryFence, markMapPools, releaseIfPreReady, markReady, closeFence } from '../server/invFence.js';
import { LocStore, setLocStore } from '../server/locstock.js';
import { PgMineStore, resetMines } from '../server/mines.js';
import { poolsFolded } from '../server/locmoves.js';
const run = promisify(execFile);
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = [];
afterAll(async () => { for (const d of drops) await d(); });
async function freshDb(tag: string) {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
  const name = `mpb_${tag}_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
  u.pathname = `/${name}`; const dbUrl = u.toString(); const pools: pg.Pool[] = [];
  const pool = (o: pg.PoolConfig = {}) => { const p = new pg.Pool({ connectionString: dbUrl, max: 3, ...o }); p.on('error', () => {}); pools.push(p); return p; };
  drops.push(async () => { for (const p of pools) await p.end().catch(() => {}); await root.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await root.end(); });
  return { dbUrl, pool };
}
const seed = async (db: pg.Pool) => {
  await db.query(FOLD_PREP);
  await db.query(`INSERT INTO loc_stock VALUES ('a','A','warehouse','ore:iron',5),('a','A','mine:frost','ore:iron',2),('a','A','factory','crop:wheat',1),('a','A','farm:rf:2','crop:mango',4)`);
  await db.query("INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ('a','A','ore','iron',10)");
  await db.query("INSERT INTO fish_catches (id,player_key,name,species,weight_g,value,caught_at,loc) VALUES ('f1','a','A','bass',900,40,1,'factory'),('f4','c','C','bass',100,5,1,NULL)");
  await db.query("INSERT INTO kitchen_fillets VALUES ('c','fish',2)");
  await db.query("INSERT INTO building_inv VALUES ('c','C','resort_farm','crop:mango',5)");
};
const state = async (db: pg.Pool) => ({
  items: (await db.query('SELECT player_key k, item_type t, item_id i, qty FROM mine_items ORDER BY 1,2,3')).rows,
  stock: (await db.query('SELECT player_key k, loc, item, qty::int FROM loc_stock WHERE qty > 0 ORDER BY 1,2,3')).rows,
  fish: (await db.query('SELECT id, loc FROM fish_catches ORDER BY 1')).rows,
  held: [(await db.query('SELECT qty FROM kitchen_fillets')).rows, (await db.query("SELECT qty::int FROM building_inv WHERE building = 'resort_farm'")).rows],
  markers: (await db.query('SELECT id FROM loc_migrations ORDER BY 1')).rows.map((r) => r.id),
});
const FOLDED = {
  items: [{ k: 'a', t: 'ore', i: 'iron', qty: 17 }],
  stock: [{ k: 'a', loc: 'resort', item: 'crop:mango', qty: 4 }, { k: 'a', loc: 'warehouse', item: 'crop:wheat', qty: 1 }],
  fish: [{ id: 'f1', loc: 'warehouse' }, { id: 'f4', loc: null }],
  held: [[{ qty: 2 }], [{ qty: 5 }]], markers: ['map-pools-v1'],
};

it.skipIf(!url)('two OS processes race the fold: exactly one folds, the other sees the marker; conserved once', async () => {
  const { dbUrl, pool } = await freshDb('race'); const db = pool(); await seed(db);
  const proc = () => run('npx', ['tsx', 'tests/helpers/foldProc.mts', dbUrl], { env: { ...process.env, PGAPPNAME: '' } }).then((o) => JSON.parse(o.stdout.trim().split('\n').at(-1)!));
  const [a, b] = await Promise.all([proc(), proc()]);
  expect(a.pid).not.toBe(b.pid);
  expect([a.already, b.already].sort()).toEqual([false, true]); expect(a.conserved && b.conserved).toBe(true);
  expect(await state(db)).toEqual(FOLDED);
}, 60_000);

it.skipIf(!url)('lost COMMIT reply: the fold committed, the caller saw an error; the next boot is a no-op (nothing doubled)', async () => {
  const { pool } = await freshDb('ack'); const db = pool(); await seed(db);
  const lossy = { connect: async () => { const c = await db.connect(); return { release: () => c.release(), query: async (s: string, a?: unknown[]) => {
    const r = await c.query(s, a as never); if (s === 'COMMIT') throw new Error('Connection terminated unexpectedly'); return r; } }; } };
  await expect(foldToMapPools(lossy as never, ['r:beachhouse:1'])).rejects.toThrow(/terminated/);
  expect(await state(db)).toEqual(FOLDED); // it DID commit
  const again = await foldToMapPools(db, ['r:beachhouse:1']); expect(again.already).toBe(true);
  expect(await state(db)).toEqual(FOLDED);
}, 30_000);

it.skipIf(!url)('compatibility boundary: after the fold a boot failure keeps the fence; the old writer and an old boot are refused', async () => {
  const { dbUrl, pool } = await freshDb('fence'); const old = pool({ application_name: 'chud-inv-0ld-cdcea58' });
  await seed(old); await old.query(FENCE_SQL);
  await old.query("INSERT INTO inv_fence (id, holder, mode, epoch, at, migrated) VALUES (1, 'chud-inv-0ld-cdcea58', 'fenced', 1, 0, true)");
  await old.query("CREATE TRIGGER inv_fence_loc_stock BEFORE INSERT OR UPDATE OR DELETE ON loc_stock FOR EACH STATEMENT EXECUTE FUNCTION inv_fence_check()");
  try {
    await initInventoryFence(dbUrl);
    await markMapPools(); // the boundary, BEFORE the fold
    const cur = pool(); expect((await foldToMapPools(cur, ['r:beachhouse:1'])).conserved).toBe(true);
    expect(await releaseIfPreReady('test: boot failed after the fold')).toBe('kept'); // NOT handed back to cdcea58
    await expect(old.query("INSERT INTO loc_stock VALUES ('a','A','mine:frost','ore:iron',1)")).rejects.toThrow(/fenced/);
    // an old server booting now (its newest-wins fence take) is refused: it can not resurrect the per-location shape
    await expect(old.query("UPDATE inv_fence SET prev_holder = holder, prev_mode = mode, holder = 'chud-inv-0ld-cdcea58', mode = 'fenced', epoch = epoch + 1 WHERE id = 1")).rejects.toThrow(/map-pool shape/);
    await expect(old.query("UPDATE inv_fence SET mode = 'open' WHERE id = 1")).rejects.toThrow(/map-pool shape/);
    await expect(old.query("UPDATE inv_fence SET pools = false WHERE id = 1")).rejects.toThrow(/cannot be undone/);
    expect((await old.query("SELECT count(*)::int n FROM loc_stock WHERE loc = 'mine:frost'")).rows[0].n).toBe(0);
    // a newer map-pool server can still take over (forward recovery)
    await expect(old.query("UPDATE inv_fence SET holder = 'chud-inv-mp-next', epoch = epoch + 1 WHERE id = 1")).resolves.toBeTruthy();
  } finally { markReady(); await closeFence(); }
}, 60_000);

it.skipIf(!url)('boot order: fold -> stores load (city pool = banked store) -> legacy migration skipped, held entries stay held', async () => {
  const { pool } = await freshDb('boot'); const db = pool(); await seed(db);
  await foldToMapPools(db, ['r:beachhouse:1']);
  const w = resetMines(); await w.attach(new PgMineStore(db as never));
  const ls = new LocStore(db as never); await ls.init(); setLocStore(ls);
  expect(ls.at('A', 'warehouse').sort((x, y) => x.item.localeCompare(y.item))).toEqual([{ item: 'crop:wheat', qty: 1 }, { item: 'ore:iron', qty: 17 }]);
  expect(ls.qty('A', 'factory', 'ore:iron')).toBe(0); // no second city store
  expect(await poolsFolded()).toBe(true); // initLocMoves therefore never runs migrateLegacy again
  // a sale-shaped debit of the city pool goes through the banked store, in its transaction, once
  await ls.adjust('A', [{ loc: 'warehouse', item: 'ore:iron', delta: -7 }]); await w.flush();
  expect((await db.query("SELECT qty FROM mine_items WHERE player_key = 'a' AND item_id = 'iron'")).rows[0].qty).toBe(10);
  expect((await db.query("SELECT count(*)::int n FROM loc_stock WHERE loc = 'warehouse' AND item LIKE 'ore:%'")).rows[0].n).toBe(0);
  const s = await state(db); expect(s.held).toEqual(FOLDED.held); expect(s.fish).toEqual(FOLDED.fish);
}, 30_000);

it.skipIf(!url)('farm: a lost COMMIT reply on a paid seed purchase is reconciled by the ledger (no false "nothing charged", memory = DB)', async () => {
  const { CasinoBank, PgCasinoStore } = await import('../server/casino-store.js');
  const { Farm } = await import('../server/farm.js'); const { RealEstate } = await import('../server/realEstate.js'); const { farmPlots } = await import('../shared/farm.js');
  const { pool } = await freshDb('farmack'); const db = pool(); let armed = false;
  const wrap = { query: (...a: unknown[]) => (db.query as (...x: unknown[]) => unknown)(...a), connect: async () => { const c = await db.connect(); return { release: () => c.release(), query: async (q: string, a?: unknown[]) => {
    const r = await c.query(q, a as never); if (armed && q === 'COMMIT') { armed = false; throw new Error('Connection terminated unexpectedly'); } return r; } }; } };
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(db as never));
  const now = () => Date.parse('2026-11-01T12:00:00Z'); const re = new RealEstate(db as never, () => bank, now); await re.init();
  const f = new Farm(wrap as never, () => bank, now); await f.init();
  bank.transfer('QA-Ack', 10_000, { game: 'admin' }); await bank.flush();
  const pid = `f:${farmPlots()[0]!.n}`; await db.query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ($1,$2,$3,1,1)', [pid, 'qa-ack', 'QA-Ack']);
  const before = Number((await db.query("SELECT chips FROM casino_players WHERE player_key = 'qa-ack'")).rows[0].chips);
  armed = true; await f.plant('QA-Ack', pid, 'wheat', [0]); // committed: reported as done, not "nothing charged"
  await bank.flush();
  const dbChips = Number((await db.query("SELECT chips FROM casino_players WHERE player_key = 'qa-ack'")).rows[0].chips);
  expect(dbChips).toBeLessThan(before); expect(bank.account('QA-Ack').chips).toBe(dbChips);
  expect((await db.query('SELECT count(*)::int n FROM farm_tiles')).rows[0].n).toBe(1);
  expect((await db.query("SELECT count(*)::int n FROM wallet_transactions WHERE game = 'farm_seed'")).rows[0].n).toBe(1);
}, 30_000);
