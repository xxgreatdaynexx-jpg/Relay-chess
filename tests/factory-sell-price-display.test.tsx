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
    render(createElement(FactoryPanel));
    fireEvent.click(screen.getByTestId('factory-tab'));
    expect((await screen.findByTestId('sell-unit')).textContent).toBe('🪙196.56');
    fireEvent.click(screen.getByTestId('factory-sell-pick'));
    expect(screen.getByTestId('factory-qty-go').textContent).toContain('🪙 196');
    fireEvent.click(screen.getByTestId('factory-sell'));
    expect(screen.getByText('Sell 1 item (1 stack) for about 🪙 196?')).toBeTruthy();
  });
});
