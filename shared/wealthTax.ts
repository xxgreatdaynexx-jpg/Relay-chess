/** Daily wealth tax (pt1397u), redistributed, not burned. Pure maths shared by the server job, the API and tests. */
export const WEALTH_TAX_RATE = 0.01;
export const WEALTH_TAX_MULT = 2;
export const WEALTH_TAX_ACTIVE_DAYS = 7;
export const WEALTH_TAX_GAME = 'wealth_tax';
/** Median is taken only over active players at or above this net worth; nobody below it ever pays. */
export const WEALTH_TAX_MEDIAN_MIN = 10_000;

export type WealthRow = { name: string; netWorth: number; chips: number };
export type WealthPlan = {
  median: number; threshold: number;
  taxes: Array<{ name: string; amount: number; netWorth: number }>;
  shares: Array<{ name: string; amount: number }>;
  total: number;
};

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 1% of net worth above 2× the median, from chips only: never more than the chip balance, never below 0. */
export const taxFor = (r: WealthRow, threshold: number) =>
  Math.max(0, Math.min(Math.floor(Math.max(0, r.chips)), Math.floor(Math.max(0, r.netWorth - threshold) * WEALTH_TAX_RATE)));

/** Even split; the rounding remainder goes 1 chip each to the first recipients so the total is conserved exactly. */
export function split(total: number, names: string[]): Array<{ name: string; amount: number }> {
  if (!names.length || total <= 0) return [];
  const base = Math.floor(total / names.length); let rem = total - base * names.length;
  return names.map((name) => ({ name, amount: base + (rem-- > 0 ? 1 : 0) })).filter((s) => s.amount > 0);
}

/** Full plan for one day. Recipients are active players below the threshold, in a stable (name) order. */
export function planWealthTax(rows: WealthRow[], noShare: (name: string) => boolean = () => false): WealthPlan {
  const base = rows.filter((r) => r.netWorth >= WEALTH_TAX_MEDIAN_MIN);
  // Nobody at 10K+: no median, no tax.
  if (!base.length) return { median: 0, threshold: 0, taxes: [], shares: [], total: 0 };
  const med = median(base.map((r) => r.netWorth)); const threshold = Math.floor(med * WEALTH_TAX_MULT);
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const taxes = sorted.filter((r) => r.netWorth >= WEALTH_TAX_MEDIAN_MIN).map((r) => ({ name: r.name, amount: taxFor(r, threshold), netWorth: r.netWorth })).filter((t) => t.amount > 0);
  const total = taxes.reduce((a, t) => a + t.amount, 0);
  const shares = split(total, sorted.filter((r) => r.netWorth < threshold && !noShare(r.name)).map((r) => r.name));
  // No one below the threshold to receive it: collect nothing (redistributed, never burned).
  if (!shares.length) return { median: med, threshold, taxes: [], shares: [], total: 0 };
  return { median: med, threshold, taxes, shares, total };
}
