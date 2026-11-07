/**
 * City Hall: weekly mayor election (pt1312u, Liam's request #13). All schedule maths is in Alberta time at a FIXED
 * UTC-6 (no DST), so the week never shifts. Week = Monday 00:00 AB -> next Monday 00:00 AB.
 *   Mon-Thu  filing  (run for mayor: FILING_FEE chips burned through the wallet ledger, plus a slogan)
 *   Fri-Sat  voting  (one vote per account; voter must be >= 24 h old and have some playtime)
 *   Sunday   results (winner = most votes, ties -> earlier filer; shown as mayor-elect)
 *   next Monday 00:00 AB the winner takes office for exactly one week.
 * Mayor powers are bounded to two multipliers, each clamped to [RATE_MIN, RATE_MAX] of the game default:
 *   property tax (default 0.5%/day)  and  market + stock trading fee (default 5% / 1%).
 * A change takes effect at the next Alberta midnight, at most one change per Alberta day, logged publicly.
 * The mayor can't touch anything else (casino odds, balances, sell caps...) and is paid nothing.
 */
export const AB_OFFSET_MS = -6 * 3_600_000; // fixed UTC-6
export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
export const FILING_FEE = 2_500;
export const SLOGAN_MAX = 80;
export const MIN_VOTER_AGE_MS = DAY_MS;
/** Playtime proxy: wallet ledger entries from actually playing (daily bonus and admin grants don't count). */
export const MIN_PLAY_TX = 5;
export const RATE_MIN = 0.75;
export const RATE_MAX = 1.25;
export const RATE_STEP = 0.05;
export const BASE_PROPERTY_TAX = 0.005; // shared/realEstate.ts TAX_RATE
export const BASE_MARKET_FEE = 0.05; // server/market.ts MARKET_FEE
export const BASE_STOCK_FEE = 0.01; // shared/stocks.ts STOCK_FEE

export type Phase = 'filing' | 'voting' | 'results';
/** Clamp + snap a requested multiplier to the allowed range. Non-numbers fall back to 1. */
export const clampRate = (x: unknown): number => {
  const n = Number(x); if (!Number.isFinite(n)) return 1;
  const s = Math.round(n / RATE_STEP) * RATE_STEP;
  return Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, s)) * 100) / 100;
};
/** Alberta-local day index helpers. */
export const abDayStart = (t: number) => Math.floor((t + AB_OFFSET_MS) / DAY_MS) * DAY_MS - AB_OFFSET_MS;
export const nextAbMidnight = (t: number) => abDayStart(t) + DAY_MS;
export const abDate = (t: number) => new Date(t + AB_OFFSET_MS).toISOString().slice(0, 10);
/** Monday 00:00 AB of the week containing t (epoch ms). */
export function weekStart(t: number): number {
  const d = abDayStart(t); const dow = new Date(d + AB_OFFSET_MS).getUTCDay(); // 0 = Sunday
  return d - ((dow + 6) % 7) * DAY_MS;
}
/** Election id = the Alberta date of that week's Monday. */
export const weekId = (t: number) => abDate(weekStart(t));
export function schedule(t: number) {
  const w = weekStart(t);
  const votingAt = w + 4 * DAY_MS, resultsAt = w + 6 * DAY_MS, termStart = w + WEEK_MS;
  const phase: Phase = t < votingAt ? 'filing' : t < resultsAt ? 'voting' : 'results';
  return { week: abDate(w), weekStart: w, votingAt, resultsAt, termStart, termEnd: termStart + WEEK_MS, phase };
}
export const rateLabel = (m: number) => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;
export const pct = (x: number, d = 3) => `${+(x * 100).toFixed(d)}%`;
export interface CityRates { property: number; fee: number }
export interface RateChange { at: number; effectiveAt: number; by: string; property: number; fee: number; note?: string }
export interface Candidate { name: string; slogan: string; filedAt: number; votes?: number }
export interface Term { week: string; name: string; votes: number; startsAt: number; endsAt: number; removedAt: number | null; note?: string | null }
export interface CityHallView {
  laws?: import('./mayorLaws.js').MayorLawView;
  now: number; schedule: ReturnType<typeof schedule>; candidates: Candidate[]; mayor: Term | null; elect: Term | null; vice?: { name: string; votes: number; startsAt: number; endsAt: number } | null;
  rates: CityRates; pending: RateChange | null; log: RateChange[]; me?: { isVice?: boolean; name: string; filed: boolean; votedFor: string | null; canVote: boolean; reason?: string; isMayor: boolean; canChange: boolean; changeReason?: string };
  limits: { min: number; max: number; step: number; fee: number; base: { property: number; market: number; stock: number } };
}
