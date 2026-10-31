/**
 * Global economy stats for the Bank panel: liquid cash, asset worth, daily inflation, faucets/sinks.
 * Postgres is the source of truth (wallet = casino_players.chips, ledger = wallet_transactions). QA- accounts are excluded.
 * There is no house account: every ledger row is player <-> house, so positive rows are chips created and negative rows destroyed
 * (market/trade rows are player <-> player; only their net, the fee, leaves the economy).
 *
 * Valuation (documented in the UI tooltip):
 *  - market items: median unit price of the last 20 public sales in the last 30 days; else median of the last 5 ever.
 *  - skins with no sales: median of same rarity + same weapon peers that have a price, then same rarity, then a catalog base. Marked est.
 *  - cases/keys with no sales: catalog base. ore/bars/goods with no sales: house sell price. Marked est.
 *  - factory machines (placed + in kit): 50% of Machinist cost (resale-style depreciation). Floors are not counted (not sellable). Marked est.
 */
import express from 'express';
import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { SKIN_BY_ID, type Rarity } from '../shared/skins.js';
import { priceOf, type ItemType } from '../shared/mines.js';
import { KINDS, isKind } from '../shared/factory.js';
import { COMPANIES } from '../shared/stocks.js';
import { getExchange } from './stocks.js';

