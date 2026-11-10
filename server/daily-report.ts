/**
 * Daily Report: shown on the first sign-in of each UTC day (same claim as the daily bonus) and reopenable from the Bank.
 * Economy numbers come from Economy.stats() and player assets from Economy.playerAssets() (the Bank's valuation); nothing
 * is re-valued here. A tiny per-player snapshot per day (daily_reports) powers "since your last report".
 */
import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { getEconomy, utcDay } from './economy.js';
import { getExchange } from './stocks.js';
import { getFleet, jetUpkeepInfo } from './fleet.js';
import { fleetModel } from '../shared/fleet.js';
import { priceIndexView } from './price-index.js';
import { inflationView, type InflationStatsInput } from '../shared/inflation.js';

export const REPORT_MIGRATION = `CREATE TABLE IF NOT EXISTS daily_reports (
  player_key TEXT NOT NULL, day TEXT NOT NULL, cash BIGINT NOT NULL, assets BIGINT NOT NULL, total BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (player_key, day))`;

export interface Snapshot { day: string; cash: number; assets: number; total: number }
export interface SnapshotStore { last(key: string, before: string): Promise<Snapshot | null>; save(key: string, s: Snapshot): Promise<void>; history?(key: string, limit: number): Promise<Snapshot[]> }

export class MemorySnapshots implements SnapshotStore {
  rows = new Map<string, Snapshot[]>();
  async last(key: string, before: string) { return (this.rows.get(key) ?? []).filter((s) => s.day < before).sort((a, b) => b.day.localeCompare(a.day))[0] ?? null; }
  async history(key: string, limit: number) { return [...(this.rows.get(key) ?? [])].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit); }
  async save(key: string, s: Snapshot) { const l = (this.rows.get(key) ?? []).filter((x) => x.day !== s.day); l.push(s); this.rows.set(key, l); }
}
export class PgSnapshots implements SnapshotStore {
  private ready: Promise<unknown> | null = null;
  constructor(private readonly db: Queryable) {}
  private init() { return (this.ready ??= this.db.query(REPORT_MIGRATION)); }
  async last(key: string, before: string) {
    await this.init();
    const r = (await this.db.query('SELECT day, cash, assets, total FROM daily_reports WHERE player_key = $1 AND day < $2 ORDER BY day DESC LIMIT 1', [key, before])).rows[0];
    return r ? { day: String(r.day), cash: Number(r.cash), assets: Number(r.assets), total: Number(r.total) } : null;
  }
  async history(key: string, limit: number) {
    await this.init();
    const r = (await this.db.query('SELECT day, cash, assets, total FROM daily_reports WHERE player_key = $1 ORDER BY day DESC LIMIT $2', [key, limit])).rows;
    return r.map((x) => ({ day: String(x.day), cash: Number(x.cash), assets: Number(x.assets), total: Number(x.total) }));
  }
  async save(key: string, s: Snapshot) {
    await this.init();
    await this.db.query(`INSERT INTO daily_reports (player_key, day, cash, assets, total) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (player_key, day) DO UPDATE SET cash = EXCLUDED.cash, assets = EXCLUDED.assets, total = EXCLUDED.total`, [key, s.day, s.cash, s.assets, s.total]);
  }
}

let store: SnapshotStore | null = null;
export function setSnapshotStore(s: SnapshotStore | null) { store = s; }
function snapshots(): SnapshotStore {
  if (store) return store;
  const url = databaseUrl();
  if (!url) return (store = new MemorySnapshots());
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[daily-report] pool error:', e.message));
  return (store = new PgSnapshots(pool));
}

const pct = (now: number, then: number | null | undefined) => (then ? Math.round(((now - then) / then) * 10000) / 100 : null);
type Econ = { cash: number; assets: number; total: number } & Partial<InflationStatsInput>;

export async function buildDailyReport(name: string, bonus: number | null, now = Date.now()) {
  const key = name.replace(/\s+/g, ' ').trim().toLowerCase();
  const day = utcDay(now);
  const econ = getEconomy();
  const [stats, assets, chips] = await Promise.all([
    econ ? (econ.stats() as Promise<Econ>).catch(() => null) : Promise.resolve(null),
    econ ? econ.playerAssets(name, now).catch(() => null) : Promise.resolve(null),
    getBank().refresh(name),
  ]);
  const ex = getExchange();
  let movers: { up: Array<{ ticker: string; name: string; price: number; chg: number }>; down: Array<{ ticker: string; name: string; price: number; chg: number }> } | null = null;
  if (ex) {
    const cs = ex.list().companies.map((c) => ({ ticker: c.ticker, name: c.name, price: c.price, chg: c.chg })).sort((a, b) => b.chg - a.chg);
    movers = { up: cs.slice(0, 3), down: cs.slice(-3).reverse() };
  }
  // Tess QA #4: private-jet upkeep (per day, next charge, arrears) on the report. Luxury boats use the same shape.
  const fleetOwned = await (getFleet()?.owned(name) ?? Promise.resolve([])).catch(() => []);
  const jets = fleetOwned.filter((c) => c.kind === 'jet').map((c) => ({ name: fleetModel(c.model)?.name ?? c.model, ...jetUpkeepInfo(c, now) }));
  const boats = fleetOwned.filter((c) => c.kind === 'boat' && (fleetModel(c.model)?.upkeep ?? 0) > 0).map((c) => ({ name: fleetModel(c.model)?.name ?? c.model, ...jetUpkeepInfo(c, now) }));
  const assetTotal = assets?.total ?? 0;
  const me = { cash: chips, assets: assetTotal, total: chips + assetTotal };
  const snaps = snapshots();
  const prev = await snaps.last(key, day).catch(() => null);
  await snaps.save(key, { day, ...me }).catch((e) => console.error('[daily-report] snapshot failed:', (e as Error).message));
  // Read-only: the last 7 daily snapshots (newest first) for the "Past 7 days" list when the report is reopened.
  const history = snaps.history ? await snaps.history(key, 7).catch(() => []) : [];
  return {
    day, bonus, history, jets, boats,
    // Inflation comes from the same Economy.stats() object the Bank's Economy tab renders, through the same inflationView().
    economy: stats ? { cash: stats.cash, assets: stats.assets, total: stats.total,
      inflation: inflationView({ at: stats.at ?? now, change: stats.change ?? { cash: null, total: null }, inflation: stats.inflation ?? { cash7: null, total7: null }, priceIndex: stats.priceIndex ?? priceIndexView() }),
      priceIndex: priceIndexView().index, priceIndexPct: priceIndexView().appliedPct, movers } : null,
    me: {
      ...me, categories: (assets?.categories ?? []).map((c) => ({ key: c.key, label: c.label, value: c.value, units: c.units })),
      since: prev ? { day: prev.day, total: me.total - prev.total, totalPct: pct(me.total, prev.total), cash: me.cash - prev.cash, assets: me.assets - prev.assets } : null,
    },
  };
}
