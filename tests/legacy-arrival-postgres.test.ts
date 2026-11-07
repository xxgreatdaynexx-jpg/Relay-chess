/** Real PostgreSQL: arriveLegacy is exactly-once across retry, concurrent attempts (two instances), savePack and restart. */
import { afterAll, expect, it } from 'vitest';
import pg from 'pg';
import { foldToMapPools, FOLD_PREP } from '../server/mapPools.js';
import { LocStore, setLocStore } from '../server/locstock.js';
import { LocMoves } from '../server/locmoves.js';
import { PgMineStore, resetMines } from '../server/mines.js';
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = [];
afterAll(async () => { for (const d of drops) await d(); });
it.skipIf(!url)('legacy arrival credits once (retry, concurrent, flush, restart)', async () => {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
  const name = `la_${process.pid}_${Date.now()}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
  u.pathname = `/${name}`; const pool = new pg.Pool({ connectionString: u.toString(), max: 6 });
  drops.push(async () => { await pool.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); });
  await pool.query(FOLD_PREP); await new PgMineStore(pool).init();
  await pool.query("INSERT INTO freight_shipments(id,player_key,name,to_key,to_name,mode,from_hub,to_hub,item_type,item_id,qty,fee,created_at,depart_at,arrive_at,status,from_loc,to_loc) VALUES('L1','a','A','a','A','hired','city','city','ore','iron',4,10,1,1,2,'transit',NULL,NULL),('L2','a','A','a','A','hired','city','city','ore','copper',5,10,1,1,2,'transit',NULL,NULL)");
  await pool.query("INSERT INTO mine_factories(player_key,owner_name,level,built_at) VALUES('a','A',1,1)");
  await foldToMapPools(pool, []);
  const boot = async () => { const w = resetMines(); await w.attach(new PgMineStore(pool)); const ls = new LocStore(pool as never); setLocStore(ls); await ls.init(); const lm = new LocMoves(); (lm as unknown as { fishPool: () => pg.Pool }).fishPool = () => pool; return { w, lm }; };
  let { w, lm } = await boot();
  const L1 = { id: 'L1', toName: 'A', ownerName: 'A', type: 'ore', itemId: 'iron', qty: 4 } as never;
  await lm.arriveLegacy(L1); await lm.arriveLegacy(L1);
  const L2 = { id: 'L2', toName: 'A', ownerName: 'A', type: 'ore', itemId: 'copper', qty: 5 } as never;
  await Promise.allSettled([lm.arriveLegacy(L2), lm.arriveLegacy(L2)]); // both pass the pre-check: only one may land
  expect(w.stackQty('A', 'ore', 'iron')).toBe(4); expect(w.stackQty('A', 'ore', 'copper')).toBe(5);
  await w.savePack('A', []);
  const q = async (id: string) => (await pool.query('SELECT COALESCE(SUM(qty),0)::int q FROM mine_items WHERE item_id=$1', [id])).rows[0].q;
  expect(await q('iron')).toBe(4); expect(await q('copper')).toBe(5);
  ({ w, lm } = await boot()); await lm.arriveLegacy(L1);
  expect(w.stackQty('A', 'ore', 'iron')).toBe(4); expect(await q('iron')).toBe(4);
  expect((await pool.query('SELECT count(*)::int c FROM freight_arrivals')).rows[0].c).toBe(2);
}, 30_000);
