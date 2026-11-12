// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { MinePackShop } from '../client/src/components/MinePackShop';
import type { MineBackpackView } from '../shared/mineBackpack';

afterEach(() => cleanup());

const baseView = (over: Partial<MineBackpackView> = {}): MineBackpackView => ({
  cap: 120, tier: 0, index: 1, signedIn: true, prices: { pack_160: 5000, pack_200: 15000, pack_250: 45000, pack_300: 110000 },
  next: { id: 'pack_160', name: 'Roomy Pack', cap: 160, price: 5000 },
  ...over,
});

describe('MinePackShop', () => {
  it('shows current and next capacity with the buy price, and calls onBuy', () => {
    const onBuy = vi.fn();
    render(createElement(MinePackShop, { view: baseView(), cap: 120, guest: false, wallet: 20_000, msg: '', onBuy }));
    expect(screen.getByTestId('mines-pack-now').textContent).toMatch(/Capacity:\s*120\s*· next 160/);
    expect(screen.getByTestId('mines-pack-path').textContent).toMatch(/120 → 160 → 200 → 250 → 300/);
    expect(screen.getByTestId('mines-pack-buy').textContent).toBe('🪙5,000');
    fireEvent.click(screen.getByTestId('mines-pack-buy'));
    expect(onBuy).toHaveBeenCalledWith('pack_160');
  });
  it('disables the button when the player cannot afford it, and for guests', () => {
    render(createElement(MinePackShop, { view: baseView(), cap: 120, guest: false, wallet: 100, msg: '', onBuy: () => {} }));
    expect((screen.getByTestId('mines-pack-buy') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(createElement(MinePackShop, { view: baseView({ signedIn: false }), cap: 120, guest: true, wallet: 99_000, msg: '', onBuy: () => {} }));
    expect(screen.queryByTestId('mines-pack-buy')).toBeNull();
    expect(screen.getByText('Sign in')).toBeTruthy();
  });
  it('shows a maxed state at 300 with no buy button', () => {
    render(createElement(MinePackShop, { view: baseView({ cap: 300, tier: 4, next: null }), cap: 300, guest: false, wallet: 999_000, msg: 'Your pack is at the maximum 300 capacity.', onBuy: () => {} }));
    expect(screen.getByTestId('mines-pack-now').textContent).toMatch(/Capacity:\s*300\s*· maxed/);
    expect(screen.getByTestId('mines-pack-max').textContent).toMatch(/maximum 300/);
    expect(screen.queryByTestId('mines-pack-buy')).toBeNull();
    expect(screen.getByTestId('mines-pack-msg').textContent).toMatch(/maximum 300/);
  });
});
