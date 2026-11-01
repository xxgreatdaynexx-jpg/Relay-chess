import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { once, SAME_INTENT_MS } from '../server/stocks';
import { isDoubleBet, DOUBLE_CLICK_MS } from '../client/src/lib/doubleClick';

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

describe('QA r11: double-clicked fund buy charges once (server)', () => {
  it('two identical rapid fund buys with different request ids run the trade once', async () => {
    let charges = 0; const run = async () => { charges++; await new Promise((r) => setTimeout(r, 20)); return { total: 102 }; };
    const body = (rid: string) => ({ fund: 'CHFIN', units: 1, rid });
    const [a, b] = await Promise.all([
      once('QA-Dbl1', 'stk2_fund_buy', 'rid-aaaaaaaa', run, body('rid-aaaaaaaa')),
      once('QA-Dbl1', 'stk2_fund_buy', 'rid-bbbbbbbb', run, body('rid-bbbbbbbb')),
    ]);
    expect(charges).toBe(1); expect(a).toEqual(b);
    // a click just after the first one finished is still a double-click
    await once('QA-Dbl1', 'stk2_fund_buy', 'rid-cccccccc', run, body('rid-cccccccc'));
    expect(charges).toBe(1);
  });
  it('different units, another player, or after the window trade for real', async () => {
    let charges = 0; const run = () => { charges++; return {}; };
    await once('QA-Dbl2', 'stk2_fund_buy', 'rid-11111111', run, { fund: 'CHFIN', units: 1 });
    await once('QA-Dbl2', 'stk2_fund_buy', 'rid-22222222', run, { fund: 'CHFIN', units: 2 });
    await once('QA-Dbl3', 'stk2_fund_buy', 'rid-33333333', run, { fund: 'CHFIN', units: 1 });
    expect(charges).toBe(3);
    expect(SAME_INTENT_MS).toBeLessThanOrEqual(2000);
  });
  it('a failed attempt is not cached, so a real retry runs', async () => {
    let n = 0; const run = () => { n++; if (n === 1) throw new Error('db'); return { ok: 1 }; };
    await expect(once('QA-Dbl4', 'stk2_fund_buy', 'rid-44444444', run, { fund: 'X', units: 1 })).rejects.toThrow();
    await expect(once('QA-Dbl4', 'stk2_fund_buy', 'rid-55555555', run, { fund: 'X', units: 1 })).resolves.toEqual({ ok: 1 });
  });
  it('the socket wrapper passes the body for money events', () => {
    expect(src('server/stocks.ts')).toContain('MONEY_EV.test(ev) ? b : undefined');
  });
});

describe('QA r11: client locks against double-clicks', () => {
  it('StocksPage money handlers take a synchronous lock', () => {
    const s = src('client/src/components/StocksPage.tsx');
    expect(s.match(/if \(lk\.current\) return; lk\.current = true; setBusy\(/g)?.length).toBe(5);
    expect(s.match(/setBusy\(false\); lk\.current = false;/g)?.length).toBe(5);
  });
  it('slots spin and blackjack actions are locked while in flight', () => {
    expect(src('client/src/components/SlotsPanel.tsx')).toMatch(/if \(!machine \|\| spinLock\.current\) return;\s*spinLock\.current = true;/);
    expect(src('client/src/components/BlackjackPanel.tsx')).toMatch(/if \(sending\.current\) return;/);
  });
  it('roulette: a double-click on a spot is one chip; deliberate later clicks still stack', () => {
    const idle = { k: '"red"', at: 1000, busy: false };
    expect(isDoubleBet({ ...idle, busy: true }, '"black"', 5000)).toBe(true);
    expect(isDoubleBet(idle, '"red"', 1000 + DOUBLE_CLICK_MS - 1)).toBe(true);
    expect(isDoubleBet(idle, '"red"', 1000 + DOUBLE_CLICK_MS + 1)).toBe(false);
    expect(isDoubleBet(idle, '"black"', 1100)).toBe(false);
  });
});
