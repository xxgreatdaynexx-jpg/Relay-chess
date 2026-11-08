import { afterAll, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Mayor } from '../server/mayor';
import { City } from '../server/city';
import { RIOT_STOP_COST } from '../shared/city';
import { DAY_MS, WEEK_MS } from '../shared/mayor';
import { cityRiotGate } from '../client/src/lib/cityRiotGate';

const MON = Date.parse('2026-11-02T06:00:00Z'); const H = 3_600_000;
async function setup(pool: any, bankPool = pool) {
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(bankPool));
  await pool.query('CREATE TABLE IF NOT EXISTS players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  let now = MON + 10 * H; const clock = () => now;
  const m = new Mayor(pool, () => bank, clock); await m.init();
  const c = new City(pool as never, () => m, clock, () => bank, () => 1); await c.init();
  for (const name of ['Ann', 'Bob', 'Cat']) { await pool.query('INSERT INTO players VALUES ($1,$2,$3)', [name.toLowerCase(), name, new Date(now - 3 * DAY_MS).toISOString()]); bank.transfer(name, 50_000, { game: 'admin' }); for (let i = 0; i < 6; i++) bank.transfer(name, 1, { game: 'slots' }); await bank.flush(); }
  await m.file('Ann', 'Build it'); await m.file('Cat', 'Runner up'); now = MON + 5 * DAY_MS; await m.vote('Bob', 'Ann'); now = MON + WEEK_MS + 9 * H;
  const fund = (n: number) => pool.query("UPDATE city_treasury SET balance = $1 WHERE id = 'main'", [n]);
  const bal = async () => Number((await pool.query("SELECT balance FROM city_treasury WHERE id='main'")).rows[0].balance);
  const chips = (n: string) => bank.account(n).chips;
  return { pool, bank, m, c, clock, fund, bal, chips, set: (t: number) => { now = t; }, get now() { return now; } };
}

const memPool = () => { const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); return new Pool(); };
const count = async (pool: any, sql: string) => Number((await pool.query(sql)).rows[0].n);

describe('client riot gate', () => {
  it('hidden until the server says active; ended latches off for good (stale/offline answers never re-enable)', () => {
    const calls: boolean[] = []; const g = cityRiotGate({ setEnabled: (on) => calls.push(on) });
    g.apply(null); g.apply({}); expect(calls).toEqual([]); // no answer: stays hidden
    g.apply({ riot: { active: true } }); g.apply({ riot: { active: true } }); expect(calls).toEqual([true]);
    g.apply({ riot: { active: false } }); expect(calls).toEqual([true, false]); expect(g.ended).toBe(true);
    g.apply({ riot: { active: true } }); expect(calls).toEqual([true, false]); // stale snapshot cannot bring it back
    const c2: boolean[] = []; const h = cityRiotGate({ setEnabled: (on) => c2.push(on) }); h.apply({ riot: { active: false } }); expect(c2).toEqual([false]); // resolved at load: never shown
  });
  it('world3d starts the joke disabled and routes /api/city snapshots through the gate', () => {
    const w = readFileSync('client/src/lib/world3d.ts', 'utf8');
    expect(w).toMatch(/enabled: false \}\);/); expect(w).toMatch(/riotGate\.apply\(x\?\.view\)/);
  });
});

describe('stopRiot (pg-mem)', () => {
  it('default active; non-mayor/insufficient write nothing; exact 3000 debit + ledger + log + persisted; replay free; second stop refused', async () => {
    const s = await setup(memPool());
    expect((await s.c.view(null)).riot).toEqual({ active: true, resolvedAt: null, by: null, cost: 3000 });
    await expect(s.c.stopRiot('Bob')).rejects.toThrow(/sitting mayor/);
    await s.fund(2_999); await expect(s.c.stopRiot('Ann')).rejects.toThrow(/doesn't have/);
    expect(await s.bal()).toBe(2_999); expect(await count(s.pool, 'SELECT count(*) n FROM city_riot')).toBe(0);
    await s.fund(10_000); const chips = ['Ann', 'Bob', 'Cat'].map(s.chips);
    const r = await s.c.stopRiot('Ann', 'riot-req-0001'); expect(r).toEqual({ stopped: true, cost: RIOT_STOP_COST });
    expect(await s.bal()).toBe(7_000); expect(['Ann', 'Bob', 'Cat'].map(s.chips)).toEqual(chips);
    const v = await s.c.view(null); expect(v.riot).toMatchObject({ active: false, by: 'Ann', cost: 3000 });
    expect(v.treasury.ledger[0]).toMatchObject({ kind: 'riot', amount: -3000 }); expect(v.actions[0]!.text).toMatch(/paid 🪙 3,000 .* end the city riot/);
    expect(await s.c.stopRiot('Ann', 'riot-req-0001')).toMatchObject({ replay: true }); expect(await s.bal()).toBe(7_000);
    await expect(s.c.stopRiot('Ann')).rejects.toThrow(/already over/); expect(await s.bal()).toBe(7_000);
    const c2 = new City(s.pool as never, () => s.m, s.clock, () => s.bank, () => 7); await c2.init(); // restart, different price index
    expect((await c2.view(null)).riot!.active).toBe(false);
  });
});

const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = []; afterAll(async () => { for (const d of drops) await d(); });
const db = async () => { const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only'); const name = `rt_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
  u.pathname = `/${name}`; const pool = new pg.Pool({ connectionString: u.toString(), max: 8 }); drops.push(async () => { await pool.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); }); return pool; };
