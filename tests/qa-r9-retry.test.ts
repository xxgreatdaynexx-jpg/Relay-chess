import { beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { Exchange, once } from '../server/stocks';
import { Derivatives } from '../server/derivs';
import { backdropDismiss } from '../client/src/lib/backdrop';

const T0 = Date.parse('2026-11-01T18:00:00Z');
const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };

describe('QA r9: a retried fund buy never charges twice', () => {
  beforeEach(() => resetBank());
  it('same request id replays the first result, a new id trades again', async () => {
    const e = new Exchange(null, () => T0); const d = new Derivatives(e, null, () => T0); const n = 'QA-R9fund'; fund(n, 50_000);
    const f = d.funds()[0].id; const run = () => d.tradeFund(n, 'buy', f, 1);
    const [a, b] = await Promise.all([once(n, 'stk2_fund_buy', 'rid-aaaaaaaa', run), once(n, 'stk2_fund_buy', 'rid-aaaaaaaa', run)]);
    expect(b).toEqual(a); const c = await once(n, 'stk2_fund_buy', 'rid-aaaaaaaa', run); expect(c).toEqual(a);
    const paid = (a as { total: number }).total; expect(getBank().account(n).chips).toBe(50_000 - paid);
    await once(n, 'stk2_fund_buy', 'rid-bbbbbbbb', run); expect(getBank().account(n).chips).toBeLessThan(50_000 - paid);
  });
  it('a failed attempt is not cached, so a real retry can still go through', async () => {
    let calls = 0; const run = () => { calls++; if (calls === 1) throw new Error('cold'); return { ok: 1 }; };
    await expect(once('QA-R9x', 'stk2_fund_buy', 'rid-cccccccc', run)).rejects.toThrow('cold');
    await expect(once('QA-R9x', 'stk2_fund_buy', 'rid-cccccccc', run)).resolves.toEqual({ ok: 1 });
  });
});

describe('QA r9: backdrop dismiss does not click through', () => {
  const ev = (onBackdrop: boolean) => { const el = {}; let stopped = false; return { e: { target: onBackdrop ? el : {}, currentTarget: el, stopPropagation: () => { stopped = true; }, preventDefault: () => {} } as never, stopped: () => stopped }; };
  it('closes on its own click and swallows the press; ignores clicks on the card', () => {
    let closed = 0; const h = backdropDismiss(() => closed++);
    const d = ev(true); h.onPointerDown(d.e); expect(d.stopped()).toBe(true); expect(closed).toBe(0);
    const c = ev(true); h.onClick(c.e); expect(c.stopped()).toBe(true); expect(closed).toBe(1);
    const inner = ev(false); h.onPointerDown(inner.e); h.onClick(ev(true).e); expect(closed).toBe(1); // press began on the card
  });
});
