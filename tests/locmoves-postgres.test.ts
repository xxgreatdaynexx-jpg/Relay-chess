/**
 * Real PostgreSQL: per-location stock + truck/plane/ship legs. Every step runs in a separate process (a fresh server instance)
 * against one disposable local database, so restarts and two concurrent instances are real. Local DB only.
 * MAYOR_LAWS_TEST_DATABASE_URL=postgres://...@127.0.0.1/postgres
 */
import { expect, it } from 'vitest';
import pg from 'pg';
import { dropDrainedTestDatabase } from './fixtures/drain-postgres-db';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const A = 'QA-LmA', B = 'QA-LmB', C = 'QA-LmC';
const RESORT_HOME = 'r:beachhouse:1', CITY_HOME = 'b:house:-691:-188';

it.skipIf(!url)('real PostgreSQL: legacy->factory migration, atomic dispatch, ownership, same-map trucks, warehouse-only sale, exactly-once arrival across restart + 2 instances', async () => {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Only a disposable local test DB is allowed.');
  const dbName = `lm_test_${process.pid}_${Date.now()}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${dbName}`);
  const dbu = new URL(url!); dbu.pathname = `/${dbName}`; const DB = dbu.toString(); const db = new pg.Pool({ connectionString: DB });
  const step = async (name: string, arg: unknown = {}, offset = 0) => {
    const { stdout } = await run('npx', ['tsx', 'tests/fixtures/locmoves-pg-step.ts', name, JSON.stringify(arg)], { env: { ...process.env, DATABASE_URL: DB, NODE_ENV: 'test', LM_CLOCK_OFFSET: String(offset) }, maxBuffer: 1 << 24 });
    const line = stdout.split('\n').find((l) => l.startsWith('RESULT ')); if (!line) throw new Error(`step ${name}: no result\n${stdout}`); return JSON.parse(line.slice(7));
  };
  const owners = (m: { held: Array<{ owner: string }> }) => [...new Set(m.held.map((h) => h.owner))];
  const q = async (sql: string, a: unknown[] = []) => (await db.query(sql, a)).rows;
  try {
    await step('boot');
    // the old (14bad00-style) server keeps writing until cutover: the operator rollback switch opens the fence for it
    await q("UPDATE inv_fence SET mode = 'open'");
    // ---- legacy stock: A and C own a factory, B does not (held, untouched)
    await q("INSERT INTO mine_factories VALUES ('qa-lma',$1,1,0),('qa-lmc',$2,1,0)", [A, C]);
    await q("INSERT INTO fish_catches (id,player_key,name,species,weight_g,value,caught_at) VALUES ('fa1','qa-lma',$1,'bass',900,40,1),('fa2','qa-lma',$1,'trout',500,20,1),('fb1','qa-lmb',$2,'bass',700,30,1)", [A, B]);
    await q("INSERT INTO kitchen_fillets VALUES ('qa-lma','fish',3),('qa-lmb','fish',2)");
    await q("INSERT INTO kitchen_dishes (id,player_key,name,recipe,quality,value,cooked_at) VALUES ('da1','qa-lma',$1,'pancakes',0.9,55,1)", [A]);
    await q("CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_name TEXT NOT NULL, price BIGINT NOT NULL, bought_at BIGINT NOT NULL, arrears INT NOT NULL DEFAULT 0, tax_paid BIGINT NOT NULL DEFAULT 0, deed TEXT)");
    await q("INSERT INTO properties (id,owner_key,owner_name,price,bought_at) VALUES ($1,'qa-lma',$3,1,1),($2,'qa-lma',$3,1,1)", [RESORT_HOME, CITY_HOME, A]);
    const m1 = await step('migrate'); // the new server boots: re-fences, then migrates
    // a stale/old writer (any other connection, e.g. the old instance during deploy overlap) is now refused, fail closed
    await expect(q("INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ('qa-lma',$1,'ore','gold',1)", [A])).rejects.toThrow(/inventory fenced/);
    await expect(q("UPDATE kitchen_fillets SET qty = qty + 1")).rejects.toThrow(/inventory fenced/); expect(m1).toMatchObject({ fish: 2, dishes: 1, fillets: 3, conserved: true }); expect(owners(m1)).toEqual(['qa-lmb']); // B has no factory: held (fish + fillets), reported
    const m2 = await step('remigrate'); expect(m2).toMatchObject({ fish: 0, dishes: 0, fillets: 0, conserved: true }); expect(owners(m2)).toEqual(['qa-lmb']); // idempotent
    expect(await q("SELECT id, loc, species, weight_g, value FROM fish_catches ORDER BY id")).toEqual([
      { id: 'fa1', loc: 'factory', species: 'bass', weight_g: 900, value: 40 }, { id: 'fa2', loc: 'factory', species: 'trout', weight_g: 500, value: 20 }, { id: 'fb1', loc: null, species: 'bass', weight_g: 700, value: 30 }]);
    expect(await q("SELECT player_key, item_id, qty FROM mine_items WHERE item_type = 'food'")).toEqual([{ player_key: 'qa-lma', item_id: 'fillet_fish', qty: 3 }]);
    expect(await q("SELECT player_key, qty FROM kitchen_fillets ORDER BY 1")).toEqual([{ player_key: 'qa-lma', qty: 0 }, { player_key: 'qa-lmb', qty: 2 }]); // moved once, held owner untouched
    // ---- funds, a truck, factory ore
    const f = await step('fund', { names: [A, B, C], amt: 100_000 }); const c0 = f[A].chips;
    const t = await step('buyTruck', { name: A, truck: 'pickup' }); expect(t.ok).toBe(true); const truckId = t.r.truck.id; const c1 = c0 - t.r.price;
    await step('stack', { items: [[A, 'ore', 'copper', 300], [C, 'ore', 'copper', 20]] });
    // ---- concurrent dispatch: one truck, 300 ore; two 200 truck legs + a 50 hired leg in parallel
    const mv = await step('move', { names: [A], moves: [
      { name: A, from: 'factory', to: 'warehouse', item: 'ore:copper', qty: 200, mode: 'truck' },
      { name: A, from: 'factory', to: 'warehouse', item: 'ore:copper', qty: 200, mode: 'truck' },
      { name: A, from: 'factory', to: 'warehouse', item: 'ore:copper', qty: 50, mode: 'hired' }] });
    expect(mv.res.filter((r: { ok: boolean }) => r.ok)).toHaveLength(2);
    const fees = mv.res.filter((r: { ok: boolean }) => r.ok).reduce((s: number, r: { r: { shipment: { fee: number } } }) => s + r.r.shipment.fee, 0);
    expect(mv.snap[A].chips).toBe(c1 - fees); expect(Object.fromEntries(mv.snap[A].factory)['ore:copper']).toBe(50); // source unavailable while in transit
    expect(await q("SELECT count(*)::int n FROM freight_shipments WHERE status='moving' AND kind='loc'")).toEqual([{ n: 2 }]);
    expect(await q("SELECT count(*)::int n FROM freight_shipments WHERE status='transit' AND kind='loc'")).toEqual([{ n: 0 }]); // rollback barrier: 14bad00 loads status='transit' only, never a loc leg
    // ---- busy truck is global; another player's truck id is refused; same-map plane/ship and cross-map truck refused
    const deny = await step('move', { names: [A, C], moves: [
      { name: A, from: 'factory', to: 'warehouse', item: 'ore:copper', qty: 5, mode: 'truck' },
      { name: C, from: 'factory', to: 'warehouse', item: 'ore:copper', qty: 5, mode: 'truck', vehicle: truckId },
      { name: A, from: 'factory', to: `kitchen:${RESORT_HOME}`, item: 'fish:bass', qty: 1, mode: 'truck' },
      { name: A, from: 'factory', to: `kitchen:${RESORT_HOME}`, item: 'fish:bass', qty: 1, mode: 'hired' },
      { name: A, from: 'factory', to: 'kitchen:not-mine', item: 'fish:bass', qty: 1, mode: 'hired' },
      { name: B, from: 'factory', to: 'warehouse', item: 'fish:bass', qty: 1, mode: 'hired' }] });
    expect(deny.res.map((r: { ok: boolean }) => r.ok)).toEqual([false, false, false, false, false, false]);
    expect(deny.snap[A].chips).toBe(mv.snap[A].chips); expect(Object.fromEntries(deny.snap[C].factory)['ore:copper']).toBe(20);
    // ---- fish keep species/weight: plane to the resort kitchen, hired truck to the city kitchen + warehouse
    const fm = await step('move', { names: [A], moves: [
      { name: A, from: 'factory', to: `kitchen:${RESORT_HOME}`, item: 'fish:trout', qty: 1, mode: 'plane' },
      { name: A, from: 'factory', to: 'warehouse', item: 'fish:bass', qty: 1, mode: 'hired' },
      { name: A, from: 'factory', to: 'warehouse', item: 'dish:pancakes', qty: 1, mode: 'hired' }] });
    expect(fm.res.map((r: { ok: boolean; error?: string }) => r.ok || r.error)).toEqual([true, true, true]);
    expect((await q("SELECT loc FROM fish_catches WHERE id IN ('fa1','fa2') ORDER BY id")).every((r) => String(r.loc).startsWith('transit:'))).toBe(true);
    // ---- only the warehouse sells; nothing there yet
    expect((await step('sell', { name: A, item: 'ore:copper', qty: 1 })).ok).toBe(false);
    // ---- restart + two instances tick at once after arrival time: credited exactly once
    const late = 6 * 3_600_000; const [t1, t2] = await Promise.all([step('tick', { names: [A] }, late), step('tick', { names: [A] }, late)]);
    // deploy overlap: two servers up at once. Exactly one holds the fence; the other fails closed (boot error or
    // rejected writes) and can never double-credit. The ledger/stock rows below are the truth.
    const live = [t1, t2].filter((t) => !t.bootError); expect(live.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...live.map((t) => t.transit))).toBe(0);
    expect(await q("SELECT loc, item, qty::int AS qty FROM loc_stock WHERE player_key='qa-lma' ORDER BY 1,2")).toEqual([{ loc: 'warehouse', item: 'ore:copper', qty: 250 }]);
    expect(await q("SELECT id, loc, species, weight_g FROM fish_catches WHERE player_key='qa-lma' ORDER BY id")).toEqual([
      { id: 'fa1', loc: 'warehouse', species: 'bass', weight_g: 900 }, { id: 'fa2', loc: `kitchen:${RESORT_HOME}`, species: 'trout', weight_g: 500 }]);
    expect(await q("SELECT loc FROM kitchen_dishes WHERE id='da1'")).toEqual([{ loc: 'warehouse' }]);
    expect(await q("SELECT status, count(*)::int n FROM freight_shipments GROUP BY 1")).toEqual([{ status: 'delivered', n: 5 }]);
    const again = await step('tick', { names: [A] }, late); expect(again.transit).toBe(0); // a third boot credits nothing more
    expect(await q("SELECT qty::int AS qty FROM loc_stock WHERE player_key='qa-lma'")).toEqual([{ qty: 250 }]);
    // ---- warehouse sale: ore, fish, dish
    const s1 = await step('sell', { name: A, item: 'ore:copper', qty: 50 }); expect(s1.ok).toBe(true);
    expect(await q("SELECT qty::int AS qty FROM loc_stock WHERE player_key='qa-lma'")).toEqual([{ qty: 200 }]);
    expect((await step('sell', { name: A, item: 'fish:bass', qty: 1 })).ok).toBe(true);
    expect((await step('sell', { name: A, item: 'dish:pancakes', qty: 1 })).ok).toBe(true);
    expect((await step('sell', { name: A, item: 'fish:trout', qty: 1 })).ok).toBe(false); // trout is in a kitchen, not the warehouse
    const end = await step('snap', { names: [A] }); expect(end[A].chips).toBeGreaterThan(deny.snap[A].chips);
  } finally { await dropDrainedTestDatabase(root, db, dbName); }
}, 240_000);
