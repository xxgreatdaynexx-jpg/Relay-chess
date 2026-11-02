/**
 * City real estate (see shared/realEstate.ts for the price table and tax rule). Postgres is the source of truth:
 *  - properties: one row per owned property (PRIMARY KEY id = one owner; a purchase race loses on the INSERT).
 *  - property_tax: one row per (UTC day, property) — the claim that makes the daily tax exactly-once across instances
 *    and restarts. The claim, the wallet debit (CasinoBank.transferAtomic + ledger row, game 'property_tax') and the
 *    arrears / repossession update commit in one transaction. Tax is a chip sink (burned, no house account).
 * Buying ('property_buy') and selling back to the city at 70% ('property_sell') use the same atomic wallet path.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { bootAttach, setBootState } from './boot-retry.js';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { requireResort } from './travel.js';
import { GRACE_DAYS, propertyById as baseProperty, sellBackOf, taxOf, landPrice, landMultiplier, type OwnedProperty } from '../shared/realEstate.js';

export class PropertyError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export const PROPERTY_MIGRATION = `
CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_name TEXT NOT NULL, price BIGINT NOT NULL,
  bought_at BIGINT NOT NULL, arrears INT NOT NULL DEFAULT 0, tax_paid BIGINT NOT NULL DEFAULT 0, deed TEXT);
CREATE INDEX IF NOT EXISTS properties_owner ON properties (owner_key);
CREATE TABLE IF NOT EXISTS property_tax (day TEXT NOT NULL, property_id TEXT NOT NULL, owner_key TEXT NOT NULL, amount BIGINT NOT NULL, paid BOOLEAN NOT NULL,
  repossessed BOOLEAN NOT NULL DEFAULT false, at BIGINT NOT NULL, claim TEXT, PRIMARY KEY (day, property_id));`;

type Pool = pg.Pool;
interface Row { id: string; owner_key: string; owner_name: string; price: string | number; bought_at: string | number; arrears: number; tax_paid: string | number }
/** Catalog entry with today's indexed list price (list prices and tax follow the price index). */
const propertyById = (id: Parameters<typeof baseProperty>[0]) => { const p = baseProperty(id); return p ? { ...p, price: px(p.price) } : undefined; };
const toOwned = (r: Row): OwnedProperty => ({ id: r.id, owner: r.owner_name, price: Number(r.price), arrears: Number(r.arrears), boughtAt: Number(r.bought_at) });

