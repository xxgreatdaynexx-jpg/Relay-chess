import { describe, expect, it } from 'vitest';
import { once } from '../server/stocks';

const sell = (rid: string) => ({ fund: 'CHFIN', units: 1, rid });
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('QA r12: identical-order dedupe never swallows a real follow-up order', () => {
  it('sell, finish, then click + click 200 ms later: both later clicks are evaluated (none merged into the old sale)', async () => {
    let sold = 0; const run = async () => { await tick(30); sold++; return { total: 99 }; };
    await once('QA-R12a', 'stk2_fund_sell', 'rid-r12a0001', run, sell('rid-r12a0001'));
    const a = await once('QA-R12a', 'stk2_fund_sell', 'rid-r12a0002', run, sell('rid-r12a0002'));
    await tick(200);
    const b = await once('QA-R12a', 'stk2_fund_sell', 'rid-r12a0003', run, sell('rid-r12a0003'));
    expect(sold).toBe(3);
    expect((a as { replayed?: boolean }).replayed).toBeUndefined();
    expect((b as { replayed?: boolean }).replayed).toBeUndefined();
  });
  it('an identical order while the first is still running is merged and flagged replayed:true', async () => {
    let sold = 0; const run = async () => { await tick(50); sold++; return { total: 99 }; };
    const [x, y] = await Promise.all([
      once('QA-R12b', 'stk2_fund_sell', 'rid-r12b0001', run, sell('rid-r12b0001')),
      (async () => { await tick(10); return once('QA-R12b', 'stk2_fund_sell', 'rid-r12b0002', run, sell('rid-r12b0002')); })(),
    ]);
    expect(sold).toBe(1);
    expect(x).toEqual({ total: 99 }); expect(y).toEqual({ total: 99, replayed: true });
  });
  it("the client's own retry (same request id) gets the first answer unflagged and never trades twice", async () => {
    let sold = 0; const run = () => { sold++; return { total: 7 }; };
    const r1 = await once('QA-R12c', 'stk2_fund_sell', 'rid-r12c0001', run, sell('rid-r12c0001'));
    const r2 = await once('QA-R12c', 'stk2_fund_sell', 'rid-r12c0001', run, sell('rid-r12c0001'));
    expect(sold).toBe(1); expect(r2).toEqual(r1);
  });
  it('a failed order is not merged into the next one', async () => {
    let n = 0; const run = async () => { await tick(10); n++; if (n === 1) throw new Error('db'); return { ok: 1 }; };
    await expect(once('QA-R12d', 'stk2_fund_sell', 'rid-r12d0001', run, sell('rid-r12d0001'))).rejects.toThrow();
    await expect(once('QA-R12d', 'stk2_fund_sell', 'rid-r12d0002', run, sell('rid-r12d0002'))).resolves.toEqual({ ok: 1 });
  });
});
