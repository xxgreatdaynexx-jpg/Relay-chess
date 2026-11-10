/**
 * City real estate (see shared/realEstate.ts for the price table and tax rule). Postgres is the source of truth:
 *  - properties: one row per owned property (PRIMARY KEY id = one owner; a purchase race loses on the INSERT).
 *  - property_tax: one row per (UTC day, property) — the claim that makes the daily tax exactly-once across instances
 *    and restarts. The claim, the wallet debit (CasinoBank.transferAtomic + ledger row, game 'property_tax') and the
 *    arrears / repossession update commit in one transaction. Tax is a chip sink (burned, no house account).
 * Buying ('property_buy') and selling back to the city at 70% ('property_sell') use the same atomic wallet path.
 */
import { PROPERTY_INCOME_EVERY_MS, incomeEligible } from '../shared/propertyIncome.js';
import { PropertyIncome, PropertyIncomeFailure } from './propertyIncome.js';
import { zoneRefusal, zoneUse, zoneLine, zoneOf, type ZoneUse } from '../shared/zoning.js';
import { cityPerk, treasuryStmtsFor, treasuryCreditStmts, treasuryOpenFor } from './city-rates.js';
import { treasuryShareOf, taxShareSplit } from '../shared/city.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { bootAttach, setBootState } from './boot-retry.js';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { getRoyalties } from './royalty.js';
import { sendPopup } from './popups.js';
import { BUYOUT_MUL, BUYOUT_PROTECT_MS, buyoutPrice } from '../shared/royalty.js';
import { px, priceIndex } from './price-index.js';
import { requireResort } from './travel.js';
import { taxBasisOf, propertyValue, GRACE_DAYS, propertyById as baseProperty, sellBackOf, taxOf, landMultiplier, type OwnedProperty } from '../shared/realEstate.js';
import { skillLevelAsync } from './skills.js';
import { propertyWorth, propertyPaid, propertyPaidPlusUpgrades, upgradeSpendFromLevels } from '../shared/netWorth.js';
import { cropById, farmPlots } from '../shared/farm.js';
import { upgradeDef, upgradePrice, type FarmUpgradeKind } from '../shared/farmUpgrades.js';
import { fieldPlotOf } from '../shared/fieldFarms.js';
import { isBigFarmN } from '../shared/bigFarms.js';
import { resortPlotOf } from '../shared/resort.js';
import { fertDef, fertCost } from '../shared/farmWork.js';
import { propertyTaxMul } from '../shared/skillPerks.js';
import { cityPropertyTaxMul } from './mayor.js';
import { preparePurchaseTax, purchaseTaxMoves, quotePurchaseTax, PurchaseTaxUnprepared, type PurchaseTaxPrep } from './purchase-tax.js';
import { backTaxOf, backTaxMoves, backTaxBlockMsg } from './backTax.js';

export class PropertyError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export const PROPERTY_MIGRATION = `
CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_name TEXT NOT NULL, price BIGINT NOT NULL,
  bought_at BIGINT NOT NULL, arrears INT NOT NULL DEFAULT 0, tax_paid BIGINT NOT NULL DEFAULT 0, deed TEXT);
CREATE INDEX IF NOT EXISTS properties_owner ON properties (owner_key);
CREATE TABLE IF NOT EXISTS property_tax (day TEXT NOT NULL, property_id TEXT NOT NULL, owner_key TEXT NOT NULL, amount BIGINT NOT NULL, paid BOOLEAN NOT NULL,
  repossessed BOOLEAN NOT NULL DEFAULT false, at BIGINT NOT NULL, claim TEXT, PRIMARY KEY (day, property_id));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS city_price BIGINT;`;

type Pool = pg.Pool;
interface Row { id: string; owner_key: string; owner_name: string; price: string | number; bought_at: string | number; arrears: number; tax_paid: string | number; city_price?: string | number | null }
/** Catalog entry with today's indexed list price (list prices and tax follow the price index). */
const plotTiles = (id: string): number | null => {
  if (/^f:\d+$/.test(id)) { const p = farmPlots().find((q) => `f:${q.n}` === id); return p ? p.cols * p.rows : null; }
  const c = fieldPlotOf(id) ?? resortPlotOf(id); return c ? c.cols * c.rows : null;
};
/** Became taxable after preparation (e.g. another instance's buy landed first): refuse, nothing charged. */
const unprepared = (e: unknown): never => { if (e instanceof PurchaseTaxUnprepared) throw new PropertyError('Your property total just changed, so the purchase wealth tax needs a fresh price. Nothing was charged. Try again.'); throw e; };
const propertyById = (id: Parameters<typeof baseProperty>[0]) => { const p = baseProperty(id); return p ? { ...p, price: px(p.price) } : undefined; };
const toOwned = (r: Row): OwnedProperty => ({ id: r.id, owner: r.owner_name, price: Number(r.price), arrears: Number(r.arrears), boughtAt: Number(r.bought_at), ...(r.city_price != null && Number(r.city_price) !== Number(r.price) ? { basis: Number(r.city_price) } : {}) });

