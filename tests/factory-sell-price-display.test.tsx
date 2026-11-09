// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('@/lib/net', () => ({
  socket: {
    on: () => {}, off: () => {},
    timeout: () => ({ emit: (_ev: string, _body: unknown, cb: (err: Error | null, ack: unknown) => void) => cb(null, {
      ok: true, guest: false, inMine: false,
      storage: [{ type: 'good', id: 'pumpkin_pie', qty: 1 }],
      quote: { gross: 175.5, paid: 196, already: 0, effAlready: 0, index: 1.12, capBase: 100000, capIndex: 1 },
    }) }),
  },
}));
vi.mock('@/lib/doing', () => ({ useDoing: () => {} }));
vi.mock('@/lib/wallet', () => ({ useWalletChips: () => null }));
vi.mock('@/lib/windowDrag', () => ({ useWindowDrag: () => ({ className: '', style: {}, grips: null, bar: {}, front: () => {}, onPanelMove: () => {}, moved: false, reset: () => {} }) }));
vi.mock('@/components/TopTabs', () => ({ TopTab: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/FactoryBuilder', () => ({ FactoryBuilder: () => null }));
vi.mock('@/components/FactoryViewer', () => ({ openFactoryView: () => {} }));
vi.mock('@/components/MarketPage', () => ({ openMarket: () => {} }));

const { FactoryPanel } = await import('../client/src/components/FactoryPanel');

afterEach(() => { cleanup(); localStorage.clear(); });

describe('Factory storage sell price', () => {
  it('uses the quote price index, matching the quantity preview and server payout', async () => {
    const { houseSellPrice } = await import('../shared/sellBuff');
    const unit = houseSellPrice({ type: 'good', id: 'pumpkin_pie' });
    const idx = 1.12;
    const shown = +(unit * idx).toFixed(2);
    const paidFloor = Math.floor(unit * idx); // preview uses payoutFor then * idx; single unit under cap ≈ floor(unit)*idx path via mock paid
    render(createElement(FactoryPanel));
    fireEvent.click(screen.getByTestId('factory-tab'));
    expect((await screen.findByTestId('sell-unit')).textContent).toBe(`🪙${shown}`);
    fireEvent.click(screen.getByTestId('factory-sell-pick'));
    // Quantity preview floors house payout then applies index; mock quote.paid stays the server figure shown on Sell all.
    expect(screen.getByTestId('factory-qty-go').textContent).toMatch(/🪙\s*\d+/);
    fireEvent.click(screen.getByTestId('factory-sell'));
    expect(screen.getByText('Sell 1 item (1 stack) for about 🪙 196?')).toBeTruthy();
  });
});