export const ECON_MIGRATION = `CREATE TABLE IF NOT EXISTS daily_economy (
  day TEXT PRIMARY KEY, cash BIGINT NOT NULL, assets BIGINT, total BIGINT, est_pct REAL, flows JSONB, source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;

export const SKIN_BASE: Record<Rarity, number> = { common: 40, rare: 150, ultra: 600 };
export const CASE_BASE = 50, KEY_BASE = 100, MACHINE_RESALE = 0.5;
const DAY = 86_400_000, WINDOW = 30 * DAY, RECENT_N = 20, STALE_N = 5, CACHE_MS = 5 * 60_000, BACKFILL_DAYS = 90;
/** Ledger games where chips only move player -> player (trades, gifts, escrow). Never created or destroyed. */
export const P2P_GAMES = new Set(['trade', 'gift', 'tip', 'transfer', 'p2p']);
/** Player-to-player with a burned fee: only the fee leaves the economy. */
const FEE_GAMES = new Set(['market']);

export interface SaleRow { what: string; unit: number; at: number }
export interface Holdings {
  skins: Array<{ kind: string; skin: string; n: number }>;
  stacks: Array<{ type: string; id: string; qty: number }>;
  machines: Array<{ kind: string; n: number }>;
  /** Player-owned stock (Stock Exchange) at market price. */
  stocks?: Array<{ ticker: string; n: number; price: number }>;
}
export interface Flow { game: string; amount: number }
export interface DayRow { day: string; cash: number; assets: number | null; total: number | null; estPct: number | null; flows: { faucets: Flow[]; sinks: Flow[]; transfers?: Flow[] } | null; source: string }
export interface Category { key: string; label: string; value: number; units: number; estValue: number }

export interface EconSource {
  cash(): Promise<number>;
  holdings(): Promise<Holdings>;
  sales(): Promise<SaleRow[]>;
  /** Ledger net per game for [from, to). */
  flows(from: number, to: number): Promise<Array<{ game: string; pos: number; neg: number }>>;
  /** Liquid cash at instant t, reconstructed from each player's last ledger balance before t. */
  cashAt(t: number): Promise<number>;
  firstLedgerAt(): Promise<number | null>;
  days(): Promise<DayRow[]>;
  saveDay(r: DayRow): Promise<void>;
}

const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };
export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Market price per `what` (skin id | 'case' | 'key' | 'stack:type:id'). */
export function marketPrices(sales: SaleRow[], now: number): Map<string, number> {
  const by = new Map<string, SaleRow[]>();
  for (const s of sales) { let a = by.get(s.what); if (!a) by.set(s.what, (a = [])); a.push(s); }
  const out = new Map<string, number>();
  for (const [w, rows] of by) {
    rows.sort((a, b) => b.at - a.at);
    const recent = rows.filter((r) => r.at >= now - WINDOW).slice(0, RECENT_N);
    const m = median((recent.length ? recent : rows.slice(0, STALE_N)).map((r) => r.unit));
    if (m != null) out.set(w, m);
  }
  return out;
}

/** Value for one skin: market, else same rarity+weapon peers, else same rarity, else base. */
export function skinValue(skinId: string, prices: Map<string, number>): { value: number; est: false | 'peers' | 'rarity' | 'base' } {
  const p = prices.get(skinId); if (p != null) return { value: p, est: false };
  const d = SKIN_BY_ID.get(skinId); if (!d) return { value: 0, est: 'base' };
  const peer = (f: (x: NonNullable<ReturnType<typeof SKIN_BY_ID.get>>) => boolean) => median([...prices].filter(([w]) => { const x = SKIN_BY_ID.get(w); return !!x && f(x); }).map(([, v]) => v));
  const a = peer((x) => x.rarity === d.rarity && x.weapon === d.weapon); if (a != null) return { value: a, est: 'peers' };
  const b = peer((x) => x.rarity === d.rarity); if (b != null) return { value: b, est: 'rarity' };
  return { value: SKIN_BASE[d.rarity], est: 'base' };
}

export function valueHoldings(h: Holdings, prices: Map<string, number>) {
  const cats: Record<string, Category> = {};
  const add = (key: string, label: string, v: number, n: number, est: boolean) => { const c = (cats[key] ??= { key, label, value: 0, units: 0, estValue: 0 }); c.value += v * n; c.units += n; if (est) c.estValue += v * n; };
  for (const s of h.skins) {
    if (s.kind === 'case' || s.kind === 'key') { const p = prices.get(s.kind); add('cases', 'Cases & keys', p ?? (s.kind === 'case' ? CASE_BASE : KEY_BASE), s.n, p == null); continue; }
    const v = skinValue(s.skin, prices); const pick = SKIN_BY_ID.get(s.skin)?.weapon === 'pickaxe';
    add(pick ? 'pickaxes' : 'skins', pick ? 'Pickaxe skins' : 'Weapon skins', v.value, s.n, v.est !== false);
  }
  for (const s of h.stacks) {
    const p = prices.get(`stack:${s.type}:${s.id}`);
    add(s.type === 'ore' ? 'ore' : 'goods', s.type === 'ore' ? 'Ore' : 'Bars & goods', p ?? priceOf({ type: s.type as ItemType, id: s.id }), s.qty, p == null);
  }
  for (const st of h.stocks ?? []) if (st.n > 0) add('stocks', 'Stocks', st.price, st.n, false);
  for (const m of h.machines) if (isKind(m.kind)) add('factory', 'Factory machines', Math.round(KINDS[m.kind].cost * MACHINE_RESALE), m.n, true);
  const list = Object.values(cats).map((c) => ({ ...c, value: Math.round(c.value), estValue: Math.round(c.estValue) })).sort((a, b) => b.value - a.value);
  const total = list.reduce((a, c) => a + c.value, 0), est = list.reduce((a, c) => a + c.estValue, 0);
  return { categories: list, total, estPct: total ? Math.round((est / total) * 1000) / 10 : 0 };
}

export function splitFlows(rows: Array<{ game: string; pos: number; neg: number }>) {
  const faucets: Flow[] = [], sinks: Flow[] = [], transfers: Flow[] = [];
  for (const r of rows) {
    if (P2P_GAMES.has(r.game)) {
      // Volume only (chips sent or received, whichever is larger: escrow can be open across the window). Not a source or sink.
      const vol = Math.max(r.pos, -r.neg); if (vol) transfers.push({ game: r.game, amount: vol }); continue;
    }
    if (FEE_GAMES.has(r.game)) {
      if (r.pos) transfers.push({ game: r.game, amount: r.pos });
      const fee = -(r.pos + r.neg); if (fee > 0) sinks.push({ game: `${r.game} fees`, amount: fee }); continue;
    }
    if (r.pos) faucets.push({ game: r.game, amount: r.pos }); if (r.neg) sinks.push({ game: r.game, amount: -r.neg });
  }
  const s = (a: Flow[]) => a.sort((x, y) => y.amount - x.amount);
  return { faucets: s(faucets), sinks: s(sinks), transfers: s(transfers) };
}

/** Re-sort stored snapshot flows (saved before p2p games were split out) without touching the stored rows. */
export function normalizeFlows(f: { faucets: Flow[]; sinks: Flow[]; transfers?: Flow[] } | null): { faucets: Flow[]; sinks: Flow[]; transfers: Flow[] } | null {
  if (!f) return null;
  const p2p = (x: Flow) => P2P_GAMES.has(x.game) || P2P_GAMES.has(x.game.replace(/ fees$/, ''));
  const transfers = [...(f.transfers ?? [])];
  for (const x of [...f.faucets, ...f.sinks]) if (p2p(x) && !transfers.some((t) => t.game === x.game.replace(/ fees$/, ''))) transfers.push({ game: x.game.replace(/ fees$/, ''), amount: x.amount });
  return { faucets: f.faucets.filter((x) => !p2p(x)), sinks: f.sinks.filter((x) => !p2p(x)), transfers };
}

const pct = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || !b ? null : Math.round(((a - b) / b) * 10000) / 100);
/** Average daily % change over the last n day-closes (geometric). */
export function avgDaily(series: Array<number | null>, n: number): number | null {
  const v = series.filter((x): x is number => x != null && x > 0).slice(-(n + 1)); if (v.length < 2) return null;
  return Math.round((Math.pow(v[v.length - 1]! / v[0]!, 1 / (v.length - 1)) - 1) * 10000) / 100;
}

export class Economy {
  private cached: { at: number; data: unknown } | null = null;
  private inflight: Promise<unknown> | null = null;
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly src: EconSource, private readonly clock = () => Date.now()) {}

  /** Live numbers (cached 5 min; concurrent callers share one computation). */
  async stats(): Promise<unknown> {
    const now = this.clock();
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.data;
    if (!this.inflight) this.inflight = this.compute(now).then((d) => { this.cached = { at: now, data: d }; return d; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async live(now: number) {
    const [cash, h, sales] = await Promise.all([this.src.cash(), this.src.holdings(), this.src.sales()]);
    // Stocks: shares players own are assets; the rest of each company's market cap is offshore (not anyone's net worth).
    const ex = getExchange(); let offshore = 0;
    if (ex) {
      const held = await ex.playerHeld().catch(() => new Map<string, number>());
      h.stocks = COMPANIES.map((c) => ({ ticker: c.ticker, n: held.get(c.ticker) ?? 0, price: ex.price(c.ticker) ?? c.start }));
      offshore = Math.round(h.stocks.reduce((a, s, i) => a + (COMPANIES[i]!.shares - s.n) * s.price, 0));
    }
    const v = valueHoldings(h, marketPrices(sales, now));
    return { cash, assets: v.total, total: cash + v.total, estPct: v.estPct, categories: v.categories, offshore, totalWithOffshore: cash + v.total + offshore };
  }

  private async compute(now: number) {
    await this.catchUp(now).catch((e) => console.error('[economy] catch-up failed:', (e as Error).message));
    const today = utcDay(now);
    const [live, days, fl] = await Promise.all([this.live(now), this.src.days(), this.src.flows(dayStart(today), now + 1)]);
    const hist = days.filter((d) => d.day < today).sort((a, b) => a.day.localeCompare(b.day));
    const y = hist[hist.length - 1];
    const cashSeries = [...hist.map((d) => d.cash), live.cash], totalSeries = [...hist.map((d) => d.total), live.total];
    const flows = splitFlows(fl);
    return {
      ok: true, at: now, today, ...live,
      change: { cash: pct(live.cash, y?.cash), assets: pct(live.assets, y?.assets), total: pct(live.total, y?.total) },
      inflation: { cash7: avgDaily(cashSeries, 7), cash30: avgDaily(cashSeries, 30), total7: avgDaily(totalSeries, 7), total30: avgDaily(totalSeries, 30) },
      flows, net: flows.faucets.reduce((a, f) => a + f.amount, 0) - flows.sinks.reduce((a, f) => a + f.amount, 0),
      history: hist.slice(-60).map((d) => ({ day: d.day, cash: d.cash, assets: d.assets, total: d.total, source: d.source })),
      method: 'Prices: median of the last 20 sales in 30 days. No sales: same rarity + weapon, then same rarity, then a base value (est.). Ore/goods without sales use the house price (est.). Factory machines at 50% of Machinist cost (est.). Stocks: player-owned shares at the live exchange price; shares no player owns are offshore assets (shown separately, not in net worth). QA accounts excluded.',
    };
  }

  /** Close every finished UTC day that has no row: yesterday gets a full snapshot if we're within its first hour, otherwise ledger cash only. */
  async catchUp(now: number) {
    const have = new Set((await this.src.days()).map((d) => d.day));
    const today = utcDay(now);
    const first = await this.src.firstLedgerAt(); if (first == null) return;
    let d = utcDay(Math.max(first, now - BACKFILL_DAYS * DAY));
    while (d < today) {
      if (!have.has(d)) {
        const end = dayStart(d) + DAY; const flows = splitFlows(await this.src.flows(dayStart(d), end));
        if (now - end < 3_600_000) { const l = await this.live(now); await this.src.saveDay({ day: d, cash: l.cash, assets: l.assets, total: l.total, estPct: l.estPct, flows, source: 'snapshot' }); }
        else await this.src.saveDay({ day: d, cash: await this.src.cashAt(end), assets: null, total: null, estPct: null, flows, source: 'ledger' });
      }
      d = utcDay(dayStart(d) + DAY);
    }
  }

  /** Snapshot at each UTC midnight (plus catch-up on boot). */
  start() {
    const arm = () => { const now = this.clock(); const next = dayStart(utcDay(now)) + DAY + 5_000; this.timer = setTimeout(() => { this.cached = null; void this.catchUp(this.clock()).catch((e) => console.error('[economy] snapshot failed:', (e as Error).message)).finally(arm); }, next - now); this.timer.unref?.(); };
    void this.catchUp(this.clock()).catch((e) => console.error('[economy] catch-up failed:', (e as Error).message));
    arm();
  }
  stop() { if (this.timer) clearTimeout(this.timer); }
}

const NOT_QA = (col: string) => `${col} NOT LIKE 'qa-%'`;
export class PgEconSource implements EconSource {
  constructor(private readonly db: Queryable) {}
  async init() { await this.db.query(ECON_MIGRATION); }
  async cash() { return Number((await this.db.query(`SELECT COALESCE(SUM(chips),0) s FROM casino_players WHERE ${NOT_QA('player_key')}`)).rows[0]?.s ?? 0); }
  async holdings(): Promise<Holdings> {
    const q = async (sql: string) => { try { return (await this.db.query(sql)).rows; } catch { return []; } }; // a table may not exist yet
    const skins = (await q(`SELECT kind, skin_id, COUNT(*) n FROM inventory_items WHERE NOT gone AND ${NOT_QA('player_key')} GROUP BY 1,2`)).map((r) => ({ kind: String(r.kind), skin: String(r.skin_id), n: Number(r.n) }));
    const st = new Map<string, { type: string; id: string; qty: number }>();
    const put = (type: string, id: string, qty: number) => { if (!(qty > 0)) return; const k = `${type}:${id}`; const s = st.get(k); if (s) s.qty += qty; else st.set(k, { type, id, qty }); };
    for (const r of await q(`SELECT item_type, item_id, SUM(qty) q FROM mine_items WHERE ${NOT_QA('player_key')} GROUP BY 1,2`)) put(String(r.item_type), String(r.item_id), Number(r.q));
    for (const r of await q(`SELECT item_type, item_id, SUM(qty_left) q FROM market_stack_listings WHERE status = 'active' AND ${NOT_QA('seller_key')} GROUP BY 1,2`)) put(String(r.item_type), String(r.item_id), Number(r.q));
    for (const r of await q(`SELECT items FROM mine_carried WHERE ${NOT_QA('player_key')}`)) { const a = (typeof r.items === 'string' ? JSON.parse(r.items) : r.items) as Array<{ type: string; id: string; qty: number }>; for (const s of a ?? []) put(s.type, s.id, Number(s.qty)); }
    const mc = new Map<string, number>();
    for (const r of await q(`SELECT data FROM factory_v2 WHERE ${NOT_QA('player_key')}`)) {
      const d = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as { ents?: Array<{ k: string }>; kit?: Record<string, number> };
      for (const e of d?.ents ?? []) mc.set(e.k, (mc.get(e.k) ?? 0) + 1);
      for (const [k, n] of Object.entries(d?.kit ?? {})) mc.set(k, (mc.get(k) ?? 0) + Number(n || 0));
    }
    return { skins, stacks: [...st.values()], machines: [...mc].map(([kind, n]) => ({ kind, n })) };
  }
  async sales(): Promise<SaleRow[]> {
    try {
      return (await this.db.query(`SELECT what, price, at FROM market_sales WHERE ${NOT_QA('seller_key')} AND ${NOT_QA('buyer_key')} ORDER BY at DESC LIMIT 20000`)).rows.map((r) => ({ what: String(r.what), unit: Number(r.price), at: Number(r.at) }));
    } catch { return []; }
  }
  async flows(from: number, to: number) {
    return (await this.db.query(`SELECT game, COALESCE(SUM(amount) FILTER (WHERE amount > 0),0) pos, COALESCE(SUM(amount) FILTER (WHERE amount < 0),0) neg FROM wallet_transactions
      WHERE created_at >= to_timestamp($1/1000.0) AND created_at < to_timestamp($2/1000.0) AND ${NOT_QA('player_key')} GROUP BY game`, [from, to])).rows.map((r) => ({ game: String(r.game), pos: Number(r.pos), neg: Number(r.neg) }));
  }
  async cashAt(t: number) {
    return Number((await this.db.query(`SELECT COALESCE(SUM(b),0) s FROM (SELECT DISTINCT ON (player_key) balance b FROM wallet_transactions WHERE created_at < to_timestamp($1/1000.0) AND ${NOT_QA('player_key')} ORDER BY player_key, id DESC) x`, [t])).rows[0]?.s ?? 0);
  }
  async firstLedgerAt() { const r = (await this.db.query('SELECT MIN(created_at) m FROM wallet_transactions')).rows[0]?.m; return r ? new Date(r).getTime() : null; }
  async days(): Promise<DayRow[]> {
    return (await this.db.query('SELECT * FROM daily_economy ORDER BY day')).rows.map((r) => ({ day: String(r.day), cash: Number(r.cash), assets: r.assets == null ? null : Number(r.assets), total: r.total == null ? null : Number(r.total), estPct: r.est_pct == null ? null : Number(r.est_pct), flows: normalizeFlows((typeof r.flows === 'string' ? JSON.parse(r.flows) : r.flows) ?? null), source: String(r.source) }));
  }
  async saveDay(r: DayRow) {
    await this.db.query('INSERT INTO daily_economy (day, cash, assets, total, est_pct, flows, source) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (day) DO NOTHING', [r.day, r.cash, r.assets, r.total, r.estPct, JSON.stringify(r.flows), r.source]);
  }
}

let econ: Economy | null = null;
export const getEconomy = () => econ;
export const setEconomyForTest = (e: Economy | null) => { econ = e; };
export async function initEconomy(): Promise<void> {
  const url = databaseUrl(); if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[economy] pool error:', e.message));
  try { const s = new PgEconSource(pool); await s.init(); econ = new Economy(s); econ.start(); console.log('[economy] ready'); } catch (e) { console.error('[economy] init failed:', (e as Error).message); }
}

export function economyRouter(): express.Router {
  const r = express.Router();
  r.get('/api/economy', async (_req, res) => {
    const e = getEconomy(); res.set('Cache-Control', 'public, max-age=60');
    if (!e) return res.json({ ok: false, error: 'Economy stats need the database.' });
    try { res.json(await e.stats()); } catch (err) { console.error('[economy] stats failed:', (err as Error).message); res.status(500).json({ ok: false, error: 'Could not compute economy stats.' }); }
  });
  return r;
}
