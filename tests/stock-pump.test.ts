import { describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives } from '../server/derivs';
import { MAX_TOTAL_IMPACT, impactAllowed } from '../shared/stocks';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const mk = () => { const clk = { now: T0 }; const e = new Exchange(null, () => clk.now); const d = new Derivatives(e, null, () => clk.now); return { e, d, clk }; };
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };

describe('pump-and-dump guard', () => {
  it('impactAllowed caps total push but always lets it unwind', () => {
    expect(impactAllowed(0, 0.05)).toBe(true);
    expect(impactAllowed(0.1, 0.03)).toBe(false);
    expect(impactAllowed(-0.1, -0.03)).toBe(false);
    expect(impactAllowed(0.6, -0.02)).toBe(true);
    expect(impactAllowed(MAX_TOTAL_IMPACT, 0)).toBe(true);
  });
  it('rejects a buy once the stock is pushed to the cap, still allows selling', async () => {
    const { e, clk } = mk(); const n = 'QA-pump1'; fund(n, 1_000_000);
    await e.trade(n, 'buy', 'MEMQ', 3);
    const r = e.rows.get('MEMQ')!; r.imp = MAX_TOTAL_IMPACT; clk.now += 60 * 60_000;
    await expect(e.trade(n, 'buy', 'MEMQ', 3)).rejects.toThrow(/pushed as far/);
    await expect(e.trade(n, 'sell', 'MEMQ', 1)).resolves.toBeTruthy();
  });
  it('options price and bid off the un-pushed base price', async () => {
    const { e, d } = mk(); const r = e.rows.get('MEMQ')!; r.base = 200; r.imp = 0;
    const flat = d.optionQuote('MEMQ', 'call', 200, 1, 100);
    r.imp = 0.5; // pumped spot ~330
    const pumped = d.optionQuote('MEMQ', 'call', 200, 1, 100);
    expect(pumped.price).toBe(200); expect(pumped.premium).toBe(flat.premium);
    const n = 'QA-pump2'; fund(n, 1_000_000); r.imp = 0;
    const o = await d.buyOption(n, 'MEMQ', 'call', 200, 1, 100);
    r.imp = 0.5; const s = await d.optionSellQuote(n, o.id, 100);
    expect(s.price).toBe(200); expect(s.payout).toBeLessThanOrEqual(o.premium);
  });
});

import { HOUSE_SELL_BLOCKED } from '../server/house-cap-index';
describe('house-sell block', () => {
  it('house selling is re-enabled for the former exploit accounts', () => { for (const k of ['jay', 'conner', 'carter2']) expect(HOUSE_SELL_BLOCKED.has(k)).toBe(false); expect(HOUSE_SELL_BLOCKED.has('dayne')).toBe(false); });
});