const holdLock = async (pool: pg.Pool) => { const cl = await pool.connect(); await cl.query('BEGIN'); await cl.query("SELECT 1 FROM city_treasury WHERE id='main' FOR UPDATE"); return async (ok = true) => { await cl.query(ok ? 'COMMIT' : 'ROLLBACK'); cl.release(); }; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
describe.skipIf(!url)('stopRiot (real PostgreSQL)', () => {
  it('three instances racing (mixed request ids) charge exactly once', async () => {
    const pool = await db(); const s = await setup(pool); await s.fund(100_000);
    const cs = [s.c, new City(pool as never, () => s.m, s.clock, () => s.bank, () => 1), new City(pool as never, () => s.m, s.clock, () => s.bank, () => 1)]; for (const c of cs.slice(1)) await c.init();
    const res = await Promise.allSettled([cs[0]!.stopRiot('Ann', 'same-req-1'), cs[1]!.stopRiot('Ann', 'same-req-1'), cs[2]!.stopRiot('Ann'), cs[1]!.stopRiot('Ann')]);
    expect(await s.bal()).toBe(97_000); expect(await count(pool, "SELECT count(*) n FROM city_treasury_ledger WHERE kind='riot'")).toBe(1);
    expect(res.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const r of res) if (r.status === 'rejected') expect(String(r.reason.message)).toMatch(/already over/);
  });
  it('lost ack: same request id retried after commit returns ok without a second charge', async () => {
    const pool = await db(); const s = await setup(pool); await s.fund(10_000);
    await s.c.stopRiot('Ann', 'lost-ack-77'); const again = await new City(pool as never, () => s.m, s.clock, () => s.bank, () => 1).stopRiot('Ann', 'lost-ack-77');
    expect(again.replay).toBe(true); expect(await s.bal()).toBe(7_000);
  });
  it('term ends or recall commits while queued on the lock: refused, nothing written', async () => {
    for (const mode of ['termEnd', 'recall'] as const) {
      const pool = await db(); const s = await setup(pool); await s.fund(10_000); await s.m.settle(s.now); const t = (await s.m.mayor(s.now))!;
      const release = await holdLock(pool); const p = s.c.stopRiot('Ann').then(() => 'ok', (e) => String(e.message));
      await wait(300); if (mode === 'termEnd') s.set(t.endsAt + 1); else await pool.query('UPDATE mayor_terms SET removed_at = $1 WHERE removed_at IS NULL', [s.now]);
      await release(); expect(await p).toMatch(/sitting mayor/);
      expect(await s.bal()).toBe(10_000); expect(await count(pool, 'SELECT count(*) n FROM city_riot')).toBe(0); expect(await count(pool, "SELECT count(*) n FROM mayor_actions WHERE text LIKE '%riot%'")).toBe(0);
    }
  });
  it('rollback: a failure after the debit leaves treasury, riot and log untouched', async () => {
    const pool = await db(); const s = await setup(pool); await s.fund(10_000);
    await pool.query("CREATE FUNCTION no_riot() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql; CREATE TRIGGER t BEFORE INSERT ON city_riot FOR EACH ROW EXECUTE FUNCTION no_riot();");
    await expect(s.c.stopRiot('Ann')).rejects.toThrow(/boom/);
    expect(await s.bal()).toBe(10_000); expect(await count(pool, "SELECT count(*) n FROM city_treasury_ledger WHERE kind='riot'")).toBe(0); expect((await s.c.view(null)).riot!.active).toBe(true);
  });
});
