import { describe, it, expect } from 'vitest';
import { sellAllSummary, sellAllText } from '../shared/sellConfirm';
import { ORES, sellable, type Stack } from '../shared/mines';

const ore = Object.keys(ORES)[0]!;
describe('#39 Sell all confirmation', () => {
  it('counts sellable items and stacks, uses the quote for chips', () => {
    const st: Stack[] = [{ type: 'ore', id: ore, qty: 12 }, { type: 'ore', id: ore, qty: 0 }];
    expect(sellable(st[0]!)).toBe(true);
    const x = sellAllSummary(st, 1234.9);
    expect(x).toMatchObject({ items: 12, stacks: 1, chips: 1234, fee: 0, net: 1234 });
    expect(sellAllText(x)).toBe('Sell 12 items (1 stack) for about 🪙 1,234?');
  });
  it('singular wording and freight fee', () => {
    const x = sellAllSummary([{ type: 'ore', id: ore, qty: 1 }], 500, 75);
    expect(x.net).toBe(425);
    expect(sellAllText(x)).toBe('Sell 1 item (1 stack) for about 🪙 500, minus a 🪙 75 freight fee (≈ 🪙 425 net)?');
  });
  it('empty storage', () => { expect(sellAllSummary([], 0)).toMatchObject({ items: 0, chips: 0 }); });
});

import { shipSellSummary, shipSellText } from '../shared/sellConfirm';
describe('#39 warehouse Ship & sell confirmation', () => {
  it('shows count, est chips and freight fee', () => {
    const x = shipSellSummary(30, 4.5, 20);
    expect(x).toMatchObject({ items: 30, chips: 135, fee: 20, net: 115 });
    expect(shipSellText('Wheat', x)).toBe('Ship 30 Wheat to the Chud City Warehouse and sell for about 🪙 135, minus a 🪙 20 freight fee (≈ 🪙 115 net)?');
  });
  it('own truck: no fee', () => {
    expect(shipSellText('Steel', shipSellSummary(2, 10, 0))).toBe('Ship 2 Steel to the Chud City Warehouse and sell for about 🪙 20 (your truck, no freight fee)?');
  });
});
