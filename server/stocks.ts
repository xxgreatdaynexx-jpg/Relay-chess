/**
 * Stock Exchange: server-authoritative prices for 100 fictional companies.
 *
 * Price = base * exp(imp). `base` is a random walk (market + sector + company shocks, scaled by each company's volatility
 * and beta) that mean-reverts toward an `anchor`; the anchor drifts with chip inflation (Bank Economy) and in-game
 * activity per sector. `imp` is player impact: orders push it by value/liquidity (capped per trade and per tick) and it
 * decays with a 2h half-life. Seeded daily news events (>= 1 per company per UTC day) shock base and anchor.
 *
 * Multi-instance: each 30s tick slot is claimed in Postgres (UPDATE ... WHERE slot < $1); only the winner advances prices,
 * every instance re-reads them. Trades run in one transaction with their chip ledger rows (CasinoBank.transferAtomic),
 * the holdings row, the trade row, and the impact update, re-checking the price and caps under FOR UPDATE.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { getEconomy } from './economy.js';
import { COMPANIES, COMPANY_BY_TICKER, SECTOR_BY_ID, SECTORS, IMPACT_HALF_LIFE_MS, MAX_TICK_IMPACT, TICK_MS, dailyEvents, maxOrderChips, quote, seeded, hash32, type ActivityKey, type Company, type NewsItem } from '../shared/stocks.js';

export class StockError extends Error {}
const DAY = 86_400_000;
const TICKS_PER_DAY = DAY / TICK_MS;
const HIST_EVERY = 20; // history point every 20 ticks (10 min)
const REVERT = Math.LN2 / (3 * TICKS_PER_DAY); // pull toward anchor, 3-day half-life
const MAX_DRIFT = 0.03; // |anchor drift| <= 3%/day
const INFL_CAP = 0.02; // inflation input clamped to +-2%/day
const ACT_WEIGHT = 0.01; // full activity signal = +-1%/day
const PLAYER_CAP = 2000; // chips of one player's activity counted per window (no single player can game it)
const CASINO = ['casino', 'blackjack', 'roulette', 'holdem', 'poker', 'slots', 'vslots', 'videopoker', 'solitro'];
export const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface Row { ticker: string; base: number; anchor: number; imp: number; tickImp: number; tickSlot: number; held: number }
export interface Holding { ticker: string; shares: number; cost: number }

export const MIGRATION = `
CREATE TABLE IF NOT EXISTS stock_prices (ticker TEXT PRIMARY KEY, base DOUBLE PRECISION NOT NULL, anchor DOUBLE PRECISION NOT NULL, imp DOUBLE PRECISION NOT NULL DEFAULT 0,
  tick_imp DOUBLE PRECISION NOT NULL DEFAULT 0, tick_slot BIGINT NOT NULL DEFAULT 0, held BIGINT NOT NULL DEFAULT 0 CHECK (held >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS stock_meta (id INT PRIMARY KEY, slot BIGINT NOT NULL, act JSONB);
CREATE TABLE IF NOT EXISTS stock_history (ticker TEXT NOT NULL, t BIGINT NOT NULL, price DOUBLE PRECISION NOT NULL, PRIMARY KEY (ticker, t));
CREATE INDEX IF NOT EXISTS stock_history_t ON stock_history (t);
CREATE TABLE IF NOT EXISTS stock_holdings (player_key TEXT NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL, shares BIGINT NOT NULL CHECK (shares >= 0), cost BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, ticker));
CREATE TABLE IF NOT EXISTS stock_trades (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL, side TEXT NOT NULL, shares BIGINT NOT NULL, price DOUBLE PRECISION NOT NULL, chips BIGINT NOT NULL, fee BIGINT NOT NULL, at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS stock_trades_at ON stock_trades (at);
CREATE TABLE IF NOT EXISTS stock_news (id TEXT PRIMARY KEY, ticker TEXT NOT NULL, at BIGINT NOT NULL, headline TEXT NOT NULL, move DOUBLE PRECISION NOT NULL, good BOOLEAN NOT NULL);
CREATE INDEX IF NOT EXISTS stock_news_at ON stock_news (at);
INSERT INTO stock_meta (id, slot) VALUES (1, 0) ON CONFLICT DO NOTHING;`;

const gauss = (r: () => number) => { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Anchor drift per day for a company: inflation x sector sensitivity + activity signal, capped. Pure, for tests. */
export function dailyDrift(c: Company, inflPct: number | null, act: Partial<Record<ActivityKey, number>>): number {
  const s = SECTOR_BY_ID.get(c.sector)!;
  const infl = clamp((inflPct ?? 0) / 100, -INFL_CAP, INFL_CAP) * s.infl;
  const a = clamp(act[s.activity] ?? 0, -1, 1) * 0.7 + clamp(act.players ?? 0, -1, 1) * 0.3;
  return clamp(infl + a * ACT_WEIGHT, -MAX_DRIFT, MAX_DRIFT);
}
/** Activity signal: log of last-24h activity vs. the prior 7-day daily average, damped below 3 distinct players, in [-1, 1]. */
export function activitySignal(cur: number, avg: number, players: number): number {
  const k = 50; const s = Math.log((cur + k) / (avg + k));
  return clamp(s, -1, 1) * Math.min(1, players / 3);
}
/** Advance one company one tick (pure). */
export function stepBase(c: Company, row: Pick<Row, 'base' | 'anchor'>, zMarket: number, zSector: number, zIdio: number, driftDay: number) {
  const sig = c.vol / Math.sqrt(TICKS_PER_DAY);
  const anchor = row.anchor * Math.exp(driftDay / TICKS_PER_DAY);
  const shock = sig * (0.5 * c.beta * zMarket + 0.5 * zSector + 0.7 * zIdio);
  const rev = -REVERT * Math.log(row.base / anchor);
  const base = clamp(row.base * Math.exp(shock + rev + driftDay / TICKS_PER_DAY), 0.5, 1e6);
  return { base, anchor };
}
export const priceOf = (r: Pick<Row, 'base' | 'imp'>) => Math.round(r.base * Math.exp(r.imp) * 100) / 100;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

