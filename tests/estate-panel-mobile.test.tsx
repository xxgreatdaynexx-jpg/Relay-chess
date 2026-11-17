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
import { RIG_STAGES } from '../shared/offshoreRig';

vi.mock('../client/src/lib/doing', () => ({ useDoing: vi.fn() }));
vi.mock('../client/src/lib/net', () => ({
  request: vi.fn(async () => ({ ok: true, sites: [], rigs: [], power: undefined })),
  socket: { on: vi.fn(), off: vi.fn(), timeout: () => ({ emit: vi.fn() }) },
}));
vi.mock('../client/src/lib/panelDrag', () => ({
  usePanelDrag: () => ({ ref: { current: null }, style: () => ({}), handle: el('div', { 'data-drag-handle': '', className: 'panel-drag-handle' }), onPointerDown: vi.fn() }),
}));

const src = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8');

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
