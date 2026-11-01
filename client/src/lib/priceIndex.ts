import { useEffect, useState } from 'react';
import { indexed } from '../../../shared/priceIndex';

/** Today's price index from the server (house-set payouts and prices). Casino games are never indexed. */
let cache: Promise<number> | null = null;
let last = 1;
export function loadPriceIndex(): Promise<number> {
  cache ??= fetch('/api/price-index').then((r) => r.json()).then((j) => { last = j?.ok && j.index > 0 ? Number(j.index) : 1; return last; }).catch(() => 1);
  return cache;
}
export function usePriceIndex(): number {
  const [i, setI] = useState(last);
  useEffect(() => { let live = true; void loadPriceIndex().then((v) => live && setI(v)); return () => { live = false; }; }, []);
  return i;
}
/** Scale a house-set base amount for display. */
export const ix = (base: number, index: number) => indexed(base, index);