export class Exchange {
  rows = new Map<string, Row>();
  prev24 = new Map<string, number>();
  vol24 = new Map<string, number>();
  act: Partial<Record<ActivityKey, number>> = {};
  inflPct: number | null = null;
  news: NewsItem[] = [];
  // memory mode (no DB: tests / dev)
  private memHold = new Map<string, Map<string, Holding>>();
  private memHist = new Map<string, Array<[number, number]>>();
  private memSlot = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  onTick?: () => void;
  constructor(private readonly pool: pg.Pool | null, private readonly clock = () => Date.now()) {
    for (const c of COMPANIES) this.rows.set(c.ticker, { ticker: c.ticker, base: c.start, anchor: c.start, imp: 0, tickImp: 0, tickSlot: 0, held: 0 });
  }
  slotNow() { return Math.floor(this.clock() / TICK_MS); }
  price(t: string) { const r = this.rows.get(t); return r ? priceOf(r) : null; }

  async init() {
    if (!this.pool) return;
    await this.pool.query(MIGRATION);
    const vals = COMPANIES.map((c, i) => `($${i * 2 + 1}, $${i * 2 + 2}::float8, $${i * 2 + 2}::float8)`).join(',');
    await this.pool.query(`INSERT INTO stock_prices (ticker, base, anchor) VALUES ${vals} ON CONFLICT DO NOTHING`, COMPANIES.flatMap((c) => [c.ticker, c.start]));
    await this.reload(true);
  }

