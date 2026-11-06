import { describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives } from '../server/derivs';

const T0 = Date.parse('2026-11-01T18:00:00Z');
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };

describe('public trade history', () => {
  it('lists stock buys/sells and shorts newest first, hides QA, filters by ticker and fund, changes no chips', async () => {
    let now = T0; const e = new Exchange(null, () => now); const d = new Derivatives(e, null, () => now);
    fund('PubTrader', 200_000); fund('QA-Hidden', 200_000);
    await e.trade('PubTrader', 'buy', 'QRKL', 3); now += 1000;
    await e.trade('QA-Hidden', 'buy', 'QRKL', 2); now += 1000;
    await e.trade('PubTrader', 'sell', 'QRKL', 1); now += 1000;
    await d.openShort('PubTrader', 'QRKL', 2); now += 1000;
    const before = getBank().account('PubTrader').chips;
    const all = (await d.publicTrades(undefined, undefined, 50)).trades;
    expect(all.map((t) => t.kind)).toEqual(['short', 'sell', 'buy']);
    expect(all.every((t) => t.name === 'PubTrader')).toBe(true);
    expect(all[2]).toMatchObject({ ticker: 'QRKL', qty: 3 });
    expect((await d.publicTrades('QRKL', undefined, 1)).trades).toHaveLength(1);
    const other = [...(await d.funds())].find((f) => !f.holdings.some((h) => h.ticker === 'QRKL'));
    if (other) expect((await d.publicTrades(undefined, other.id, 50)).trades).toHaveLength(0);
    await expect(d.publicTrades('NOPE', undefined, 5)).rejects.toThrow(/Unknown/);
    expect(getBank().account('PubTrader').chips).toBe(before);
  });
});
