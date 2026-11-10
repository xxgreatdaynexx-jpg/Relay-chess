// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent, cleanup, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBarnProperty } from '../shared/barnFarms';
import { properties, type OwnedProperty } from '../shared/realEstate';
import { FarmOverview } from '../client/src/components/FarmOverview';
import type { BarnFarmOverview } from '../shared/barnFarmStatus';

const net = vi.hoisted(() => ({ handlers: new Map<string, Function>(), callbacks: [] as Function[], emit: vi.fn(), off: vi.fn() }));
vi.mock('../client/src/lib/doing', () => ({ useDoing: vi.fn() }));
vi.mock('../client/src/lib/net', () => ({ socket: {
  timeout: () => ({ emit: (ev: string, b: unknown, cb: Function) => { net.emit(ev, b); net.callbacks.push(cb); } }),
  on: (ev: string, fn: Function) => net.handlers.set(ev, fn),
  off: (ev: string) => { net.handlers.delete(ev); net.off(ev); },
} }));
vi.mock('../client/src/lib/panelDrag', () => ({ usePanelDrag: () => ({ ref: null, style: () => ({}), handle: null, onPointerDown: vi.fn() }) }));

const barn = properties().find((p) => isBarnProperty(p.id))!;
const city = properties().find((p) => p.kind === 'farm' && p.id.startsWith('f:'))!;
const resort = properties().find((p) => p.kind === 'farm' && p.map === 'resort')!;
const own = (id: string, owner = 'carter2'): OwnedProperty => ({ id, owner, price: 500, arrears: 0, boughtAt: 1 });
const owned = () => new Map([own(barn.id), own(city.id), own(resort.id)].map((o) => [o.id, o]));
const T = 100_000;
const overview = (extra: Partial<BarnFarmOverview> = {}): BarnFarmOverview => ({
  now: T, index: 1,
  plots: [
    { id: city.id, cols: 2, rows: 2, tiles: [
      { tile: 0, crop: 'wheat', plantedAt: T - 10_000, readyAt: T - 1, witherAt: T + 50_000, stage: 'ready' },
      { tile: 1, crop: 'wheat', plantedAt: T - 2_000, readyAt: T + 8_000, witherAt: T + 80_000, stage: 'growing' },
    ] },
    { id: resort.id, cols: 2, rows: 2, tiles: [] },
  ],
  ...extra,
});
const answerOverview = (view: BarnFarmOverview = overview()) => {
  const cb = net.callbacks.find((_, i) => net.emit.mock.calls[i]?.[0] === 'farm_overview') ?? net.callbacks[0];
  // answer all pending farm_overview callbacks
  net.emit.mock.calls.forEach((c, i) => { if (c[0] === 'farm_overview' && net.callbacks[i]) net.callbacks[i]!(null, { ok: true, overview: view }); });
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  net.emit.mockClear(); net.off.mockClear(); net.callbacks.length = 0; net.handlers.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('All my farms dashboard harvest and replant', () => {
  it('shows crop counts and timers, and harvest-all / replant-all only on the current map', () => {
    render(<FarmOverview me="carter2" owned={owned()} map="city" onOpenFarm={() => {}} onClose={() => {}} />);
    act(() => { answerOverview(); });
    expect(screen.getByTestId(`farm-status-${city.id}`).textContent).toMatch(/2 empty · 1 growing · 1 ready/);
    expect(screen.getByText(/Next ready in/)).toBeTruthy();
    expect(screen.getByTestId(`all-farms-harvest-${city.id}`)).toBeTruthy();
    expect(screen.getByTestId('all-farms-harvest-map')).toBeTruthy();
    expect(screen.queryByTestId(`all-farms-harvest-${resort.id}`)).toBeNull();
    expect((screen.getByTestId(`all-farms-${resort.id}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it('harvest all ready and replant empty emit one farm_dash per action with the plot ids and chosen seed', () => {
    render(<FarmOverview me="carter2" owned={owned()} map="city" onOpenFarm={() => {}} onClose={() => {}} />);
    act(() => { answerOverview(); });
    fireEvent.click(screen.getByTestId('all-farms-harvest-map'));
    const harvest = net.emit.mock.calls.find((c) => c[0] === 'farm_dash');
    expect(harvest?.[1]).toMatchObject({ action: 'harvest', ids: [city.id] });
    const hcb = net.callbacks[net.emit.mock.calls.findIndex((c) => c[0] === 'farm_dash')];
    act(() => { hcb?.(null, { ok: true, harvested: 1, paid: 20 }); });
    expect(screen.getByTestId('all-farms-msg').textContent).toMatch(/Harvested 1/);

    fireEvent.click(screen.getByTestId('all-farms-seed-carrot'));
    fireEvent.click(screen.getByTestId(`all-farms-plant-${city.id}`));
    const plant = [...net.emit.mock.calls].reverse().find((c) => c[0] === 'farm_dash');
    expect(plant?.[1]).toMatchObject({ action: 'plant', ids: [city.id], crop: 'carrot' });
  });

  it('does not emit dash actions for a remote-map farm', () => {
    render(<FarmOverview me="carter2" owned={owned()} map="city" onOpenFarm={() => {}} onClose={() => {}} />);
    act(() => { answerOverview(); });
    expect(screen.queryByTestId(`all-farms-plant-${resort.id}`)).toBeNull();
    expect(net.emit.mock.calls.filter((c) => c[0] === 'farm_dash')).toHaveLength(0);
  });
});
