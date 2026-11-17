// @vitest-environment jsdom
// Shore Construction Dock / estate sheets must use the shared mobile MapSheet
// (header + close outside the scroller, world-deed full-bleed on phones).
import { createElement as el, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent } from '@testing-library/react';
import { EstatePanel } from '../client/src/components/EstatePanel';
import { request } from '../client/src/lib/net';
import { RIG_CHIP_STEP, RIG_LAUNCH_FEE, RIG_STAGES, rigLabel } from '../shared/offshoreRig';

vi.mock('../client/src/lib/doing', () => ({ useDoing: vi.fn() }));
vi.mock('../client/src/lib/net', () => ({
  request: vi.fn(async () => ({ ok: true, sites: [], rigs: [], power: undefined })),
  socket: { on: vi.fn(), off: vi.fn(), timeout: () => ({ emit: vi.fn() }) },
}));
vi.mock('../client/src/lib/panelDrag', () => ({
  usePanelDrag: () => ({ ref: { current: null }, style: () => ({}), handle: el('div', { 'data-drag-handle': '', className: 'panel-drag-handle' }), onPointerDown: vi.fn() }),
}));

const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8');
const req = vi.mocked(request);

type FixtureRig = {
  id: string; owner: string; stage: number; done: Array<Record<string, number>>;
  status: 'building' | 'ready' | 'launched'; hold: number; settledAt: number;
  label: string; launchFee: number; berthAt: null; stages: typeof RIG_STAGES;
};
const fixtureRigs: FixtureRig[] = [
  {
    id: 'rig-build', owner: 'Jay', stage: 0,
    done: [{ chips: 40_000, 'good:steel_plate': 200 }, {}, {}, {}],
    status: 'building', hold: 0, settledAt: 1,
    label: rigLabel({ status: 'building', stage: 0 }),
    launchFee: RIG_LAUNCH_FEE, berthAt: null, stages: RIG_STAGES,
  },
  {
    id: 'rig-ready', owner: 'Jay', stage: 4,
    done: RIG_STAGES.map((st) => ({ chips: st.chips, ...Object.fromEntries(st.goods.map(([id, n]) => [`good:${id}`, n])) })),
    status: 'ready', hold: 0, settledAt: 1,
    label: rigLabel({ status: 'ready', stage: 4 }),
    launchFee: RIG_LAUNCH_FEE, berthAt: null, stages: RIG_STAGES,
  },
];

function viewOf(rigs: FixtureRig[] = fixtureRigs, chips = 1_250_000) {
  return { ok: true, signedIn: true, chips, rigs, sites: [], power: undefined };
}

describe('Shore Construction Dock opens as a mobile map sheet', () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

  it('renders the dock in a MapSheet with close in the non-scrolling header', async () => {
    const onClose = vi.fn();
    const root = createRoot(host);
    await act(async () => root.render(el(EstatePanel, { kind: 'rigdock', me: 'Jay', onClose })));
    const sheet = host.querySelector('[data-testid="estate-panel"]')!;
    expect(sheet.className).toContain('world-deed');
    expect(sheet.className).toContain('estate-panel');
    expect(sheet.className).not.toContain('sol-panel');
    const header = sheet.querySelector(':scope > .map-sheet-header')!;
    const body = sheet.querySelector(':scope > .map-sheet-body')!;
    const x = header.querySelector('button[aria-label="Close"]')!;
    expect(header.nextElementSibling).toBe(body);
    expect(header.contains(x)).toBe(true);
    expect(body.contains(x)).toBe(false);
    expect(header.textContent).toContain('Shore Construction Dock');
    expect(body.textContent).toContain('Build a rig on the dock');
    for (const st of RIG_STAGES) expect(body.textContent).toContain(st.name);
    fireEvent.click(x);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the dock tile and 3D pick still open the estate panel', () => {
    const wm = src('client/src/components/WorldMap.tsx');
    expect(wm).toContain("case 'rigdock': setPanel({ k: 'estate', kind: 'rigdock' })");
    expect(src('client/src/lib/worldSpots.ts')).toContain("id: 'rigdock'");
    expect(src('client/src/lib/worldSpots.ts')).toContain('Shore Construction Dock');
    const panel = src('client/src/components/EstatePanel.tsx');
    expect(panel).toContain('MapSheet');
    expect(panel).toContain('world-deed estate-panel');
    expect(panel).toContain('world-deed-x');
    expect(panel).not.toContain('sol-panel');
    expect(panel).not.toContain('hub-win-bar');
  });
});