  private async reload(full = false) {
    if (!this.pool) return;
    const r = await this.pool.query('SELECT ticker, base, anchor, imp, tick_imp, tick_slot, held FROM stock_prices');
    for (const x of r.rows) { const t = String(x.ticker); if (!COMPANY_BY_TICKER.has(t)) continue; this.rows.set(t, { ticker: t, base: Number(x.base), anchor: Number(x.anchor), imp: Number(x.imp), tickImp: Number(x.tick_imp), tickSlot: Number(x.tick_slot), held: Number(x.held) }); }
    if (full || this.slotNow() % HIST_EVERY === 1) await this.reloadStats();
  }
  private async reloadStats() {
    if (!this.pool) return;
    const now = this.clock();
    const [p, v, n, m] = await Promise.all([
      this.pool.query('SELECT DISTINCT ON (ticker) ticker, price FROM stock_history WHERE t >= $1 ORDER BY ticker, t', [now - DAY]),
      this.pool.query('SELECT ticker, SUM(shares) s FROM stock_trades WHERE at >= $1 GROUP BY 1', [now - DAY]),
      this.pool.query('SELECT id, ticker, at, headline, move, good FROM stock_news WHERE at >= $1 ORDER BY at DESC LIMIT 400', [now - 7 * DAY]),
      this.pool.query('SELECT act FROM stock_meta WHERE id = 1'),
    ]);
    this.prev24 = new Map(p.rows.map((x) => [String(x.ticker), Number(x.price)]));
    this.vol24 = new Map(v.rows.map((x) => [String(x.ticker), Number(x.s)]));
    this.news = n.rows.map((x) => ({ id: String(x.id), ticker: String(x.ticker), at: Number(x.at), headline: String(x.headline), move: Number(x.move), good: !!x.good }));
    const a = m.rows[0]?.act as { act?: Partial<Record<ActivityKey, number>>; infl?: number | null } | null; if (a) { this.act = a.act ?? {}; this.inflPct = a.infl ?? null; }
  }

  /** Measure in-game activity (rolling 24h vs prior 7-day average, each player capped). */
  async measureActivity(): Promise<Partial<Record<ActivityKey, number>>> {
    if (!this.pool) return this.act;
    const now = this.clock();
    const rows = (await this.pool.query(`WITH w AS (
        SELECT game, player_key, (created_at >= to_timestamp($1/1000.0)) cur, SUM(ABS(amount)) a FROM wallet_transactions
        WHERE created_at >= to_timestamp($2/1000.0) AND player_key NOT LIKE 'qa-%' AND game NOT IN ('stocks','admin') GROUP BY 1,2,3)
      SELECT game, cur, SUM(LEAST(a, $3)) v, COUNT(DISTINCT player_key) p FROM w GROUP BY 1,2`, [now - DAY, now - 8 * DAY, PLAYER_CAP])).rows;
    const players = (await this.pool.query(`SELECT (created_at >= to_timestamp($1/1000.0)) cur, COUNT(DISTINCT player_key) p FROM wallet_transactions WHERE created_at >= to_timestamp($2/1000.0) AND player_key NOT LIKE 'qa-%' GROUP BY 1`, [now - DAY, now - 8 * DAY])).rows;
    const bucket = (g: string): ActivityKey | null => g === 'mines' ? 'mines' : g === 'arena' ? 'arena' : g === 'factory' ? 'factory' : g === 'market' || g === 'trade' ? 'market' : CASINO.includes(g) ? 'casino' : null;
    const acc = new Map<string, { cur: number; prev: number; p: number }>();
    const add = (k: string, cur: boolean, v: number, p: number) => { const e = acc.get(k) ?? { cur: 0, prev: 0, p: 0 }; if (cur) { e.cur += v; e.p = Math.max(e.p, p); } else e.prev += v; acc.set(k, e); };
    for (const r of rows) { const b = bucket(String(r.game)); const cur = !!r.cur; if (b) add(b, cur, Number(r.v), Number(r.p)); add('flow', cur, Number(r.v), Number(r.p)); }
    for (const r of players) add('players', !!r.cur, Number(r.p) * 100, Number(r.p));
    const out: Partial<Record<ActivityKey, number>> = {};
    for (const [k, e] of acc) { const s = activitySignal(e.cur, e.prev / 7, e.p); const old = this.act[k as ActivityKey] ?? 0; out[k as ActivityKey] = Math.round((old * 0.7 + s * 0.3) * 1000) / 1000; } // EMA smoothing
    return out;
  }

