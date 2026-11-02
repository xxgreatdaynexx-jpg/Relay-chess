/** Pure helpers for the resource sell card (UI only; the server still decides fees and validates). */
export const LIST_FEE = 0.05;
/** Seller fee shown in the UI: 5%, at least 1 chip (Trading skill / city perks can lower it server-side). */
export const listFee = (qty: number, unit: number) => (qty > 0 && unit > 0 ? Math.max(1, Math.ceil(qty * unit * LIST_FEE)) : 0);
export const receiveFor = (qty: number, unit: number) => Math.max(0, qty * unit - listFee(qty, unit));
/** Suggested unit price: undercut the lowest listing by 1 (never below 1); else the last sale; else the house price; else 1. */
export function suggestUnit(lowest: number | null | undefined, last: number | null | undefined, house = 0): number {
  if (lowest != null && lowest > 0) return Math.max(1, lowest - 1);
  if (last != null && last > 0) return last;
  return house > 0 ? Math.ceil(house * 1.1) : 1;
}
/** Quantity for a quick button: 25% / 50% / Max of what you own, at least 1. */
export const pctQty = (owned: number, pct: number) => Math.max(1, Math.min(owned, Math.floor(owned * pct)));
