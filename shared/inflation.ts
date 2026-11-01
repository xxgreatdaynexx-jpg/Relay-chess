/**
 * One definition of "inflation" for every screen (Daily Report, Bank > Economy tab).
 * Source of truth: Economy.stats() on the server (one cached computation, QA excluded). Both screens render inflationView(stats)
 * with the same labels, so they can only differ if they were fetched at different times, and each shows its "as of" time.
 *  - today: % change of liquid cash (and of total net worth) vs the last closed UTC day (00:00 UTC snapshot).
 *  - 7-day avg: geometric average daily change over the last 7 day-closes.
 *  - smoothed: the price index's EMA of daily cash growth (what moves house prices); null until it has a day of history.
 */
export interface InflationStatsInput {
  at: number;
  change: { cash: number | null; total: number | null };
  inflation: { cash7: number | null; total7: number | null; cash30?: number | null; total30?: number | null };
  priceIndex?: { emaPct: number | null } | null;
}
export interface InflationView {
  at: number;
  cashToday: number | null; totalToday: number | null;
  cash7: number | null; total7: number | null; cash30: number | null; total30: number | null;
  smoothed: number | null;
}
export const INFLATION_LABELS = {
  cashToday: 'Cash inflation today',
  totalToday: 'Net worth change today',
  avg7: '7-day avg / day',
  avg30: '30-day avg / day',
  smoothed: 'Smoothed (price index) / day',
  smoothedEmpty: 'needs a closed day',
  tip: 'Today = change since the last 00:00 UTC close. Cash = all players\' wallet chips; net worth = cash + assets. QA accounts excluded.',
} as const;
export function inflationView(s: InflationStatsInput): InflationView {
  return {
    at: s.at, cashToday: s.change.cash, totalToday: s.change.total,
    cash7: s.inflation.cash7, total7: s.inflation.total7, cash30: s.inflation.cash30 ?? null, total30: s.inflation.total30 ?? null,
    smoothed: s.priceIndex?.emaPct ?? null,
  };
}
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
