/**
 * Stock Exchange v2: dividends, index funds, mutual funds, shorts and options (calls + puts).
 * All defaults live here so the server, the UI and the tests agree. Game-balanced, not real-world.
 */
import { COMPANIES, COMPANY_BY_TICKER, hash32, quote, seeded, type Company, type Sector } from './stocks.js';

// ---------- dividends ----------
/** Dividends pay once per real (UTC) day at 16:00 UTC (10:00 AM CST). */
export const DIV_HOUR_UTC = 16;
/** Daily yield ranges by sector [min, max] (fraction of share price per day). `pct` = share of the sector's companies that pay. */
export const DIV_SECTORS: Partial<Record<Sector, { min: number; max: number; pct: number }>> = {
  realestate: { min: 0.001, max: 0.002, pct: 1 },
  finance: { min: 0.0005, max: 0.0015, pct: 1 },
  energy: { min: 0.0005, max: 0.0015, pct: 1 },
  food: { min: 0.0005, max: 0.0012, pct: 1 },
  industrials: { min: 0.0005, max: 0.0008, pct: 0.5 },
  retail: { min: 0.0005, max: 0.0008, pct: 0.5 },
  healthcare: { min: 0.0005, max: 0.0008, pct: 0.5 },
  defense: { min: 0.0005, max: 0.0008, pct: 0.5 },
};
/** Global dividend multiplier (Dayne, Nov 2 2026: 30x). Applied on top of the seeded per-ticker base yield. */
export const DIV_MULT = 30;
/** Daily dividend yield per ticker (0 = no dividend). Deterministic (seeded by ticker). */
export const DIV_YIELD = new Map<string, number>(COMPANIES.map((c) => {
  const s = DIV_SECTORS[c.sector]; if (!s) return [c.ticker, 0];
  const r = seeded(hash32(`div:${c.ticker}`)); if (r() >= s.pct) return [c.ticker, 0];
  return [c.ticker, (Math.round((s.min + r() * (s.max - s.min)) * 100000) / 100000) * DIV_MULT];
}));
export const divYield = (t: string) => DIV_YIELD.get(t) ?? 0;
/** Chips a holding earns today (floored; under 1 chip pays nothing). */
export const dividendOf = (shares: number, price: number, y: number) => Math.floor(shares * price * y);

// ---------- funds ----------
export interface Fund { id: string; name: string; kind: 'index' | 'mutual'; blurb: string; fee: number; /** daily expense ratio (mutual only), taken from units and burned */ expense: number; weights: Array<[string, number]> }
const eq = (ts: string[]): Array<[string, number]> => ts.map((t) => [t, 1 / ts.length]);
const bySector = (s: Sector) => COMPANIES.filter((c) => c.sector === s).map((c) => c.ticker);
export const INDEX_FEE = 0.0025, MUTUAL_FEE = 0.005;
export const FUND_MAX_ORDER = 25_000; // chips per fund order
const payers = COMPANIES.filter((c) => divYield(c.ticker) > 0).sort((a, b) => divYield(b.ticker) - divYield(a.ticker)).slice(0, 15).map((c) => c.ticker);
const growth = COMPANIES.filter((c) => ['tech', 'entertainment', 'healthcare'].includes(c.sector)).sort((a, b) => b.vol * b.beta - a.vol * a.beta).slice(0, 12).map((c) => c.ticker);
export const FUNDS: Fund[] = [
  { id: 'CH100', name: 'Chud 100 Index', kind: 'index', blurb: 'Every company on the exchange, equal weight.', fee: INDEX_FEE, expense: 0, weights: eq(COMPANIES.map((c) => c.ticker)) },
  { id: 'CHTEK', name: 'Chud Tech Index', kind: 'index', blurb: 'All 10 tech companies.', fee: INDEX_FEE, expense: 0, weights: eq(bySector('tech')) },
  { id: 'CHDIG', name: 'Chud Mining Index', kind: 'index', blurb: 'All 9 mining companies.', fee: INDEX_FEE, expense: 0, weights: eq(bySector('mining')) },
  { id: 'CHFIN', name: 'Chud Finance Index', kind: 'index', blurb: 'All 8 finance companies.', fee: INDEX_FEE, expense: 0, weights: eq(bySector('finance')) },
  { id: 'CHNRG', name: 'Chud Energy Index', kind: 'index', blurb: 'All 7 energy companies.', fee: INDEX_FEE, expense: 0, weights: eq(bySector('energy')) },
  { id: 'CHFUN', name: 'Chud Entertainment Index', kind: 'index', blurb: 'All 9 entertainment & gaming companies.', fee: INDEX_FEE, expense: 0, weights: eq(bySector('entertainment')) },
  { id: 'RCKT', name: 'Rocket Growth Fund', kind: 'mutual', blurb: 'The 12 most volatile tech, gaming and healthcare names. Swings hard.', fee: MUTUAL_FEE, expense: 0.0005, weights: eq(growth) },
  { id: 'DIVI', name: 'Dividend Income Fund', kind: 'mutual', blurb: 'The 15 highest dividend payers. Steady, pays out daily.', fee: MUTUAL_FEE, expense: 0.0003, weights: eq(payers) },
  { id: 'DEGN', name: 'Crypto Degen Fund', kind: 'mutual', blurb: 'All 7 crypto-ish coins, plus the casino and slots crowd. Not financial advice.', fee: MUTUAL_FEE, expense: 0.001, weights: [...eq(bySector('crypto')).map(([t]) => [t, 0.8 / 7] as [string, number]), ['NEOC', 0.1], ['SPNX', 0.1]] },
];
export const FUND_BY_ID = new Map(FUNDS.map((f) => [f.id, f]));
/** Net asset value per unit: 100 x the weighted price relative to each company's start price. */
export function navOf(f: Fund, price: (t: string) => number | null): number {
  let v = 0; for (const [t, w] of f.weights) { const c = COMPANY_BY_TICKER.get(t)!; v += (w * (price(t) ?? c.start)) / c.start; }
  return Math.round(v * 100 * 10000) / 10000;
}
/** Dividend per unit (chips) passed through from the constituents. */
export function fundDivPerUnit(f: Fund, price: (t: string) => number | null): number {
  let v = 0; for (const [t, w] of f.weights) { const c = COMPANY_BY_TICKER.get(t)!; v += (w * (price(t) ?? c.start) * divYield(t)) / c.start; }
  return v * 100;
}
export const fundYield = (f: Fund, price: (t: string) => number | null) => { const n = navOf(f, price); return n ? fundDivPerUnit(f, price) / n : 0; };
/** Fund order quote (no spread, no price impact on constituents). units may be fractional (2 decimals). */
export function fundQuote(f: Fund, nav: number, side: 'buy' | 'sell', units: number) {
  const gross = side === 'buy' ? Math.ceil(nav * units) : Math.floor(nav * units);
  const fee = Math.max(1, Math.ceil(gross * f.fee));
  return { gross, fee, total: side === 'buy' ? gross + fee : gross - fee };
}