export class RealEstate {
  onChange?: () => void;
  private timer: NodeJS.Timeout | null = null;
  /** Same-instance serialisation per property id (cross-instance races are settled by the PRIMARY KEY). */
  private locks = new Map<string, Promise<unknown>>();
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  constructor(private readonly pool: Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) { this.income = new PropertyIncome(pool, clock); }
  private readonly income: PropertyIncome;
  async init() { await this.pool.query(PROPERTY_MIGRATION); await this.income.init(); }
  /** Automatic/offline catch-up; no client claim or per-owner activity required. */
  runIncome(now = this.clock()) { return this.income.run(now, (name) => this.bank().notifyDurableBalance(name)); }

  async owned(): Promise<OwnedProperty[]> {
    return ((await this.pool.query('SELECT * FROM properties ORDER BY id')).rows as Row[]).map(toOwned);
  }
  async ownerOf(id: string): Promise<{ key: string; name: string } | null> {
    const r = (await this.pool.query('SELECT owner_key, owner_name FROM properties WHERE id = $1', [id])).rows[0] as { owner_key: string; owner_name: string } | undefined;
    return r ? { key: String(r.owner_key), name: String(r.owner_name) } : null;
  }
  /** Monument royalties earned by each landmark's CURRENT owner since they bought it (ledger game 'monument_royalty'). */
  async royalties(): Promise<Record<string, number>> {
    try {
      const rows = (await this.pool.query(`SELECT p.id, COALESCE(SUM(t.amount), 0) s FROM properties p JOIN wallet_transactions t
          ON t.game = 'monument_royalty' AND t.player_key = p.owner_key AND t.tx_key LIKE 'royalty:' || substr(p.id, 4) || ':%' AND t.created_at >= to_timestamp(p.bought_at / 1000.0)
        WHERE p.id LIKE 'lm:%' GROUP BY p.id`)).rows as { id: string; s: unknown }[];
      return Object.fromEntries(rows.map((r) => [r.id, Number(r.s)]));
    } catch { return {}; }
  }
  async mine(name: string) {
    const rows = ((await this.pool.query('SELECT * FROM properties WHERE owner_key = $1 ORDER BY price DESC', [keyOf(name)])).rows as Row[]);
    const sp = await this.spend(keyOf(name));
    return rows.map((r) => { const p = propertyById(r.id); return { ...toOwned(r), label: p?.label ?? r.id, type: p?.type ?? '', value: propertyWorth({ paid: Number(r.price), list: p?.price ?? 0, ...(sp.get(r.id) ?? {}) }), list: p?.price ?? Number(r.price), paid: propertyPaid(Number(r.price), p?.price ?? 0), upgradeSpend: sp.get(r.id)?.upgrades ?? 0, cropValue: sp.get(r.id)?.crops ?? 0, tax: taxOf(taxBasisOf(Number(r.price), p?.price ?? 0)), taxPaid: Number(r.tax_paid) }; });
  }

