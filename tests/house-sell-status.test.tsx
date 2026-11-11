// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { houseSellStatus } from '../shared/houseSellView';
import { houseCapBase, payoutFor } from '../shared/mines';
import { plantCapToBase } from '../shared/plantCap';
import { effectiveAlready } from '../shared/sinkRoom';

// Real figures from a Nov 11 report: the panel showed "Sold today: 403905 · paying 0%" next to a 535,310 chip cap.
// 403,905 was base units; in chips it is 542,808 (x1.3439), past the cap once refunded room is counted.
const idx = 1.3439, capIdx = 4.7122, bonus = 0.00076386775947479, plant = 63_731, lost = 6_153;
const already = 403_905.4; // server tracks fractional base units; the old panel floored this to 403905
const capBase = houseCapBase(capIdx, idx) * (1 + bonus) + plantCapToBase(plant, idx);
const effAlready = effectiveAlready(already, lost, idx);

const quote = { gross: 31 * 3.15, paid: Math.floor(payoutFor(31 * 3.15, effAlready, capBase) * idx), already, lost, effAlready, index: idx, capBase, capIndex: capIdx, sellBonus: bonus, plantBonus: plant };

vi.mock('@/lib/net', () => ({
  socket: { on: () => {}, off: () => {}, timeout: () => ({ emit: (_e: string, _b: unknown, cb: (err: Error | null, ack: unknown) => void) => cb(null, { ok: true, guest: false, inMine: false, storage: [{ type: 'good', id: 'brick', qty: 31 }], quote }) }) },
  request: async () => ({ ok: true, items: [] }),
}));
vi.mock('@/lib/doing', () => ({ useDoing: () => {} }));
vi.mock('@/lib/wallet', () => ({ useWalletChips: () => null }));
vi.mock('@/lib/windowDrag', () => ({ useWindowDrag: () => ({ className: '', style: {}, grips: null, bar: {}, front: () => {}, onPanelMove: () => {}, moved: false, reset: () => {} }) }));
vi.mock('@/lib/useBuildingWindow', () => ({ useBuildingWindow: () => ({ className: '', style: {}, grips: null, bar: {}, front: () => {}, onPanelMove: () => {}, moved: false, reset: () => {}, isFront: true }) }));
vi.mock('@/components/TopTabs', () => ({ TopTab: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/FactoryBuilder', () => ({ FactoryBuilder: () => null }));
vi.mock('@/components/FactoryViewer', () => ({ openFactoryView: () => {} }));
vi.mock('@/components/MarketPage', () => ({ openMarket: () => {} }));

afterEach(() => { cleanup(); localStorage.clear(); });

describe('house sell status uses the same units as server enforcement', () => {
  it('reports sold today in chips, so a maxed player is shown as past the cap', () => {
    const s = houseSellStatus({ already, effAlready, lost, capBase, index: idx });
    expect(s.soldChips).toBe(542_808);
    expect(s.countedChips).toBeGreaterThan(535_310 - 1);
    expect(s.leftChips).toBe(0);
    expect(s.rate).toBe(0);
    expect(payoutFor(1_000, effAlready, capBase)).toBe(0); // server pays nothing either
  });

  it('agrees with the server payout for any amount sold so far', () => {
    for (const sold of [0, 100_000, 300_000, 390_000, 398_000, 399_000, 403_905]) {
      const eff = effectiveAlready(sold, lost, idx);
      const s = houseSellStatus({ already: sold, effAlready: eff, lost, capBase, index: idx });
      const serverPays = payoutFor(10 ** 9, eff, capBase) * idx; // chips the server would still pay at full price
      expect(s.rate).toBe(serverPays > 0 ? 1 : 0);
      expect(Math.abs(s.leftChips - serverPays)).toBeLessThanOrEqual(1.5);
    }
  });

  it('the Factory panel shows sold, room left and paying % that match the server', async () => {
    const { FactoryPanel } = await import('../client/src/components/FactoryPanel');
    render(createElement(FactoryPanel));
    fireEvent.click(screen.getByTestId('factory-tab'));
    const line = (await screen.findByTestId('factory-house-status')).textContent ?? '';
    expect(line).toContain('Sold today: 🪙 542,808');
    expect(line).toContain('paying 0%');
    expect(line).toContain('full price up to 🪙 535,310');
    expect(screen.getByTestId('factory-house-left').textContent).toBe('0');
    expect(line).not.toContain('403905');
  });
});
