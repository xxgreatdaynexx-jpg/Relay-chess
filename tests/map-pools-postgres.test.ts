/**
 * Real PostgreSQL (disposable local DB): fold per-location stock into one pool per owner per map (t1942u/t1945u).
 * MAYOR_LAWS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55482/postgres
 */
import { expect, it } from 'vitest';
import pg from 'pg';
import { foldToMapPools, FOLD_ID, FOLD_PREP } from '../server/mapPools.js';
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const RESORT_HOME = 'r:beachhouse:1', CITY_HOME = 'b:house:-691:-188';

it.skipIf(!url)('fold: conserved, identity-preserving, idempotent, atomic on failure, serialised across processes, freight re-pointed, held legacy untouched', async () => {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
  const dbName = `mp_test_${process.pid}_${Date.now()}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${dbName}`);
  const dbu = new URL(url!); dbu.pathname = `/${dbName}`; const db = new pg.Pool({ connectionString: dbu.toString(), max: 6 });
  const q = async (s: string, a: unknown[] = []) => (await db.query(s, a)).rows;
  try {
    await q(FOLD_PREP);
    await q(`INSERT INTO loc_stock VALUES
      ('a','A','warehouse','ore:iron',5),('a','A','mine:frost','ore:iron',2),('a','A','farm:cf:3','crop:wheat',7),('a','A','factory','crop:wheat',1),
      ('a','A','farm:rf:2','crop:mango',4),('a','A','kitchen:${RESORT_HOME}','food:flour',3),('a','A','kitchen:${CITY_HOME}','food:flour',6),
      ('b','B','warehouse','good:gear',9),('b','B','mystery:x','ore:iron',1)`);
    await q("INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ('a','A','ore','iron',10)");
    await q("INSERT INTO building_inv VALUES ('a','A','coral','gem:pearl',2),('c','C','resort_farm','crop:mango',5)");
    await q(`INSERT INTO fish_catches (id,player_key,name,species,weight_g,value,caught_at,loc) VALUES
      ('f1','a','A','bass',900,40,1,'fishing:lake'),('f2','a','A','tuna',5000,300,1,'fishing:deep'),('f3','a','A','bass',700,30,1,'warehouse'),('f4','c','C','bass',100,5,1,NULL)`);
    await q(`INSERT INTO kitchen_dishes (id,player_key,name,recipe,quality,value,cooked_at,loc) VALUES ('d1','a','A','pancakes',0.9,55,1,'kitchen:${RESORT_HOME}'),('d2','c','C','pancakes',0.5,20,1,NULL)`);
    await q("INSERT INTO kitchen_fillets VALUES ('c','fish',2)");
    await q(`INSERT INTO freight_shipments (id,player_key,name,to_key,to_name,mode,from_hub,to_hub,item_type,item_id,qty,fee,created_at,depart_at,arrive_at,status,from_loc,to_loc) VALUES
      ('s1','a','A','a','A','ship','city','resort','ore','iron',3,0,1,1,9,'transit','warehouse','kitchen:${RESORT_HOME}'),
      ('s2','a','A','a','A','truck','city','city','crop','wheat',2,0,1,1,9,'transit','farm:cf:3','warehouse'),
      ('s3','a','A','a','A','ship','city','resort','ore','iron',1,0,1,1,9,'delivered','warehouse','farm:rf:2'),
      ('s4','a','A','a','A','plane','city','resort','fish','bass',1,0,1,1,9,'moving','fishing:lake','fishing:reef')`);
    await q("INSERT INTO fish_catches (id,player_key,name,species,weight_g,value,caught_at,loc) VALUES ('f5','a','A','bass',800,35,1,'transit:s4')");

    // atomic: a failure before COMMIT changes nothing
    const snap = async () => JSON.stringify([await q('SELECT * FROM loc_stock ORDER BY 1,3,4'), await q('SELECT player_key,item_type,item_id,qty FROM mine_items ORDER BY 1,2,3'), await q('SELECT id,loc FROM fish_catches ORDER BY 1'), await q('SELECT id,to_loc FROM freight_shipments ORDER BY 1')]);
    const s0 = await snap();
    await expect(foldToMapPools(db, [RESORT_HOME], { failAt: 'afterMove' })).rejects.toThrow(/before COMMIT/);
    expect(await snap()).toBe(s0);
    expect(await q('SELECT 1 FROM loc_migrations WHERE id = $1', [FOLD_ID])).toHaveLength(0);

    // two processes race: exactly one folds, the other sees the marker
    const db2 = new pg.Pool({ connectionString: dbu.toString(), max: 2 });
    const [r1, r2] = await Promise.all([foldToMapPools(db, [RESORT_HOME]), foldToMapPools(db2, [RESORT_HOME])]); await db2.end();
    const r = r1.already ? r2 : r1; expect([r1.already, r2.already].sort()).toEqual([false, true]);
    expect(r).toMatchObject({ conserved: true, fish: 2, dishes: 1, coral: 2, freightRepointed: 2 });
    expect(r.unknownLocs).toEqual([{ table: 'loc_stock', loc: 'mystery:x', n: 1 }]);
    expect(r.heldLegacy).toEqual({ fishNullLoc: 1, dishNullLoc: 1, fillets: 2, resortBarn: 5 });

    const ls = await q("SELECT player_key k, loc, item, qty::int FROM loc_stock WHERE qty > 0 ORDER BY 1,2,3");
    expect(ls).toEqual([
      { k: 'a', loc: 'resort', item: 'crop:mango', qty: 4 }, { k: 'a', loc: 'resort', item: 'food:flour', qty: 3 }, { k: 'a', loc: 'resort', item: 'gem:pearl', qty: 2 },
      { k: 'a', loc: 'warehouse', item: 'crop:wheat', qty: 8 }, // farm 7 + old factory location 1: one city inventory
      { k: 'b', loc: 'mystery:x', item: 'ore:iron', qty: 1 }, // unknown location: untouched, reported
    ]);
    // the city pool's stackables ARE the banked store (as before Millionaire): warehouse 5 + Frostbite 2 + banked 10
    expect(await q("SELECT player_key k, item_type t, item_id i, qty FROM mine_items ORDER BY 1,2,3")).toEqual([
      { k: 'a', t: 'food', i: 'flour', qty: 6 }, { k: 'a', t: 'ore', i: 'iron', qty: 17 }, { k: 'b', t: 'good', i: 'gear', qty: 9 }]);
    expect(await q('SELECT id, loc, species, weight_g, value FROM fish_catches ORDER BY 1')).toEqual([
      { id: 'f1', loc: 'warehouse', species: 'bass', weight_g: 900, value: 40 }, { id: 'f2', loc: 'resort', species: 'tuna', weight_g: 5000, value: 300 },
      { id: 'f3', loc: 'warehouse', species: 'bass', weight_g: 700, value: 30 }, { id: 'f4', loc: null, species: 'bass', weight_g: 100, value: 5 }, { id: 'f5', loc: 'transit:s4', species: 'bass', weight_g: 800, value: 35 }]);
    expect(await q('SELECT id, loc, quality FROM kitchen_dishes ORDER BY 1')).toEqual([{ id: 'd1', loc: 'resort', quality: 0.9 }, { id: 'd2', loc: null, quality: 0.5 }]);
    expect(await q('SELECT id, status, qty, to_loc FROM freight_shipments ORDER BY 1')).toEqual([
      { id: 's1', status: 'transit', qty: 3, to_loc: 'resort' }, { id: 's2', status: 'transit', qty: 2, to_loc: 'warehouse' }, { id: 's3', status: 'delivered', qty: 1, to_loc: 'farm:rf:2' }, { id: 's4', status: 'moving', qty: 1, to_loc: 'resort' }]);
    expect(await q("SELECT qty::int FROM building_inv WHERE building = 'resort_farm'")).toEqual([{ qty: 5 }]);

    // idempotent re-run / lost-COMMIT replay: no change
    const s1 = await snap(); const again = await foldToMapPools(db, [RESORT_HOME]);
    expect(again.already).toBe(true); expect(await snap()).toBe(s1);
  } finally { await db.end(); await root.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await root.end(); }
}, 60_000);
