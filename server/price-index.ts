/**
 * Stored cumulative price index (see shared/priceIndex.ts for the damping). One row per UTC day in price_index,
 * computed from the previous row + yesterday's daily_economy cash change. INSERT ... ON CONFLICT (day) DO NOTHING is
 * the claim: the step is deterministic, so whichever instance writes first wins and the others read it back.
 */
import express from 'express';
import type { Queryable } from './leaderboard-store.js';
import { indexed, stepIndex, PI_CEIL, PI_EMA_DAYS, PI_FLOOR, PI_MAX_DAILY, PI_PASS_THROUGH, PI_RAW_CLIP } from '../shared/priceIndex.js';

export const PRICE_INDEX_MIGRATION = `CREATE TABLE IF NOT EXISTS price_index (
  day TEXT PRIMARY KEY, idx DOUBLE PRECISION NOT NULL, ema DOUBLE PRECISION, raw DOUBLE PRECISION, applied DOUBLE PRECISION, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;

const DAY = 86_400_000;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const prevDay = (d: string) => utcDay(Date.parse(`${d}T00:00:00Z`) - DAY);

export interface PriceIndexView { index: number; day: string | null; appliedPct: number | null; emaPct: number | null; rawPct: number | null }
let cur: PriceIndexView = { index: 1, day: null, appliedPct: null, emaPct: null, rawPct: null };
let db: Queryable | null = null;
let timer: NodeJS.Timeout | null = null;

/** Current multiplier for house-set payouts and prices (1 until the database is read). */
export const priceIndex = () => cur.index;
export const priceIndexView = () => cur;
/** Scale a house-set chip amount (payout or price) by today's index. */
export const px = (base: number) => indexed(base, cur.index);
export const setPriceIndexForTest = (index: number) => { cur = { index, day: null, appliedPct: null, emaPct: null, rawPct: null }; };

type Row = { day: string; idx: number; ema: number | null; raw: number | null; applied: number | null };
const toRow = (r: Record<string, unknown>): Row => ({ day: String(r.day), idx: Number(r.idx), ema: r.ema == null ? null : Number(r.ema), raw: r.raw == null ? null : Number(r.raw), applied: r.applied == null ? null : Number(r.applied) });

/** Raw growth for day d from daily_economy: (cash[d] - cash[d-1] - admin net[d]) / cash[d-1]. */
export function rawRate(days: Map<string, { cash: number; flows: unknown }>, d: string): number | null {
  const a = days.get(d), b = days.get(prevDay(d));
  if (!a || !b || !(b.cash > 0)) return null;
  const f = (typeof a.flows === 'string' ? JSON.parse(a.flows) : a.flows) as { faucets?: Array<{ game: string; amount: number }>; sinks?: Array<{ game: string; amount: number }> } | null;
  const admin = (f?.faucets ?? []).filter((x) => x.game === 'admin').reduce((s, x) => s + x.amount, 0) - (f?.sinks ?? []).filter((x) => x.game === 'admin').reduce((s, x) => s + x.amount, 0);
  return (a.cash - b.cash - admin) / b.cash;
}

/** Bring price_index up to today. Safe to call from every instance at any time. */
export async function advancePriceIndex(q: Queryable, now = Date.now()): Promise<PriceIndexView> {
  const today = utcDay(now);
  let last = (await q.query('SELECT * FROM price_index ORDER BY day DESC LIMIT 1')).rows.map(toRow)[0];
  if (!last) {
    await q.query('INSERT INTO price_index (day, idx, ema, raw, applied) VALUES ($1, 1, NULL, NULL, 0) ON CONFLICT (day) DO NOTHING', [today]);
    last = (await q.query('SELECT * FROM price_index ORDER BY day DESC LIMIT 1')).rows.map(toRow)[0]!;
  }
  if (last.day < today) {
    const days = new Map<string, { cash: number; flows: unknown }>((await q.query('SELECT day, cash, flows FROM daily_economy')).rows.map((r) => [String(r.day), { cash: Number(r.cash), flows: r.flows }]));
    let d = last.day, st = { index: last.idx, ema: last.ema };
    while (d < today) {
      const next = utcDay(Date.parse(`${d}T00:00:00Z`) + DAY);
      // Wait for yesterday's close (snapshot runs just after midnight); after 2h, step with whatever exists.
      if (!days.has(prevDay(next)) && now - Date.parse(`${next}T00:00:00Z`) < 2 * 3_600_000) break;
      const s = stepIndex(st, rawRate(days, prevDay(next))); // today's index uses yesterday's closed day
      await q.query('INSERT INTO price_index (day, idx, ema, raw, applied) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (day) DO NOTHING', [next, s.index, s.ema, s.raw, s.applied]);
      const back = (await q.query('SELECT * FROM price_index WHERE day = $1', [next])).rows.map(toRow)[0]!;
      st = { index: back.idx, ema: back.ema }; d = next; last = back;
    }
  }
  const r2 = (x: number | null) => (x == null ? null : Math.round(x * 10000) / 100);
  cur = { index: last.idx, day: last.day, appliedPct: r2(last.applied), emaPct: r2(last.ema), rawPct: r2(last.raw) };
  return cur;
}

export async function initPriceIndex(q: Queryable): Promise<void> {
  db = q;
  await q.query(PRICE_INDEX_MIGRATION);
  const tick = () => { if (db) void advancePriceIndex(db).catch((e) => console.error('[price-index] advance failed:', (e as Error).message)); };
  await advancePriceIndex(q).catch((e) => console.error('[price-index] advance failed:', (e as Error).message));
  console.log(`[price-index] x${cur.index}`);
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 10 * 60_000); timer.unref?.();
}
/** Called right after the midnight economy snapshot so the new day's index uses the fresh close. */
export function refreshPriceIndex(): void { if (db) void advancePriceIndex(db).catch((e) => console.error('[price-index] advance failed:', (e as Error).message)); }

export const PRICE_INDEX_PARAMS = { emaDays: PI_EMA_DAYS, passThrough: PI_PASS_THROUGH, rawClip: PI_RAW_CLIP, maxDaily: PI_MAX_DAILY, floor: PI_FLOOR, ceil: PI_CEIL };

export function priceIndexRouter(): express.Router {
  const r = express.Router();
  r.get('/api/price-index', (_req, res) => { res.set('Cache-Control', 'public, max-age=60'); res.json({ ok: true, ...cur, params: PRICE_INDEX_PARAMS }); });
  return r;
}