export class RealEstate {
  onChange?: () => void;
  private timer: NodeJS.Timeout | null = null;
  /** Same-instance serialisation per property id (cross-instance races are settled by the PRIMARY KEY). */
  private locks = new Map<string, Promise<unknown>>();
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  constructor(private readonly pool: Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() { await this.pool.query(PROPERTY_MIGRATION); }

  async owned(): Promise<OwnedProperty[]> {
    return ((await this.pool.query('SELECT * FROM properties ORDER BY id')).rows as Row[]).map(toOwned);
  }
  async mine(name: string) {
    const rows = ((await this.pool.query('SELECT * FROM properties WHERE owner_key = $1 ORDER BY price DESC', [keyOf(name)])).rows as Row[]);
    return rows.map((r) => { const p = propertyById(r.id); return { ...toOwned(r), label: p?.label ?? r.id, type: p?.type ?? '', value: p?.price ?? Number(r.price), tax: taxOf(p?.price ?? Number(r.price)), taxPaid: Number(r.tax_paid) }; });
  }

  /** Atomic: the ledger rows and the ownership change commit together, or neither does. */
  private async atomic(name: string, amount: number, game: string, memo: string, body: (cl: pg.PoolClient) => Promise<void>) {
    const bank = this.bank();
    const w = bank.transferAtomic([{ name, amount, key: `${game}:${randomUUID()}`, game, memo }]);
    const run = async () => {
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN'); await body(cl);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof PropertyError) throw e; console.error(`[realestate] ${game} failed:`, (e as Error).message); throw new PropertyError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
  }

  /** Parcels this player owns right now (the n in list × LAND_GROWTH^n). */
  async ownedCount(name: string, cl: { query: pg.Pool['query'] } = this.pool): Promise<number> {
    return Number((await cl.query('SELECT COUNT(*) n FROM properties WHERE owner_key = $1', [keyOf(name)])).rows[0].n);
  }
  /** What this player would pay for a property right now. */
  async quote(name: string, id: unknown) {
    const p = propertyById(id); if (!p) throw new PropertyError('That property is not for sale.');
    const owned = await this.ownedCount(name);
    return { id: p.id, list: p.price, owned, multiplier: landMultiplier(owned), price: landPrice(p.price, owned) };
  }
  /** max: the price the player saw; a higher price now (they bought something else meanwhile) refuses instead of surprising them. */
  async buy(name: string, id: unknown, max?: unknown) {
    const p = propertyById(id); if (!p) throw new PropertyError('That property is not for sale.');
    // per-buyer lock too: two parallel buys by one player can't both be priced at the same n
    return this.lock(`owner:${keyOf(name)}`, () => this.lock(p.id, () => this.buyNow(name, p, typeof max === 'number' && Number.isFinite(max) ? max : undefined)));
  }
  private async buyNow(name: string, p: NonNullable<ReturnType<typeof propertyById>>, max?: number) {
    const bank = this.bank(); await bank.refresh(name);
    const owned = await this.ownedCount(name); const price = landPrice(p.price, owned);
    if (max !== undefined && price > max) throw new PropertyError(`The price changed: you own ${owned} now, so ${p.label} costs ${price.toLocaleString('en-US')}. Check the deed and try again.`);
    if (bank.account(name).chips < price) throw new PropertyError(`Not enough chips: ${p.label} costs ${price.toLocaleString('en-US')}${owned ? ` (×${+landMultiplier(owned).toFixed(2)} because you own ${owned})` : ''}.`);
    await this.atomic(name, -price, 'property_buy', `Bought ${p.label} (${p.id})${owned ? ` ×${+landMultiplier(owned).toFixed(2)}, owned ${owned}` : ''}`, async (cl) => {
      // cross-instance: the count must still be what we priced at (a parallel buy elsewhere = refuse, nothing charged)
      if ((await this.ownedCount(name, cl)) !== owned) throw new PropertyError('You just bought another property: the price went up. Check the deed and try again.');
      // The insert wins only if the row now carries our deed nonce (a concurrent buyer's row = conflict, DO NOTHING).
      const deed = randomUUID();
      // One round trip (QA r8 speed): RETURNING yields a row only if our insert won. price = what was actually paid.
      const r = await cl.query('INSERT INTO properties (id, owner_key, owner_name, price, bought_at, deed) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING deed', [p.id, keyOf(name), name.trim(), price, this.clock(), deed]);
      if (r.rows[0]?.deed !== deed) throw new PropertyError('Someone already owns this property.');
    });
    this.onChange?.();
    return { id: p.id, price, list: p.price, owned, multiplier: landMultiplier(owned), chips: bank.account(name).chips };
  }

  async sell(name: string, id: unknown) {
    const p = propertyById(id); if (!p) throw new PropertyError('Unknown property.');
    return this.lock(`owner:${keyOf(name)}`, () => this.lock(p.id, () => this.sellNow(name, p)));
  }
  private async sellNow(name: string, p: NonNullable<ReturnType<typeof propertyById>>) {
    // 70% of what this owner actually paid (no buy-cheap/sell-at-list arbitrage either way)
    const row = (await this.pool.query('SELECT price FROM properties WHERE id = $1 AND owner_key = $2', [p.id, keyOf(name)])).rows[0] as { price: string } | undefined;
    if (!row) throw new PropertyError('You do not own this property.');
    const paid = Number(row.price); const back = sellBackOf(paid); const bank = this.bank();
    await this.atomic(name, back, 'property_sell', `Sold ${p.label} (${p.id}) to the city`, async (cl) => {
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
    const now = this.clock(); const day = utcDay(now); const start = Date.parse(`${day}T00:00:00Z`);
    const done = new Set(((await this.pool.query('SELECT property_id FROM property_tax WHERE day = $1', [day])).rows as Array<{ property_id: string }>).map((x) => x.property_id));
    const due = ((await this.pool.query('SELECT * FROM properties WHERE bought_at < $1 ORDER BY owner_key, price', [start])).rows as Row[]).filter((r) => !done.has(r.id));
    const out = { charged: 0, paid: 0, unpaid: 0, repossessed: 0 }; const bank = this.bank();
    for (const r of due) {
      const amount = taxOf(propertyById(r.id)?.price ?? Number(r.price));
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
          try { await this.atomic(r.owner_name, -amount, 'property_tax', `Property tax ${day}: ${propertyById(r.id)?.label ?? r.id}`, (cl) => claim(cl, true, false)); out.paid++; out.charged += amount; continue; }
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
  /** Player-owned property at list value (economy assets; QA excluded). */
  async playerValue(): Promise<{ n: number; value: number }> {
    const rows = (await this.pool.query("SELECT id, price FROM properties WHERE owner_key NOT LIKE 'qa-%'")).rows as Array<{ id: string; price: string }>;
    return { n: rows.length, value: rows.reduce((a, r) => a + (propertyById(r.id)?.price ?? Number(r.price)), 0) };
  }

  start() { const run = () => { void this.runTax().catch((e) => console.error('[realestate] tax run failed:', (e as Error).message)); }; this.timer = setInterval(run, 10 * 60_000); this.timer.unref?.(); setTimeout(run, 30_000).unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); }
}

let re: RealEstate | null = null;
export const getRealEstate = () => re;
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
    try { res.json({ ok: true, live: true, owned: await re.owned(), index: priceIndex(), stats: await re.stats() }); } catch { res.status(500).json({ ok: false }); }
  });
  return r;
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wired: Server | null = null;
export function registerRealEstate(io: Server, socket: Socket): void {
  if (wired !== io && re) { wired = io; re.onChange = () => io.emit('re_changed'); }
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (b: Record<string, unknown>, e: RealEstate) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!re) throw new PropertyError('Real estate is offline right now.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, re)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof PropertyError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new PropertyError('Sign in to buy property.'); return n; };
  on('re_mine', async (_b, e) => ({ properties: await e.mine(need()) }));
  on('re_buy', async (b, e) => { const n = need(); if (typeof b.id === 'string' && /^(r|rf):/.test(b.id)) await requireResort(n, PropertyError); return e.buy(n, b.id, b.max); });
  on('re_quote', async (b, e) => e.quote(need(), b.id));
  on('re_sell', (b, e) => e.sell(need(), b.id));
}
