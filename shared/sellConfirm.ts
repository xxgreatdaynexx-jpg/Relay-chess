import { sellable, type Stack } from './mines.js';

/** What 'Sell all' will sell: item count (sum of sellable stack qty), stack count and estimated chips (server quote). */
export function sellAllSummary(storage: Stack[], estChips: number, fee = 0): { items: number; stacks: number; chips: number; fee: number; net: number } {
  const s = storage.filter((x) => sellable(x) && x.qty > 0);
  const chips = Math.max(0, Math.floor(estChips || 0)); const f = Math.max(0, Math.floor(fee || 0));
  return { items: s.reduce((a, x) => a + x.qty, 0), stacks: s.length, chips, fee: f, net: Math.max(0, chips - f) };
}

export function sellAllText(x: ReturnType<typeof sellAllSummary>): string {
  const base = `Sell ${x.items.toLocaleString('en-US')} item${x.items === 1 ? '' : 's'} (${x.stacks} stack${x.stacks === 1 ? '' : 's'}) for about 🪙 ${x.chips.toLocaleString('en-US')}`;
  return x.fee > 0 ? `${base}, minus a 🪙 ${x.fee.toLocaleString('en-US')} freight fee (≈ 🪙 ${x.net.toLocaleString('en-US')} net)?` : `${base}?`;
}

/** Millionaire Update: Ship & sell to the Chud City Warehouse. Count, est. chips (qty × unit) and the freight fee (0 on your own truck). */
export function shipSellSummary(qty: number, unit: number, fee: number) {
  const n = Math.max(0, Math.floor(qty || 0)); const chips = Math.max(0, Math.floor(n * (unit || 0))); const f = Math.max(0, Math.floor(fee || 0));
  return { items: n, stacks: n > 0 ? 1 : 0, chips, fee: f, net: Math.max(0, chips - f) };
}

export function shipSellText(label: string, x: ReturnType<typeof shipSellSummary>): string {
  const base = `Ship ${x.items.toLocaleString('en-US')} ${label} to the Chud City Warehouse and sell for about 🪙 ${x.chips.toLocaleString('en-US')}`;
  return x.fee > 0 ? `${base}, minus a 🪙 ${x.fee.toLocaleString('en-US')} freight fee (≈ 🪙 ${x.net.toLocaleString('en-US')} net)?` : `${base} (your truck, no freight fee)?`;
}
