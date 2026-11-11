// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { TOP_TAB_ORDER, TopTab, TopTabs } from '../client/src/components/TopTabs';

function StubTabs() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <TopTabs />
      {TOP_TAB_ORDER.map((id) => (
        <TopTab key={id} id={id}>
          <button type="button" className="sol-tab" aria-expanded={open === id} data-testid={`${id}-tab`} onClick={() => setOpen((cur) => (cur === id ? null : id))}>
            {id}
          </button>
        </TopTab>
      ))}
    </>
  );
}

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; }, onchange: null })) as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
});
afterEach(() => { cleanup(); document.body.replaceChildren(); });

describe('top bar grouped menus', () => {
  it('keeps category menus in the bar and still reaches every destination', async () => {
    render(createElement(StubTabs));
    expect(screen.getByTestId('top-group-btn-casino').textContent).toMatch(/Casino/);
    expect(screen.getByTestId('top-group-btn-play').textContent).toMatch(/Play/);
    expect(screen.getByTestId('top-group-btn-work').textContent).toMatch(/Work/);
    expect(screen.getByTestId('top-group-btn-money').textContent).toMatch(/Money/);
    expect(screen.getByTestId('top-menu').textContent).toMatch(/Menu/);

    await act(async () => { fireEvent.click(screen.getByTestId('top-group-btn-casino')); });
    expect(screen.getByTestId('top-group-menu-casino')).toBeTruthy();
    expect(screen.getByTestId('top-group-item-blackjack')).toBeTruthy();
    expect(screen.getByTestId('top-group-item-mines')).toBeTruthy();

    const bj = screen.getByTestId('blackjack-tab');
    expect(bj.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { fireEvent.click(screen.getByTestId('top-group-item-blackjack')); });
    expect(bj.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('top-group-menu-casino')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByTestId('top-group-btn-work')); });
    expect(screen.getByTestId('top-group-item-factory')).toBeTruthy();
    expect(screen.getByTestId('top-group-item-market')).toBeTruthy();
    expect(screen.getByTestId('top-group-item-skills')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId('top-group-item-factory')); });
    expect(screen.getByTestId('factory-tab').getAttribute('aria-expanded')).toBe('true');
  });
});
