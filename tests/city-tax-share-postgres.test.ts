/**
 * pt2032u: 25% of the tax collected through tax-bearing City levers goes to the treasury, without changing any bill.
 * Real PostgreSQL (MAYOR_LAWS_TEST_DATABASE_URL, local only); pure invariants always run.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { CasinoBank, PgCasinoStore, getBank } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Garage } from '../server/cars';
import { CITY_MIGRATION } from '../server/city';
import { setCityRates, treasuryCreditStmts, type CityRates } from '../server/city-rates';
import { resetPurchaseTaxCache } from '../server/purchase-tax';
import { runWealthTax } from '../server/wealth-tax';
import { setEconomyForTest } from '../server/economy';
import { setJail, type Jail } from '../server/jail';
import { LEVERS, taxShareSplit, treasuryShareOf } from '../shared/city';
import { planWealthTax } from '../shared/wealthTax';
import { properties } from '../shared/realEstate';
import { CARS } from '../shared/cars';
import { px } from '../server/price-index';

setJail({ isJailed: () => false, status: () => null } as unknown as Jail);
const live: CityRates = { lever: (id) => LEVERS[id].base, policyMul: () => 1, perk: () => 0 };

describe('pure invariants', () => {
  it('split always sums to the collected amount; floor 25%', () => {
    for (const n of [0, 1, 3, 4, 7, 51, 2_500, 123_457]) { const s = taxShareSplit(n); expect(s.treasury + s.rest).toBe(n); expect(s.treasury).toBe(Math.floor(n / 4)); expect(s.treasury).toBe(treasuryShareOf(n)); }
  });
  it('daily plan: same payers and charged amounts; 25% to treasury, 75% pool conserved; off = old behaviour', () => {
    const rows = [{ name: 'a', netWorth: 10_000, chips: 10_000 }, { name: 'b', netWorth: 20_000, chips: 5_000 }, { name: 'c', netWorth: 900_000, chips: 400_000 }, { name: 'd', netWorth: 6_000, chips: 6_000 }, { name: 'e', netWorth: 12_000, chips: 1 }];
    const off = planWealthTax(rows), on = planWealthTax(rows, () => false, undefined, true);
    expect(off.treasury).toBe(0); expect(on.taxes).toEqual(off.taxes); expect(on.total).toBe(off.total);
    expect(on.treasury).toBe(Math.floor(off.total / 4)); expect(on.shares.reduce((a, s) => a + s.amount, 0)).toBe(on.total - on.treasury);
    expect(off.shares.reduce((a, s) => a + s.amount, 0)).toBe(off.total);
  });
});

const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = []; afterAll(async () => { setCityRates(null); for (const d of drops) await d(); });
async function freshDb() {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
  const name = `ts_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
  u.pathname = `/${name}`; const pool = new pg.Pool({ connectionString: u.toString(), max: 6 }); drops.push(async () => { await pool.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); });
  return pool;
}
async function setup(cityOpen: boolean, bank = new CasinoBank()) {
  resetPurchaseTaxCache(); setCityRates(cityOpen ? live : null);
  const pool = await freshDb(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool as never)); await pool.query(CITY_MIGRATION);
  const re = new RealEstate(pool as never, () => bank); await re.init();
  await pool.query(`CREATE TABLE farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
  CREATE TABLE farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
  CREATE TABLE farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));`);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  for (const o of ['Ann', 'Bob', 'Cat']) await fund(o, 6000);
  await pool.query("INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ('test:rich', 'rich', 'Rich', 150000, 0)");
  await fund('Rich', 2_000_000);
  const bal = async () => Number((await pool.query("SELECT balance FROM city_treasury WHERE id='main'")).rows[0].balance);
  const sum = async (game: string, pos: boolean) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM wallet_transactions WHERE game=$1 AND amount ${pos ? '>' : '<'} 0`, [game])).rows[0].s);
  return { pool, bank, re, fund, bal, sum };
}
const home = () => [...properties()].filter((p) => p.kind === 'building' && !p.retired && p.price >= 10_000).sort((a, b) => a.price - b.price)[0]!;

describe.skipIf(!url)('real PostgreSQL', () => {
  beforeEach(() => resetPurchaseTaxCache());
  it('property buy: identical bill; treasury gets 25% of purchase wealth tax (no surcharge: Bill Chud 1); recipients get the rest', async () => {
    const closed = await setup(false); const c = await closed.re.buy('Rich', home().id);
    const open = await setup(true); const o = await open.re.buy('Rich', home().id);
    expect(o.price).toBe(c.price); expect(o.wealthTax).toBe(c.wealthTax); expect(open.bank.account('Rich').chips).toBe(closed.bank.account('Rich').chips); // same bill
    expect(o.price).toBe(px(home().price)); // list price: no surcharge
    const wt = taxShareSplit(o.wealthTax);
    expect(await open.bal()).toBe(wt.treasury);
    expect(await open.sum('wealth_tax_share', true)).toBe(wt.rest); expect(await closed.sum('wealth_tax_share', true)).toBe(c.wealthTax);
    expect(-(await open.sum('wealth_tax_buy', false))).toBe(o.wealthTax);
    const led = (await open.pool.query('SELECT id, kind, amount FROM city_treasury_ledger ORDER BY kind')).rows;
    expect(led.map((r) => [r.kind, Number(r.amount)])).toEqual([['wealth_tax_buy', wt.treasury]]);
    expect(led.every((r) => /^(property_surcharge|wealth_tax_buy):/.test(r.id))).toBe(true);
    expect(await closed.bal()).toBe(0);
  });
  it('car buy: wealth tax 25% to treasury in the purchase transaction; bill unchanged', async () => {
    const s = await setup(true, getBank()); const g = new Garage(s.pool as never); await g.init?.();
    const car = [...CARS].sort((a, b) => a.price - b.price).find((x) => px(x.price) >= 1000)!;
    const before = s.bank.account('Rich').chips; const r = await g.buy('Rich', car.id, undefined);
    expect(before - s.bank.account('Rich').chips).toBe(r.price + r.wealthTax);
    expect(await s.bal()).toBe(taxShareSplit(r.wealthTax).treasury); expect(await s.sum('wealth_tax_share', true)).toBe(r.wealthTax - taxShareSplit(r.wealthTax).treasury);
  });
  it('treasury share is exactly-once: a replayed key aborts the whole transaction', async () => {
    const s = await setup(true); const cl = await s.pool.connect();
    try {
      await cl.query('BEGIN'); for (const x of treasuryCreditStmts('wealth_tax', 100, 'm', 1, 'wealth_tax_day:2026-11-08')) await cl.query(x.sql, x.args); await cl.query('COMMIT');
      await cl.query('BEGIN'); await expect((async () => { for (const x of treasuryCreditStmts('wealth_tax', 100, 'm', 1, 'wealth_tax_day:2026-11-08')) await cl.query(x.sql, x.args); })()).rejects.toThrow(/duplicate/); await cl.query('ROLLBACK');
    } finally { cl.release(); }
    expect(await s.bal()).toBe(100);
  });
  it('no eligible recipients: no tax at all, nothing to the treasury (guard also covers recipients vanishing after the quote)', async () => {
    const s = await setup(true); await s.pool.query("DELETE FROM wallet_transactions WHERE player_key IN ('ann','bob','cat')"); resetPurchaseTaxCache();
    const before = s.bank.account('Rich').chips; const r = await s.re.buy('Rich', home().id);
    expect(r.wealthTax).toBe(0); expect(before - s.bank.account('Rich').chips).toBe(r.price); expect(await s.sum('wealth_tax_buy', false)).toBe(0);
  });
  it('wealth tax card copy is accurate about the cap and shows the treasury part of the last run', () => {
    const src = readFileSync('client/src/components/WealthTaxCard.tsx', 'utf8');
    expect(src).toMatch(/capped at 🪙 10,000,000; any part above the cap is burned/); expect(src).toMatch(/w\.last\.treasury/);
    expect(src).not.toMatch(/75% is split evenly among active players below the line\. Nothing is burned/);
  });
  it('treasury cap: credits stop at the cap (existing rule), nothing minted to players', async () => {
    const s = await setup(true); await s.pool.query("UPDATE city_treasury SET balance = 9999990 WHERE id='main'");
    const r = await s.re.buy('Rich', home().id); expect(await s.bal()).toBe(10_000_000);
    expect(await s.sum('wealth_tax_share', true)).toBe(r.wealthTax - taxShareSplit(r.wealthTax).treasury);
  });
  it('daily wealth tax run: charged amounts unchanged, 25% to treasury, 75% split, second run of the day is a no-op', async () => {
    const bank = getBank(); const s = await setup(true, bank);
    await s.pool.query('CREATE TABLE IF NOT EXISTS wealth_tax_days (day TEXT PRIMARY KEY, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const [n, c] of [['Dee', 12_000], ['Eve', 15_000], ['Fay', 11_000], ['Gus', 900_000]] as const) await s.fund(n, c);
    setEconomyForTest({ playerAssets: async () => ({ total: 0 }) } as never);
    try {
      const sum = (await runWealthTax(s.pool as never))!; expect(sum.total).toBeGreaterThan(0);
      const charged = -(await s.sum('wealth_tax', false)); const paid = await s.sum('wealth_tax', true);
      expect(charged).toBe(sum.total); expect(sum.treasury).toBe(Math.floor(sum.total / 4)); expect(paid).toBe(sum.total - sum.treasury!);
      expect(await s.bal()).toBe(sum.treasury);
      expect(await runWealthTax(s.pool as never)).toBeNull(); expect(await s.bal()).toBe(sum.treasury);
    } finally { setEconomyForTest(null); }
  });
});
