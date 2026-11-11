// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { CookingHost, OPEN_GROCERY, openKitchen } from '../client/src/components/CookingPanels';
import { listBuildingWindows, resetBuildingWindowsForTest } from '../client/src/lib/buildingWindows';

vi.mock('@/lib/net', () => ({
  request: vi.fn(async (ev: string) => {
    if (ev === 'cook_state') return { ok: true, state: { level: 1, pantry: {}, fish: { fish: 0, fish_fine: 0 }, fillets: { fish: 0 }, dishes: [], today: { paid: 0, gross: 0 }, hasHome: true, index: 1 }, prices: {} };
    return { ok: true };
  }),
  socket: { on: vi.fn(), off: vi.fn(), timeout: () => ({ emit: vi.fn() }) },
}));
vi.mock('@/lib/wallet', () => ({ useWalletChips: () => 0 }));

afterEach(() => { cleanup(); resetBuildingWindowsForTest(); document.body.replaceChildren(); });

describe('Kitchen and Grocery can stay open together', () => {
  it('opens both and focuses an already-open kitchen', async () => {
    const host = document.createElement('div');
    host.className = 'app-panels';
    document.body.appendChild(host);
    render(createElement(CookingHost, { me: 'tester' }));
    await act(async () => { openKitchen('Trailer', 'trailer'); });
    expect(await screen.findByTestId('venue-kitchen')).toBeTruthy();
    await act(async () => { window.dispatchEvent(new Event(OPEN_GROCERY)); });
    expect(await screen.findByTestId('venue-grocery')).toBeTruthy();
    expect(screen.getByTestId('venue-kitchen')).toBeTruthy();
    const ids = listBuildingWindows().map((e) => e.id);
    expect(ids).toContain('kitchen');
    expect(ids).toContain('grocery');
    expect(listBuildingWindows().at(-1)?.id).toBe('grocery');
    await act(async () => { openKitchen('Trailer', 'trailer'); });
    expect(listBuildingWindows().at(-1)?.id).toBe('kitchen');
    fireEvent.click(screen.getByTestId('venue-grocery').querySelector('button[aria-label="Close"]')!);
    expect(screen.queryByTestId('venue-grocery')).toBeNull();
    expect(screen.getByTestId('venue-kitchen')).toBeTruthy();
  });
});
