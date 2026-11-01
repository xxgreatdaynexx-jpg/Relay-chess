// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

type Ack = { ok: boolean; [k: string]: unknown };
const calls: { ev: string; data: unknown; resolve: (a: Ack) => void }[] = [];
vi.mock('@/lib/net', () => ({
  socket: { on: () => {}, off: () => {}, connected: true },
  request: (ev: string, data?: unknown) => {
    if (ev === 'stk2_funds') return Promise.resolve({ ok: true, funds: [{ id: 'CHFIN', name: 'Chud Finance Index', kind: 'index', blurb: 'b', fee: 0.0025, expense: 0, nav: 100, yield: 0, holdings: [] }] });
    if (ev === 'stk2_portfolio') return Promise.resolve({ ok: true, funds: [{ fund: 'CHFIN', units: 3 }], shorts: [], options: [] });
    return new Promise<Ack>((resolve) => calls.push({ ev, data, resolve }));
  },
}));
vi.mock('@/lib/auth', () => ({ useAccount: () => 'QA-Dom' }));

const { FundsView } = await import('../client/src/components/StocksPage');
const { MIN_BUSY_MS } = await import('../client/src/lib/moneyAction');

afterEach(() => { cleanup(); calls.length = 0; vi.useRealTimers(); });

async function openChfin() {
  render(createElement(FundsView, { onTraded: () => {} }));
  fireEvent.click(await screen.findByTestId('stk-fund-CHFIN'));
  return { buy: screen.getByTestId('stk-fund-buy') as HTMLButtonElement, sell: screen.getByTestId('stk-fund-sell') as HTMLButtonElement };
}

describe('QA r12: fund buttons lock synchronously (real DOM)', () => {
  it('disabled + aria-busy + spinner right after the click, for the whole request; a double-click sends ONE order', async () => {
    const { buy, sell } = await openChfin();
    expect(buy.disabled).toBe(false);
    fireEvent.click(buy); fireEvent.click(buy); // double-click
    expect(buy.disabled).toBe(true); expect(sell.disabled).toBe(true);
    expect(buy.getAttribute('aria-busy')).toBe('true');
    expect(buy.querySelector('[data-testid="stk-spin"]')).not.toBeNull();
    expect(calls.filter((c) => c.ev === 'stk2_fund_buy')).toHaveLength(1);
    await act(async () => { await new Promise((r) => setTimeout(r, MIN_BUSY_MS + 50)); });
    expect(buy.disabled).toBe(true); // still pending on the server: stays locked
    await act(async () => { calls[0]!.resolve({ ok: true, total: 102, fee: 1 }); await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(buy.disabled).toBe(false); expect(buy.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByText(/Bought 1 CHFIN/)).toBeTruthy();
  });
  it('a fast answer still shows the spinner for MIN_BUSY_MS; a replayed answer says "Already placed"', async () => {
    const { sell } = await openChfin();
    fireEvent.click(sell);
    await act(async () => { calls[0]!.resolve({ ok: true, total: 99, fee: 1, replayed: true }); await Promise.resolve(); });
    expect(sell.getAttribute('aria-busy')).toBe('true');
    await act(async () => { await new Promise((r) => setTimeout(r, MIN_BUSY_MS + 50)); });
    expect(sell.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByText(/Already placed/)).toBeTruthy();
    expect(screen.queryByText(/Sold 1 CHFIN/)).toBeNull();
  });
});
