/**
 * pt2041u: "Buying... / No answer from the server" on a taxed property buy. RealEstate's pool has 2 connections; buyNow holds
 * one for the whole locked buy, and a cold purchase-tax recipient scan (economy.playerAssets -> RealEstate.mine on the SAME
 * pool, once per active player) needs another. Two taxed buys at once (or any other holder of the 2nd connection) starve
 * each other until the pool's connection timeout. Real PostgreSQL, local only.
 */
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { setEconomyForTest } from '../server/economy';
import { resetPurchaseTaxCache, purchaseTaxMoves, PurchaseTaxUnprepared } from '../server/purchase-tax';
import { setJail, type Jail } from '../server/jail';
import { properties } from '../shared/realEstate';

setJail({ isJailed: () => false, status: () => null } as unknown as Jail);
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = []; afterAll(async () => { setEconomyForTest(null); for (const d of drops) await d(); });
describe.skipIf(!url)('taxed property buy with the production pool size (max 2)', () => {
  it('two concurrent taxed buys with a cold recipient cache both complete promptly', async () => {
    const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
    const name = `pb_${process.pid}_${Date.now()}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
    u.pathname = `/${name}`; const conn = u.toString();
    const pool = new pg.Pool({ connectionString: conn, max: 2, connectionTimeoutMillis: 3_000 }); // same shape as initRealEstate (10 s there)
    const setupPool = new pg.Pool({ connectionString: conn, max: 2 });
    drops.push(async () => { await pool.end(); await setupPool.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); });
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(setupPool as never));
    const re = new RealEstate(pool as never, () => bank); await re.init();
    await setupPool.query(`CREATE TABLE farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
      CREATE TABLE farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
      CREATE TABLE farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));`);
    const fund = async (n: string, c: number) => { bank.transfer(n, c - bank.account(n).chips, { game: 'admin' }); await bank.flush(); };
    for (let i = 0; i < 10; i++) await fund(`P${i}`, 6000);
    for (const r of ['Rich', 'Rose']) { await setupPool.query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ($1,$2,$3,158884,0)', [`test:${r}`, r.toLowerCase(), r]); await fund(r, 1_000_000); }
    // Production economy.playerAssets reads RealEstate.mine (same 2-connection pool) for every active player.
    setEconomyForTest({ playerAssets: async (n: string) => { await re.mine(n); return { total: 0 }; } } as never);
    resetPurchaseTaxCache();
    const [a, b] = [...properties()].filter((p) => p.kind !== 'landmark' && p.price >= 5_000 && p.price < 20_000).sort((x, y) => x.price - y.price);
    const t0 = Date.now();
    const res = await Promise.allSettled([re.buy('Rich', a!.id), re.buy('Rose', b!.id)]);
    const ms = Date.now() - t0;
    expect(res.map((r) => r.status === 'rejected' ? String((r as PromiseRejectedResult).reason?.message) : 'ok')).toEqual(['ok', 'ok']);
    expect(ms).toBeLessThan(2_500); // well under the pool timeout and the client's 15 s ack
    for (const r of res) expect((r as PromiseFulfilledResult<{ wealthTax: number }>).value.wealthTax).toBeGreaterThan(0);
  }, 30_000);

  async function world(clock?: () => number) {
    const u = new URL(url!); const name = `pc_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
    u.pathname = `/${name}`; const conn = u.toString();
    const pool = new pg.Pool({ connectionString: conn, max: 2, connectionTimeoutMillis: 3_000 }); const setupPool = new pg.Pool({ connectionString: conn, max: 2 });
    drops.push(async () => { await pool.end(); await setupPool.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); });
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(setupPool as never));
    const re = new RealEstate(pool as never, () => bank, clock); await re.init();
    await setupPool.query(`CREATE TABLE farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
      CREATE TABLE farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
      CREATE TABLE farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));`);
    const fund = async (n: string, c: number) => { bank.transfer(n, c - bank.account(n).chips, { game: 'admin' }); await bank.flush(); };
    for (let i = 0; i < 10; i++) await fund(`P${i}`, 6000);
    await setupPool.query("INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ('test:rich','rich','Rich',158884,0)"); await fund('Rich', 1_000_000);
    const checkedOut = () => pool.totalCount - pool.idleCount;
    const n = async (sql: string) => Number((await setupPool.query(sql)).rows[0].n);
    return { pool, setupPool, bank, re, checkedOut, n };
  }
  const farm = () => [...properties()].filter((p) => p.kind !== 'landmark' && p.price >= 5_000 && p.price < 20_000).sort((x, y) => x.price - y.price)[0]!;

  it('cache expiring between preparation and the locked buy: no asset/property reads while the buy holds a connection', async () => {
    const t0 = Date.now(); let pinned: () => number = () => 0;
    const clock = () => (pinned() > 0 ? t0 + 120_000 : t0); // any clock read once the buy holds a connection is 2 min later: the 60 s cache has expired
    const w = await world(clock); pinned = w.checkedOut; let readsWhilePinned = 0, reads = 0;
    setEconomyForTest({ playerAssets: async (n: string) => { reads++; if (w.checkedOut() > 0) readsWhilePinned++; await w.re.mine(n); return { total: 0 }; } } as never);
    resetPurchaseTaxCache();
    const r = await w.re.buy('Rich', farm().id);
    expect(r.wealthTax).toBeGreaterThan(0); expect(reads).toBeGreaterThan(0); expect(readsWhilePinned).toBe(0);
  }, 30_000);
  it('preparation failure fails closed: clear error, nothing charged, no deed, connection pool free', async () => {
    const w = await world(); const before = w.bank.account('Rich').chips;
    setEconomyForTest({ playerAssets: async () => { throw new Error('economy down'); } } as never); resetPurchaseTaxCache();
    await expect(w.re.buy('Rich', farm().id)).rejects.toThrow(/Could not price the purchase wealth tax right now\. Nothing was charged/);
    expect(w.bank.account('Rich').chips).toBe(before); expect(await w.n("SELECT count(*) n FROM properties WHERE owner_key='rich'")).toBe(1);
    expect(await w.n("SELECT count(*) n FROM wallet_transactions WHERE game IN ('property_buy','wealth_tax_buy','wealth_tax_share')")).toBe(0);
    expect(w.checkedOut()).toBe(0);
  }, 30_000);
  it('a retried/duplicate buy (lost reply) charges once', async () => {
    const w = await world(); setEconomyForTest({ playerAssets: async () => ({ total: 0 }) } as never); resetPurchaseTaxCache();
    const p = farm(); const r = await w.re.buy('Rich', p.id); const after = w.bank.account('Rich').chips;
    await expect(w.re.buy('Rich', p.id)).rejects.toThrow(); expect(w.bank.account('Rich').chips).toBe(after);
    expect(await w.n("SELECT count(*) n FROM wallet_transactions WHERE game='wealth_tax_buy'")).toBe(1); expect(r.wealthTax).toBeGreaterThan(0);
  }, 30_000);
  it('prepared mode never falls back to a live roster scan: taxable without a prepared roster throws (mapped to a no-charge refusal)', async () => {
    const w = await world(); let reads = 0; setEconomyForTest({ playerAssets: async () => { reads++; return { total: 0 }; } } as never); resetPurchaseTaxCache();
    await expect(purchaseTaxMoves(w.setupPool as never, 'Rich', 10_000, 'k1', 'x', Date.now(), { roster: null })).rejects.toBeInstanceOf(PurchaseTaxUnprepared);
    expect(reads).toBe(0);
    expect(readFileSync('server/realEstate.ts', 'utf8')).toMatch(/PurchaseTaxUnprepared\) throw new PropertyError\('Your property total just changed/);
  }, 30_000);
});