  /** One tick. Returns true when this instance advanced the prices. */
  async tick(): Promise<boolean> {
    if (this.ticking) return false; this.ticking = true;
    try {
      const slot = this.slotNow();
      let won: boolean;
      if (this.pool) {
        won = ((await this.pool.query('UPDATE stock_meta SET slot = $1 WHERE id = 1 AND slot < $1 RETURNING slot', [slot])).rowCount ?? 0) > 0;
        if (!won) { await this.reload(); this.onTick?.(); return false; }
        await this.reload();
      } else { if (slot <= this.memSlot) return false; this.memSlot = slot; won = true; }
      const now = this.clock();
      if (slot % HIST_EVERY === 0 || this.inflPct === null) {
        try { const e = (await getEconomy()?.stats()) as { inflation?: { cash7?: number | null }; change?: { cash?: number | null } } | undefined; this.inflPct = e?.inflation?.cash7 ?? e?.change?.cash ?? 0; } catch { /* keep */ }
        try { this.act = await this.measureActivity(); } catch (e) { console.error('[stocks] activity failed:', (e as Error).message); }
        if (this.pool) await this.pool.query('UPDATE stock_meta SET act = $1 WHERE id = 1', [JSON.stringify({ act: this.act, infl: this.inflPct })]);
      }
      // Seeded shocks (same draw on any instance for this slot).
      const r = seeded(hash32(`tick:${slot}`)); const zm = gauss(r); const zs = new Map(SECTORS.map((s) => [s.id, gauss(r)]));
      const due = await this.dueNews(now);
      const decay = Math.pow(0.5, TICK_MS / IMPACT_HALF_LIFE_MS);
      for (const c of COMPANIES) {
        const row = this.rows.get(c.ticker)!; const n = step(c, row, zm, zs.get(c.sector)!, gauss(r), dailyDrift(c, this.inflPct, this.act));
        let { base, anchor } = n; for (const e of due) if (e.ticker === c.ticker) { base *= Math.exp(e.move); anchor *= Math.exp(e.move * 0.5); }
        row.base = base; row.anchor = anchor; if (!this.pool) row.imp *= decay;
      }
      if (this.pool) {
        const list = COMPANIES.map((c) => this.rows.get(c.ticker)!);
        await this.pool.query(`UPDATE stock_prices p SET base = u.base, anchor = u.anchor, imp = p.imp * $4, updated_at = now() FROM unnest($1::text[], $2::float8[], $3::float8[]) u(ticker, base, anchor) WHERE p.ticker = u.ticker`,
          [list.map((x) => x.ticker), list.map((x) => x.base), list.map((x) => x.anchor), decay]);
        if (slot % HIST_EVERY === 0) {
          await this.pool.query('INSERT INTO stock_history (ticker, t, price) SELECT ticker, $1, ROUND((base * exp(imp))::numeric, 2) FROM stock_prices ON CONFLICT DO NOTHING', [slot * TICK_MS]);
          if (slot % (HIST_EVERY * 36) === 0) await this.pool.query('DELETE FROM stock_history WHERE t < $1', [now - 31 * DAY]);
        }
        await this.reload();
      } else if (slot % HIST_EVERY === 0) for (const c of COMPANIES) { const h = this.memHist.get(c.ticker) ?? []; h.push([slot * TICK_MS, this.price(c.ticker)!]); this.memHist.set(c.ticker, h); }
      this.onTick?.();
      return true;
    } finally { this.ticking = false; }
  }

  /** Today's and yesterday's scheduled events whose time has come and that were not applied yet (persisted, so never re-rolled or skipped). */
  private async dueNews(now: number): Promise<NewsItem[]> {
    const days = [utcDay(now - DAY), utcDay(now)];
    const cand = COMPANIES.flatMap((c) => days.flatMap((d) => dailyEvents(c, d))).filter((e) => e.at <= now && e.at > now - DAY);
    const have = new Set(this.news.map((n) => n.id)); const fresh = cand.filter((e) => !have.has(e.id));
    if (!fresh.length) return [];
    if (!this.pool) { this.news.unshift(...fresh); return fresh; }
    const ins = await this.pool.query(`INSERT INTO stock_news (id, ticker, at, headline, move, good) SELECT * FROM unnest($1::text[], $2::text[], $3::bigint[], $4::text[], $5::float8[], $6::bool[]) ON CONFLICT DO NOTHING RETURNING id`,
      [fresh.map((e) => e.id), fresh.map((e) => e.ticker), fresh.map((e) => e.at), fresh.map((e) => e.headline), fresh.map((e) => e.move), fresh.map((e) => e.good)]);
    const ok = new Set(ins.rows.map((x) => String(x.id))); const applied = fresh.filter((e) => ok.has(e.id));
    this.news = [...applied.sort((a, b) => b.at - a.at), ...this.news].slice(0, 400);
    return applied;
  }

