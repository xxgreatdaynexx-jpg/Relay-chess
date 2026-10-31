import { useSyncExternalStore } from 'react';

/** The one client-side copy of the shared wallet balance (fed by the top-bar WalletButton's subscription). */
let chips: number | null = null;
const subs = new Set<() => void>();
export function setWalletChips(n: number | null): void {
  if (n === chips) return;
  chips = n;
  for (const f of subs) f();
}
export const getWalletChips = (): number | null => chips;
/** Live wallet balance, or null when signed out / not yet loaded. Casino windows show this so numbers never disagree. */
export function useWalletChips(): number | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getWalletChips, getWalletChips);
}
