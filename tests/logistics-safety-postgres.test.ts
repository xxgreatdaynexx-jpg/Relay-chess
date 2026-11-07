/**
 * Real PostgreSQL cutover + logistics safety. Every step is a separate server process (tests/fixtures/locmoves-pg-step.ts)
 * on a disposable LOCAL database: real fence, real dispatch -> arrival -> Warehouse sale, restarts, overlapping instances.
 */
import { expect, it } from 'vitest';
import pg from 'pg';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { farmPlots } from '../shared/farm';
const run = promisify(execFile);
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const A = 'QA-SfA', B = 'QA-SfB';
const CITY_HOME = 'b:house:-691:-188';
const H = 3_600_000;
const PLOT = `f:${farmPlots()[0]!.n}`;

async function makeDb(tag: string) {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Only a disposable local test DB is allowed.');
  const name = `lmsf_${tag}_${process.pid}_${Date.now()}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
  u.pathname = `/${name}`; const DB = u.toString(); const db = new pg.Pool({ connectionString: DB, max: 4 });
  const env = (offset: number, extra: Record<string, string> = {}) => ({ ...process.env, DATABASE_URL: DB, NODE_ENV: 'test', LM_CLOCK_OFFSET: String(offset), ...extra });
  const step = async (s: string, arg: unknown = {}, offset = 0, extra: Record<string, string> = {}) => {
    const { stdout } = await run('npx', ['tsx', 'tests/fixtures/locmoves-pg-step.ts', s, JSON.stringify(arg)], { env: env(offset, extra), maxBuffer: 1 << 24 });
    const lines = stdout.split('\n').filter((l) => l.startsWith('RESULT ')); if (!lines.length) throw new Error(`step ${s}: no result\n${stdout}`);
    return lines.length === 1 ? JSON.parse(lines[0]!.slice(7)) : lines.map((l) => JSON.parse(l.slice(7)));
  };
  const failBoot = async (extra: Record<string, string>) => { try { await run('npx', ['tsx', 'tests/fixtures/locmoves-pg-step.ts', 'failBoot', '{}'], { env: env(0, extra) }); return 0; } catch (e) { return (e as { code?: number }).code ?? -1; } };
  const q = async (sql: string, a: unknown[] = []) => (await db.query(sql, a)).rows;
  const close = async () => { await db.end(); await root.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {}); await root.end(); };
  return { DB, env, step, failBoot, q, close, db };
}
const n = (rows: Array<Record<string, unknown>>) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v])));

it.skipIf(!url)('real PostgreSQL: trigger install vs an old writer, migration (barn, listings, held freight), crops/resort ship move->arrive->sell, kitchen capacity incl. inbound, factory arrival while storage offline, stale instance fenced', async () => {
  const d = await makeDb('a'); const { step, q } = d;
  try {
    await step('boot');
    // ---- N2: an OLD writer holds a table lock (mid-transaction) while a new server boots and must add a missing trigger
    await q("UPDATE inv_fence SET mode = 'open'"); await q('DROP TRIGGER inv_fence_mine_items ON mine_items');
    const old = await d.db.connect(); await old.query('BEGIN'); await old.query("INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ('qa-old','QA-Old','ore','coal',1)");
    const t0 = Date.now(); const booting = step('boot');
    await new Promise((r) => setTimeout(r, 2500));
    await old.query("INSERT INTO fish_catches (id,player_key,name,species,weight_g,value,caught_at) VALUES ('old1','qa-old','QA-Old','bass',100,1,1)"); // reads the fence row FOR SHARE: not blocked
    await old.query('COMMIT'); old.release();
    expect(await booting).toEqual({ ok: true }); expect(Date.now() - t0).toBeLessThan(60_000); // no deadlock
    expect(await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'inv_fence_mine_items'")).toEqual([{ n: 1 }]);
    expect(await q("SELECT count(*)::int n FROM mine_items WHERE player_key = 'qa-old'")).toEqual([{ n: 1 }]); // the old txn committed whole

    // ---- legacy state written by the old server (fence open = pre-cutover)
    await q("UPDATE inv_fence SET mode = 'open'");
    await q("INSERT INTO mine_factories VALUES ('qa-sfa',$1,1,0)", [A]);
    await q("INSERT INTO properties (id,owner_key,owner_name,price,bought_at) VALUES ($1,'qa-sfa',$3,1,1),('rf:1','qa-sfa',$3,1,1),($2,'qa-sfa',$3,1,1) ON CONFLICT DO NOTHING", [PLOT, CITY_HOME, A]);
    const now = Date.now();
    for (let t = 0; t < 4; t++) await q("INSERT INTO farm_tiles VALUES ($1,$2,'qa-sfa','wheat',$3,$4)", [PLOT, t, now - 2 * H, `n${t}`]);
    for (let t = 0; t < 2; t++) await q("INSERT INTO farm_tiles VALUES ('rf:1',$1,'qa-sfa','coconut',$2,$3)", [t, now - 13 * H, `c${t}`]);
    await q("INSERT INTO building_inv VALUES ('qa-sfa',$1,'resort_farm','crop:coconut',5),('qa-sfb',$2,'resort_farm','crop:coconut',2)", [A, B]);
    await q("INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ('qa-sfa',$1,'food','fillet_fish',1200)", [A]);
    await q("INSERT INTO market_stack_listings (id, seller_key, seller_name, item_type, item_id, qty_left, qty_total, unit_price, sold, status, created_at, closed_at) VALUES ('legacy-l','qa-sfa',$1,'ore','iron',4,4,10,0,'active',1,NULL)", [A]);
    await q(`INSERT INTO freight_shipments (id, player_key, name, to_key, to_name, mode, truck, from_hub, to_hub, item_type, item_id, qty, fee, created_at, depart_at, arrive_at, status, kind, src, auto)
      VALUES ('legacy-b','qa-sfa',$1,'qa-sfb',$2,'hired',NULL,'city','city','bar','iron_bar',6,25,1,1,2,'transit','move',NULL,false)`, [A, B]);

    // ---- cutover boot: migration
    const m = await step('migrate');
    expect(m).toMatchObject({ barn: 5, conserved: true }); expect(m.held).toContainEqual(expect.objectContaining({ owner: 'qa-sfb', what: expect.stringMatching(/resort barn/) }));
    expect(m.freightHeld).toEqual([{ id: 'legacy-b', to: 'qa-sfb', item: 'bar:iron_bar', qty: 6 }]);
    expect(n(await q("SELECT player_key, loc, item, qty FROM loc_stock ORDER BY 1"))).toEqual([{ player_key: 'qa-sfa', loc: 'factory', item: 'crop:coconut', qty: 5 }]);
    expect(n(await q("SELECT player_key, qty FROM building_inv WHERE building = 'resort_farm' ORDER BY 1"))).toEqual([{ player_key: 'qa-sfa', qty: 0 }, { player_key: 'qa-sfb', qty: 2 }]);
    expect(await q("SELECT origin FROM market_stack_listings WHERE id = 'legacy-l'")).toEqual([{ origin: 'factory' }]);
    // legacy listing cancel -> back to the factory it came from
    expect((await step('cancelListing', { name: A, id: 'legacy-l' })).ok).toBe(true);
    expect(n(await q("SELECT qty FROM mine_items WHERE player_key = 'qa-sfa' AND item_id = 'iron'"))).toEqual([{ qty: 4 }]);

    // ---- real harvests: pre-Millionaire instant sale at the field (city and resort plantation), farm_harvest ledger; no crop stock
    await step('fund', { names: [A, B], amt: 200_000 });
    const h1 = await step('harvest', { name: A, plot: PLOT }); expect(h1).toMatchObject({ ok: true }); expect(h1.r.paid).toBeGreaterThan(0);
    const h2 = await step('harvest', { name: A, plot: 'rf:1' }); expect(h2).toMatchObject({ ok: true }); expect(h2.r.paid).toBeGreaterThan(0);
    expect(await q("SELECT count(*)::int n FROM wallet_transactions WHERE player_key = 'qa-sfa' AND game = 'farm_harvest'")).toEqual([{ n: 2 }]);
    expect(await q("SELECT count(*)::int n FROM loc_stock WHERE player_key = 'qa-sfa' AND item LIKE 'crop:%' AND loc <> 'factory'")).toEqual([{ n: 0 }]);

    // ---- route rules (map pools): same map = instant + free whatever the mode; other maps = plane/ship only; kitchens are no destination
    const deny = await step('move', { names: [A], moves: [
      { name: A, from: 'factory', to: 'resort', item: 'crop:coconut', qty: 1, mode: 'hired' },
      { name: A, from: 'factory', to: `kitchen:${CITY_HOME}`, item: 'food:fillet_fish', qty: 1, mode: 'hired' }] });
    expect(deny.res.map((r: { ok: boolean; error?: string }) => r.error)).toEqual([expect.stringMatching(/other maps/), expect.stringMatching(/map warehouse/)]);
    const c0 = (await step('snap', { names: [A] }))[A].chips;
    const mv = await step('move', { names: [A], moves: [
      { name: A, from: 'factory', to: 'warehouse', item: 'crop:coconut', qty: 5, mode: 'plane' },
      { name: A, from: 'factory', to: 'warehouse', item: 'food:fillet_fish', qty: 600, mode: 'truck' }] });
    expect(mv.res.map((r: { ok: boolean; error?: string }) => r.ok || r.error)).toEqual([true, true]);
    expect(mv.snap[A].chips).toBe(c0); // same-map moves are free
    // ---- arrival (restart, later clock): everything lands exactly once; the legacy load to B (no factory) waits at the dock
    const t1 = await step('tick', { names: [A, B] }, 8 * H); expect(t1.transit).toBe(0);
    const wh = Object.fromEntries((await q("SELECT loc || '|' || item k, qty::int n FROM loc_stock WHERE player_key = 'qa-sfa' AND qty > 0")).map((r) => [r.k, r.n]));
    expect(wh).toEqual({ 'warehouse|crop:coconut': 5, 'warehouse|food:fillet_fish': 600 });
    expect(await q("SELECT status FROM freight_shipments WHERE id = 'legacy-b'")).toEqual([{ status: 'transit' }]);
    expect(await q("SELECT count(*)::int n FROM mine_items WHERE player_key = 'qa-sfb'")).toEqual([{ n: 0 }]);
    // ---- legacy crop stock sells from the map warehouse once (farm_sale)
    expect((await step('sell', { name: A, item: 'crop:coconut', qty: 5 }, 8 * H)).ok).toBe(true);
    expect((await step('sell', { name: A, item: 'crop:coconut', qty: 5 }, 8 * H)).ok).toBe(false);
    expect(await q("SELECT count(*)::int n FROM wallet_transactions WHERE player_key = 'qa-sfa' AND game = 'farm_sale'")).toEqual([{ n: 1 }]);

    // ---- factory arrival while factory storage is offline: refused (no "delivered" marker), credited once when back
    await step('stack', { items: [[A, 'ore', 'copper', 30]] });
    expect((await step('move', { names: [A], moves: [{ name: A, from: 'factory', to: 'warehouse', item: 'ore:copper', qty: 30, mode: 'hired' }] }, 8 * H)).res[0].ok).toBe(true);
    await step('tick', { names: [A] }, 9 * H);
    expect((await step('move', { names: [A], moves: [{ name: A, from: 'warehouse', to: 'factory', item: 'ore:copper', qty: 30, mode: 'hired' }] }, 9 * H)).res[0].ok).toBe(true);
    const off = await step('offlineTick', { names: [A] }, 10 * H); expect(off.moving).toBe(1);
    expect(await q("SELECT count(*)::int n FROM freight_shipments WHERE kind = 'loc' AND status = 'moving'")).toEqual([{ n: 1 }]);
    expect(n(await q("SELECT qty FROM mine_items WHERE player_key = 'qa-sfa' AND item_id = 'copper'"))).toEqual([]);
    await step('tick', { names: [A] }, 10 * H); await step('tick', { names: [A] }, 10 * H);
    expect(n(await q("SELECT qty FROM mine_items WHERE player_key = 'qa-sfa' AND item_id = 'copper'"))).toEqual([{ qty: 30 }]);

    // ---- the held legacy load is delivered once B has a factory (explicit, validated destination)
    await q("UPDATE inv_fence SET mode = 'open'"); await q("INSERT INTO mine_factories VALUES ('qa-sfb',$1,1,0)", [B]);
    await step('tick', { names: [B] }, 10 * H); await step('tick', { names: [B] }, 10 * H);
    expect(n(await q("SELECT item_id, qty FROM mine_items WHERE player_key = 'qa-sfb'"))).toEqual([{ item_id: 'iron_bar', qty: 6 }]);

    // ---- overlap: an instance that loses the fence to a newer boot can no longer write, and reports unhealthy
    const p1 = step('holdWrite', { name: A, waitMs: 9000 });
    await new Promise((r) => setTimeout(r, 3000)); const p2 = await step('health');
    const [b1, a1] = await p1;
    expect(b1.before).toMatchObject({ ok: true, fence: 'held' }); expect(p2).toMatchObject({ ok: true, fence: 'held', ready: true });
    expect(a1.after).toMatchObject({ ok: false, fence: 'lost' }); expect(a1.err).toMatch(/inventory fenced/);
    expect(await q("SELECT count(*)::int n FROM mine_items WHERE player_key = 'qa-sfa' AND item_id = 'gold'")).toEqual([{ n: 0 }]);
  } finally { await d.close(); }
}, 600_000);

it.skipIf(!url)('real PostgreSQL: a boot that fails before ready hands the fence back only when provably safe; otherwise inventory stays fenced until forward recovery', async () => {
  const d = await makeDb('b'); const { q } = d;
  const oldWrite = () => q("INSERT INTO kitchen_fillets VALUES ('qa-old','fish',1) ON CONFLICT (player_key, kind) DO UPDATE SET qty = kitchen_fillets.qty + 1");
  try {
    // bounded boot: never ready within the deadline -> exits, fence handed back (old code era, nothing migrated)
    expect(await d.failBoot({ LM_TEST_FAIL: 'hang', INV_BOOT_DEADLINE_MS: '6000' })).toBe(1);
    expect(await q('SELECT holder, mode, migrated FROM inv_fence')).toEqual([{ holder: null, mode: 'open', migrated: false }]);
    await oldWrite(); // the old server keeps working
    // SIGTERM before ready (Render stopping a deploy that never got healthy)
    const c = spawn('npx', ['tsx', 'tests/fixtures/locmoves-pg-step.ts', 'failBoot', '{}'], { env: d.env(0, { LM_TEST_FAIL: 'hang' }), detached: false });
    let log = ''; c.stdout.on('data', (b) => { log += String(b); }); c.stderr.on('data', (b) => { log += String(b); });
    for (let i = 0; i < 200 && !log.includes('fence taken'); i++) await new Promise((r) => setTimeout(r, 200));
    expect(await q('SELECT mode FROM inv_fence')).toEqual([{ mode: 'fenced' }]);
    await expect(oldWrite()).rejects.toThrow(/inventory fenced/);
    const killed = new Promise((r) => c.on('exit', r));
    // signal the tsx child (the node process) via the process group of npx
    for (const pid of (await run('pgrep', ['-f', 'locmoves-pg-step.ts failBoot'])).stdout.trim().split('\n').filter(Boolean)) process.kill(Number(pid), 'SIGTERM');
    await killed; await new Promise((r) => setTimeout(r, 500));
    expect(await q('SELECT holder, mode FROM inv_fence')).toEqual([{ holder: null, mode: 'open' }]);
    await oldWrite();
    // failure before migrating -> handed back
    expect(await d.failBoot({ LM_TEST_FAIL: 'premigrate' })).toBe(1);
    expect(await q('SELECT mode, migrated FROM inv_fence')).toEqual([{ mode: 'open', migrated: false }]);
    // failure AFTER migration started -> the database is new-shape: fence KEPT, old code stays out (no stale legacy writes)
    expect(await d.failBoot({ LM_TEST_FAIL: 'migrate' })).toBe(1);
    expect(await q('SELECT mode, migrated FROM inv_fence')).toEqual([{ mode: 'fenced', migrated: true }]);
    await expect(oldWrite()).rejects.toThrow(/inventory fenced/);
    // forward recovery: a healthy new server boots, migrates, serves
    expect(await d.step('health')).toMatchObject({ ok: true, fence: 'held', ready: true });
  } finally { await d.close(); }
}, 300_000);
