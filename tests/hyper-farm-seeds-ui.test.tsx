// @vitest-environment jsdom
import React from 'react';
import { render, cleanup, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FarmGame } from '../client/src/components/FarmGame';
import { properties } from '../shared/realEstate';
import { HYPER_CROPS, type FarmView } from '../shared/farm';

const net = vi.hoisted(() => ({ callbacks: [] as Function[], emit: vi.fn() }));
vi.mock('../client/src/lib/doing', () => ({ useDoing: vi.fn() }));
vi.mock('../client/src/lib/net', () => ({ socket: {
  timeout: () => ({ emit: (ev: string, b: unknown, cb: Function) => { net.emit(ev, b); net.callbacks.push(cb); } }),
  on: vi.fn(), off: vi.fn(),
} }));
vi.mock('../client/src/lib/panelDrag', () => ({ usePanelDrag: () => ({ ref: null, style: () => ({}), handle: null, onPointerDown: vi.fn() }) }));

const plot = properties().find((p) => p.kind === 'farm' && p.id.startsWith('cf:'))!;
const view = (extra: Partial<FarmView> = {}): FarmView => ({ id: plot.id, owner: 'Jay', mine: true, cols: 4, rows: 4, now: 1, index: 1, today: { gross: 0, paid: 0 }, tiles: [], ...extra });
const answer = (v: FarmView) => net.emit.mock.calls.forEach((c, i) => { if (c[0] === 'farm_view') net.callbacks[i]?.(null, { ok: true, farm: v }); });

beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })); net.emit.mockClear(); net.callbacks.length = 0; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('hyper farm seeds in the farm seed list', () => {
  it('a finished glasshouse lists the flowers', () => {
    render(<FarmGame id={plot.id} label={plot.label} onClose={() => {}} />);
    act(() => answer(view({ hyper: true })));
    const seeds = screen.getByTestId('farm-seeds').textContent!;
    for (const c of HYPER_CROPS) expect(seeds).toContain(c.label);
  });
  it('an ordinary farm does not', () => {
    render(<FarmGame id={plot.id} label={plot.label} onClose={() => {}} />);
    act(() => answer(view()));
    const seeds = screen.getByTestId('farm-seeds').textContent!;
    for (const c of HYPER_CROPS) expect(seeds).not.toContain(c.label);
  });
});