// ---------- shorts ----------
export const SHORT_INIT = 1.5; // collateral posted = 150% of the short's value
export const SHORT_MAINT = 1.2; // liquidated when equity < 120% of the current position value
export const BORROW_FEE = 0.0005; // 0.05% of position value per day (min 1 chip), taken from collateral and burned
export const MAX_OPEN_SHORTS = 20;
/** Equity of a short: collateral + sale proceeds - cost to buy back at `price` (never below 0). */
export const shortEquity = (s: { collateral: number; proceeds: number; shares: number }, price: number) => Math.max(0, s.collateral + s.proceeds - price * s.shares);
export const needsLiquidation = (s: { collateral: number; proceeds: number; shares: number }, price: number) => s.collateral + s.proceeds - price * s.shares < SHORT_MAINT * price * s.shares;
/** Price at which a short gets liquidated. */
/** Exactly what closing a short pays at `price` now (buy back at the ask with impact, rounded up, minus the 1% fee). The UI shows this, the server pays this. */
export function shortClose(c: Company, s: { collateral: number; proceeds: number; shares: number; fees: number; entry?: number }, price: number) {
  const q = quote(c, price, 'buy', s.shares);
  // QA r9: settle the exact price difference (entry fill vs buy-back fill), rounded once. Before, the open floored the sale
  // proceeds and the close ceiled the buy-back, so a tiny short lost up to ~2 chips to rounding on top of the two fees.
  const diff = s.entry != null && s.entry > 0 ? Math.round((s.entry - q.fill) * s.shares) : s.proceeds - q.gross;
  const payout = Math.max(0, s.collateral + diff - q.fee);
  return { q, payout, pnl: payout - s.collateral - s.fees };
}
export const liquidationPrice = (s: { collateral: number; proceeds: number; shares: number }) => (s.collateral + s.proceeds) / ((1 + SHORT_MAINT) * s.shares);

// ---------- options ----------
export const OPT_EXPIRIES = [1, 3, 7] as const; // days
export const OPT_STRIKES = [-0.1, -0.05, 0, 0.05, 0.1] as const; // moneyness offsets offered in the UI
export const OPT_EDGE = 0.05; // house markup over fair value
export const OPT_MAX_PREMIUM = 10_000; // chips per order
export const OPT_MAX_QTY = 1000; // shares covered per order
export const MAX_OPEN_OPTIONS = 30;
const DAYMS = 86_400_000;
/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
export function ncdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
/** Fair value per share (Black-Scholes, zero rates). `vol` is the company's daily volatility; `days` time left. */
export function optionValue(kind: 'call' | 'put', S: number, K: number, vol: number, days: number): number {
  const intrinsic = kind === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  if (days <= 0 || vol <= 0) return intrinsic;
  const sd = vol * Math.sqrt(days); const d1 = (Math.log(S / K) + 0.5 * sd * sd) / sd; const d2 = d1 - sd;
  const v = kind === 'call' ? S * ncdf(d1) - K * ncdf(d2) : K * ncdf(-d2) - S * ncdf(-d1);
  return Math.max(intrinsic, v);
}
export const optionPremium = (c: Company, kind: 'call' | 'put', S: number, K: number, days: number, qty: number) => Math.max(1, Math.ceil(optionValue(kind, S, K, c.vol, days) * (1 + OPT_EDGE) * qty));
/** Sell-to-close bid: the same model value the buy quote uses, minus the house edge and the 1% trade fee (floor).
 *  Always below the buy premium for the same contract, so buy-then-sell can never make chips. */
export const OPT_SELL_FEE = 0.01;
export const optionBid = (c: Company, kind: 'call' | 'put', S: number, K: number, days: number, qty: number) => Math.max(0, Math.floor(optionValue(kind, S, K, c.vol, days) * (1 - OPT_EDGE) * (1 - OPT_SELL_FEE) * qty));
export const optionPayout = (kind: 'call' | 'put', S: number, K: number, qty: number) => Math.floor((kind === 'call' ? Math.max(0, S - K) : Math.max(0, K - S)) * qty);
export const strikeFor = (price: number, off: number) => Math.max(0.01, Math.round(price * (1 + off) * 100) / 100);
export const daysLeft = (expiry: number, now: number) => Math.max(0, (expiry - now) / DAYMS);
