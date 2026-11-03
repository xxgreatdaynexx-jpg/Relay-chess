/**
 * Millionaire Update (#9): display-only "real investing app" stats for the Stock Exchange.
 * Everything here is derived from data the sim already has (company params, price history, 24h volume, dividend yield)
 * and is deterministic (seeded by ticker). Nothing in this file feeds back into prices, fees, dividends or fund values.
 */
import { COMPANY_BY_TICKER, hash32, seeded, type Company, type Sector } from './stocks.js';
import { FUND_BY_ID, divYield, navOf } from './derivs.js';

/** Period toggles shown in the UI. `all` = everything the server keeps (31 days of 10-minute history). */
export type Period = '1d' | '1w' | '1m' | 'all';
export const PERIODS: Array<[Period, string]> = [['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['all', 'All']];
const H = 3_600_000, D = 24 * H;
/** Window length and bucket size per period. Legacy ranges ('24h' | '7d' | '30d') map onto the new ones. */
export function periodSpec(p: unknown): { ms: number; step: number } {
  switch (p) {
    case '1w': case '7d': return { ms: 7 * D, step: H };
    case '1m': case '30d': return { ms: 30 * D, step: 4 * H };
    case 'all': return { ms: 31 * D, step: 4 * H };
    default: return { ms: D, step: 600_000 };
  }
}

/** Typical P/E by sector (game flavour). Each company gets a seeded spread around it. */
const SECTOR_PE: Record<Sector, number> = { tech: 32, energy: 11, mining: 9, finance: 13, healthcare: 22, retail: 17, transport: 14, entertainment: 24, food: 19, realestate: 16, defense: 18, crypto: 85, industrials: 15 };
/** Deterministic earnings per share. Fixed per company (earnings don't follow the price), so P/E moves with the price. */
export function epsOf(c: Company): number {
  const r = seeded(hash32(`eps:${c.ticker}`));
  const pe0 = SECTOR_PE[c.sector] * (0.6 + r() * 0.9);
  // A few crypto names have negative earnings (no P/E), like real loss-making companies.
  if (c.sector === 'crypto' && r() < 0.4) return -Math.round((c.start / pe0) * 100) / 100;
  return Math.max(0.01, Math.round((c.start / pe0) * 100) / 100);
}

export interface PriceStats {
  open: number | null; dayLo: number; dayHi: number; lo30: number; hi30: number;
  /** realized daily volatility from 10-minute history (fraction), null when there isn't enough history */
  realizedVol: number | null;
}
/** Ranges and realized volatility from [t, price] points (oldest first). `price` is the live price. */
export function priceStats(pts: Array<[number, number]>, price: number, now: number): PriceStats {
  const day = pts.filter(([t]) => t >= now - D).map((p) => p[1]).concat(price);
  const all = pts.filter(([t]) => t >= now - 30 * D).map((p) => p[1]).concat(price);
  const rets: number[] = []; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]![1], b = pts[i]![1]; if (a > 0 && b > 0) rets.push(Math.log(b / a)); }
  let realizedVol: number | null = null;
  if (rets.length >= 6) { const m = rets.reduce((a, x) => a + x, 0) / rets.length; const v = rets.reduce((a, x) => a + (x - m) ** 2, 0) / (rets.length - 1); const dt = pts.length > 1 ? (pts[pts.length - 1]![0] - pts[0]![0]) / (pts.length - 1) : 600_000; realizedVol = Math.round(Math.sqrt(v * (D / Math.max(60_000, dt))) * 10000) / 10000; }
  const first = pts.find(([t]) => t >= now - D);
  return { open: first ? first[1] : null, dayLo: Math.min(...day), dayHi: Math.max(...day), lo30: Math.min(...all), hi30: Math.max(...all), realizedVol };
}

export interface KeyStats { price: number; cap: number; eps: number; pe: number | null; divYieldDay: number; divPerShare: number; volume: number; avgVolume: number | null; beta: number; vol: number; realizedVol: number | null; open: number | null; dayLo: number; dayHi: number; lo30: number; hi30: number; shares: number; turnoverPct: number }
export function keyStats(c: Company, price: number, pts: Array<[number, number]>, volume24: number, now: number, avgVolume: number | null = null): KeyStats {
  const eps = epsOf(c); const s = priceStats(pts, price, now); const dy = divYield(c.ticker);
  return { price, cap: Math.round(price * c.shares), eps, pe: eps > 0 ? Math.round((price / eps) * 10) / 10 : null, divYieldDay: dy, divPerShare: Math.round(price * dy * 100) / 100, volume: volume24, avgVolume, beta: c.beta, vol: c.vol, shares: c.shares, turnoverPct: Math.round((volume24 / c.shares) * 10000) / 100, ...s };
}

/** NAV series for a fund from constituent price history (same navOf formula the fund trades at). Points must be bucketed. */
export function fundSeries(fundId: string, rows: Array<{ ticker: string; t: number; price: number }>): Array<[number, number]> {
  const f = FUND_BY_ID.get(fundId); if (!f) return [];
  const byT = new Map<number, Map<string, number>>();
  for (const r of rows) { const m = byT.get(r.t) ?? new Map(); m.set(r.ticker, r.price); byT.set(r.t, m); }
  const last = new Map<string, number>(); const out: Array<[number, number]> = [];
  for (const t of [...byT.keys()].sort((a, b) => a - b)) { for (const [k, v] of byT.get(t)!) last.set(k, v); out.push([t, navOf(f, (x) => last.get(x) ?? COMPANY_BY_TICKER.get(x)?.start ?? null)]); }
  return out;
}

/** Change over a series: absolute and percent vs the first point. */
export function seriesChange(pts: Array<[number, number]>): { abs: number; pct: number } {
  if (pts.length < 2) return { abs: 0, pct: 0 };
  const a = pts[0]![1], b = pts[pts.length - 1]![1];
  return { abs: Math.round((b - a) * 100) / 100, pct: a ? Math.round(((b - a) / a) * 10000) / 100 : 0 };
}