  start() { const run = () => { void this.tick().catch((e) => console.error('[stocks] tick failed:', (e as Error).message)); }; this.timer = setInterval(run, TICK_MS); this.timer.unref?.(); run(); }
  stop() { if (this.timer) clearInterval(this.timer); }

  // ---------- reads ----------
  summary(c: Company) {
    const row = this.rows.get(c.ticker)!; const price = priceOf(row); const prev = this.prev24.get(c.ticker) ?? c.start;
    return { ticker: c.ticker, name: c.name, sector: c.sector, price, chg: Math.round(((price - prev) / prev) * 10000) / 100, volume: this.vol24.get(c.ticker) ?? 0, shares: c.shares, held: row.held, cap: Math.round(price * c.shares), playerPct: Math.round((row.held / c.shares) * 10000) / 100 };
  }
  list() {
    const all = COMPANIES.map((c) => this.summary(c));
    const cap = all.reduce((a, s) => a + s.cap, 0), owned = all.reduce((a, s) => a + s.price * s.held, 0);
    return { companies: all, sectors: SECTORS, news: this.news.slice(0, 40), totals: { cap, playerOwned: Math.round(owned), offshore: Math.round(cap - owned) }, drift: { inflPct: this.inflPct, activity: this.act } };
  }
  async chart(t: string, range: unknown) {
    const ms = range === '30d' ? 30 * DAY : range === '7d' ? 7 * DAY : DAY; const step = range === '30d' ? 4 * 3_600_000 : range === '7d' ? 3_600_000 : 600_000;
    const now = this.clock(); let pts: Array<[number, number]>;
    if (this.pool) pts = (await this.pool.query('SELECT (t / $3) * $3 b, (ARRAY_AGG(price ORDER BY t DESC))[1] p FROM stock_history WHERE ticker = $1 AND t >= $2 GROUP BY 1 ORDER BY 1', [t, now - ms, step])).rows.map((x) => [Number(x.b), Number(x.p)]);
    else pts = (this.memHist.get(t) ?? []).filter(([x]) => x >= now - ms);
    pts.push([now, this.price(t)!]);
    return pts;
  }
  async company(t: unknown, range: unknown, name: string | null) {
    const c = typeof t === 'string' ? COMPANY_BY_TICKER.get(t) : undefined; if (!c) throw new StockError('Unknown company.');
    const mine = name ? (await this.holdings(name)).find((h) => h.ticker === c.ticker) ?? null : null;
    return { company: { ...c, ...this.summary(c) }, chart: await this.chart(c.ticker, range), news: this.news.filter((n) => n.ticker === c.ticker).slice(0, 20), upcoming: dailyEvents(c, utcDay(this.clock())).filter((e) => e.at > this.clock()).length, mine, maxOrder: maxOrderChips(c), drift: dailyDrift(c, this.inflPct, this.act) };
  }
  async holdings(name: string): Promise<Holding[]> {
    const k = keyOf(name);
    if (!this.pool) return [...(this.memHold.get(k)?.values() ?? [])].filter((h) => h.shares > 0);
    return (await this.pool.query('SELECT ticker, shares, cost FROM stock_holdings WHERE player_key = $1 AND shares > 0 ORDER BY ticker', [k])).rows.map((x) => ({ ticker: String(x.ticker), shares: Number(x.shares), cost: Number(x.cost) }));
  }
  async portfolio(name: string) {
    const hs = (await this.holdings(name)).map((h) => { const p = this.price(h.ticker) ?? 0; const value = Math.round(p * h.shares); return { ...h, name: COMPANY_BY_TICKER.get(h.ticker)?.name ?? h.ticker, price: p, value, pnl: value - h.cost, pnlPct: h.cost ? Math.round(((value - h.cost) / h.cost) * 10000) / 100 : 0 }; });
    const value = hs.reduce((a, h) => a + h.value, 0), cost = hs.reduce((a, h) => a + h.cost, 0);
    return { holdings: hs, value, cost, pnl: value - cost };
  }

