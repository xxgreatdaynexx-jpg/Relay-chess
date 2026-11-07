// Surcharge base = price paid + upgrades (same as the 5% wealth tax), and the property back-tax for old under-charged buys.
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate, propertyPaidPlusUpgradesOf } from '../server/realEstate';
import { Garage } from '../server/cars';
import { setJail, type Jail } from '../server/jail';
import { resetPurchaseTaxCache, quotePurchaseTax } from '../server/purchase-tax';
import { backTaxOf, BACKTAX_GAME } from '../server/backTax';
import { properties, landPrice } from '../shared/realEstate';
import { CARS } from '../shared/cars';
import { px } from '../server/price-index';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, on: () => {}, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}
setJail({ isJailed: () => false, status: () => null } as unknown as Jail);
const FARM = `CREATE TABLE IF NOT EXISTS farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
CREATE TABLE IF NOT EXISTS farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
CREATE TABLE IF NOT EXISTS farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));`;
async function setup() {
  resetPurchaseTaxCache(); const db = new PGlite(); const pool = shim(db) as never;
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const re = new RealEstate(pool, () => bank); await re.init(); await db.exec(FARM);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  await fund('Other', 6000); // an active recipient (net worth >= 5,000)
  const hold = (id: string, owner: string, paid: number, at = 0) => (pool as any).query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ($1,$2,$3,$4,$5)', [id, owner.toLowerCase(), owner, paid, at]);
  // a historical buy row exactly as RealEstate wrote it (old list-price base in the memo)
  const pastBuy = async (owner: string, id: string, label: string, paid: number, oldBase: number, iso: string) => {
    const note = oldBase > 0 ? ` +${+(oldBase / 1000 * 2).toFixed(1)}% surcharge: you own ${oldBase.toLocaleString('en-US')} in property` : '';
    await (pool as any).query(`INSERT INTO wallet_transactions (tx_key, player_key, name, game, amount, balance, memo, created_at) VALUES ($1,$2,$3,'property_buy',$4,0,$5,$6)`, [`property_buy:${id}`, owner.toLowerCase(), owner, -paid, `Bought ${label} (${id})${note}`, iso]);
    await hold(id, owner, paid);
  };
  const chips = async (k: string) => Number((await db.query<{ chips: string }>('SELECT chips FROM casino_players WHERE player_key = $1', [k])).rows[0]?.chips ?? 0);
  return { db, pool, bank, re, fund, hold, pastBuy, chips };
}
const cheap = (k: number) => [...properties()].filter((p) => p.kind !== 'landmark' && p.kind !== 'farm').sort((a, b) => a.price - b.price).slice(0, k);
const farm = () => [...properties()].find((p) => p.kind === 'farm')!;

describe('surcharge base = price paid + upgrades', () => {
  it('base is what was paid (not list), and the quote total equals the 5% wealth tax property total', async () => {
    const s = await setup(); const [a, b] = cheap(2);
    await s.hold(a!.id, 'Dayne', 136_000);
    const q = await s.re.quote('Dayne', b!.id);
    expect(q.ownedValue).toBe(136_000); expect(q.surchargePct).toBeCloseTo(136); expect(q.price).toBe(landPrice(px(b!.price), 136_000));
    expect(q.ownedValue).toBe(await propertyPaidPlusUpgradesOf(s.pool as never, 'Dayne'));
    expect(q.ownedValue).toBe((await quotePurchaseTax(s.pool as never, 'Dayne', q.price)).propertyValue);
  });
  it('farm upgrades count; planted seed does not', async () => {
    const s = await setup(); const f = farm(); const [b] = cheap(1);
    await s.hold(f.id, 'Ann', 20_000);
    const base = (await s.re.quote('Ann', b!.id)).ownedValue;
    await (s.pool as any).query("INSERT INTO farm_upgrades (plot_id, kind, owner_key, level) VALUES ($1,'sprinkler','ann',1)", [f.id]);
    const up = (await s.re.quote('Ann', b!.id)).ownedValue; expect(up).toBeGreaterThan(base);
    await (s.pool as any).query("INSERT INTO farm_tiles (plot_id, tile, owner_key, crop, planted_at, nonce) VALUES ($1,0,'ann','carrot',0,'n')", [f.id]);
    expect((await s.re.quote('Ann', b!.id)).ownedValue).toBe(up);
  });
});

describe('historical property back-tax permanently canceled', () => {
  it('old underpaid purchases never block property/cars or charge cached pay requests, including after new buys', async () => {
    const s = await setup(); const [a, b, c, d] = cheap(4);
    await s.pastBuy('Dayne', a!.id, a!.label, 120_000, 0, '2026-11-02T12:00:00Z');
    await s.pastBuy('Dayne', b!.id, b!.label, px(b!.price), 1000, '2026-11-04T20:00:00Z');
    await s.fund('Dayne', 10_000_000);
    expect((await backTaxOf(s.pool as never, 'Dayne')).debt).toBe(0);
    const before = await s.chips('dayne');
    const results = await Promise.all([s.re.payBackTax('Dayne'), s.re.payBackTax('Dayne')]);
    expect(results.map(r => r.paid)).toEqual([0, 0]);
    expect(await s.chips('dayne')).toBe(before);
    expect(await s.chips('other')).toBe(6000);
    await expect(s.re.buy('Dayne', c!.id)).resolves.toBeTruthy();
    const g = new Garage(s.pool as never); await g.init(); await expect(g.buy('Dayne', CARS[0]!.id, undefined)).resolves.toBeTruthy();
    await expect(s.re.buy('Dayne', d!.id)).resolves.toBeTruthy();
    expect((await backTaxOf(s.pool as never, 'Dayne')).debt).toBe(0);
    expect((await s.re.payBackTax('Dayne')).paid).toBe(0);
    expect(Number((await (s.pool as any).query(`SELECT COUNT(*) n FROM wallet_transactions WHERE game = '${BACKTAX_GAME}'`)).rows[0].n)).toBe(0);
  });
  it('never reconstructs canceled debt or depends on historical DB availability', async () => {
    const bad = { query: async () => { throw new Error('history offline'); } };
    expect((await backTaxOf(bad, 'Dayne')).debt).toBe(0);
  });
});
