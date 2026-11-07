// Purchase wealth tax: 5% on top for buyers holding >100K of property (price paid), shared among other active players.
import { describe, expect, it, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Garage } from '../server/cars';
import { setJail, type Jail } from '../server/jail';
import { resetPurchaseTaxCache, quotePurchaseTax } from '../server/purchase-tax';
import { purchaseTaxOf, purchaseShares, purchaseTaxLine, PURCHASE_TAX_THRESHOLD } from '../shared/purchaseTax';
import { properties } from '../shared/realEstate';
import { CARS } from '../shared/cars';
import { px } from '../server/price-index';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, on: () => {}, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}
let jailed = new Set<string>();
setJail({ isJailed: (n: string | null | undefined) => !!n && jailed.has(n.toLowerCase()), status: () => null } as unknown as Jail);

async function setup(others: string[]) {
  resetPurchaseTaxCache(); jailed = new Set();
  const db = new PGlite(); const pool = shim(db) as never;
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  const re = new RealEstate(pool, () => bank); await re.init();
  await db.exec(`CREATE TABLE farm_tiles (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, owner_key TEXT NOT NULL, crop TEXT NOT NULL, planted_at BIGINT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY (plot_id, tile));
  CREATE TABLE farm_upgrades (plot_id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (plot_id, kind));
  CREATE TABLE farm_fert (plot_id TEXT NOT NULL, tile INTEGER NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (plot_id, tile, nonce));`);
  const fund = async (name: string, n: number) => { bank.transfer(name, n - bank.account(name).chips, { game: 'admin' }); await bank.flush(); };
  for (const o of others) await fund(o, 6000); // ledger activity = active; net worth >= 5,000 to receive shares
  const hold = async (name: string, value: number) => { await (pool as any).query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ($1,$2,$3,$4,0)', [`test:${name}:${value}`, name.toLowerCase(), name, value]); };
  const chips = async (k: string) => Number((await db.query<{ chips: string }>('SELECT chips FROM casino_players WHERE player_key = $1', [k])).rows[0]?.chips ?? 0);
  const ledger = async (game: string) => (await db.query<{ player_key: string; amount: string; tx_key: string; memo: string }>('SELECT player_key, amount, tx_key, memo FROM wallet_transactions WHERE game = $1 ORDER BY player_key', [game])).rows;
  return { db, pool, bank, re, fund, hold, chips, ledger };
}
const home = () => [...properties()].filter((p) => p.kind === 'building' && p.price >= 10_000).sort((a, b) => a.price - b.price)[0]!;

describe('purchase wealth tax: pure rule', () => {
  it('threshold is strictly above 100K; under-1,000 items are exempt; 5% rounded up', () => {
    expect(purchaseTaxOf(PURCHASE_TAX_THRESHOLD, 50_000)).toBe(0);
    expect(purchaseTaxOf(PURCHASE_TAX_THRESHOLD + 1, 50_000)).toBe(2_500);
    expect(purchaseTaxOf(500_000, 999)).toBe(0);
    expect(purchaseTaxOf(500_000, 1_001)).toBe(51);
  });
  it('split is equal, deterministic, and conserves the total (remainder to the first keys)', () => {
    const s = purchaseShares(10, ['a', 'b', 'c']);
    expect(s).toEqual([{ name: 'a', amount: 4 }, { name: 'b', amount: 3 }, { name: 'c', amount: 3 }]);
    expect(purchaseShares(2, ['a', 'b', 'c']).map((x) => x.name)).toEqual(['a', 'b']);
    expect(purchaseTaxLine(1250, 3)).toBe('Wealth tax 5%: 1,250 chips, shared with 3 players');
  });
});

describe('purchase wealth tax: property and car purchases', () => {
  beforeEach(() => resetPurchaseTaxCache());
  it('no tax at or below 100K held', async () => {
    const s = await setup(['Ann', 'Bob']); const p = home();
    await s.hold('Rich', 100_000); await s.fund('Rich', 1_000_000);
    const r = await s.re.buy('Rich', p.id); expect(r.wealthTax).toBe(0);
    expect(await s.ledger('wealth_tax_buy')).toEqual([]);
  });
  it('above 100K: 5% on top, split equally among other active non-QA/guest/jailed players, atomic with the buy', async () => {
    const s = await setup(['Ann', 'Bob', 'Cat', 'QA-Cole-Visit', 'Guest123', 'Jay']); jailed.add('jay');
    const p = home(); await s.hold('Rich', 150_000); await s.fund('Rich', 1_000_000);
    const price = (await s.re.quote('Rich', p.id)).price; const q = await quotePurchaseTax(s.pool as never, 'Rich', price);
    expect(q.recipients).toBe(3); const tax = Math.ceil(price * 0.05); expect(q.tax).toBe(tax);
    const r = await s.re.buy('Rich', p.id); expect(r.wealthTax).toBe(tax); expect(r.wealthTaxRecipients).toBe(3);
    await s.bank.flush();
    expect(await s.chips('rich')).toBe(1_000_000 - price - tax);
    const shares = await s.ledger('wealth_tax_share');
    expect(shares.map((x) => x.player_key)).toEqual(['ann', 'bob', 'cat']);
    expect(shares.reduce((a, x) => a + Number(x.amount), 0)).toBe(tax);
    expect(Math.max(...shares.map((x) => Number(x.amount))) - Math.min(...shares.map((x) => Number(x.amount)))).toBeLessThanOrEqual(1);
    const buy = (await s.ledger('wealth_tax_buy'))[0]!; expect(Number(buy.amount)).toBe(-tax); expect(buy.memo).toMatch(/Wealth tax 5%: .* chips, shared with 3 players/);
    for (const x of shares) expect(x.tx_key).toBe(`wealth_tax_share:${buy.tx_key.slice('wealth_tax_buy:'.length)}:${x.player_key}`);
    expect(s.bank.account('Ann').chips).toBe(6000 + Number(shares[0]!.amount));
  });
  it('zero recipients: no tax charged (redistributed, never burned)', async () => {
    const s = await setup([]); const p = home(); await s.hold('Rich', 150_000); await s.fund('Rich', 1_000_000);
    const r = await s.re.buy('Rich', p.id); expect(r.wealthTax).toBe(0);
  });
  it('insufficient chips for price + tax refuses up front, nothing moves', async () => {
    const s = await setup(['Ann']); const p = home(); await s.hold('Rich', 150_000);
    const price = (await s.re.quote('Rich', p.id)).price; await s.fund('Rich', price + 1);
    await expect(s.re.buy('Rich', p.id)).rejects.toThrow(/Not enough chips.*Wealth tax 5%/);
    expect(await s.chips('rich')).toBe(price + 1); expect(await s.ledger('wealth_tax_share')).toEqual([]);
  });
  it('atomic rollback: a failing share key (replay) aborts the purchase, the tax and every share', async () => {
    const s = await setup(['Ann', 'Bob', 'Cat']); const p = home(); await s.hold('Rich', 150_000); await s.fund('Rich', 1_000_000);
    // Make the purchase's own row insert fail AFTER the tax moves were built: someone else takes the property in-txn.
    await (s.pool as any).query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ($1,$2,$3,$4,0)', [p.id, 'zed', 'Zed', 1]);
    await expect(s.re.buy('Rich', p.id)).rejects.toThrow(/already owns/);
    await s.bank.flush();
    expect(await s.chips('rich')).toBe(1_000_000); expect(await s.chips('ann')).toBe(6000);
    expect(s.bank.account('Ann').chips).toBe(6000); expect(s.bank.account('Rich').chips).toBe(1_000_000);
    expect(await s.ledger('wealth_tax_buy')).toEqual([]); expect(await s.ledger('wealth_tax_share')).toEqual([]);
  });
  it('idempotency: a replayed share key is refused by the ledger and the whole transfer rolls back', async () => {
    const s = await setup(['Ann', 'Bob']); await s.hold('Rich', 150_000); await s.fund('Rich', 1_000_000);
    const moves = [{ name: 'Rich', amount: -10, key: 'wealth_tax_buy:k1', game: 'wealth_tax_buy' }, { name: 'Ann', amount: 5, key: 'wealth_tax_share:k1:ann', game: 'wealth_tax_share' }, { name: 'Bob', amount: 5, key: 'wealth_tax_share:k1:bob', game: 'wealth_tax_share' }];
    const run = async () => { const w = s.bank.transferAtomic(moves, { batch: true }); const p = (async () => { await w.after; const cl = await (s.pool as any).connect(); try { await cl.query('BEGIN'); for (const x of w.stmts) await cl.query(x.sql, x.args); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK'); throw e; } finally { cl.release(); } })(); w.bind(p); try { await p; } catch (e) { w.revert(); throw e; } };
    await run(); await s.bank.flush();
    expect(() => s.bank.transferAtomic(moves, { batch: true })).toThrow(/Already applied/); // same instance
    expect((await s.ledger('wealth_tax_share')).length).toBe(2); expect(await s.chips('ann')).toBe(6005);
  });
  it('batches many recipients into a constant number of statements', async () => {
    const names = Array.from({ length: 300 }, (_, i) => `P${String(i).padStart(3, '0')}`);
    const s = await setup(names); const p = home(); await s.hold('Rich', 150_000); await s.fund('Rich', 10_000_000);
    const t0 = Date.now(); const r = await s.re.buy('Rich', p.id); const ms = Date.now() - t0;
    expect(r.wealthTaxRecipients).toBe(300); await s.bank.flush();
    const shares = await s.ledger('wealth_tax_share'); expect(shares.length).toBe(Math.min(300, r.wealthTax));
    expect(shares.reduce((a, x) => a + Number(x.amount), 0)).toBe(r.wealthTax);
    const moves = Array.from({ length: 300 }, (_, i) => ({ name: `Q${i}`, amount: 1, key: `b:${i}`, game: 't' }));
    expect(s.bank.transferAtomic([{ name: 'Rich', amount: -300, key: 'b:x', game: 't' }, ...moves], { batch: true }).stmts.length).toBe(6);
    expect(ms).toBeLessThan(5_000);
  });
  it('cars: quote shows the tax and the buy charges price + tax, shared atomically', async () => {
    const s = await setup(['Ann', 'Bob']); await s.hold('Rich', 150_000);
    const { getBank } = await import('../server/casino-store'); const gb = getBank(); gb.retryMs = []; await gb.attach(new PgCasinoStore(s.pool));
    gb.transfer('Rich', 10_000_000 - gb.account('Rich').chips, { game: 'admin' }); await gb.flush();
    const g = new Garage(s.pool as never); await g.init();
    const car = [...CARS].sort((a, b) => b.price - a.price)[0]!; const tax = Math.ceil(px(car.price) * 0.05);
    const q = await g.buyQuote('Rich', car.id); expect(q.wealthTax.tax).toBe(tax); expect(q.wealthTax.recipients).toBe(2);
    const r = await g.buy('Rich', car.id, undefined); expect(r.wealthTax).toBe(tax); await gb.flush();
    expect(await s.chips('rich')).toBe(10_000_000 - px(car.price) - tax);
    expect((await s.ledger('wealth_tax_share')).reduce((a, x) => a + Number(x.amount), 0)).toBe(tax);
  });
});

describe('purchase wealth tax: threshold = price paid + upgrades held (no planted seed)', () => {
  beforeEach(() => resetPurchaseTaxCache());
  it('upgrades bought for a property count toward the 100K line; planted seed does not', async () => {
    const { Farm } = await import('../server/farm'); const { farmPlots, cropById } = await import('./farm-helpers');
    const { propertyPaidValue } = await import('../server/purchase-tax');
    const { propertyPaidPlusUpgrades, propertyWorth } = await import('../shared/netWorth');
    expect(propertyPaidPlusUpgrades({ paid: 99_000, list: 5, upgrades: 2_000 })).toBe(101_000);
    expect(propertyWorth({ paid: 99_000, list: 5, upgrades: 2_000, crops: 40 })).toBe(101_040);
    const s = await setup(['Ann', 'Bob']); const farm = new Farm(s.pool as never, () => s.bank); await farm.init();
    const plot = farmPlots().find((p) => p.cols * p.rows === 16)!; const id = `f:${plot.n}`;
    await (s.pool as any).query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ($1,$2,$3,$4,0)', [id, 'rich', 'Rich', PURCHASE_TAX_THRESHOLD]);
    await s.fund('Rich', 1_000_000);
    // Exactly at the line: planting seed does NOT push it over.
    await farm.plant('Rich', id, 'wheat', [0, 1, 2]); expect(cropById('wheat')!.seed).toBeGreaterThan(0);
    expect(await propertyPaidValue(s.pool as never, 'Rich')).toBe(PURCHASE_TAX_THRESHOLD);
    expect((await quotePurchaseTax(s.pool as never, 'Rich', 50_000)).tax).toBe(0);
    // An upgrade bought for it does.
    const up = await farm.buyUpgrade('Rich', id, 'sprinkler'); expect(up.cost).toBeGreaterThan(0);
    expect(await propertyPaidValue(s.pool as never, 'Rich')).toBe(PURCHASE_TAX_THRESHOLD + up.cost);
    expect((await quotePurchaseTax(s.pool as never, 'Rich', 50_000)).tax).toBe(2_500);
  });
});