  // ---------- trading ----------
  async trade(name: string, side: 'buy' | 'sell', t: unknown, n: unknown) {
    const c = typeof t === 'string' ? COMPANY_BY_TICKER.get(t) : undefined; if (!c) throw new StockError('Unknown company.');
    const shares = Number(n); if (!Number.isInteger(shares) || shares < 1 || shares > 1_000_000) throw new StockError('Enter a whole number of shares.');
    const bank = getBank(); const k = keyOf(name); const row = this.rows.get(c.ticker)!; const price = priceOf(row);
    const q = quote(c, price, side, shares);
    if (q.gross > maxOrderChips(c)) throw new StockError(`Order too large: max ${maxOrderChips(c).toLocaleString()} chips per trade (about ${Math.max(1, Math.floor(maxOrderChips(c) / price))} shares).`);
    if (side === 'sell' && q.total < 1) throw new StockError('Too small to sell after the fee.');
    if (side === 'buy' && row.held + shares > c.shares) throw new StockError(`Only ${c.shares - row.held} shares are left offshore.`);
    const slot = this.slotNow(); const used = row.tickSlot === slot ? row.tickImp : 0;
    if (used + Math.abs(q.imp) > MAX_TICK_IMPACT) throw new StockError('Heavy trading in this stock right now. Try a smaller order or wait a few seconds.');
    if (side === 'buy' && !bank.canAfford(name, q.total)) throw new StockError('Not enough chips.');
    if (side === 'sell') { const h = (await this.holdings(name)).find((x) => x.ticker === c.ticker); if (!h || h.shares < shares) throw new StockError(`You own ${h?.shares ?? 0} ${c.ticker} shares.`); }
    const id = randomUUID(); const at = this.clock();
    const memo = `${side === 'buy' ? 'Bought' : 'Sold'} ${shares} ${c.ticker} @ ${q.fill.toFixed(2)} (fee ${q.fee})`;
    const w = bank.transferAtomic([{ name, amount: side === 'buy' ? -q.total : q.total, key: `stk:${id}`, game: 'stocks', memo }]);
    const costDelta = side === 'buy' ? q.total : 0;
    const run = async () => {
      if (!this.pool) {
        const m = this.memHold.get(k) ?? new Map<string, Holding>(); this.memHold.set(k, m); const h = m.get(c.ticker) ?? { ticker: c.ticker, shares: 0, cost: 0 };
        if (side === 'sell') { if (h.shares < shares) throw new StockError('Not enough shares.'); h.cost -= Math.round((h.cost * shares) / h.shares); h.shares -= shares; } else { h.shares += shares; h.cost += costDelta; }
        m.set(c.ticker, h); row.held += side === 'buy' ? shares : -shares; row.imp += q.imp; row.tickImp = used + Math.abs(q.imp); row.tickSlot = slot; return;
      }
      await w.after;
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        const cur = (await cl.query('SELECT base, imp, tick_imp, tick_slot, held FROM stock_prices WHERE ticker = $1 FOR UPDATE', [c.ticker])).rows[0];
        if (!cur) throw new StockError('Unknown company.');
        const live = priceOf({ base: Number(cur.base), imp: Number(cur.imp) });
        if (Math.abs(live - price) / price > 0.01) throw new StockError('The price just moved. Check the new quote and try again.');
        const u = Number(cur.tick_slot) === slot ? Number(cur.tick_imp) : 0;
        if (u + Math.abs(q.imp) > MAX_TICK_IMPACT) throw new StockError('Heavy trading in this stock right now. Try a smaller order or wait a few seconds.');
        const dh = side === 'buy' ? shares : -shares;
        if (Number(cur.held) + dh > c.shares) throw new StockError('Not enough shares left offshore.');
        await cl.query('UPDATE stock_prices SET imp = imp + $2, tick_imp = $3, tick_slot = $4, held = held + $5 WHERE ticker = $1', [c.ticker, q.imp, u + Math.abs(q.imp), slot, dh]);
        if (side === 'buy') await cl.query('INSERT INTO stock_holdings (player_key, name, ticker, shares, cost) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_key, ticker) DO UPDATE SET shares = stock_holdings.shares + $4, cost = stock_holdings.cost + $5, name = $2', [k, name.trim(), c.ticker, shares, costDelta]);
        else if (((await cl.query('UPDATE stock_holdings SET cost = cost - ROUND(cost::numeric * $3 / shares), shares = shares - $3 WHERE player_key = $1 AND ticker = $2 AND shares >= $3', [k, c.ticker, shares])).rowCount ?? 0) === 0) throw new StockError('Not enough shares.');
        await cl.query('INSERT INTO stock_trades (id, player_key, name, ticker, side, shares, price, chips, fee, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, k, name.trim(), c.ticker, side, shares, q.fill, q.total, q.fee, at]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
        row.imp = Number(cur.imp) + q.imp; row.tickImp = u + Math.abs(q.imp); row.tickSlot = slot; row.held = Number(cur.held) + dh;
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof StockError) throw e; console.error('[stocks] trade failed:', (e as Error).message); throw new StockError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Trade failed. Nothing was charged.'); }
    this.vol24.set(c.ticker, (this.vol24.get(c.ticker) ?? 0) + shares);
    return { side, ticker: c.ticker, shares, fill: Math.round(q.fill * 100) / 100, gross: q.gross, fee: q.fee, total: q.total, price: this.price(c.ticker), balance: bank.account(name).chips };
  }

  /** Player-held shares by ticker (non-QA) for the Bank Economy. */
  async playerHeld(): Promise<Map<string, number>> {
    if (!this.pool) { const m = new Map<string, number>(); for (const [k, hs] of this.memHold) if (!k.startsWith('qa-')) for (const h of hs.values()) m.set(h.ticker, (m.get(h.ticker) ?? 0) + h.shares); return m; }
    return new Map((await this.pool.query("SELECT ticker, SUM(shares) s FROM stock_holdings WHERE player_key NOT LIKE 'qa-%' GROUP BY 1")).rows.map((x) => [String(x.ticker), Number(x.s)]));
  }
}
const step = stepBase;

let ex: Exchange | null = null;
export const getExchange = () => ex;
export function setExchange(e: Exchange | null) { ex = e; }
export async function initStocks(): Promise<void> {
  const url = databaseUrl();
  if (!url) { ex = new Exchange(null); ex.start(); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[stocks] pool error:', e.message));
  try { const e = new Exchange(pool); await e.init(); ex = e; e.start(); console.log('[stocks] ready'); } catch (e) { console.error('[stocks] init failed:', (e as Error).message); }
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wired: Server | null = null;
export function registerStocks(io: Server, socket: Socket): void {
  if (wired !== io && ex) { wired = io; const e = ex; e.onTick = () => io.to('stocks').emit('stk_tick', { prices: COMPANIES.map((c) => [c.ticker, e.price(c.ticker)]) }); }
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (b: Record<string, unknown>, e: Exchange) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!ex) throw new StockError('The exchange is starting up. Try again in a moment.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, ex)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof StockError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new StockError('Sign in to trade. Guests can browse.'); return n; };
  on('stk_list', (_b, e) => { void socket.join('stocks'); return e.list(); });
  on('stk_company', (b, e) => e.company(b.ticker, b.range, nameOf()));
  on('stk_portfolio', (_b, e) => e.portfolio(need()));
  on('stk_buy', (b, e) => e.trade(need(), 'buy', b.ticker, b.shares));
  on('stk_sell', (b, e) => e.trade(need(), 'sell', b.ticker, b.shares));
}
