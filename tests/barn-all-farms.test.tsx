// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { barnFarms, isBarnProperty } from '../shared/barnFarms';
import { properties, optimisticOwn, type OwnedProperty } from '../shared/realEstate';
import { FarmOverview, FarmOverviewButton } from '../client/src/components/FarmOverview';
import { FarmGame } from '../client/src/components/FarmGame';
import { closePanel, panelId, type WorldPanel } from '../client/src/lib/worldPanels';
vi.mock('../client/src/lib/doing', () => ({ useDoing: vi.fn() }));
vi.mock('../client/src/lib/net', () => ({ socket: { timeout: () => ({ emit: vi.fn() }), on: vi.fn(), off: vi.fn() } }));
vi.mock('../client/src/lib/panelDrag', () => ({ usePanelDrag: () => ({ ref: null, style: () => ({}), handle: null, onPointerDown: vi.fn() }) }));
const barn = properties().find((p) => isBarnProperty(p.id))!;
const city = properties().find((p) => p.kind === 'farm' && p.id.startsWith('f:'))!;
const field = properties().find((p) => p.kind === 'farm' && p.id.startsWith('cf:') && !isBarnProperty(p.id))!;
const resort = properties().find((p) => p.kind === 'farm' && p.map === 'resort')!;
const own = (id: string, owner = 'Dayne'): OwnedProperty => ({ id, owner, price: 500, arrears: 0, boughtAt: 1 });
const owned = () => new Map([own(barn.id), own(city.id), own(field.id), own(resort.id)].map((o) => [o.id, o]));
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('barn-owned unified farm navigation (no stock or gameplay operations)', () => {
  it('recognizes only actual catalog Big Farm barns, not arbitrary cf ids or decorative buildings', () => {
    expect(isBarnProperty(barn.id)).toBe(true); expect(isBarnProperty(field.id)).toBe(false);
    expect(isBarnProperty('cf:999999')).toBe(false); expect(isBarnProperty('barn')).toBe(false);
  });
  it('existing barn owner unlocks own district/countryside/big farm/resort farms grouped by map', () => {
    const rows = [...owned().values(), own(properties().filter((p) => p.kind === 'farm')[2].id, 'Other')];
    const x = barnFarms('dAyNe', rows); expect(x.unlocked).toBe(true);
    expect(x.groups[0].farms.map((p) => p!.id).sort()).toEqual([barn.id, city.id, field.id].sort());
    expect(x.groups[1].farms.map((p) => p!.id)).toEqual([resort.id]);
  });
  it('guest, another owner’s barn and regular farm ownership do not unlock or expose another player’s farms', () => {
    expect(barnFarms(null, owned().values()).unlocked).toBe(false);
    expect(barnFarms('Other', owned().values()).groups.every((g) => !g.farms.length)).toBe(true);
    expect(barnFarms('Dayne', [own(city.id)]).unlocked).toBe(false);
  });
  it('confirmed new purchase ownership refresh immediately reveals affordance; selling removes it without reload', () => {
    const m = new Map([[city.id, own(city.id)]]); const open = vi.fn();
    const ui = render(<FarmOverviewButton me="Dayne" owned={m} onOpen={open} />);
    expect(screen.queryByTestId('all-farms-open')).toBeNull();
    const bought = new Map(m); bought.set(barn.id, optimisticOwn(undefined, 're_buy', barn.id, 'Dayne', 145000, Date.now()));
    ui.rerender(<FarmOverviewButton me="Dayne" owned={bought} onOpen={open} />);
    fireEvent.click(screen.getByTestId('all-farms-open')); expect(open).toHaveBeenCalledTimes(1);
    ui.rerender(<FarmOverviewButton me="Dayne" owned={m} onOpen={open} />);
    expect(screen.queryByTestId('all-farms-open')).toBeNull();
  });
  for (const map of ['city', 'resort'] as const) it(`${map}: only local owned farms open; remote farms require travel`, () => {
    const open = vi.fn(); render(<FarmOverview me="Dayne" owned={owned()} map={map} onOpenFarm={open} onClose={() => {}} />);
    const local = map === 'city' ? city : resort; const remote = map === 'city' ? resort : city;
    fireEvent.click(screen.getByTestId(`all-farms-${local.id}`)); expect(open).toHaveBeenCalledWith(local.id);
    expect((screen.getByTestId(`all-farms-${remote.id}`) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(`all-farms-${remote.id}`)); expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Inventories stay separate by map/)).toBeTruthy();
  });
  for (const mobile of [false, true]) it(`${mobile ? 'mobile' : 'desktop'} overview close and header are real original callbacks outside scroll content`, () => {
    vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const close = vi.fn(); const { container } = render(<FarmOverview me="Dayne" owned={owned()} map="city" onOpenFarm={() => {}} onClose={close} />);
    const x = screen.getByRole('button', { name: 'Close' }); fireEvent.click(x); expect(close).toHaveBeenCalledOnce();
    if (mobile) { expect(x.closest('.map-sheet-header')).toBeTruthy(); expect(x.closest('.map-sheet-body')).toBeNull(); expect(container.querySelector('.map-sheet-body section')).toBeTruthy(); }
    else expect(container.querySelector('.map-sheet-header')).toBeNull();
  });
  it('ownership removal while open hides the list, and does not alter normal individual farm access', () => {
    const ui = render(<FarmOverview me="Dayne" owned={owned()} map="city" onOpenFarm={() => {}} onClose={() => {}} />);
    ui.rerender(<FarmOverview me="Dayne" owned={new Map([[city.id, own(city.id)]])} map="city" onOpenFarm={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId(`all-farms-${city.id}`)).toBeNull();
    expect(screen.getByText(/usual individual farm access is unchanged/)).toBeTruthy(); cleanup();
    render(<FarmGame id={city.id} label={city.label} onClose={() => {}} />);
    expect(screen.getByTestId('farm-game')).toBeTruthy(); expect(screen.queryByTestId('farm-all-farms')).toBeNull();
  });
  it('individual farm can return to unified menu without new game actions', () => {
    const open = vi.fn(); render(<FarmGame id={city.id} label={city.label} onClose={() => {}} onAllFarms={open} />);
    fireEvent.click(screen.getByTestId('farm-all-farms')); expect(open).toHaveBeenCalledOnce();
  });
  it('overview shares the exclusive City panel slot and stale farm close cannot dismiss it', () => {
    const panel: WorldPanel = { k: 'farms' }; expect(panelId(panel, 'farm')).toBeNull();
    expect(closePanel(panel, 'farm')).toBe(panel); expect(closePanel(panel, 'farms')).toEqual({ k: 'none' });
  });
});