describe('Shore Construction Dock contribute UI', () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    host = document.createElement('div');
    document.body.append(host);
    req.mockImplementation(async (ev) => ev === 'estate_view' ? viewOf() : { ok: true });
  });
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); req.mockReset(); req.mockImplementation(async () => ({ ok: true, sites: [], rigs: [], power: undefined })); });

  async function renderDock() {
    const root = createRoot(host);
    await act(async () => root.render(el(EstatePanel, { kind: 'rigdock', me: 'Jay', onClose: vi.fn() })));
    return root;
  }

  it('shows progress bars, material buttons, and a Fill that can exceed the 10,000-chip step', async () => {
    await renderDock();
    const body = host.querySelector('[data-testid="estate-dock"]')!;
    expect(body.querySelector('[data-testid="estate-dock-progress-rig-build"]')).toBeTruthy();
    expect(body.querySelector('[data-testid="estate-dock-stage-rig-build-hull"]')!.textContent).toMatch(/Hull/);
    const add = host.querySelector('[data-testid="estate-dock-add-chips-rig-build"]') as HTMLButtonElement;
    const fill = host.querySelector('[data-testid="estate-dock-fill-chips-rig-build"]') as HTMLButtonElement;
    expect(add.textContent).toMatch(/10,000/);
    expect(fill.textContent).toMatch(/320,000/);
    expect(host.querySelector('[data-testid="estate-dock-add-good:steel_plate-rig-build"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="estate-dock-fill-good:steel_plate-rig-build"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="estate-dock-launch-rig-ready"]')!.textContent).toContain(RIG_LAUNCH_FEE.toLocaleString('en-US'));
    expect(host.querySelector('[data-testid="estate-dock-status"]')!.textContent).toMatch(/2 \/ 3/);
  });

  it('posts the Add step and the Fill remainder, then shows a success message and updated progress', async () => {
    const building = fixtureRigs[0]!;
    req.mockImplementation(async (ev, body) => {
      if (ev === 'estate_view') return viewOf();
      if (ev === 'estate_rig_contribute') {
        const qty = (body as { qty: number }).qty;
        const next = { ...building, done: [{ ...building.done[0], chips: 40_000 + qty }, {}, {}, {}] };
        return { ok: true, ...next };
      }
      return { ok: true };
    });
    await renderDock();
    const add = host.querySelector('[data-testid="estate-dock-add-chips-rig-build"]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(add); });
    expect(req).toHaveBeenCalledWith('estate_rig_contribute', { id: 'rig-build', part: 'chips', qty: RIG_CHIP_STEP });
    const toast = host.querySelector('[data-testid="estate-msg"]') as HTMLElement;
    expect(toast.getAttribute('data-estate-msg-kind')).toBe('ok');
    expect(toast.textContent).toMatch(/Added 10,000 chips/);
    expect(toast.textContent).toMatch(/complete/);
    const fill = host.querySelector('[data-testid="estate-dock-fill-chips-rig-build"]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(fill); });
    expect(req).toHaveBeenCalledWith('estate_rig_contribute', { id: 'rig-build', part: 'chips', qty: 320_000 });
  });

  it('shows the server error when a contribution fails', async () => {
    req.mockImplementation(async (ev) => ev === 'estate_view' ? viewOf() : { ok: false, error: 'Not enough chips.' });
    await renderDock();
    await act(async () => { fireEvent.click(host.querySelector('[data-testid="estate-dock-add-chips-rig-build"]')!); });
    const toast = host.querySelector('[data-testid="estate-msg"]') as HTMLElement;
    expect(toast.getAttribute('data-estate-msg-kind')).toBe('err');
    expect(toast.textContent).toBe('Not enough chips.');
  });

  it('disables starting a fourth rig', async () => {
    const extra = { ...fixtureRigs[1]!, id: 'rig-live', status: 'launched' as const, label: rigLabel({ status: 'launched', stage: 4 }) };
    req.mockImplementation(async () => viewOf([...fixtureRigs, extra]));
    await renderDock();
    const start = host.querySelector('[data-testid="estate-dock-start"]') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(host.querySelector('[data-testid="estate-dock-cap"]')!.textContent).toMatch(/at most 3/);
  });
});
