// @vitest-environment jsdom
/** t1967u + t1968u UI: machine Sell confirm/cancel (desktop + mobile width) and searchable factory pickers. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { createElement as h } from 'react';
vi.mock('@/lib/net', () => ({ socket: { on: () => {}, off: () => {}, timeout: () => ({ emit: () => {} }) } }));
import { Inspect } from '../client/src/components/FactoryBuilder';
import { FactoryMachineSell } from '../client/src/components/FactoryMachineSell';
import { filterOpts } from '../client/src/components/FactorySearchSelect';
import { recipesFor, type Ent } from '../shared/factory';

afterEach(cleanup);
const noop = () => {};
const smelter = (extra: Partial<Ent> = {}): Ent => ({ id: 7, k: 'smelter', x: 2, y: 0, d: 0, ...extra });
const inspect = (e: Ent, onEdit = vi.fn(), sell?: React.ReactNode) => render(h(Inspect, { e, storage: ['ore:iron', 'ore:coal', 'bar:copper_bar'], store: new Map([['ore:iron', 5]]), onEdit, onRemove: noop, onMove: noop, onClose: noop, sell }));

describe('searchable factory pickers', () => {
  it('filterOpts: case-insensitive, trimmed, matches ingredients via search text, keeps the selected value', () => {
    const o = [{ value: 'a', label: 'Iron Plate', search: 'iron bar' }, { value: 'b', label: 'Copper Wire', search: 'copper bar' }];
    expect(filterOpts(o, '  COPPER ', '').map((x) => x.value)).toEqual(['b']);
    expect(filterOpts(o, 'bar', '').map((x) => x.value)).toEqual(['a', 'b']);
    expect(filterOpts(o, 'copper', 'a').map((x) => x.value)).toEqual(['a', 'b']); // selection kept even when filtered out
    expect(filterOpts(o, '   ', 'a')).toHaveLength(2);
  });
  it('recipe search filters by name and ingredient, never picks or starts anything; clear + no-results', () => {
    const r0 = recipesFor('smelter')[0]; const onEdit = vi.fn();
    inspect(smelter({ r: r0.id }), onEdit);
    const sel = screen.getByTestId('fac-recipe') as HTMLSelectElement; const all = sel.options.length;
    expect(sel.value).toBe(r0.id);
    fireEvent.change(screen.getByTestId('fac-recipe-search'), { target: { value: '  COAL ' } });
    expect(sel.options.length).toBeLessThanOrEqual(all); expect([...sel.options].every((o) => o.value === r0.id || /coal/i.test(o.text))).toBe(true);
    fireEvent.keyDown(screen.getByTestId('fac-recipe-search'), { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled(); expect(sel.value).toBe(r0.id);
    fireEvent.change(screen.getByTestId('fac-recipe-search'), { target: { value: 'zzzz-nothing' } });
    expect(screen.getByTestId('fac-recipe-empty').textContent).toMatch(/No matches.*current pick is kept/);
    expect(sel.value).toBe(r0.id); expect(sel.options.length).toBe(1);
    fireEvent.click(screen.getByTestId('fac-recipe-clear'));
    expect((screen.getByTestId('fac-recipe-search') as HTMLInputElement).value).toBe('');
    expect(sel.options.length).toBe(all); expect(screen.queryByTestId('fac-recipe-empty')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled(); // production unchanged by searching
    const other = [...sel.options].find((o) => o.value !== r0.id)!;
    fireEvent.change(sel, { target: { value: other.value } });
    expect(onEdit).toHaveBeenCalledWith({ r: other.value }); // only an explicit pick edits
  });
  it('Escape clears the query (keyboard), chest filter search works', () => {
    const onEdit = vi.fn(); inspect({ id: 3, k: 'chest_in', x: 0, y: 0, d: 0 }, onEdit);
    const q = screen.getByTestId('fac-filter-search');
    fireEvent.change(q, { target: { value: 'iron' } });
    expect([...(screen.getByTestId('fac-filter') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'ore:iron']);
    fireEvent.keyDown(q, { key: 'Escape' }); expect((q as HTMLInputElement).value).toBe(''); expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('machine sell', () => {
  const ok = (result: unknown) => Promise.resolve({ ok: true, result });
  for (const width of [1280, 375]) it(`confirm and cancel with the server quote (${width}px)`, async () => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    const ask = vi.fn((ev: string) => ev === 'fac_sell_quote' ? ok({ pay: 100 }) : ok({ paid: 100 })); const sold = vi.fn(); const flash = vi.fn();
    inspect(smelter(), vi.fn(), h(FactoryMachineSell, { id: 7, kind: 'smelter', name: 'Smelter', ask, onSold: sold, flash }));
    await act(async () => { fireEvent.touchStart(screen.getByTestId('fac-sell')); fireEvent.click(screen.getByTestId('fac-sell')); });
    expect(ask).toHaveBeenCalledWith('fac_sell_quote', { id: 7 });
    expect(screen.getByTestId('fac-sell-confirm').textContent).toMatch(/Sell this Smelter for 100 chips/);
    fireEvent.click(screen.getByTestId('fac-sell-no')); expect(screen.queryByTestId('fac-sell-confirm')).toBeNull();
    expect(ask).toHaveBeenCalledTimes(1); expect(sold).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByTestId('fac-sell')); });
    await act(async () => { fireEvent.click(screen.getByTestId('fac-sell-yes')); });
    expect(ask).toHaveBeenLastCalledWith('fac_sell', { id: 7, kind: 'smelter', quote: 100 }); expect(sold).toHaveBeenCalledTimes(1);
    expect(flash).toHaveBeenCalledWith('Sold the Smelter for 100 chips.');
  });
  it('double click on Confirm sends one sale; server refusal (busy) is shown and nothing is sold', async () => {
    let resolve!: (v: unknown) => void;
    const ask = vi.fn((ev: string) => ev === 'fac_sell_quote' ? ok({ pay: 100 }) : new Promise((r) => { resolve = r; }));
    const flash = vi.fn(); const sold = vi.fn();
    render(h(FactoryMachineSell, { id: 7, kind: 'smelter', name: 'Smelter', ask: ask as never, onSold: sold, flash }));
    await act(async () => { fireEvent.click(screen.getByTestId('fac-sell')); });
    await act(async () => { fireEvent.click(screen.getByTestId('fac-sell-yes')); fireEvent.click(screen.getByTestId('fac-sell-yes')); });
    expect(ask.mock.calls.filter((c) => c[0] === 'fac_sell')).toHaveLength(1);
    await act(async () => { resolve({ ok: false, error: 'That Smelter is still working or holding items.' }); });
    expect(flash).toHaveBeenCalledWith('That Smelter is still working or holding items.'); expect(sold).not.toHaveBeenCalled();
  });
  it('Sell only shows on machines', () => {
    inspect({ id: 1, k: 'belt', x: 0, y: 0, d: 0 }, vi.fn(), h('button', { 'data-testid': 'fac-sell' }));
    expect(screen.queryByTestId('fac-sell')).toBeNull();
  });
});
