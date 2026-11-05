/**
 * House-sell cap index (pt1442u): the daily house-sell cap follows TOTAL player assets (daily_economy.total, the same
 * cash + assets net worth the Bank panel shows). Each UTC day: cap(d) = cap(d-1) x (1 + 0.25 x (total[close d-1] / total[close d-2] - 1)).
 * Missing/zero snapshot -> unchanged. Falls with assets too, but never below the 100K base (index floor 1).
 * Separate from the price index, which still scales payouts and prices. Never moves chips.
 */
import type { Queryable } from './leaderboard-store.js';
import { priceIndex } from './price-index.js';

export const HOUSE_CAP_MIGRATION = `CREATE TABLE IF NOT EXISTS house_cap_index (
  day TEXT PRIMARY KEY, idx DOUBLE PRECISION NOT NULL, ratio DOUBLE PRECISION, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
export const HOUSE_CAP_FLOOR = 1;
/** Dayne: a quarter of total-asset inflation moves the cap (+100% wealth -> +25% cap, -20% -> -5%). */
export const HOUSE_CAP_PASS_THROUGH = 0.25;

const DAY = 86_400_000;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const prevDay = (d: string) => utcDay(Date.parse(`${d}T00:00:00Z`) - DAY);

let cur = { index: 0, day: null as string | null, ratio: null as number | null };
let db: Queryable | null = null;
let timer: NodeJS.Timeout | null = null;

/** Current cap multiplier (cap = 100K x this). Falls back to the price index until the table is read. */
export const houseCapIndex = () => (cur.index > 0 ? cur.index : priceIndex());
export const houseCapView = () => ({ index: houseCapIndex(), day: cur.day, ratio: cur.ratio });
export const setHouseCapIndexForTest = (index: number) => { cur = { index, day: null, ratio: null }; };

/** One day forward: ratio of the two closes before day d; unchanged if either is missing. Floored at 1. */
export function stepHouseCap(prev: number, totals: Map<string, number | null>, d: string): { idx: number; ratio: number | null } {
  const a = totals.get(prevDay(d)), b = totals.get(prevDay(prevDay(d)));
  const ratio = a != null && b != null && a > 0 && b > 0 ? a / b : null;
  const idx = Math.max(HOUSE_CAP_FLOOR, Math.round(prev * (1 + HOUSE_CAP_PASS_THROUGH * ((ratio ?? 1) - 1)) * 10000) / 10000);
  return { idx, ratio };
}

export async function advanceHouseCap(q: Queryable, now = Date.now()) {
  const today = utcDay(now);
  const read = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows.map((r) => ({ day: String(r.day), idx: Number(r.idx), ratio: r.ratio == null ? null : Number(r.ratio) }))[0];
  let last = await read('SELECT * FROM house_cap_index ORDER BY day DESC LIMIT 1');
  if (!last) { // seed from today's price index so the switch doesn't jump the cap
    await q.query('INSERT INTO house_cap_index (day, idx, ratio) VALUES ($1,$2,NULL) ON CONFLICT (day) DO NOTHING', [today, Math.max(HOUSE_CAP_FLOOR, priceIndex())]);
    last = (await read('SELECT * FROM house_cap_index ORDER BY day DESC LIMIT 1'))!;
  }
  if (last.day < today) {
    const totals = new Map<string, number | null>((await q.query('SELECT day, total FROM daily_economy')).rows.map((r) => [String(r.day), r.total == null ? null : Number(r.total)]));
    let d = last.day;
    while (d < today) {
      const next = utcDay(Date.parse(`${d}T00:00:00Z`) + DAY);
      if (totals.get(prevDay(next)) == null && now - Date.parse(`${next}T00:00:00Z`) < 2 * 3_600_000) break; // wait for the close
      const s = stepHouseCap(last.idx, totals, next);
      await q.query('INSERT INTO house_cap_index (day, idx, ratio) VALUES ($1,$2,$3) ON CONFLICT (day) DO NOTHING', [next, s.idx, s.ratio]);
      last = (await read('SELECT * FROM house_cap_index WHERE day = $1', [next]))!; d = next;
    }
  }
  cur = { index: last.idx, day: last.day, ratio: last.ratio };
  return cur;
}

export async function initHouseCapIndex(q: Queryable): Promise<void> {
  db = q;
  await q.query(HOUSE_CAP_MIGRATION);
  await advanceHouseCap(q).catch((e) => console.error('[house-cap] advance failed:', (e as Error).message));
  console.log(`[house-cap] x${cur.index}`);
  if (timer) clearInterval(timer);
  timer = setInterval(() => refreshHouseCap(), 10 * 60_000); timer.unref?.();
}
export function refreshHouseCap(): void { if (db) void advanceHouseCap(db).catch((e) => console.error('[house-cap] advance failed:', (e as Error).message)); }

/** Players barred from selling to the house (stock-exploit penalty, Nov 3 2026, Dayne). Survives the daily reset; remove a key to undo. */
export const HOUSE_SELL_BLOCKED: ReadonlySet<string> = new Set<string>([]); // jay/conner/carter2 re-enabled Nov 3 2026 (Dayne)

/** Players barred from the stock market: shares, shorts, options and funds (exploit penalty, Nov 3 2026, Dayne). Remove a key to undo. */
export const MARKET_BLOCKED: ReadonlySet<string> = new Set(['arenagawd', 'chessgawd']);
export const MARKET_BLOCKED_MSG = 'Market access suspended';
export const isMarketBlocked = (name: string | null | undefined): boolean => !!name && MARKET_BLOCKED.has(name.trim().toLowerCase());
