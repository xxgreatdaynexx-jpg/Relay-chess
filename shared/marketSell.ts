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

/** Best open buy-request for the seller: highest unit price, and what they actually receive after the 5% Market fee. */
export function bestRequestTake(requests: Array<{ unit: number; qty: number }>, have: number) {
  const open = requests.filter((r) => r.unit > 0 && r.qty > 0);
  if (!open.length || have < 1) return null;
  const best = open.reduce((a, b) => (b.unit > a.unit ? b : a));
  const fill = Math.min(have, best.qty);
  return { unit: best.unit, each: receiveFor(1, best.unit), fill, total: receiveFor(fill, best.unit) };
}
/** Factory / Warehouse button: "Sell to market request · 🪙95 each", plus a total when more than one unit can be filled. */
export function requestSellLabel(requests: Array<{ unit: number; qty: number }>, have: number): string | null {
  const t = bestRequestTake(requests, have);
  if (!t) return null;
  let s = `Sell to market request · 🪙${t.each.toLocaleString()} each`;
  if (t.fill > 1) s += ` · 🪙${t.total.toLocaleString()} for ${t.fill.toLocaleString()}`;
  return s;
}
