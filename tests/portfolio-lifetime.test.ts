import { describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { COMPANIES } from '../shared/stocks';

const T0 = Date.parse('2026-10-31T12:00:00Z');
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };

describe('portfolio lifetime returns (read-only)', () => {
  it('combines realized sells and current value against chips spent', async () => {
    let now = T0; const e = new Exchange(null, () => now); now += 1;
    const name = 'life-ret-tester'; fund(name, 1_000_000);
    const cheap = [...COMPANIES].sort((x, y) => x.start - y.start); const a = cheap[0]!, b = cheap[1]!;
    const ba = await e.trade(name, 'buy', a.ticker, 4); now += 60_000;
    const sa = await e.trade(name, 'sell', a.ticker, 2); now += 60_000;
    const bb = await e.trade(name, 'buy', b.ticker, 3); now += 60_000;
    const sb = await e.trade(name, 'sell', b.ticker, 3);
    const chipsBefore = getBank().account(name).chips;
    const p = await e.portfolio(name);
    expect(getBank().account(name).chips).toBe(chipsBefore);
    const la = p.lifetime.find((x) => x.ticker === a.ticker)!; const lb = p.lifetime.find((x) => x.ticker === b.ticker)!;
    const ha = p.holdings.find((h) => h.ticker === a.ticker)!;
    expect(la.invested).toBe(ba.total); expect(la.sold).toBe(sa.total);
    expect(la.pnl).toBe(sa.total + ha.value - ba.total); expect(ha.lifePnl).toBe(la.pnl);
    expect(lb.open).toBe(false); expect(lb.pnl).toBe(sb.total - bb.total);
    expect(lb.pct).toBeCloseTo(((sb.total - bb.total) / bb.total) * 100, 1);
    expect(p.lifeTotal.pnl).toBe(la.pnl + lb.pnl); expect(p.lifeTotal.invested).toBe(ba.total + bb.total);
  });
});
