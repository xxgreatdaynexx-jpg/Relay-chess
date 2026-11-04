/**
 * THE net-worth value of an owned property, used everywhere net worth shows (profile, Bank totals and the economy total,
 * daily_economy / Daily Report snapshots and charts, wealth tax thresholds): the TOTAL SPENT on it.
 *  - paid: the purchase price actually paid (surcharged buy or hostile buyout included); the list price only when no
 *    paid price is recorded. Never the base/list worth otherwise.
 *  - upgrades: chips spent on improvements bought for it by the current owner (farm Sprinklers /
 *    Greenhouse levels), from the ledger.
 *  - crops: currently-planted tiles on it at the seed cost of what is planted, plus fertilizer spread on that planting.
 */
export function propertyPaid(paid: number | null | undefined, list: number): number { return paid && paid > 0 ? paid : Math.max(0, list || 0); }
export interface PropertySpend { paid: number | null | undefined; list: number; upgrades?: number; crops?: number }
/** Price paid + upgrades held (no crops): the purchase wealth-tax 100K threshold, and the base of propertyWorth. */
export function propertyPaidPlusUpgrades(s: Pick<PropertySpend, 'paid' | 'list' | 'upgrades'>): number {
  return propertyPaid(s.paid, s.list) + Math.max(0, Math.round(s.upgrades ?? 0));
}
export function propertyWorth(s: PropertySpend): number {
  return propertyPaidPlusUpgrades(s) + Math.max(0, Math.round(s.crops ?? 0));
}
/** Upgrade spend from levels at the given prices, for plots whose ledger rows are missing (older buys). */
export function upgradeSpendFromLevels(levels: Record<string, number>, priceOf: (kind: string, lvl: number) => number | null): number {
  let s = 0; for (const [k, n] of Object.entries(levels)) for (let l = 0; l < n; l++) s += priceOf(k, l) ?? 0; return s;
}
