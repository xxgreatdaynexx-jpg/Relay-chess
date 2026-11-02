/** Partial selling to the house (request #11): validate a chosen quantity against what you own. */
export type SellQty = { ok: true; qty: number } | { ok: false; error: string };

/** `q` undefined/null = sell everything (Sell all). Otherwise it must be an integer from 1 to `owned`. */
export function parseSellQty(q: unknown, owned: number): SellQty {
  if (q === undefined || q === null) return owned > 0 ? { ok: true, qty: owned } : { ok: false, error: 'Nothing to sell.' };
  if (typeof q !== 'number' || !Number.isInteger(q)) return { ok: false, error: 'Quantity must be a whole number.' };
  if (owned < 1) return { ok: false, error: 'Nothing to sell.' };
  if (q < 1 || q > owned) return { ok: false, error: `Quantity must be 1 to ${owned}.` };
  return { ok: true, qty: q };
}

/** Quick-pick buttons: 1 / 10 / Half / All, clamped to what you own. */
export function quickQty(kind: '1' | '10' | 'half' | 'all', owned: number): number {
  if (owned < 1) return 0;
  const n = kind === '1' ? 1 : kind === '10' ? 10 : kind === 'half' ? Math.ceil(owned / 2) : owned;
  return Math.max(1, Math.min(owned, n));
}

/** Which individual items (fish, dishes) a qty sale takes: the most valuable first, ties by id, so the preview matches the server. */
export function pickForQty<T extends { id: string; value: number }>(rows: T[], qty: number): T[] {
  return [...rows].sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, Math.max(0, qty));
}