  /** Atomic: the ledger rows and the ownership change commit together, or neither does. */
  private async atomic(name: string, amount: number, game: string, memo: string, body: (cl: pg.PoolClient) => Promise<void>, extra: Array<{ name: string; amount: number; game: string; memo: string }> | ((key: string, db: pg.PoolClient) => Promise<Array<{ name: string; amount: number; key: string; game: string; memo?: string }>>) = [], db?: pg.PoolClient) {
    const bank = this.bank(); const key = `${game}:${randomUUID()}`;
    const cl = db ?? await this.pool.connect(); let transaction = false;
    try {
      await cl.query('BEGIN'); transaction = true;
      const more = typeof extra === 'function' ? await extra(key, cl) : extra.map((m) => ({ ...m, key: `${m.game}:${randomUUID()}` }));
      const w = bank.transferAtomic([{ name, amount, key, game, memo }, ...more], { batch: more.length > 1 });
      const run = async () => {
        try {
          await w.after; await body(cl);
          for (const s of w.stmts) await cl.query(s.sql, s.args);
          await cl.query('COMMIT'); transaction = false;
        } catch (e) { await cl.query('ROLLBACK').catch(() => {}); transaction = false; throw e; }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); throw e; }
    } catch (e) {
      if (transaction) { await cl.query('ROLLBACK').catch(() => {}); transaction = false; }
      if (e instanceof PropertyError) throw e;
      console.error(`[realestate] ${game} failed:`, (e as Error).message);
      throw new PropertyError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.');
    } finally { if (!db) cl.release(); }
  }

  /** Serialize the complete buy across processes on one client, then commit on that same client. */
  private async buyNow(name: string, p: NonNullable<ReturnType<typeof propertyById>>, max: number | undefined, prep: PurchaseTaxPrep) {
    // Bank refresh may use this same pool: finish it before reserving the lock connection.
    await this.bank().refresh(name);
    const cl = await this.pool.connect(); const lockKey = `property-buy:${keyOf(name)}`;
    try {
      await cl.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      return await this.buyLocked(name, p, cl, max, prep);
    } finally {
      let failure: unknown;
      try { await cl.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]); }
      catch (e) { failure = e; console.error('[realestate] owner unlock failed:', (e as Error).message); }
      finally { cl.release(failure as Error | undefined); }
    }
  }

  /** Parcels this player owns right now. */
  async ownedCount(name: string, cl: { query: pg.Pool['query'] } = this.pool): Promise<number> {
    return Number((await cl.query('SELECT COUNT(*) n FROM properties WHERE owner_key = $1', [keyOf(name)])).rows[0].n);
  }
  /** Property total that drives the surcharge: price paid + upgrades held (no planted seed). */
  async ownedValue(name: string, cl: { query: pg.Pool['query'] } = this.pool): Promise<number> {
    return propertyPaidPlusUpgradesOf(cl, name);
  }
  /** Price-paid sum for the transaction-local price guard. */
  async ownedPaid(name: string, cl: { query: pg.Pool['query'] } = this.pool): Promise<number> {
    const rows = (await cl.query('SELECT id, price FROM properties WHERE owner_key = $1', [keyOf(name)])).rows as { id: string; price: unknown }[];
    return rows.reduce((a, r) => a + propertyPaid(Number(r.price), propertyById(r.id)?.price ?? 0), 0);
  }
  /** Bill Chud 1 zoning: what this owner already holds per zone (grandfathered deeds included). Unknown/removed ids count 0. */
  async zoneUse(name: string, cl: { query: pg.Pool['query'] } = this.pool): Promise<ZoneUse> {
    const rows = (await cl.query('SELECT id FROM properties WHERE owner_key = $1', [keyOf(name)])).rows as { id: string }[];
    return zoneUse(rows.map((r) => propertyById(String(r.id))).filter((x): x is NonNullable<typeof x> => !!x));
  }
  /** What this player would pay for a property right now. */
  async quote(name: string, id: unknown) {
    const p = propertyById(id); if (!p || p.retired) throw new PropertyError('That property is not for sale.');
    const owned = await this.ownedCount(name); const value = await this.ownedValue(name);
    // Bill Chud 1: the purchase surcharge is abolished; new buys pay the list price (plus the unchanged purchase wealth tax).
    const price = p.price; const wealthTax = await quotePurchaseTax(this.pool, name, price, this.clock());
    const backTax = await backTaxOf(this.pool, name); const use = await this.zoneUse(name);
    return { id: p.id, list: p.price, owned, ownedValue: value, surchargePct: 0, surchargePer1k: 0, multiplier: 1, price, wealthTax, backTax, zone: zoneOf(p), zoneLine: zoneLine(use, p), zoneRefusal: zoneRefusal(use, p) };
  }
  /** max: the price the player saw; a higher price now (they bought something else meanwhile) refuses instead of surprising them. */
  async buy(name: string, id: unknown, max?: unknown) {
    const p = propertyById(id); if (!p || p.retired) throw new PropertyError('That property is not for sale.');
    // Price the tax roster before taking the in-process owner/plot locks or pinning a pool client.
    // A slow roster used to hold those locks so a later click sat on Buying… and a failed attempt never released promptly.
    let prep: PurchaseTaxPrep;
    try { prep = await preparePurchaseTax(this.pool, name, this.clock()); }
    catch (e) { console.error('[realestate] purchase tax prep failed:', (e as Error).message); throw new PropertyError('Could not price the purchase wealth tax right now. Nothing was charged. Try again.'); }
    // per-buyer lock too: two parallel buys by one player can't both be priced at the same n
    return this.lock(`owner:${keyOf(name)}`, () => this.lock(p.id, () => this.buyNow(name, p, typeof max === 'number' && Number.isFinite(max) ? max : undefined, prep)));
  }
  /** Big Farms (cf:1000+) this player owns. The farmland tile cap, not a per-account count, is the limit. */
  async ownedBigFarms(name: string, cl: { query: pg.Pool['query'] } = this.pool): Promise<string[]> {
    const rows = (await cl.query('SELECT id FROM properties WHERE owner_key = $1', [keyOf(name)])).rows as { id: string }[];
    return rows.map((r) => String(r.id)).filter((id) => /^cf:\d+$/.test(id) && isBigFarmN(Number(id.slice(3))));
  }
  private async buyLocked(name: string, p: NonNullable<ReturnType<typeof propertyById>>, cl: pg.PoolClient, max?: number, prep: PurchaseTaxPrep = { roster: null }) {
    if (p.retired) throw new PropertyError('That property is not for sale.'); // under a civic building (never sold again; owners keep theirs)
    const bank = this.bank();
    const bt = await backTaxOf(cl, name); if (bt.debt > 0) throw new PropertyError(backTaxBlockMsg(bt));
    const owned = await this.ownedCount(name, cl); const value = await propertyPaidPlusUpgradesOf(cl, name); const paidSnap = await this.ownedPaid(name, cl); const price = p.price; // Bill Chud 1: no purchase surcharge
    const note = '';
    { const z = zoneRefusal(await this.zoneUse(name, cl), p); if (z) throw new PropertyError(z); } // zoning cap (grandfathered deeds count; no charge)
    if (max !== undefined && price > max) throw new PropertyError(`The price changed: ${p.label} costs ${price.toLocaleString('en-US')}. Check the deed and try again.`);
    const wq = await quotePurchaseTax(cl, name, price, this.clock(), prep).catch(unprepared);
    if (bank.account(name).chips < price + wq.tax) throw new PropertyError(`Not enough chips: ${p.label} costs ${price.toLocaleString('en-US')}${note ? ` (${note})` : ''}${wq.tax ? ` + ${wq.line}` : ''}.`);
    let wtax = 0, wn = 0; let taxStmts: Array<{ sql: string; args: unknown[] }> = [];
    const surShare = 0; // Bill Chud 1: no surcharge is charged, so there is no surcharge treasury share (past shares/refunds untouched)
    await this.atomic(name, -price, 'property_buy', `Bought ${p.label} (${p.id})${note ? ` ${note}` : ''}`, async (cl) => {
      // cross-instance: the count must still be what we priced at (a parallel buy elsewhere = refuse, nothing charged)
      if ((await propertyPaidPlusUpgradesOf(cl, name)) !== value) throw new PropertyError('You just bought another property: the price went up. Check the deed and try again.');
      { const z = zoneRefusal(await this.zoneUse(name, cl), p); if (z) throw new PropertyError(z); } // zoning cap, re-checked in the transaction
      // The insert wins only if the row now carries our deed nonce (a concurrent buyer's row = conflict, DO NOTHING).
      const deed = randomUUID();
      // One round trip (QA r8 speed): RETURNING yields a row only if our insert won. price = what was actually paid.
      const r = await cl.query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at, deed, city_price) VALUES ($1,$2,$3,$4,$5,$6,$4) ON CONFLICT (id) DO NOTHING RETURNING deed', [p.id, keyOf(name), name.trim(), price, this.clock(), deed]);
      if (r.rows[0]?.deed !== deed) throw new PropertyError('Someone already owns this property.');
      for (const s of [...taxStmts, ...(surShare ? treasuryCreditStmts('property_surcharge', surShare, `25% of a property surcharge (${p.label})`, this.clock(), `property_surcharge:${deed}`) : [])]) await cl.query(s.sql, s.args);
    }, async (key, db) => { const t = await purchaseTaxMoves(db, name, price, key, p.label, this.clock(), prep).catch(unprepared); wtax = t.tax; wn = t.recipients; taxStmts = t.stmts; return t.moves; }, cl);
    this.onChange?.();
    return { id: p.id, price, wealthTax: wtax, wealthTaxRecipients: wn, list: p.price, owned, ownedValue: value, surchargePct: 0, surchargePer1k: 0, multiplier: 1, chips: bank.account(name).chips };
  }

  /** Hostile buyout (monuments only): pay the current owner BUYOUT_MUL x what they paid, in one transaction. */
  async buyout(name: string, id: unknown, max?: unknown) {
    const p = propertyById(id); if (!p || p.kind !== 'landmark') throw new PropertyError('Only monuments can be bought out.');
    return this.lock(`owner:${keyOf(name)}`, () => this.lock(p.id, () => this.buyoutPinned(name, p, typeof max === 'number' && Number.isFinite(max) ? max : undefined)));
  }
  /** Bill Chud 1: hold the same per-owner session lock as normal buys so the zoning cap can't be raced across instances. */
  private async buyoutPinned(name: string, p: NonNullable<ReturnType<typeof propertyById>>, max?: number) {
    // Bank refresh may use this same pool: finish it before reserving the lock connection.
    await this.bank().refresh(name);
    const cl = await this.pool.connect(); const lockKey = `property-buy:${keyOf(name)}`;
    let result: Awaited<ReturnType<RealEstate['buyoutNow']>>;
    try {
      await cl.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      result = await this.buyoutNow(name, p, max, cl);
    } finally {
      let failure: unknown;
      try { await cl.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]); }
      catch (e) { failure = e; console.error('[realestate] owner unlock failed:', (e as Error).message); }
      finally { cl.release(failure as Error | undefined); }
    }
    // This read uses the bank pool; never wait for it while retaining a pinned client.
    await this.bank().notifyDurableBalance(result.from).catch(() => {});
    return result;
  }
  private async buyoutNow(name: string, p: NonNullable<ReturnType<typeof propertyById>>, max: number | undefined, pin: pg.PoolClient) {
    const row = (await pin.query('SELECT owner_key, owner_name, price, bought_at FROM properties WHERE id = $1', [p.id])).rows[0] as { owner_key: string; owner_name: string; price: unknown; bought_at: unknown } | undefined;
    if (!row) throw new PropertyError(`${p.label} belongs to the city: buy it normally.`);
    if (row.owner_key === keyOf(name)) throw new PropertyError('You already own this monument.');
    const paid = Number(row.price); const price = buyoutPrice(paid); const now = this.clock();
    const until = Number(row.bought_at) + BUYOUT_PROTECT_MS;
    if (now < until) throw new PropertyError(`${p.label} is protected from buyouts for ${Math.ceil((until - now) / 3_600_000)} more hour(s).`);
    if (max !== undefined && price > max) throw new PropertyError(`The buyout price changed to ${price.toLocaleString('en-US')}. Check the deed and try again.`);
    const bank = this.bank();
    if (bank.account(name).chips < price) throw new PropertyError(`Not enough chips: the buyout costs ${price.toLocaleString('en-US')}.`);
    const prev = String(row.owner_name);
    { const z = zoneRefusal(await this.zoneUse(name, pin), p); if (z) throw new PropertyError(z); } // monuments are Commercial (Bill Chud 1)
    await this.atomic(name, -price, 'property_buyout', `Hostile buyout of ${p.label} (${p.id}) from ${prev}`, async (cl) => {
      // Under the per-owner session lock (same key as buyNow): re-check the zoning cap in-transaction.
      { const z = zoneRefusal(await this.zoneUse(name, cl), p); if (z) throw new PropertyError(z); }
      await this.income.settle(cl, p.id, now, { key: row.owner_key, boughtAt: Number(row.bought_at), price: paid });
      const r = await cl.query('UPDATE properties SET owner_key = $1, owner_name = $2, city_price = COALESCE(city_price, price), price = $3, bought_at = $4, arrears = 0 WHERE id = $5 AND owner_key = $6 AND price = $7 RETURNING id', [keyOf(name), name.trim(), price, now, p.id, row.owner_key, paid]);
      if (!r.rowCount) throw new PropertyError('The owner changed: check the deed and try again.');
    }, [{ name: prev, amount: price, game: 'property_buyout', memo: `${name.trim()} bought out your ${p.label} (${p.id})` }], pin);
    this.onChange?.();
    void sendPopup(prev, 'City of Chud Hub', `🏛 Hostile buyout! ${name.trim()} bought your ${p.label} for 🪙 ${price.toLocaleString('en-US')} (${BUYOUT_MUL}x what you paid). The chips are in your wallet; its royalties now go to ${name.trim()}.`).catch(() => {});
    return { id: p.id, price, from: prev, chips: bank.account(name).chips };
  }


  backTax(name: string) { return backTaxOf(this.pool, name); }
  /** Pay the whole property back-tax in one atomic, replay-safe ledger write (see server/backTax.ts). */
  async payBackTax(name: string) {
    return this.lock(`owner:${keyOf(name)}`, async () => {
      const bank = this.bank(); await bank.refresh(name);
      const { b, moves } = await backTaxMoves(this.pool, name, this.clock()); if (!b.debt) return { paid: 0, backTax: b, chips: bank.account(name).chips };
      if (bank.account(name).chips < b.debt) throw new PropertyError(`Not enough chips: your back-tax is ${b.debt.toLocaleString('en-US')}.`);
      const w = bank.transferAtomic(moves, { batch: moves.length > 1 });
      const run = async () => { await w.after; const cl = await this.pool.connect(); try { await cl.query('BEGIN'); for (const st of w.stmts) await cl.query(st.sql, st.args); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); } };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); console.error('[realestate] backtax failed:', (e as Error).message); throw new PropertyError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
      return { paid: b.debt, backTax: await backTaxOf(this.pool, name), chips: bank.account(name).chips };
    });
  }

  async sell(name: string, id: unknown) {
    const p = propertyById(id); if (!p) throw new PropertyError('Unknown property.');
    return this.lock(`owner:${keyOf(name)}`, () => this.lock(p.id, () => this.sellNow(name, p)));
  }
  private async sellNow(name: string, p: NonNullable<ReturnType<typeof propertyById>>) {
    // 70% of what this owner actually paid (no buy-cheap/sell-at-list arbitrage either way)
    const row = (await this.pool.query('SELECT price, city_price, bought_at FROM properties WHERE id = $1 AND owner_key = $2', [p.id, keyOf(name)])).rows[0] as { price: string; city_price: string | null; bought_at: string } | undefined;
    if (!row) throw new PropertyError('You do not own this property.');
    // After a hostile buyout the city still only refunds 70% of what IT was paid (no buyout -> sell-back loop between alts).
    const paid = Number(row.price); const back = sellBackOf(Math.min(paid, Number(row.city_price ?? paid))); const bank = this.bank();
    await this.atomic(name, back, 'property_sell', `Sold ${p.label} (${p.id}) to the city`, async (cl) => {
      await this.income.settle(cl, p.id, this.clock(), { key: keyOf(name), boughtAt: Number(row.bought_at), price: paid });
      const r = await cl.query('DELETE FROM properties WHERE id = $1 AND owner_key = $2 AND price = $3 RETURNING id', [p.id, keyOf(name), paid]);
      if (!r.rowCount) throw new PropertyError('You do not own this property.');
    });
    this.onChange?.();
    return { id: p.id, chips: back, paid, balance: bank.account(name).chips };
  }

  /**
   * Charge today's tax on every property bought before today (UTC). Exactly once per (day, property): the claim row
   * commits with the debit. Unpaid -> arrears+1; GRACE_DAYS unpaid in a row -> repossessed (row deleted, no refund).
   */
  async runTax(): Promise<{ charged: number; paid: number; unpaid: number; repossessed: number }> {
    const now = this.clock(); let incomeReady = true; let incomeDeferred = new Set<string>();
    try { await this.runIncome(now); }
    catch (e) { if (e instanceof PropertyIncomeFailure) incomeDeferred = new Set(e.failedIds); else incomeReady = false; console.error('[realestate] income deferred; affected tax waits for settlement:', (e as Error).message); }
    const day = utcDay(now); const start = Date.parse(`${day}T00:00:00Z`);
    const done = new Set(((await this.pool.query('SELECT property_id FROM property_tax WHERE day = $1', [day])).rows as Array<{ property_id: string }>).map((x) => x.property_id));
    const due = ((await this.pool.query('SELECT * FROM properties WHERE bought_at < $1 ORDER BY owner_key, price', [start])).rows as Row[]).filter((r) => !done.has(r.id) && ((incomeReady && !incomeDeferred.has(r.id)) || !incomeEligible(r.id)));
    const out = { charged: 0, paid: 0, unpaid: 0, repossessed: 0 }; const bank = this.bank();
    for (const r of due) {
      const amount = Math.max(1, Math.round(taxOf(taxBasisOf(Number(r.price), propertyById(r.id)?.price ?? 0)) * propertyTaxMul(await skillLevelAsync(r.owner_name, 'property')) * cityPropertyTaxMul(now) * (1 - cityPerk('property_upkeep')))); // Property perk + mayor's tax rate + Police Station perk
      try { await bank.refresh(r.owner_name); } catch { continue; }
      const can = bank.account(r.owner_name).chips >= amount;
      const claim = async (cl: pg.PoolClient, paid: boolean, repo: boolean) => {
        const nonce = randomUUID();
        await cl.query('INSERT INTO property_tax (day, property_id, owner_key, amount, paid, repossessed, at, claim) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [day, r.id, r.owner_key, amount, paid, repo, now, nonce]);
        const c = await cl.query('SELECT claim FROM property_tax WHERE day = $1 AND property_id = $2', [day, r.id]);
        if (c.rows[0]?.claim !== nonce) throw new PropertyError('claimed');
        // Only touch the row if the same owner still holds it (sold/re-bought in between = new ownership, skip).
        const u = paid ? await cl.query('UPDATE properties SET arrears = 0, tax_paid = tax_paid + $3 WHERE id = $1 AND owner_key = $2', [r.id, r.owner_key, amount])
          : repo ? await cl.query('DELETE FROM properties WHERE id = $1 AND owner_key = $2', [r.id, r.owner_key])
          : await cl.query('UPDATE properties SET arrears = arrears + 1 WHERE id = $1 AND owner_key = $2', [r.id, r.owner_key]);
        if (!u.rowCount) throw new PropertyError('changed');
      };
      try {
        if (can) {
          try { await this.atomic(r.owner_name, -amount, 'property_tax', `Property tax ${day}: ${propertyById(r.id)?.label ?? r.id}`, async (cl) => { await claim(cl, true, false); for (const s of treasuryStmtsFor(r.owner_name, 'property_tax', treasuryShareOf(amount), `25% of property tax ${day}`)) await cl.query(s.sql, s.args); }); out.paid++; out.charged += amount; continue; }
          catch (e) { if ((e as Error).message !== 'Not enough chips.') throw e; }
        }
        const repo = Number(r.arrears) + 1 >= GRACE_DAYS; const cl = await this.pool.connect();
        try { await cl.query('BEGIN'); await claim(cl, false, repo); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
        out.unpaid++; if (repo) out.repossessed++;
      } catch (e) { if (!(e instanceof PropertyError)) console.error('[realestate] tax failed:', (e as Error).message); }
    }
    if (out.paid + out.unpaid) { console.log(`[realestate] tax ${day}: paid ${out.paid} (${out.charged} chips), unpaid ${out.unpaid}, repossessed ${out.repossessed}`); this.onChange?.(); }
    return out;
  }

  async stats() {
    const [own, tax] = await Promise.all([
      this.pool.query("SELECT COUNT(*) n, COALESCE(SUM(price),0) v FROM properties WHERE owner_key NOT LIKE 'qa-%'"),
      this.pool.query("SELECT COALESCE(SUM(CASE WHEN paid THEN amount ELSE 0 END),0) burned, COALESCE(SUM(CASE WHEN paid AND day = $1 THEN amount ELSE 0 END),0) today, COALESCE(SUM(CASE WHEN repossessed THEN 1 ELSE 0 END),0) repo FROM property_tax WHERE owner_key NOT LIKE 'qa-%'", [utcDay(this.clock())]),
    ]);
    return { owned: Number(own.rows[0].n), taxBurned: Number(tax.rows[0].burned), taxToday: Number(tax.rows[0].today), repossessed: Number(tax.rows[0].repo) };
  }
  /** Player-owned property at total spent (shared propertyWorth: price paid + upgrades + planted seed; QA excluded). */
  async playerValue(): Promise<{ n: number; value: number }> {
    const rows = (await this.pool.query("SELECT id, price FROM properties WHERE owner_key NOT LIKE 'qa-%'")).rows as Array<{ id: string; price: string }>;
    const sp = await this.spend(null);
    return { n: rows.length, value: rows.reduce((a, r) => a + propertyWorth({ paid: Number(r.price), list: propertyById(r.id)?.price ?? 0, ...(sp.get(r.id) ?? {}) }), 0) };
  }
  /** Per-property spend on top of the price paid, for one owner (or every non-QA owner): farm upgrade levels it holds now, at what the
   *  current owner paid for each (ledger farm_upgrade since the deed was bought; today's level price when no ledger row)
   *  and currently-planted tiles at their seed cost. Read errors propagate: zero would understate net worth. */
  spend(ownerKey: string | null) { return propertySpend(this.pool, ownerKey); }

  start() { const run = () => { void this.runTax().catch((e) => console.error('[realestate] tax run failed:', (e as Error).message)); }; this.timer = setInterval(run, PROPERTY_INCOME_EVERY_MS); this.timer.unref?.(); setTimeout(run, 30_000).unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); }
}

