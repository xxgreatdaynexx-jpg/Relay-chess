/** New accounts cannot trade with other players (trade offers, Market buys/listings) for their first 24 hours. */
export const NEW_ACCOUNT_TRADE_MS = 24 * 60 * 60 * 1000;
/** "5h 12m" / "12m" (rounded up so it never shows 0m while still locked). */
export function lockLeft(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000)); const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
export const selfLockMsg = (ms: number) => `New accounts can't trade with other players for their first 24 hours. You can trade in ${lockLeft(ms)}.`;
export const otherLockMsg = (name: string, ms: number) => `${name} joined less than 24 hours ago and can't trade yet (${lockLeft(ms)} left).`;
