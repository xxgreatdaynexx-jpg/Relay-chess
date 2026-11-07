/** Optional: real disposable LOCAL Postgres. EMPLOY_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PORT/db. Never production. */
import { expect, it } from 'vitest';
import pg from 'pg';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Employment, type OreSink } from '../server/employment';
import { FISH_MIGRATION } from '../server/fishing';
import { setPriceIndexForTest } from '../server/price-index';
import { DAY, HOUR, baseWage, jobById } from '../shared/employment';

const url = process.env.EMPLOY_TEST_DATABASE_URL;
const L = (s: string) => Date.parse(`${s}-06:00`);
it.skipIf(!url)('real PG: two servers + restarts across the lockout and wage days produce/charge exactly once', async () => {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local only');
  setPriceIndexForTest(1);
  const schema = `employ_ovn_${process.pid}_${Date.now()}`; const root = new pg.Pool({ connectionString: url });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` });
  try {
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
    await pool.query(FISH_MIGRATION); await pool.query('CREATE TABLE ore_store (id TEXT, n INT)');
    let now = L('2026-11-06T23:00:00');
    const sink = (): OreSink => ({ async write(cl, items) { for (const [id, n] of items) await cl.query('INSERT INTO ore_store VALUES ($1,$2)', [id, n]); }, after() {} });
    let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const lockPools: pg.Pool[] = [];
    const mk = async () => { const lp = new pg.Pool({ connectionString: url, max: 2 }); lockPools.push(lp); const e = new Employment(pool, () => bank, () => now, sink, rnd, lp); await e.init(); return e; };
    const a = await mk(), b = await mk();
    await pool.query('INSERT INTO players VALUES ($1,$1,$2)', ['gus', new Date(now - 2 * DAY).toISOString()]);
    bank.transfer('Gus', 1_000_000, { game: 'admin' }); await bank.flush();
    await a.hire('Gus', 'miner:mine');
    const ores = async () => Number((await pool.query('SELECT coalesce(sum(n),0) AS n FROM ore_store')).rows[0].n);
    const wages = async () => Number((await pool.query("SELECT count(*) AS n FROM wallet_transactions WHERE game='employ_wage'")).rows[0].n);
    const stops = ['2026-11-07T00:59:59', '2026-11-07T01:00:00', '2026-11-07T03:30:00', '2026-11-07T06:59:59', '2026-11-07T07:00:00', '2026-11-07T13:00:00', '2026-11-07T20:00:00'];
    for (const s of stops) { now = L(s); await Promise.all([a.sweep(), b.sweep(), a.sweep(), b.sweep()]); }
    expect(await ores()).toBe(280); // 14 h × 20/h, exactly once despite 2 servers racing
    expect(await wages()).toBe(0); // paid day runs to 23:00 day 2; production stopped at the 13:00 cap → no wage yet
    // restart: fresh instance, check-in on day 2 at 22:00 (re-hire charges one wage), then away across next closure + wage boundary
    const c = await mk(); now = L('2026-11-07T22:00:00'); await c.collect('Gus'); // check-in inside the paid day: no new wage
    expect(await wages()).toBe(0);
    for (const s of ['2026-11-08T02:00:00', '2026-11-08T07:00:00', '2026-11-08T12:00:00', '2026-11-08T22:00:00', '2026-11-08T23:00:00', '2026-11-09T12:00:00']) { now = L(s); const d = await mk(); await Promise.all([c.sweep(), d.sweep(), a.sweep()]); }
    // wage at 23:00 (owner still within cap) charged once; 22:00 + 8 awake h + 6 h closure = 12:00 → 14 h × 20 more; paidUntil 22:00 day3 > cap end → idle, no 2nd wage
    expect(await ores()).toBe(560); expect(await wages()).toBe(1);
    expect(Number((await pool.query("SELECT sum(amount) AS s FROM wallet_transactions WHERE game='employ_wage'")).rows[0].s)).toBe(-baseWage(jobById('miner:mine')!));
    void HOUR;
    for (const lp of lockPools) await lp.end();
  } finally { await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); }
}, 60_000);

it.skipIf(!url)('real PG: full storage + racing servers conserve every ore (delivered + held = produced)', async () => {
  setPriceIndexForTest(1);
  const schema = `employ_cap_${process.pid}_${Date.now()}`; const root = new pg.Pool({ connectionString: url });
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` }); const lps: pg.Pool[] = [];
  try {
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
    await pool.query(FISH_MIGRATION); await pool.query('CREATE TABLE ore_store (id TEXT, n INT)');
    let now = L('2026-11-06T23:00:00'); let stored = 0;
    const sink = (): OreSink => ({ room: () => 100 - stored, async write(cl, items) { for (const [id, n] of items) await cl.query('INSERT INTO ore_store VALUES ($1,$2)', [id, n]); }, after(items) { for (const [, n] of items) stored += n; } });
    const mk = async () => { const lp = new pg.Pool({ connectionString: url, max: 2 }); lps.push(lp); const e = new Employment(pool, () => bank, () => now, sink, () => 0.5, lp); await e.init(); return e; };
    const a = await mk(), b = await mk();
    await pool.query('INSERT INTO players VALUES ($1,$1,$2)', ['gus', new Date(now - 2 * DAY).toISOString()]);
    bank.transfer('Gus', 1_000_000, { game: 'admin' }); await bank.flush(); await a.hire('Gus', 'miner:mine');
    for (const s of ['2026-11-07T02:00:00', '2026-11-07T07:00:00', '2026-11-07T15:00:00']) { now = L(s); await Promise.all([a.sweep(), b.sweep()]); }
    const db = Number((await pool.query('SELECT coalesce(sum(n),0) AS n FROM ore_store')).rows[0].n);
    const box = JSON.parse((await pool.query('SELECT box FROM employ_workers')).rows[0].box).ores as Record<string, number>;
    const held = Object.values(box ?? {}).reduce((x, y) => x + y, 0);
    expect(db).toBe(100); expect(db + held).toBe(280);
    for (const lp of lps) await lp.end();
  } finally { await pool.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); }
}, 60_000);