let re: RealEstate | null = null;
export const getRealEstate = () => re;
export const setRealEstateForTest = (r: RealEstate | null) => { re = r; };
export async function initRealEstate(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('realestate', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[realestate] pool error:', e.message));
  await bootAttach('realestate', async () => { try { const r = new RealEstate(pool); await r.init(); re = r; r.start(); console.log('[realestate] ready'); return true; } catch (e) { console.error('[realestate] init failed:', (e as Error).message); return false; } });
}

/** Public read: who owns what (names only) + list prices come from the shared catalog on the client. */
export function realEstateRouter() {
  const r = express.Router();
  r.get('/api/real-estate', async (_req, res) => {
    if (!re) { res.json({ ok: true, live: false, owned: [] }); return; }
    try { res.json({ ok: true, live: true, owned: await re.owned(), index: priceIndex(), stats: await re.stats(), royalties: await re.royalties() }); } catch { res.status(500).json({ ok: false }); }
  });
  return r;
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wired: Server | null = null;
export function registerRealEstate(io: Server, socket: Socket): void {
  if (wired !== io && re) { wired = io; re.onChange = () => { getRoyalties().forget(); io.emit('re_changed'); }; }
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (b: Record<string, unknown>, e: RealEstate) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!re) throw new PropertyError('Real estate is offline right now.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, re)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof PropertyError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new PropertyError('Sign in to buy property.'); return n; };
  on('re_mine', async (_b, e) => ({ properties: await e.mine(need()) }));
  on('re_buy', async (b, e) => { const n = need(); if (typeof b.id === 'string' && /^(r|rf):/.test(b.id)) await requireResort(n, PropertyError); return e.buy(n, b.id, b.max); });
  on('re_quote', async (b, e) => e.quote(need(), b.id));
  on('re_backtax', async (_b, e) => ({ backTax: await e.backTax(need()) }));
  on('re_backtax_pay', async (_b, e) => e.payBackTax(need()));
  on('re_sell', (b, e) => e.sell(need(), b.id));
  on('re_buyout', (b, e) => e.buyout(need(), b.id, b.max));
}
export async function propertySpend(pool: { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> }, ownerKey: string | null): Promise<Map<string, { upgrades: number; crops: number }>> {
  const out = new Map<string, { upgrades: number; crops: number }>();
  const get = (id: string) => { let v = out.get(id); if (!v) out.set(id, (v = { upgrades: 0, crops: 0 })); return v; };
  const where = ownerKey ? 'p.owner_key = $1' : "p.owner_key NOT LIKE 'qa-%'"; const args = ownerKey ? [ownerKey] : [];
  const q = async (sql: string) => (await pool.query(sql, args)).rows as Array<Record<string, unknown>>;
  // Upgrade levels the current owner holds now (a reset/lost upgrade is not counted).
  const lv = new Map<string, Record<string, number>>();
  for (const r of await q(`SELECT u.plot_id, u.kind, u.level FROM farm_upgrades u JOIN properties p ON p.id = u.plot_id AND p.owner_key = u.owner_key WHERE ${where}`)) {
    const m = lv.get(String(r.plot_id)) ?? {}; m[String(r.kind)] = Number(r.level) || 0; lv.set(String(r.plot_id), m);
  }
  // What was actually paid for each held level: the ledger debit "Farm <id>: <Label> level <n>" since the deed was bought
  // (latest row per level); a level with no ledger row falls back to its price at today's index.
  const paidFor = new Map<string, number>();
  if (lv.size) for (const r of await q(`SELECT p.id, t.memo, t.amount FROM properties p JOIN wallet_transactions t ON t.game = 'farm_upgrade' AND t.amount < 0
      AND t.player_key = p.owner_key AND t.created_at >= to_timestamp(p.bought_at / 1000.0) WHERE ${where} ORDER BY t.id`)) paidFor.set(String(r.memo), -Number(r.amount));
  for (const [id, levels] of lv) {
    const tiles = plotTiles(id); if (!tiles) continue;
    const s = upgradeSpendFromLevels(levels, (k, l) => {
      const d = upgradeDef(k); if (!d) return null;
      const led = paidFor.get(`Farm ${id}: ${d.label} level ${l + 1}`); if (led != null) return led;
      const b = upgradePrice(k as FarmUpgradeKind, l, tiles); return b == null ? null : px(b);
    });
    if (s > 0) get(id).upgrades = s;
  }
  for (const r of await q(`SELECT t.plot_id, t.crop FROM farm_tiles t JOIN properties p ON p.id = t.plot_id AND p.owner_key = t.owner_key WHERE ${where}`)) {
    const c = cropById(String(r.crop)); if (c) get(String(r.plot_id)).crops += px(c.seed);
  }
  // Fertilizer spread on the current planting (farm_fert row for the tile's live nonce), at its per-tile cost.
  for (const r of await q(`SELECT t.plot_id, t.crop, f.kind FROM farm_fert f JOIN farm_tiles t ON t.plot_id = f.plot_id AND t.tile = f.tile AND t.nonce = f.nonce
      JOIN properties p ON p.id = t.plot_id AND p.owner_key = t.owner_key WHERE ${where}`)) {
    const c = cropById(String(r.crop)); const fd = fertDef(r.kind); if (c && fd) get(String(r.plot_id)).crops += px(fertCost(fd, c.sell));
  }
  return out;
}

/** Wealth-tax threshold value: price paid + upgrades held, per property (shared propertyPaidPlusUpgrades; no planted seed). */
export async function propertyPaidPlusUpgradesOf(pool: { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> }, name: string): Promise<number> {
  const k = keyOf(name);
  const rows = (await pool.query('SELECT id, price FROM properties WHERE owner_key = $1', [k])).rows as Array<{ id: string; price: unknown }>;
  if (!rows.length) return 0; const sp = await propertySpend(pool, k);
  return rows.reduce((a, r) => a + propertyPaidPlusUpgrades({ paid: Number(r.price), list: propertyById(r.id)?.price ?? 0, upgrades: sp.get(r.id)?.upgrades ?? 0 }), 0);
}
