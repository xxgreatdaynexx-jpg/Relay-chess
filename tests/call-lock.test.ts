import { afterEach, describe, expect, it } from 'vitest';
import { getBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives, setDerivs } from '../server/derivs';

const T0 = Date.parse('2026-11-01T18:00:00Z'); const DAY = 86_400_000;
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const setPrice = (e: Exchange, t: string, p: number) => { const r = e.rows.get(t)!; r.base = p; r.imp = 0; };
const mk = () => { const clk = { now: T0 }; const e = new Exchange(null, () => clk.now); const d = new Derivatives(e, null, () => clk.now); setDerivs(d); return { e, d, clk }; };
afterEach(() => setDerivs(null));

describe('open call blocks buying that stock', () => {
  it('blocks buys of the same ticker only; sells, other tickers and puts are fine; lifts on sell/expiry', async () => {
    const { e, d, clk } = mk(); const n = 'QA-CallLock1'; fund(n, 50_000); setPrice(e, 'GLTC', 100);
    await e.trade(n, 'buy', 'GLTC', 5);
    const p = await d.buyOption(n, 'GLTC', 'put', 100, 3, 1);
    await e.trade(n, 'buy', 'GLTC', 1); // put does not lock
    const c = await d.buyOption(n, 'GLTC', 'call', 100, 3, 2);
    await expect(e.trade(n, 'buy', 'GLTC', 1)).rejects.toThrow(/open call on GLTC/);
    expect((await e.company('GLTC', '24h', n)).callLock).toBe(true);
    await e.trade(n, 'sell', 'GLTC', 1); // selling still allowed
    const other = [...e.rows.keys()].find((t) => t !== 'GLTC')!; await e.trade(n, 'buy', other, 1);
    expect(await e.callLocked('QA-CallLock2', 'GLTC')).toBe(false);
    await d.sellOption(n, c.id, 2);
    await e.trade(n, 'buy', 'GLTC', 1);
    const c2 = await d.buyOption(n, 'GLTC', 'call', 100, 1, 1); void c2; void p;
    await expect(e.trade(n, 'buy', 'GLTC', 1)).rejects.toThrow(/open call/);
    clk.now += DAY + 1; await e.trade(n, 'buy', 'GLTC', 1); // expired call no longer locks
  });
});
