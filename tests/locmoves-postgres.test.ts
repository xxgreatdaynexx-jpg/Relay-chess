/**
 * Real PostgreSQL: map pools (one inventory per owner per map) + plane/ship cross-map legs. Every step runs in a separate process (a fresh server instance)
 * against one disposable local database, so restarts and two concurrent instances are real. Local DB only.
 * MAYOR_LAWS_TEST_DATABASE_URL=postgres://...@127.0.0.1/postgres
 */
import { expect, it } from 'vitest';
import pg from 'pg';
import { dropDrainedTestDatabase } from './fixtures/drain-postgres-db';
import { FOLD_PREP } from '../server/mapPools.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const A = 'QA-LmA', B = 'QA-LmB', C = 'QA-LmC';
const RESORT_HOME = 'r:beachhouse:1', CITY_HOME = 'b:house:-691:-188';

it.skipIf(!url)('real PostgreSQL: production boot (fence -> boundary -> fold -> stores -> no legacy re-migration), one city store (sell without moving), plane/ship only cross-map, atomic dispatch, exactly-once arrival across restart + 2 instances', async () => {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Only a disposable local test DB is allowed.');
  const dbName = `lm_test_${process.pid}_${Date.now()}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${dbName}`);
  const dbu = new URL(url!); dbu.pathname = `/${dbName}`; const DB = dbu.toString(); const db = new pg.Pool({ connectionString: DB }); db.on('error', () => {});
  const step = async (name: string, arg: unknown = {}, offset = 0) => {
    const { stdout } = await run('npx', ['tsx', 'tests/fixtures/locmoves-pg-step.ts', name, JSON.stringify(arg)], { env: { ...process.env, DATABASE_URL: DB, NODE_ENV: 'test', LM_CLOCK_OFFSET: String(offset) }, maxBuffer: 1 << 24 });
    const line = stdout.split('\n').find((l) => l.startsWith('RESULT ')); if (!line) throw new Error(`step ${name}: no result\n${stdout}`); return JSON.parse(line.slice(7));
  };
  const q = async (sql: string, a: unknown[] = []) => (await db.query(sql, a)).rows;
  const ok = (r: { res: Array<{ ok: boolean; error?: string }> }) => r.res.map((x) => x.ok || x.error);
  try {
    // ---- the live cdcea58 shape (per-location, legacy->factory already migrated), written by the old server
    await q(FOLD_PREP);
    await q(`INSERT INTO loc_stock VALUES ('qa-lma',$1,'warehouse','ore:copper',20),('qa-lma',$1,'mine:frost','ore:iron',2),('qa-lma',$1,'factory','crop:wheat',3)`, [A]);
    await q("INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ('qa-lma',$1,'ore','copper',300)", [A]);
    await q(`INSERT INTO fish_catches (id,player_key,name,species,weight_g,value,caught_at,loc) VALUES ('fa1','qa-lma',$1,'bass',900,40,1,'factory'),('fa2','qa-lma',$1,'trout',500,20,1,'fishing:lake'),('fb1','qa-lmb',$2,'bass',700,30,1,NULL)`, [A, B]);
    await q("INSERT INTO kitchen_fillets VALUES ('qa-lmb','fish',2)");
    await q("INSERT INTO kitchen_dishes (id,player_key,name,recipe,quality,value,cooked_at,loc) VALUES ('da1','qa-lma',$1,'pancakes',0.9,55,1,$2)", [A, `kitchen:${CITY_HOME}`]);
    // ---- the new server boots: fence, irreversible boundary, fold (one transaction), then every store loads
    expect(await step('boot')).toEqual({ ok: true });
    expect(await q("SELECT item_type, item_id, qty FROM mine_items WHERE player_key='qa-lma' ORDER BY 1,2")).toEqual([{ item_type: 'ore', item_id: 'copper', qty: 320 }, { item_type: 'ore', item_id: 'iron', qty: 2 }]);
    expect(await q("SELECT loc, item, qty::int FROM loc_stock WHERE qty > 0 ORDER BY 1,2")).toEqual([{ loc: 'warehouse', item: 'crop:wheat', qty: 3 }]);
    expect(await q("SELECT id, loc, weight_g FROM fish_catches ORDER BY 1")).toEqual([{ id: 'fa1', loc: 'warehouse', weight_g: 900 }, { id: 'fa2', loc: 'warehouse', weight_g: 500 }, { id: 'fb1', loc: null, weight_g: 700 }]);
    expect(await q("SELECT loc FROM kitchen_dishes")).toEqual([{ loc: 'warehouse' }]);
    // the old writer is refused, and can not take the fence back
    await expect(q("INSERT INTO loc_stock VALUES ('qa-lma',$1,'mine:frost','ore:iron',1)", [A])).rejects.toThrow(/inventory fenced/);
    await expect(q("UPDATE inv_fence SET holder = 'chud-inv-0ld', mode = 'fenced', epoch = epoch + 1")).rejects.toThrow(/map-pool shape/);
    // a reboot changes nothing (no legacy re-migration: held B fish + fillets stay held, no map guessed)
    await step('boot');
    expect(await q("SELECT loc FROM fish_catches WHERE id = 'fb1'")).toEqual([{ loc: null }]); expect(await q('SELECT qty FROM kitchen_fillets')).toEqual([{ qty: 2 }]);
    expect(await q("SELECT item_id, qty FROM mine_items WHERE player_key='qa-lma' AND item_id = 'copper'")).toEqual([{ item_id: 'copper', qty: 320 }]);
    // ---- one city inventory: My places shows the factory's store AS the Chud City Warehouse; only map warehouses are destinations
    const f = await step('fund', { names: [A, C], amt: 100_000 }); const c0 = f[A].chips;
    const v = await step('view', { name: A });
    const wh = v.locations.find((l: { id: string }) => l.id === 'warehouse');
    expect(Object.fromEntries(wh.items.map((x: { item: string; qty: number }) => [x.item, x.qty]))).toMatchObject({ 'ore:copper': 320, 'ore:iron': 2, 'crop:wheat': 3, 'fish:bass': 1, 'fish:trout': 1, 'dish:pancakes': 1 });
    expect(v.locations.filter((l: { dest: boolean }) => l.dest).map((l: { id: string }) => l.id).sort()).toEqual(['resort', 'warehouse']);
    expect(v.locations.some((l: { id: string }) => l.id === 'factory')).toBe(false);
    // ---- sell straight from the city store: no move first
    expect((await step('sell', { name: A, item: 'ore:copper', qty: 20 })).ok).toBe(true);
    expect(await q("SELECT qty FROM mine_items WHERE player_key='qa-lma' AND item_id='copper'")).toEqual([{ qty: 300 }]);
    // ---- same-map / factory moves have nothing to do; trucks never cross maps; ship / plane do
    const pre = (await step('snap', { names: [A] }))[A].chips;
    const deny = await step('move', { names: [A], moves: [
      { name: A, from: 'factory', to: 'warehouse', item: 'ore:copper', qty: 5, mode: 'hired' },
      { name: A, from: 'warehouse', to: 'factory', item: 'ore:copper', qty: 5, mode: 'hired' },
      { name: A, from: 'warehouse', to: 'resort', item: 'ore:copper', qty: 5, mode: 'truck' },
      { name: A, from: 'warehouse', to: `kitchen:${RESORT_HOME}`, item: 'ore:copper', qty: 5, mode: 'ship' }] });
    expect(deny.res.map((r: { ok: boolean }) => r.ok)).toEqual([false, false, false, false]); expect(deny.snap[A].chips).toBe(pre); void c0; // refused: nothing charged
    const mv = await step('move', { names: [A], moves: [
      { name: A, from: 'warehouse', to: 'resort', item: 'ore:copper', qty: 100, mode: 'ship' },
      { name: A, from: 'warehouse', to: 'resort', item: 'fish:trout', qty: 1, mode: 'plane' }] });
    expect(ok(mv)).toEqual([true, true]);
    // concurrent dispatch of the same stock: 200 left, two 150 legs at once -> exactly one
    const race = await step('move', { names: [A], moves: [
      { name: A, from: 'warehouse', to: 'resort', item: 'ore:copper', qty: 150, mode: 'ship' },
      { name: A, from: 'warehouse', to: 'resort', item: 'ore:copper', qty: 150, mode: 'ship' }] });
    expect(race.res.filter((r: { ok: boolean }) => r.ok)).toHaveLength(1);
    expect(await q("SELECT qty FROM mine_items WHERE player_key='qa-lma' AND item_id='copper'")).toEqual([{ qty: 50 }]);
    expect(await q("SELECT count(*)::int n FROM freight_shipments WHERE status='moving' AND kind='loc'")).toEqual([{ n: 3 }]);
    expect((await step('sell', { name: A, from: 'resort', item: 'ore:copper', qty: 1 })).ok).toBe(false); // nothing landed yet
    // ---- restart + two instances tick at once after arrival time: credited exactly once
    const late = 30 * 3_600_000; const [t1, t2] = await Promise.all([step('tick', { names: [A] }, late), step('tick', { names: [A] }, late)]);
    const live = [t1, t2].filter((t) => !t.bootError); expect(live.length).toBeGreaterThanOrEqual(1);
    expect(await q("SELECT loc, item, qty::int AS qty FROM loc_stock WHERE player_key='qa-lma' AND qty > 0 ORDER BY 1,2")).toEqual([{ loc: 'resort', item: 'ore:copper', qty: 250 }, { loc: 'warehouse', item: 'crop:wheat', qty: 3 }]);
    expect(await q("SELECT id, loc, weight_g FROM fish_catches WHERE player_key='qa-lma' ORDER BY id")).toEqual([{ id: 'fa1', loc: 'warehouse', weight_g: 900 }, { id: 'fa2', loc: 'resort', weight_g: 500 }]);
    expect(await q("SELECT status, count(*)::int n FROM freight_shipments GROUP BY 1")).toEqual([{ status: 'delivered', n: 3 }]);
    await step('tick', { names: [A] }, late); // a third boot credits nothing more
    expect(await q("SELECT qty::int AS qty FROM loc_stock WHERE player_key='qa-lma' AND loc='resort'")).toEqual([{ qty: 250 }]);
    // ---- sales from either map's warehouse, food identity kept
    expect((await step('sell', { name: A, from: 'resort', item: 'ore:copper', qty: 50 })).ok).toBe(true);
    expect(await q("SELECT qty::int AS qty FROM loc_stock WHERE player_key='qa-lma' AND loc='resort'")).toEqual([{ qty: 200 }]);
    expect((await step('sell', { name: A, item: 'fish:bass', qty: 1 })).ok).toBe(true);
    expect((await step('sell', { name: A, item: 'dish:pancakes', qty: 1 })).ok).toBe(true);
    expect((await step('sell', { name: A, item: 'fish:trout', qty: 1 })).ok).toBe(false); // it is at the resort now
    expect(await step('sell', { name: A, from: 'resort', item: 'fish:trout', qty: 1 })).toMatchObject({ ok: true });
    expect((await step('sell', { name: A, from: 'factory', item: 'ore:copper', qty: 1 })).ok).toBe(false); // no second city store
  } finally { await dropDrainedTestDatabase(root, db, dbName); }
}, 300_000);
