/**
 * Real PostgreSQL: a city-pack write whose COMMIT outcome is unknown (later found rolled back) must never be persisted
 * by a later whole-pack snapshot — deposit, withdraw and cross-consumer (savePack) variants — and restart reloads truth.
 */
import { afterAll, expect, it } from 'vitest';
import pg from 'pg';
import { PgMineStore, resetMines } from '../server/mines.js';
import { LocStore, setLocStore } from '../server/locstock.js';
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = [];
afterAll(async () => { for (const d of drops) await d(); });
async function freshDb() {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
  const name = `cu_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
  u.pathname = `/${name}`; const pool = new pg.Pool({ connectionString: u.toString() });
  drops.push(async () => { await pool.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); });
  return pool;
}
for (const mode of ['deposit', 'withdraw', 'cross'] as const) {
  it.skipIf(!url)(`unknown-then-rolled-back ${mode}: later writes never persist it; restart agrees`, async () => {
    const pool = await freshDb(); const ms = new PgMineStore(pool); await ms.init();
    const start = mode === 'deposit' ? 0 : 10;
    if (start) await pool.query("INSERT INTO mine_items(player_key,owner_name,item_type,item_id,qty) VALUES('a','A','ore','iron',10)");
    await pool.query('CREATE TABLE review_ops(id text PRIMARY KEY)');
    const world = resetMines(); await world.attach(ms);
    const ls = new LocStore(pool as never); setLocStore(ls); await ls.init();
    let down = true;
    const a = ls.adjust('A', [{ loc: 'warehouse', item: 'ore:iron', delta: mode === 'deposit' ? 10 : -10 }], [{ sql: 'SELECT 1/0', args: [] }],
      { committed: async () => { if (down) throw new Error('evidence unavailable'); return false; } });
    await expect(a).rejects.toThrow(); // caller learns "unknown" promptly
    setTimeout(() => { down = false; }, 1500);
    if (mode === 'cross') await world.savePack('A', [{ sql: "INSERT INTO review_ops VALUES('B')", args: [] }]);
    else await ls.adjust('A', [{ loc: 'warehouse', item: 'ore:iron', delta: 1 }], [{ sql: "INSERT INTO review_ops VALUES('B')", args: [] }], { marker: { sql: "SELECT 1 FROM review_ops WHERE id='B'", args: [] } });
    const want = start + (mode === 'cross' ? 0 : 1);
    expect((await pool.query('SELECT * FROM review_ops')).rows.length).toBe(1);
    expect(world.stackQty('A', 'ore', 'iron')).toBe(want);
    const db = (await pool.query("SELECT qty FROM mine_items WHERE item_id='iron'")).rows.map((r) => Number(r.qty));
    expect(db.reduce((x, y) => x + y, 0)).toBe(want);
    const reboot = resetMines(); await reboot.attach(ms); expect(reboot.stackQty('A', 'ore', 'iron')).toBe(want);
  }, 30_000);
}

/** Tentative credits are never spendable: an unknown-outcome deposit stays OUT of every consumer's view (transfer,
 *  sale, storage/qty reads) until its own marker confirms it; rolled back => nothing ever funded; committed => usable. */
for (const outcomeKind of ['rolledback', 'committed'] as const) {
  it.skipIf(!url)(`unknown deposit (${outcomeKind}) cannot fund a transfer or sale; restart conserves`, async () => {
    const pool = await freshDb(); let armed = false, down = true;
    const wrap = { query: (s: string, a?: unknown[]) => pool.query(s, a), connect: async () => { const c = await pool.connect(); return { release: () => c.release(), query: async (s: string, a?: unknown[]) => {
      let r; try { r = await c.query(s, a); } catch (e) { if (s === 'COMMIT' && outcomeKind === 'rolledback') throw new Error('COMMIT ack unavailable'); throw e; }
      if (s === 'COMMIT' && armed) { armed = false; throw new Error('lost COMMIT ack'); } return r; } }; } };
    const ms = new PgMineStore(wrap as never); await ms.init();
    await pool.query('CREATE TABLE review_ops(id text PRIMARY KEY)');
    if (outcomeKind === 'rolledback') await pool.query("CREATE FUNCTION reject_a() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='A' THEN RAISE EXCEPTION 'reject A'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER reject_a AFTER INSERT ON review_ops DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_a();");
    const world = resetMines(); await world.attach(ms);
    const ls = new LocStore(pool as never); setLocStore(ls); await ls.init();
    armed = outcomeKind === 'committed';
    const a = ls.adjust('A', [{ loc: 'warehouse', item: 'ore:iron', delta: 10 }], [{ sql: "INSERT INTO review_ops VALUES('A')", args: [] }],
      { committed: async () => { if (down) throw new Error('evidence unavailable'); return (await pool.query("SELECT 1 FROM review_ops WHERE id='A'")).rows.length > 0; } });
    await expect(a).rejects.toThrow();
    // while uncertain: not visible, not spendable by any consumer
    expect(world.stackQty('A', 'ore', 'iron')).toBe(0);
    expect(world.storage('A').length).toBe(0);
    expect(ls.adjust('A', [{ loc: 'warehouse', item: 'ore:iron', delta: -5 }, { loc: 'resort', item: 'ore:iron', delta: 5 }], [{ sql: "INSERT INTO review_ops VALUES('B')", args: [] }])).toBe(false);
    expect(() => world.sell('A', Date.now())).toThrow();
    down = false; await new Promise((r) => setTimeout(r, 2500));
    const want = outcomeKind === 'committed' ? 10 : 0;
    expect(world.stackQty('A', 'ore', 'iron')).toBe(want);
    if (want) { // confirmed => now spendable once
      await ls.adjust('A', [{ loc: 'warehouse', item: 'ore:iron', delta: -5 }, { loc: 'resort', item: 'ore:iron', delta: 5 }], [{ sql: "INSERT INTO review_ops VALUES('B')", args: [] }], { marker: { sql: "SELECT 1 FROM review_ops WHERE id='B'", args: [] } });
    }
    const reboot = resetMines(); await reboot.attach(new PgMineStore(pool)); const ls2 = new LocStore(pool as never); setLocStore(ls2); await ls2.init();
    expect(reboot.stackQty('A', 'ore', 'iron') + ls2.qty('A', 'resort', 'ore:iron')).toBe(want);
    expect(ls2.qty('A', 'resort', 'ore:iron')).toBe(want ? 5 : 0);
  }, 30_000);
}
