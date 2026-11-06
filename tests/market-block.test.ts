import { describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives } from '../server/derivs';
import { MARKET_BLOCKED, isMarketBlocked } from '../server/house-cap-index';

const T0 = Date.parse('2026-11-01T18:00:00Z');
const mk = () => { const clk = { now: T0 }; const e = new Exchange(null, () => clk.now); const d = new Derivatives(e, null, () => clk.now); return { e, d }; };
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const MSG = /Market access suspended/;

describe('market block', () => {
  it('lists arenagawd and chessgawd, case-insensitive', () => {
    expect([...MARKET_BLOCKED].sort()).toEqual(['arenagawd', 'chessgawd']);
    expect(isMarketBlocked('ArenaGawd')).toBe(true); expect(isMarketBlocked(' CHESSGAWD ')).toBe(true);
    expect(isMarketBlocked('QA-free')).toBe(false); expect(isMarketBlocked(null)).toBe(false);
  });
  for (const n of ['arenagawd', 'ChessGawd']) it(`blocks every trade route for ${n} without charging`, async () => {
    const { e, d } = mk(); fund(n, 100_000); const before = getBank().account(n).chips;
    const t = e.list().companies?.[0]?.ticker ?? [...e.rows.keys()][0];
    await expect(e.trade(n, 'buy', t, 1)).rejects.toThrow(MSG);
    await expect(e.trade(n, 'sell', t, 1)).rejects.toThrow(MSG);
    await expect(d.tradeFund(n, 'buy', 'CH100', 1)).rejects.toThrow(MSG);
    await expect(d.tradeFund(n, 'sell', 'CH100', 1)).rejects.toThrow(MSG);
    await expect(d.openShort(n, t, 1)).rejects.toThrow(MSG);
    await expect(d.closeShort(n, 'x')).rejects.toThrow(MSG);
    await expect(d.buyOption(n, t, 'call', 'atm', 3, 1)).rejects.toThrow(MSG);
    await expect(d.sellOption(n, 'x', 1)).rejects.toThrow(MSG);
    expect(getBank().account(n).chips).toBe(before);
  });
  it('still lets other players trade', async () => {
    const { d } = mk(); const n = 'QA-mktok'; fund(n, 5000);
    await expect(d.tradeFund(n, 'buy', 'CH100', 1)).resolves.toBeTruthy();
  });
});
