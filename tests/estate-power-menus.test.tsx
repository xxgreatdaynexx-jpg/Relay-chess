// @vitest-environment jsdom
import { createElement as el, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { EstatePanel } from '../client/src/components/EstatePanel';
import { request } from '../client/src/lib/net';
import {
  ESTATE_BUILDS, estateStages, estateProjectValue, partKey, stagePct,
  SERVER_RACK, PLANT_MW, PLANT_FUEL_DAY, PLANT_COAL_PER_HOUR,
  GRID_POWER_DAY, DIGITAL_DAILY_BASE, type EstateBuildId,
} from '../shared/estateProjects';
import { GOODS } from '../shared/mines';

vi.mock('../client/src/lib/doing', () => ({ useDoing: vi.fn() }));
vi.mock('../client/src/lib/net', () => ({
  request: vi.fn(async () => ({ ok: true, sites: [], rigs: [], power: undefined })),
  socket: { on: vi.fn(), off: vi.fn(), timeout: () => ({ emit: vi.fn() }) },
}));
vi.mock('../client/src/lib/panelDrag', () => ({
  usePanelDrag: () => ({ ref: { current: null }, style: () => ({}), handle: el('div', { 'data-drag-handle': '', className: 'panel-drag-handle' }), onPointerDown: vi.fn() }),
}));

const req = vi.mocked(request);

type Done = Record<string, number>;
function fullDone(id: EstateBuildId, i: number): Done {
  const st = estateStages(ESTATE_BUILDS[id])[i]!;
  return Object.fromEntries([['chips', st.chips], ...st.goods.map((g) => [partKey(g), g.qty])]);
}
function siteOf(opts: { build: EstateBuildId; stage: number; complete: boolean; gear?: number; done?: Done[]; warehouse?: Record<string, number> }) {
  const plan = ESTATE_BUILDS[opts.build];
  const stages = estateStages(plan).map((st, i) => {
    const done = opts.done?.[i] ?? (i < opts.stage || opts.complete ? fullDone(opts.build, i) : {});
    const parts = [
      { part: 'chips', name: 'Chips', need: st.chips, done: Math.min(st.chips, done.chips ?? 0), price: 1 },
      ...st.goods.map((x) => ({
        part: partKey(x), name: x.name, need: x.qty,
        done: Math.min(x.qty, done[partKey(x)] ?? 0),
        price: x.price, have: opts.warehouse?.[x.id] ?? 0,
      })),
    ];
    return { id: st.id, name: st.name, chips: st.chips, goods: st.goods.map((g) => ({ id: g.id, name: g.name, qty: g.qty })), done, parts, pct: stagePct(st, done) };
  });
  const gear = opts.build === 'data_center' ? SERVER_RACK : undefined;
  return {
    lotId: 'lot:estate:3', build: opts.build, stage: opts.stage, complete: opts.complete,
    gear: opts.gear ?? 0, kind: 'open',
    plan: { name: plan.name, icon: plan.icon, blurb: plan.blurb, total: estateProjectValue(plan) },
    stages,
    gearDef: gear && {
      ...gear,
      install: (gear.install ?? []).map(([id, qty]) => ({ id, qty, name: GOODS[id]?.name ?? id })),
    },
  };
}

const now = 1_700_000_000_000;
const viewOf = (site: ReturnType<typeof siteOf>, power: Record<string, unknown>) => ({
  ok: true, signedIn: true, chips: 2_500_000, rigs: [], sites: [site], power,
});

const dcBuild = siteOf({
  build: 'data_center', stage: 1, complete: false,
  done: [fullDone('data_center', 0), { chips: 80_000, 'good:steel_beam': 200 }, {}, {}],
  warehouse: { steel_beam: 40, steel_plate: 0 },
});
const dcRun = siteOf({ build: 'data_center', stage: 4, complete: true, gear: 3 });
const ppRun = siteOf({ build: 'power_plant', stage: 4, complete: true });

describe('data center and power plant menus', () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.useRealTimers();
    req.mockReset();
    req.mockImplementation(async () => ({ ok: true, sites: [], rigs: [], power: undefined }));
  });

  async function renderSite(site: ReturnType<typeof siteOf>, power: Record<string, unknown>) {
    req.mockImplementation(async (ev) => ev === 'estate_view' ? viewOf(site, power) : { ok: true });
    const root = createRoot(host);
    await act(async () => root.render(el(EstatePanel, { kind: 'estate', lotId: site.lotId, me: 'Jay', mine: true, onClose: vi.fn() })));
    return root;
  }

  it('builds a data center with dock-style cards, bars, and the same add/fill amounts', async () => {
    await renderSite(dcBuild, { gridMw: 0, gridPrice: GRID_POWER_DAY, plantMw: 0, demand: 0, supply: 0, throttle: 1, cap: DIGITAL_DAILY_BASE, paidToday: 0 });
    const panel = host.querySelector('[data-testid="estate-panel"]')!;
    expect(panel.querySelector('[data-testid="estate-works"]')).toBeTruthy();
    expect(panel.querySelector('[data-testid="estate-works-progress"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="estate-works-stage-pad"]')!.textContent).toMatch(/Site & slab/);
    expect(host.querySelector('[data-testid="estate-works-stage-pad"]')!.textContent).toMatch(/Done/);
    const current = host.querySelector('[data-testid="estate-works-stage-shell"]')!;
    expect(current.textContent).toMatch(/Halls & risers/);
    expect(current.textContent).toMatch(/80,000 \/ 320,000/);
    const addChips = host.querySelector('[data-testid="estate-site-add-chips"]') as HTMLButtonElement;
    const fillChips = host.querySelector('[data-testid="estate-site-fill-chips"]') as HTMLButtonElement;
    expect(addChips.className).toContain('estate-dock-btn');
    expect(addChips.textContent).toMatch(/10,000/);
    expect(fillChips.textContent).toMatch(/240,000/);
    expect(host.querySelector('[data-testid="estate-site-add-good:steel_beam"]')!.textContent).toMatch(/90/);
    expect(host.textContent).toContain(estateProjectValue(ESTATE_BUILDS.data_center).toLocaleString('en-US'));
    await act(async () => { fireEvent.click(addChips); });
    expect(req).toHaveBeenCalledWith('estate_contribute', { lotId: 'lot:estate:3', part: 'chips', qty: 10_000 });
    await act(async () => { fireEvent.click(fillChips); });
    expect(req).toHaveBeenCalledWith('estate_contribute', { lotId: 'lot:estate:3', part: 'chips', qty: 240_000 });
  });

  it('shows server-rack stats and installs one without changing the price', async () => {
    await renderSite(dcRun, {
      gridMw: 20, gridPrice: GRID_POWER_DAY, plantMw: 0, demand: 9, supply: 20, throttle: 1,
      cap: DIGITAL_DAILY_BASE, paidToday: 79_560,
    });
    const gear = host.querySelector('[data-testid="estate-gear"]')!;
    expect(gear.textContent).toMatch(/3 \/ 8/);
    expect(gear.textContent).toContain('3 MW');
    expect(gear.textContent).toContain('1,105');
    expect(gear.textContent).toContain('120,000');
    expect(gear.textContent).toMatch(/1 Server Rack/);
    expect(gear.textContent).toMatch(/4 /);
    expect(gear.textContent).toContain('3,315');
    const install = host.querySelector('[data-testid="estate-gear-install"]') as HTMLButtonElement;
    expect(install.textContent).toBe('Install one');
    await act(async () => { fireEvent.click(install); });
    expect(req).toHaveBeenCalledWith('estate_gear', { lotId: 'lot:estate:3', qty: 1 });
  });

  it('lays out power as cards and buys +10 MW at the same contract rate', async () => {
    await renderSite(dcRun, {
      gridMw: 20, gridPrice: GRID_POWER_DAY, plantMw: 0, demand: 9, supply: 20, throttle: 1,
      cap: DIGITAL_DAILY_BASE, paidToday: 79_560,
    });
    const utility = host.querySelector('[data-testid="estate-power-utility"]')!;
    expect(utility.textContent).toContain('20 MW');
    expect(utility.textContent).toContain(GRID_POWER_DAY.toLocaleString('en-US'));
    expect(host.querySelector('[data-testid="estate-power-plant"]')!.textContent).toMatch(/0 MW/);
    expect(host.querySelector('[data-testid="estate-power-balance"]')!.textContent).toMatch(/Demand\s*9 MW/);
    expect(host.querySelector('[data-testid="estate-power-balance"]')!.textContent).toMatch(/Supply\s*20 MW/);
    expect(host.querySelector('[data-testid="estate-power-balance"]')!.textContent).toMatch(/Throttle 100%/);
    expect(host.querySelector('[data-testid="estate-power-income"]')!.textContent).toContain('79,560');
    expect(host.querySelector('[data-testid="estate-power-income"]')!.textContent).toContain('400,000');
    expect(host.querySelector('[data-testid="estate-power-throttle"]')).toBeTruthy();
    const buy = host.querySelector('[data-testid="estate-grid-buy"]') as HTMLButtonElement;
    expect(buy.textContent).toBe('Buy +10 MW utility');
    await act(async () => { fireEvent.click(buy); });
    expect(req).toHaveBeenCalledWith('estate_grid', { mw: 30 });
  });

  it('keeps the grid-off banner, cut note, and restore action', async () => {
    await renderSite(dcRun, {
      gridMw: 20, gridPrice: GRID_POWER_DAY, plantMw: 0, demand: 15, supply: 0, throttle: 0,
      cap: DIGITAL_DAILY_BASE, paidToday: 4_200, gridOff: true, gridBill: 18_000,
    });
    expect(host.querySelector('[data-testid="estate-grid-off"]')!.textContent).toContain('18,000');
    expect(host.querySelector('[data-testid="estate-power-cut"]')!.textContent).toMatch(/Grid is off/);
    expect(host.querySelector('[data-testid="estate-power-utility"]')!.textContent).toMatch(/Shut off/);
    await act(async () => { fireEvent.click(host.querySelector('[data-testid="estate-grid-restore"]')!); });
    expect(req).toHaveBeenCalledWith('estate_grid_restore', {});
  });

  it('shows a finished power plant with unchanged fuel and output figures', async () => {
    await renderSite(ppRun, {
      gridMw: 10, gridPrice: GRID_POWER_DAY, plantMw: PLANT_MW, demand: 24, supply: 50, throttle: 1,
      cap: DIGITAL_DAILY_BASE, paidToday: 174_336,
      coalPerDay: PLANT_COAL_PER_HOUR * 24, fuelDay: PLANT_FUEL_DAY,
      fuelUntil: now + 18 * 3_600_000,
    });
    const plant = host.querySelector('[data-testid="estate-power-plant"]')!;
    expect(plant.textContent).toContain(`${PLANT_MW} MW`);
    expect(plant.textContent).toContain((PLANT_COAL_PER_HOUR * 24).toLocaleString('en-US'));
    expect(plant.textContent).toContain(PLANT_FUEL_DAY.toLocaleString('en-US'));
    expect(plant.textContent).toMatch(/Fueled for about 18 hours/);
    expect(host.querySelector('[data-testid="estate-works-build"]')!.textContent).toMatch(/Power Plant finished/);
    expect(host.querySelector('[data-testid="estate-gear"]')).toBeNull();
    expect(host.textContent).toContain(estateProjectValue(ESTATE_BUILDS.power_plant).toLocaleString('en-US'));
  });

  it('still opens as a MapSheet with close in the header', async () => {
    await renderSite(dcRun, {
      gridMw: 20, gridPrice: GRID_POWER_DAY, plantMw: 0, demand: 9, supply: 20, throttle: 1,
      cap: DIGITAL_DAILY_BASE, paidToday: 0,
    });
    const sheet = host.querySelector('[data-testid="estate-panel"]')!;
    const header = sheet.querySelector(':scope > .map-sheet-header')!;
    const body = sheet.querySelector(':scope > .map-sheet-body')!;
    const x = header.querySelector('button[aria-label="Close"]')!;
    expect(header.contains(x)).toBe(true);
    expect(body.contains(x)).toBe(false);
    expect(header.textContent).toContain('Data Center');
    expect(body.querySelector('.estate-ops-grid')).toBeTruthy();
  });
});
