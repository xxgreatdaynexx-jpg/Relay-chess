import { isMarketBlocked, MARKET_BLOCKED_MSG } from './house-cap-index.js';
import { isJailed } from './jail.js';
/**
 * Stock Exchange v2: dividends, index + mutual funds, shorts, options (calls and puts).
 *
 * Every chip movement goes through CasinoBank.transferAtomic: the wallet UPDATE + ledger row run inside the same Postgres
 * transaction as the position change, so a position and its chips commit together or not at all.
 * Exactly-once jobs (run only by the instance that won the 30s tick slot, and still safe if two ran):
 *  - daily payout: a `stk_claims` row `daily:<UTC day>` is inserted in the same transaction as the dividend ledger rows
 *    (tx_key `div:<day>:<player>` is UNIQUE too), mutual fund expenses and short borrow fees.
 *  - option expiry: `UPDATE stk_options SET status='settled' WHERE id=$1 AND status='open'` in the payout transaction (tx_key `opt:<id>`).
 *  - short close / liquidation: `UPDATE stk_shorts ... WHERE id=$1 AND status='open' AND collateral=$2` in the payout transaction.
 * Payouts are floored at 0, so a short can never take a player below 0 chips (collateral was already locked when opened).
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getBank } from './casino-store.js';
import { StockError, keyOf, priceOf, type Exchange } from './stocks.js';
import { COMPANIES, COMPANY_BY_TICKER, MAX_TICK_IMPACT, impactAllowed, IMPACT_CAP_MSG, maxOrderChips, parseQty, quote, type Company } from '../shared/stocks.js';
import {
  optionBid,
  BORROW_FEE, DIV_HOUR_UTC, FUNDS, FUND_BY_ID, FUND_MAX_ORDER, MAX_OPEN_OPTIONS, MAX_OPEN_SHORTS, OPT_EXPIRIES, OPT_MAX_PREMIUM, OPT_MAX_QTY,
  SHORT_INIT, daysLeft, divYield, dividendOf, fundDivPerUnit, fundQuote, fundYield, liquidationPrice, navOf, needsLiquidation, optionPayout,
  optionPremium, optionValue, shortClose, shortEquity, type Fund,
} from '../shared/derivs.js';

const DAY = 86_400_000;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const r2 = (x: number) => Math.round(x * 100) / 100;

export const DERIVS_MIGRATION = `
CREATE TABLE IF NOT EXISTS stk_fund_units (player_key TEXT NOT NULL, name TEXT NOT NULL, fund TEXT NOT NULL, units DOUBLE PRECISION NOT NULL CHECK (units >= 0), cost BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, fund));
CREATE TABLE IF NOT EXISTS stk_shorts (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL, shares BIGINT NOT NULL CHECK (shares > 0), entry DOUBLE PRECISION NOT NULL,
  proceeds BIGINT NOT NULL, collateral BIGINT NOT NULL CHECK (collateral >= 0), fees BIGINT NOT NULL DEFAULT 0, opened_at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'open', closed_at BIGINT, close_price DOUBLE PRECISION, payout BIGINT);
CREATE INDEX IF NOT EXISTS stk_shorts_open ON stk_shorts (status, player_key);
CREATE TABLE IF NOT EXISTS stk_options (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL, kind TEXT NOT NULL, strike DOUBLE PRECISION NOT NULL, qty BIGINT NOT NULL CHECK (qty > 0),
  premium BIGINT NOT NULL, opened_at BIGINT NOT NULL, expiry BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'open', settle_price DOUBLE PRECISION, payout BIGINT);
CREATE INDEX IF NOT EXISTS stk_options_open ON stk_options (status, expiry);
CREATE TABLE IF NOT EXISTS stk_claims (id TEXT PRIMARY KEY, at BIGINT NOT NULL, info JSONB);`;

export interface FundPos { fund: string; units: number; cost: number }
export interface ShortPos { id: string; key: string; name: string; ticker: string; shares: number; entry: number; proceeds: number; collateral: number; fees: number; openedAt: number; status: string; closedAt?: number | null; closePrice?: number | null; payout?: number | null }
export interface OptionPos { id: string; key: string; name: string; ticker: string; kind: 'call' | 'put'; strike: number; qty: number; premium: number; openedAt: number; expiry: number; status: string; settlePrice?: number | null; payout?: number | null }
type Move = { name: string; amount: number; key: string; game: string; memo?: string };
type Cl = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
class Skip extends Error {}
export interface PublicTrade { kind: 'buy' | 'sell' | 'short' | 'cover' | 'liquidated' | 'call' | 'put' | 'expired'; opt?: 'call' | 'put'; name: string; ticker: string; qty: number; price: number; chips: number; at: number; strike?: number; expiry?: number }

const shortOf = (x: Record<string, unknown>): ShortPos => ({ id: String(x.id), key: String(x.player_key), name: String(x.name), ticker: String(x.ticker), shares: Number(x.shares), entry: Number(x.entry), proceeds: Number(x.proceeds), collateral: Number(x.collateral), fees: Number(x.fees), openedAt: Number(x.opened_at), status: String(x.status), closedAt: x.closed_at == null ? null : Number(x.closed_at), closePrice: x.close_price == null ? null : Number(x.close_price), payout: x.payout == null ? null : Number(x.payout) });
const optOf = (x: Record<string, unknown>): OptionPos => ({ id: String(x.id), key: String(x.player_key), name: String(x.name), ticker: String(x.ticker), kind: String(x.kind) as 'call' | 'put', strike: Number(x.strike), qty: Number(x.qty), premium: Number(x.premium), openedAt: Number(x.opened_at), expiry: Number(x.expiry), status: String(x.status), settlePrice: x.settle_price == null ? null : Number(x.settle_price), payout: x.payout == null ? null : Number(x.payout) });

export class Derivatives {
  // memory mode (tests / dev without a DB)
  private mFunds = new Map<string, Map<string, FundPos & { name: string }>>();
  private mShorts = new Map<string, ShortPos>();
  private mOpts = new Map<string, OptionPos>();
  private mClaims = new Map<string, unknown>();
  private running = false;
  lastDaily: { day: string; info: unknown } | null = null;
  constructor(private readonly ex: Exchange, private readonly pool: pg.Pool | null, private readonly clock = () => Date.now()) {}

  async init() { if (this.pool) await this.pool.query(DERIVS_MIGRATION); }
  private price = (t: string) => this.ex.price(t);
  /** Options use the un-pushed base price (no player impact), so pumping shares can't inflate option value. */
  private optPrice = (t: string) => this.ex.basePrice(t);
  private comp(t: unknown): Company { const c = typeof t === 'string' ? COMPANY_BY_TICKER.get(t) : undefined; if (!c) throw new StockError('Unknown company.'); return c; }
  private fund(id: unknown): Fund { const f = typeof id === 'string' ? FUND_BY_ID.get(id) : undefined; if (!f) throw new StockError('Unknown fund.'); return f; }
  nav(f: Fund) { return navOf(f, this.price); }
  /** Display only: NAV change vs the NAV from the same rolling-24h prices the stock table's 24h column uses. */
  dayPct(f: Fund) { const prev = navOf(f, (t) => this.ex.prev24.get(t) ?? null); return prev > 0 ? Math.round(((this.nav(f) - prev) / prev) * 10000) / 100 : 0; }

  /** Run `body` in one transaction with the wallet moves (memory mode: just run it). Skip = nothing happens, quietly. */
  private async atomic<T>(moves: Move[], body: (cl: Cl | null) => Promise<T>): Promise<T> {
    const live = moves.filter((m) => m.amount !== 0);
    const bank = getBank();
    if (!this.pool) {
      const r = await body(null); // validate + mutate memory state first; wallet below cannot fail for credits, debits were pre-checked
      if (live.length) bank.transferAtomic(live);
      return r;
    }
    const w = live.length ? bank.transferAtomic(live) : null;
    const run = async () => {
      if (w) await w.after;
      const cl = await this.pool!.connect();
      try {
        await cl.query('BEGIN'); const r = await body(cl);
        if (w) for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT'); return r;
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w?.bind(p);
    try { return await p; } catch (e) {
      w?.revert(); if (e instanceof StockError || e instanceof Skip) throw e;
      console.error('[stocks2] write failed:', (e as Error).message);
      throw new StockError(/chips|balance|null value|check constraint/i.test((e as Error).message) ? 'Not enough chips.' : 'Trade failed. Nothing was charged.');
    }
  }
  private debitCheck(name: string, amount: number) { if (!getBank().canAfford(name, amount)) throw new StockError('Not enough chips.'); }

  /** Lock the company row, re-check the price and the per-tick cap, and push `imp` (shorts move prices like trades). */
  private async pushPrice(cl: Cl | null, c: Company, price: number, imp: number) {
    const row = this.ex.rows.get(c.ticker)!; const slot = this.ex.slotNow();
    if (!cl) {
      const used = row.tickSlot === slot ? row.tickImp : 0;
      if (used + Math.abs(imp) > MAX_TICK_IMPACT) throw new StockError('Heavy trading in this stock right now. Try a smaller order or wait a few seconds.');
      if (!impactAllowed(row.imp, imp)) throw new StockError(IMPACT_CAP_MSG);
      return () => { row.imp += imp; row.tickImp = used + Math.abs(imp); row.tickSlot = slot; };
    }
    const cur = (await cl.query('SELECT base, imp, tick_imp, tick_slot FROM stock_prices WHERE ticker = $1 FOR UPDATE', [c.ticker])).rows[0];
    if (!cur) throw new StockError('Unknown company.');
    const live = priceOf({ base: Number(cur.base), imp: Number(cur.imp) });
    if (Math.abs(live - price) / price > 0.01) throw new StockError('The price just moved. Check the new quote and try again.');
    const u = Number(cur.tick_slot) === slot ? Number(cur.tick_imp) : 0;
    if (u + Math.abs(imp) > MAX_TICK_IMPACT) throw new StockError('Heavy trading in this stock right now. Try a smaller order or wait a few seconds.');
    if (!impactAllowed(Number(cur.imp), imp)) throw new StockError(IMPACT_CAP_MSG);
    await cl.query('UPDATE stock_prices SET imp = imp + $2, tick_imp = $3, tick_slot = $4 WHERE ticker = $1', [c.ticker, imp, u + Math.abs(imp), slot]);
    return () => { row.base = Number(cur.base); row.imp = Number(cur.imp) + imp; row.tickImp = u + Math.abs(imp); row.tickSlot = slot; };
  }

  // ---------- reads ----------
  funds() {
    return FUNDS.map((f) => ({ id: f.id, name: f.name, kind: f.kind, blurb: f.blurb, fee: f.fee, expense: f.expense, nav: this.nav(f), dayPct: this.dayPct(f), divPerUnit: r2(fundDivPerUnit(f, this.price) * 10000) / 10000, yield: fundYield(f, this.price),
      holdings: f.weights.map(([t, w]) => ({ ticker: t, name: COMPANY_BY_TICKER.get(t)!.name, weight: Math.round(w * 10000) / 100, price: this.price(t) })) }));
  }
  async fundPositions(name: string): Promise<FundPos[]> {
    const k = keyOf(name);
    if (!this.pool) return [...(this.mFunds.get(k)?.values() ?? [])].filter((p) => p.units > 1e-9).map(({ fund, units, cost }) => ({ fund, units, cost }));
    return (await this.pool.query('SELECT fund, units, cost FROM stk_fund_units WHERE player_key = $1 AND units > 0 ORDER BY fund', [k])).rows.map((x) => ({ fund: String(x.fund), units: Number(x.units), cost: Number(x.cost) }));
  }
  async shorts(name: string | null, status: 'open' | 'all' = 'open'): Promise<ShortPos[]> {
    const k = name ? keyOf(name) : null;
    if (!this.pool) return [...this.mShorts.values()].filter((s) => (!k || s.key === k) && (status === 'all' || s.status === 'open')).sort((a, b) => b.openedAt - a.openedAt);
    const rows = (await this.pool.query(`SELECT * FROM stk_shorts WHERE ($1::text IS NULL OR player_key = $1) AND ($2 = 'all' OR status = 'open') ORDER BY opened_at DESC LIMIT 200`, [k, status])).rows;
    return rows.map(shortOf);
  }
  async options(name: string | null, status: 'open' | 'all' = 'open'): Promise<OptionPos[]> {
    const k = name ? keyOf(name) : null;
    if (!this.pool) return [...this.mOpts.values()].filter((o) => (!k || o.key === k) && (status === 'all' || o.status === 'open')).sort((a, b) => b.openedAt - a.openedAt);
    return (await this.pool.query(`SELECT * FROM stk_options WHERE ($1::text IS NULL OR player_key = $1) AND ($2 = 'all' OR status = 'open') ORDER BY opened_at DESC LIMIT 200`, [k, status])).rows.map(optOf);
  }
  optionMark(o: OptionPos) { const c = COMPANY_BY_TICKER.get(o.ticker)!; const S = this.optPrice(o.ticker) ?? c.start; return Math.floor(optionValue(o.kind, S, o.strike, c.vol, daysLeft(o.expiry, this.clock())) * o.qty); }

  /** Everything a player owns on the exchange, valued at mark. */
  /** Public trade history (read-only): stock buys/sells, short opens/covers/liquidations, option buys and expiries.
   *  `ticker` = one company; `fund` = trades in that fund's underlying companies; neither = whole exchange. QA hidden. */
  async publicTrades(t: unknown, f: unknown, n: unknown) {
    const limit = Math.max(1, Math.min(100, Math.floor(Number(n) || 50)));
    let tickers: string[] | null = null;
    if (typeof t === 'string' && t) { if (!COMPANY_BY_TICKER.has(t)) throw new StockError('Unknown company.'); tickers = [t]; }
    else if (typeof f === 'string' && f) { const fd = FUNDS.find((x) => x.id === f); if (!fd) throw new StockError('Unknown fund.'); tickers = Object.keys(fd.weights); }
    const ok = (x: { key: string; ticker: string }) => !x.key.startsWith('qa-') && (!tickers || tickers.includes(x.ticker));
    const out: PublicTrade[] = (await this.ex.recentTrades(tickers, limit)).map((x) => ({ kind: x.side === 'buy' ? 'buy' : 'sell', name: x.name, ticker: x.ticker, qty: x.shares, price: Math.round(x.price * 100) / 100, chips: x.chips, at: x.at }));
    let sh: ShortPos[]; let op: OptionPos[];
    if (!this.pool) { sh = [...this.mShorts.values()].filter(ok); op = [...this.mOpts.values()].filter(ok); }
    else {
      const [a, b] = await Promise.all([
        this.pool.query("SELECT * FROM stk_shorts WHERE player_key NOT LIKE 'qa-%' AND ($1::text[] IS NULL OR ticker = ANY($1)) ORDER BY GREATEST(opened_at, COALESCE(closed_at, 0)) DESC LIMIT $2", [tickers, limit]),
        this.pool.query("SELECT * FROM stk_options WHERE player_key NOT LIKE 'qa-%' AND ($1::text[] IS NULL OR ticker = ANY($1)) ORDER BY GREATEST(opened_at, CASE WHEN status = 'settled' THEN expiry ELSE 0 END) DESC LIMIT $2", [tickers, limit]),
      ]);
      sh = a.rows.map(shortOf); op = b.rows.map(optOf);
    }
    for (const s of sh) {
      out.push({ kind: 'short', name: s.name, ticker: s.ticker, qty: s.shares, price: s.entry, chips: s.proceeds, at: s.openedAt });
      if (s.closedAt != null) out.push({ kind: s.status === 'liquidated' ? 'liquidated' : 'cover', name: s.name, ticker: s.ticker, qty: s.shares, price: s.closePrice ?? 0, chips: s.payout ?? 0, at: s.closedAt });
    }
    for (const o of op) {
      out.push({ kind: o.kind, name: o.name, ticker: o.ticker, qty: o.qty, price: o.strike, chips: o.premium, at: o.openedAt, strike: o.strike, expiry: o.expiry });
      if (o.status === 'settled') out.push({ kind: 'expired', opt: o.kind, name: o.name, ticker: o.ticker, qty: o.qty, price: o.settlePrice ?? 0, chips: o.payout ?? 0, at: o.expiry, strike: o.strike, expiry: o.expiry });
    }
    return { trades: out.filter((x) => x.at <= this.clock()).sort((a, b) => b.at - a.at).slice(0, limit) };
  }

  async portfolio(name: string) {
    const stocks = await this.ex.portfolio(name);
    const funds = (await this.fundPositions(name)).map((p) => { const f = FUND_BY_ID.get(p.fund)!; const nav = this.nav(f); const value = Math.floor(nav * p.units); return { ...p, name: f.name, kind: f.kind, nav, value, pnl: value - p.cost }; });
    const now = this.clock();
    const shorts = (await this.shorts(name)).map((s) => { const p = this.price(s.ticker)!; const eqv = Math.floor(shortEquity(s, p)); const cl = shortClose(COMPANY_BY_TICKER.get(s.ticker)!, s, p); return { ...s, price: p, equity: eqv, closeValue: cl.payout, pnl: cl.pnl, liqPrice: r2(liquidationPrice(s)) }; });
    const options = (await this.options(name)).map((o) => ({ ...o, price: this.price(o.ticker), mark: this.optionMark(o), bid: o.expiry > now ? optionBid(COMPANY_BY_TICKER.get(o.ticker)!, o.kind, this.optPrice(o.ticker)!, o.strike, daysLeft(o.expiry, now), o.qty) : 0, hoursLeft: Math.max(0, Math.round((o.expiry - now) / 360_000) / 10) }));
    const history = { shorts: (await this.shorts(name, 'all')).filter((s) => s.status !== 'open').slice(0, 20), options: (await this.options(name, 'all')).filter((o) => o.status !== 'open').slice(0, 20) };
    const totals = { stocks: stocks.value, funds: funds.reduce((a, f) => a + f.value, 0), shorts: shorts.reduce((a, s) => a + s.equity, 0), options: options.reduce((a, o) => a + o.mark, 0) };
    return { stocks, funds, shorts, options, history, totals: { ...totals, all: totals.stocks + totals.funds + totals.shorts + totals.options } };
  }

  // ---------- funds ----------
  async tradeFund(name: string, side: 'buy' | 'sell', id: unknown, u: unknown) {
    if (isMarketBlocked(name)) throw new StockError(MARKET_BLOCKED_MSG);
    const f = this.fund(id); const pu = parseQty(u, { decimals: 2, max: 1_000_000 }); if (!pu.ok) throw new StockError(pu.error.replaceAll('shares', 'units')); let units = pu.n;
    const k = keyOf(name); const nav = this.nav(f);
    if (side === 'sell') { const have = (await this.fundPositions(name)).find((p) => p.fund === f.id)?.units ?? 0; if (units > have + 1e-9) { if (units - have < 0.01) units = have; else throw new StockError(`You own ${have.toFixed(2)} ${f.id} units.`); } }
    const q = fundQuote(f, nav, side, units);
    if (q.gross > FUND_MAX_ORDER) throw new StockError(`Order too large: max ${FUND_MAX_ORDER.toLocaleString()} chips per fund order.`);
    if (side === 'sell' && q.total < 1) throw new StockError('Too small to sell after the fee.');
    if (side === 'buy') this.debitCheck(name, q.total);
    const tid = randomUUID();
    const memo = `${side === 'buy' ? 'Bought' : 'Sold'} ${units} ${f.id} @ ${nav.toFixed(2)} (fee ${q.fee})`;
    await this.atomic([{ name, amount: side === 'buy' ? -q.total : q.total, key: `fund:${tid}`, game: 'stocks', memo }], async (cl) => {
      if (!cl) {
        const m = this.mFunds.get(k) ?? new Map(); this.mFunds.set(k, m); const p = m.get(f.id) ?? { fund: f.id, units: 0, cost: 0, name };
        if (side === 'buy') { p.units += units; p.cost += q.total; } else { if (p.units + 1e-9 < units) throw new StockError('Not enough units.'); p.cost -= Math.round((p.cost * units) / p.units); p.units = Math.max(0, p.units - units); }
        m.set(f.id, p); return;
      }
      if (side === 'buy') await cl.query('INSERT INTO stk_fund_units (player_key, name, fund, units, cost) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_key, fund) DO UPDATE SET units = stk_fund_units.units + $4, cost = stk_fund_units.cost + $5, name = $2', [k, name.trim(), f.id, units, q.total]);
      else if (((await cl.query('UPDATE stk_fund_units SET cost = cost - ROUND(cost::numeric * $3 / units), units = GREATEST(0, units - $3) WHERE player_key = $1 AND fund = $2 AND units + 1e-9 >= $3', [k, f.id, units])).rowCount ?? 0) === 0) throw new StockError('Not enough units.');
    });
    return { side, fund: f.id, units, nav, gross: q.gross, fee: q.fee, total: q.total, balance: getBank().account(name).chips };
  }

  // ---------- shorts ----------
  async openShort(name: string, t: unknown, n: unknown) {
    if (isMarketBlocked(name)) throw new StockError(MARKET_BLOCKED_MSG);
    const c = this.comp(t); const ps = parseQty(n); if (!ps.ok) throw new StockError(ps.error); const shares = ps.n;
    const price = this.price(c.ticker)!; const q = quote(c, price, 'sell', shares); // you sell borrowed shares: bid side, pushes the price down
    if (q.gross > maxOrderChips(c)) throw new StockError(`Order too large: max ${maxOrderChips(c).toLocaleString()} chips per trade (about ${Math.max(1, Math.floor(maxOrderChips(c) / price))} shares).`);
    if ((await this.shorts(name)).length >= MAX_OPEN_SHORTS) throw new StockError(`You can have at most ${MAX_OPEN_SHORTS} open shorts.`);
    const collateral = Math.ceil(SHORT_INIT * q.gross); const cost = collateral + q.fee;
    this.debitCheck(name, cost);
    const id = randomUUID(); const k = keyOf(name); const now = this.clock();
    const s: ShortPos = { id, key: k, name: name.trim(), ticker: c.ticker, shares, entry: r2(q.fill), proceeds: q.gross, collateral, fees: q.fee, openedAt: now, status: 'open' };
    let commit: (() => void) | null = null;
    await this.atomic([{ name, amount: -cost, key: `short:${id}:open`, game: 'stocks', memo: `Shorted ${shares} ${c.ticker} @ ${q.fill.toFixed(2)}: ${collateral} collateral locked (fee ${q.fee})` }], async (cl) => {
      commit = await this.pushPrice(cl, c, price, q.imp);
      if (!cl) { this.mShorts.set(id, s); return; }
      await cl.query('INSERT INTO stk_shorts (id, player_key, name, ticker, shares, entry, proceeds, collateral, fees, opened_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, k, s.name, c.ticker, shares, s.entry, s.proceeds, collateral, q.fee, now]);
    });
    (commit as (() => void) | null)?.();
    return { id, ticker: c.ticker, shares, fill: s.entry, collateral, fee: q.fee, cost, liqPrice: r2(liquidationPrice(s)), balance: getBank().account(name).chips };
  }

  /** Close (player) or liquidate (system). Returns the payout; null when it was already closed elsewhere. */
  private async settleShort(s: ShortPos, how: 'closed' | 'liquidated', price: number, buyback: number, fee: number, imp: number | null, c: Company, exact?: number) {
    const payout = exact ?? Math.max(0, Math.floor(s.collateral + s.proceeds - buyback - fee));
    const now = this.clock(); let commit: (() => void) | null = null;
    const memo = how === 'closed' ? `Closed short ${s.shares} ${s.ticker} @ ${price.toFixed(2)} (fee ${fee})` : `Short ${s.shares} ${s.ticker} liquidated @ ${price.toFixed(2)} (fee ${fee})`;
    await this.atomic([{ name: s.name, amount: payout, key: `short:${s.id}:close`, game: 'stocks', memo }], async (cl) => {
      if (imp != null) commit = await this.pushPrice(cl, c, this.price(c.ticker)!, imp);
      if (!cl) { const m = this.mShorts.get(s.id); if (!m || m.status !== 'open' || m.collateral !== s.collateral) throw new Skip(); Object.assign(m, { status: how, closedAt: now, closePrice: r2(price), payout, fees: m.fees + fee }); return; }
      const u = await cl.query('UPDATE stk_shorts SET status = $2, closed_at = $3, close_price = $4, payout = $5, fees = fees + $6 WHERE id = $1 AND status = \'open\' AND collateral = $7', [s.id, how, now, r2(price), payout, fee, s.collateral]);
      if ((u.rowCount ?? 0) === 0) throw new Skip();
    });
    (commit as (() => void) | null)?.();
    return payout;
  }
  async closeShort(name: string, id: unknown) {
    if (isMarketBlocked(name)) throw new StockError(MARKET_BLOCKED_MSG);
    const s = (await this.shorts(name)).find((x) => x.id === id); if (!s) throw new StockError('That short is already closed.');
    const c = COMPANY_BY_TICKER.get(s.ticker)!; const price = this.price(c.ticker)!; const { q, payout: exact } = shortClose(c, s, price); // buy back: ask side, pushes the price up (same math the UI shows)
    if (q.gross > maxOrderChips(c) * 2) throw new StockError('This short is too big to close in one go right now. Wait for the price to settle.');
    const fees0 = s.fees; // (memory mode mutates `s` in settle; P&L must use the fees paid before this close)
    try { const payout = await this.settleShort(s, 'closed', q.fill, q.gross, q.fee, Math.min(q.imp, MAX_TICK_IMPACT), c, exact); return { id: s.id, ticker: s.ticker, shares: s.shares, fill: r2(q.fill), payout, pnl: payout - s.collateral - fees0, balance: getBank().account(name).chips }; }
    catch (e) { if (e instanceof Skip) throw new StockError('That short was just updated. Refresh and try again.'); throw e; }
  }

  // ---------- options ----------
  optionQuote(t: unknown, kind: unknown, strike: unknown, days: unknown, qty: unknown) {
    const c = this.comp(t); if (kind !== 'call' && kind !== 'put') throw new StockError('Pick a call or a put.');
    const d = Number(days); if (!(OPT_EXPIRIES as readonly number[]).includes(d)) throw new StockError(`Expiry must be ${OPT_EXPIRIES.join(', ')} days.`);
    const pq = parseQty(qty, { max: OPT_MAX_QTY }); if (!pq.ok) throw new StockError(`${pq.error} Cover 1 to ${OPT_MAX_QTY} shares per option.`); const n = pq.n;
    const S = this.optPrice(c.ticker)!; const K = Math.round(Number(strike) * 100) / 100;
    if (!(K > 0) || Math.abs(K / S - 1) > 0.25) throw new StockError('Strike must be within 25% of the current price.');
    const premium = optionPremium(c, kind, S, K, d, n);
    if (premium > OPT_MAX_PREMIUM) throw new StockError(`Premium too large: max ${OPT_MAX_PREMIUM.toLocaleString()} chips per order.`);
    const be = kind === 'call' ? K + premium / n : K - premium / n;
    return { ticker: c.ticker, kind, strike: K, days: d, qty: n, price: S, premium, breakeven: r2(be), expiry: this.clock() + d * DAY };
  }
  async buyOption(name: string, t: unknown, kind: unknown, strike: unknown, days: unknown, qty: unknown) {
    if (isMarketBlocked(name)) throw new StockError(MARKET_BLOCKED_MSG);
    const q = this.optionQuote(t, kind, strike, days, qty);
    if ((await this.options(name)).length >= MAX_OPEN_OPTIONS) throw new StockError(`You can have at most ${MAX_OPEN_OPTIONS} open options.`);
    this.debitCheck(name, q.premium);
    const id = randomUUID(); const k = keyOf(name); const now = this.clock();
    const o: OptionPos = { id, key: k, name: name.trim(), ticker: q.ticker, kind: q.kind as 'call' | 'put', strike: q.strike, qty: q.qty, premium: q.premium, openedAt: now, expiry: q.expiry, status: 'open' };
    await this.atomic([{ name, amount: -q.premium, key: `opt:${id}:buy`, game: 'stocks', memo: `Bought ${q.qty}x ${q.ticker} ${q.strike} ${q.kind} (${q.days}d) for ${q.premium}` }], async (cl) => {
      if (!cl) { this.mOpts.set(id, o); return; }
      await cl.query('INSERT INTO stk_options (id, player_key, name, ticker, kind, strike, qty, premium, opened_at, expiry) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, k, o.name, o.ticker, o.kind, o.strike, o.qty, o.premium, now, o.expiry]);
    });
    return { ...q, id, balance: getBank().account(name).chips };
  }

  private selling = new Set<string>();
  /** What selling `qty` of held option `id` would pay right now. */
  async optionSellQuote(name: string, id: unknown, qty: unknown) {
    const k = keyOf(name); const o = (await this.options(name)).find((x) => x.id === id && x.key === k);
    if (!o) throw new StockError("You don't hold that option (it may have expired or been sold).");
    const now = this.clock(); if (o.expiry <= now) throw new StockError('That option has expired. It settles automatically at the next price tick.');
    const pq = parseQty(qty ?? o.qty, { max: o.qty }); if (!pq.ok) throw new StockError(`${pq.error} You hold ${o.qty}.`);
    const c = COMPANY_BY_TICKER.get(o.ticker)!; const S = this.optPrice(o.ticker)!;
    const payout = optionBid(c, o.kind, S, o.strike, daysLeft(o.expiry, now), pq.n);
    const basis = pq.n === o.qty ? o.premium : Math.round((o.premium * pq.n) / o.qty);
    return { o, qty: pq.n, price: S, payout, basis };
  }
  /** Sell to close (all or part). Payout via the atomic wallet; row update is conditional on the qty we priced. */
  async sellOption(name: string, id: unknown, qty: unknown) {
    if (isMarketBlocked(name)) throw new StockError(MARKET_BLOCKED_MSG);
    const lockId = String(id);
    if (this.selling.has(lockId)) throw new StockError('A sale of this option is already in progress.');
    this.selling.add(lockId);
    try {
      const { o, qty: n, price: S, payout, basis } = await this.optionSellQuote(name, id, qty);
      if (payout < 1) throw new StockError('That option is worth less than 1 chip right now, so it can only be held to expiry.');
      const left = o.qty - n; const now = this.clock();
      await this.atomic([{ name, amount: payout, key: `opt:${o.id}:sell:${o.qty}`, game: 'stocks', memo: `Sold ${n}x ${o.ticker} ${o.strike} ${o.kind} for ${payout}` }], async (cl) => {
        if (!cl) {
          const m = this.mOpts.get(o.id); if (!m || m.status !== 'open' || m.qty !== o.qty || m.expiry <= now) throw new StockError('That option changed. Try again.');
          if (left) Object.assign(m, { qty: left, premium: m.premium - basis }); else Object.assign(m, { status: 'sold', settlePrice: S, payout });
          return;
        }
        const u = left
          ? await cl.query('UPDATE stk_options SET qty = $2, premium = premium - $3 WHERE id = $1 AND status = \'open\' AND qty = $4 AND player_key = $5 AND expiry > $6', [o.id, left, basis, o.qty, o.key, now])
          : await cl.query('UPDATE stk_options SET status = \'sold\', settle_price = $2, payout = $3 WHERE id = $1 AND status = \'open\' AND qty = $4 AND player_key = $5 AND expiry > $6', [o.id, S, payout, o.qty, o.key, now]);
        if ((u.rowCount ?? 0) === 0) throw new StockError('That option changed. Try again.');
      });
      return { id: o.id, ticker: o.ticker, kind: o.kind, strike: o.strike, sold: n, left, price: S, payout, pnl: payout - basis, balance: getBank().account(name).chips };
    } finally { this.selling.delete(lockId); }
  }

  // ---------- jobs (tick winner) ----------
  async afterTick(now = this.clock()) {
    if (this.running) return; this.running = true;
    try {
      await this.liquidate().catch((e) => console.error('[stocks2] liquidations failed:', (e as Error).message));
      await this.expire(now).catch((e) => console.error('[stocks2] expiries failed:', (e as Error).message));
      await this.daily(now).catch((e) => console.error('[stocks2] daily payout failed:', (e as Error).message));
    } finally { this.running = false; }
  }
  /** Close every short whose equity fell under the maintenance margin, at the mark price (no extra impact), fee 1%. */
  async liquidate() {
    let n = 0;
    for (const s of await this.shorts(null)) {
      const p = this.price(s.ticker); if (p == null || !needsLiquidation(s, p)) continue;
      const c = COMPANY_BY_TICKER.get(s.ticker)!; const buy = Math.ceil(p * s.shares); const fee = Math.max(1, Math.ceil(buy * 0.01));
      try { await this.settleShort(s, 'liquidated', p, buy, fee, null, c); n++; } catch (e) { if (!(e instanceof Skip)) throw e; }
    }
    return n;
  }
  /** Cash-settle every expired option once, at the price when it is processed (the first tick after expiry). */
  async expire(now = this.clock()) {
    let n = 0;
    for (const o of (await this.options(null)).filter((x) => x.expiry <= now)) {
      const S = this.optPrice(o.ticker)!; const payout = optionPayout(o.kind, S, o.strike, o.qty);
      try {
        await this.atomic([{ name: o.name, amount: payout, key: `opt:${o.id}:settle`, game: 'stocks', memo: `${o.ticker} ${o.strike} ${o.kind} expired @ ${S.toFixed(2)}` }], async (cl) => {
          if (!cl) { const m = this.mOpts.get(o.id); if (!m || m.status !== 'open' || m.qty !== o.qty) throw new Skip(); Object.assign(m, { status: 'settled', settlePrice: S, payout }); return; }
          const u = await cl.query('UPDATE stk_options SET status = \'settled\', settle_price = $2, payout = $3 WHERE id = $1 AND status = \'open\' AND qty = $4', [o.id, S, payout, o.qty]);
          if ((u.rowCount ?? 0) === 0) throw new Skip();
        });
        n++;
      } catch (e) { if (!(e instanceof Skip)) throw e; }
    }
    return n;
  }
  /** Once per UTC day after DIV_HOUR_UTC: dividends (stocks + fund pass-through), mutual fund expenses, short borrow fees. */
  async daily(now = this.clock()) {
    const day = utcDay(now); if (new Date(now).getUTCHours() < DIV_HOUR_UTC) return null;
    const claim = `daily:${day}`;
    if (this.pool) { if ((await this.pool.query('SELECT 1 FROM stk_claims WHERE id = $1', [claim])).rows.length) return null; } else if (this.mClaims.has(claim)) return null;
    // Who gets what (snapshot).
    const pay = new Map<string, { name: string; chips: number }>();
    const add = (k: string, name: string, v: number) => { if (!(v > 0)) return; const e = pay.get(k) ?? { name, chips: 0 }; e.chips += v; pay.set(k, e); };
    const holds: Array<{ k: string; name: string; ticker: string; shares: number }> = this.pool
      ? (await this.pool.query('SELECT player_key, name, ticker, shares FROM stock_holdings WHERE shares > 0')).rows.map((x) => ({ k: String(x.player_key), name: String(x.name), ticker: String(x.ticker), shares: Number(x.shares) }))
      : this.ex.memHoldings();
    for (const h of holds) { const y = divYield(h.ticker); if (y) add(h.k, h.name, h.shares * this.price(h.ticker)! * y); }
    const fundRows: Array<{ k: string; name: string; fund: string; units: number }> = this.pool
      ? (await this.pool.query('SELECT player_key, name, fund, units FROM stk_fund_units WHERE units > 0')).rows.map((x) => ({ k: String(x.player_key), name: String(x.name), fund: String(x.fund), units: Number(x.units) }))
      : [...this.mFunds].flatMap(([k, m]) => [...m.values()].map((p) => ({ k, name: p.name, fund: p.fund, units: p.units })));
    let expenseBurn = 0;
    for (const r of fundRows) { const f = FUND_BY_ID.get(r.fund); if (!f) continue; add(r.k, r.name, r.units * fundDivPerUnit(f, this.price)); expenseBurn += r.units * f.expense * this.nav(f); }
    const moves: Move[] = [...pay].map(([k, p]) => ({ name: p.name, amount: Math.floor(p.chips), key: `div:${day}:${k}`, game: 'dividend', memo: `Daily dividends ${day}` })).filter((m) => m.amount >= 1 && !isJailed(m.name)); // jailed players don't earn dividends
    const shorts = await this.shorts(null);
    const fees = shorts.map((s) => ({ s, fee: Math.min(s.collateral, Math.max(1, Math.ceil(this.price(s.ticker)! * s.shares * BORROW_FEE))) }));
    const info = { day, paid: moves.reduce((a, m) => a + m.amount, 0), players: moves.length, expenseBurn: Math.round(expenseBurn), borrowFees: fees.reduce((a, f) => a + f.fee, 0) };
    try {
      await this.atomic(moves, async (cl) => {
        if (!cl) {
          if (this.mClaims.has(claim)) throw new Skip(); this.mClaims.set(claim, info);
          for (const m of this.mFunds.values()) for (const p of m.values()) { const f = FUND_BY_ID.get(p.fund); if (f?.expense) p.units *= 1 - f.expense; }
          for (const { s, fee } of fees) { const m = this.mShorts.get(s.id); if (m && m.status === 'open') { m.collateral -= fee; m.fees += fee; } }
          return;
        }
        if (!(await cl.query('INSERT INTO stk_claims (id, at, info) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [claim, now, JSON.stringify(info)])).rows.length) throw new Skip();
        for (const f of FUNDS) if (f.expense) await cl.query('UPDATE stk_fund_units SET units = units * $2 WHERE fund = $1', [f.id, 1 - f.expense]);
        for (const { s, fee } of fees) await cl.query('UPDATE stk_shorts SET collateral = GREATEST(0, collateral - $2), fees = fees + $2 WHERE id = $1 AND status = \'open\'', [s.id, fee]);
      });
    } catch (e) { if (e instanceof Skip) return null; throw e; }
    this.lastDaily = { day, info };
    return info;
  }

  /** Bank Economy: non-QA fund units, short equity and options at mark. */
  async economyAssets(): Promise<Array<{ key: string; label: string; value: number }>> {
    const notQa = (k: string) => !k.startsWith('qa-');
    let funds = 0;
    const units: Array<{ k: string; fund: string; units: number }> = this.pool
      ? (await this.pool.query("SELECT player_key, fund, units FROM stk_fund_units WHERE units > 0 AND player_key NOT LIKE 'qa-%'")).rows.map((x) => ({ k: String(x.player_key), fund: String(x.fund), units: Number(x.units) }))
      : [...this.mFunds].flatMap(([k, m]) => [...m.values()].map((p) => ({ k, fund: p.fund, units: p.units })));
    for (const u of units) if (notQa(u.k)) { const f = FUND_BY_ID.get(u.fund); if (f) funds += u.units * this.nav(f); }
    const shorts = (await this.shorts(null)).filter((s) => notQa(s.key)).reduce((a, s) => a + shortEquity(s, this.price(s.ticker)!), 0);
    const options = (await this.options(null)).filter((o) => notQa(o.key)).reduce((a, o) => a + this.optionMark(o), 0);
    return [{ key: 'funds', label: 'Funds', value: Math.floor(funds) }, { key: 'shorts', label: 'Short equity', value: Math.floor(shorts) }, { key: 'options', label: 'Options', value: Math.floor(options) }];
  }
}

let d: Derivatives | null = null;
export const getDerivs = () => d;
export const setDerivs = (x: Derivatives | null) => { d = x; };
export const allTickers = () => COMPANIES.map((c) => c.ticker);
