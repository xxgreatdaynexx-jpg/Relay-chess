import { beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { Exchange } from '../server/stocks';
import { Derivatives } from '../server/derivs';
import { COMPANY_BY_TICKER, quote } from '../shared/stocks';
import { shortClose } from '../shared/derivs';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const chips = (n: string) => getBank().account(n).chips;

describe('QA r9: an immediate short open + close loses at most the fees', () => {
  beforeEach(() => resetBank());
  it('the QA case: 1 and 3 HYDQ at 8.90 (was -3 each from floor/ceil rounding)', () => {
    const c = COMPANY_BY_TICKER.get('HYDQ')!;
    for (const shares of [1, 3]) {
      const o = quote(c, 8.9, 'sell', shares); const collateral = Math.ceil(1.5 * o.gross);
      const { q, pnl } = shortClose(c, { collateral, proceeds: o.gross, shares, fees: o.fee, entry: Math.round(o.fill * 100) / 100 }, 8.9);
      expect(pnl).toBeGreaterThanOrEqual(-(o.fee + q.fee));
    }
  });
  it('end to end on the exchange, many tickers and sizes', async () => {
    for (const t of ['HYDQ', 'QRKL', 'SLRX']) for (const shares of [1, 2, 3, 5]) {
      const e = new Exchange(null, () => T0); const d = new Derivatives(e, null, () => T0); const n = `QA-R9-${t}-${shares}`; fund(n, 100_000);
      const before = chips(n); const o = await d.openShort(n, t, shares); const r = await d.closeShort(n, o.id);
      const closeFee = Math.max(1, Math.ceil(r.fill * shares * 0.01));
      const spread = Math.ceil(o.fill * shares * 0.0055); // round-trip spread (0.5%) + the tiny impact of a few shares
      expect(before - chips(n), `${t} x${shares} @${o.fill}`).toBeLessThanOrEqual(o.fee + closeFee + spread);
      expect(r.pnl).toBe(chips(n) - before);
    }
  });
});
