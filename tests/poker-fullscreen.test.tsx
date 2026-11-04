// @vitest-environment jsdom
// #34 (Liam): poker full-screen mode. Toggle adds .he-full + body lock, asks the browser for real fullscreen, and Esc
// or leaving browser fullscreen exits it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('@/lib/net', () => ({ socket: { on: () => {}, off: () => {}, connected: true } }));
vi.mock('@/lib/casino', () => ({ emitCasino: () => Promise.resolve({ ok: true, state: null, tables: [] }), useCountdown: () => null }));
vi.mock('@/lib/sounds', () => ({ playCardFlick: () => {}, playSolitaireWin: () => {} }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('poker full screen (#34)', () => {
  it('toggles the overlay, requests browser fullscreen, and exits on Esc', async () => {
    const req = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    document.documentElement.requestFullscreen = req as never;
    const { HoldemTableView } = await import('../client/src/components/HoldemTable');
    render(createElement(HoldemTableView, { name: 'Liam' }));
    const btn = screen.getByTestId('he-fullscreen');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('holdem').className).not.toContain('he-full');
    act(() => { fireEvent.click(btn); });
    expect(screen.getByTestId('holdem').className).toContain('he-full');
    expect(document.body.classList.contains('he-full-open')).toBe(true);
    expect(req).toHaveBeenCalledTimes(1);
    expect(btn.textContent).toMatch(/Exit full screen/);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.getByTestId('holdem').className).not.toContain('he-full');
    expect(document.body.classList.contains('he-full-open')).toBe(false);
  });
  it('leaves overlay mode when the browser exits fullscreen', async () => {
    const { HoldemTableView } = await import('../client/src/components/HoldemTable');
    render(createElement(HoldemTableView, { name: 'Liam' }));
    act(() => { fireEvent.click(screen.getByTestId('he-fullscreen')); });
    expect(screen.getByTestId('holdem').className).toContain('he-full');
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(screen.getByTestId('holdem').className).not.toContain('he-full');
  });
});
