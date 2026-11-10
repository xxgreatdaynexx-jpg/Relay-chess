// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent, cleanup, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FarmGame } from '../client/src/components/FarmGame';
import { properties } from '../shared/realEstate';
import { boxTiles, tileAtPoint } from '../shared/farmTemplates';
import type { FarmView } from '../shared/farm';

const net = vi.hoisted(() => ({ handlers: new Map<string, Function>(), callbacks: [] as Function[], emit: vi.fn() }));
vi.mock('../client/src/lib/doing', () => ({ useDoing: vi.fn() }));
vi.mock('../client/src/lib/net', () => ({ socket: {
  timeout: () => ({ emit: (ev: string, b: unknown, cb: Function) => { net.emit(ev, b); net.callbacks.push(cb); } }),
  on: (ev: string, fn: Function) => net.handlers.set(ev, fn),
  off: (ev: string) => { net.handlers.delete(ev); },
} }));
vi.mock('../client/src/lib/panelDrag', () => ({ usePanelDrag: () => ({ ref: null, style: () => ({}), handle: null, onPointerDown: vi.fn() }) }));

const city = properties().find((p) => p.kind === 'farm' && p.id.startsWith('f:'))!;
const T = 1_000_000;
const view = (extra: Partial<FarmView> = {}): FarmView => ({
  id: city.id, owner: 'carter2', mine: true, cols: 4, rows: 4, now: T, index: 1, today: { gross: 0, paid: 0 },
  tiles: [
    { tile: 0, crop: 'wheat', plantedAt: T - 2_000, readyAt: T + 8_000, witherAt: T + 80_000, stage: 'growing' },
  ],
  ...extra,
});

const flush = (ev: string, payload: Record<string, unknown>) => {
  net.emit.mock.calls.forEach((c, i) => { if (c[0] === ev && net.callbacks[i]) net.callbacks[i]!(null, { ok: true, ...payload }); });
};
const answerFarm = (v: FarmView = view()) => flush('farm_view', { farm: v });
const answerTpl = (templates: unknown[] = []) => flush('farm_templates', { templates });

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  net.emit.mockClear(); net.callbacks.length = 0; net.handlers.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function layoutGrid(el: HTMLElement, cols: number, rows: number) {
  // pad 6, gap 3, 10px tiles
  const width = 6 + cols * 10 + (cols - 1) * 3 + 6;
  const height = 6 + rows * 10 + (rows - 1) * 3 + 6;
  const rect = { left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON() { return this; } };
  el.getBoundingClientRect = () => rect as DOMRect;
  return rect;
}
function cellPoint(cols: number, rows: number, tile: number, rect: { left: number; top: number; width: number; height: number }) {
  const c = tile % cols, r = Math.floor(tile / cols);
  const pad = 6, gap = 3, size = 10;
  return { clientX: rect.left + pad + c * (size + gap) + 5, clientY: rect.top + pad + r * (size + gap) + 5 };
}

describe('farm area select and templates UI', () => {
  it('tells the owner they can drag-select and shows the templates panel', () => {
    render(<FarmGame id={city.id} label={city.label} onClose={() => {}} />);
    act(() => { answerFarm(); answerTpl(); });
    expect(screen.getByTestId('farm-game').textContent).toMatch(/drag a box to select/);
    expect(screen.getByTestId('farm-templates')).toBeTruthy();
    expect(screen.getByTestId('farm-tpl-save')).toBeTruthy();
    expect(screen.getByText(/No saved templates yet/)).toBeTruthy();
  });

  it('click still toggles a single empty tile and plant-selected emits farm_plant', () => {
    render(<FarmGame id={city.id} label={city.label} onClose={() => {}} />);
    act(() => { answerFarm(); answerTpl(); });
    fireEvent.click(screen.getByTestId('farm-seed-wheat'));
    fireEvent.click(screen.getByTestId('farm-tile-1'));
    fireEvent.click(screen.getByTestId('farm-plant-sel'));
    const plant = net.emit.mock.calls.find((c) => c[0] === 'farm_plant');
    expect(plant?.[1]).toMatchObject({ id: city.id, crop: 'wheat', tiles: [1] });
  });

  it('dragging a box selects every empty tile in the rectangle and does not harvest', () => {
    render(<FarmGame id={city.id} label={city.label} onClose={() => {}} />);
    act(() => { answerFarm(); answerTpl(); });
    const grid = screen.getByTestId('farm-grid');
    const rect = layoutGrid(grid, 4, 4);
    expect(tileAtPoint(4, 4, rect, ...Object.values(cellPoint(4, 4, 5, rect)) as [number, number])).toBe(5);
    const a = cellPoint(4, 4, 0, rect), b = cellPoint(4, 4, 5, rect);
    fireEvent.pointerDown(grid, { pointerId: 1, button: 0, ...a });
    fireEvent.pointerMove(grid, { pointerId: 1, buttons: 1, ...b });
    fireEvent.pointerUp(grid, { pointerId: 1, button: 0, ...b });
    // tile 0 is growing, so the box 0..5 should select empty 1, 4, 5
    expect([...boxTiles(4, 4, 0, 5)]).toEqual([0, 1, 4, 5]);
    fireEvent.click(screen.getByTestId('farm-plant-sel'));
    const plant = [...net.emit.mock.calls].reverse().find((c) => c[0] === 'farm_plant');
    expect(plant?.[1].tiles.sort()).toEqual([1, 4, 5]);
  });

  it('saving the field and applying a template emit the template sockets', () => {
    render(<FarmGame id={city.id} label={city.label} onClose={() => {}} />);
    act(() => { answerFarm(); answerTpl(); });
    fireEvent.change(screen.getByTestId('farm-tpl-name'), { target: { value: 'Spring mix' } });
    fireEvent.click(screen.getByTestId('farm-tpl-save'));
    const save = net.emit.mock.calls.find((c) => c[0] === 'farm_template_save');
    expect(save?.[1]).toMatchObject({ name: 'Spring mix', cols: 4, rows: 4, cells: [{ tile: 0, crop: 'wheat' }] });
    const saved = { id: 'tpl-1', name: 'Spring mix', cols: 2, rows: 1, cells: [{ tile: 0, crop: 'wheat' }, { tile: 1, crop: 'carrot' }], updatedAt: T };
    act(() => { net.callbacks[net.emit.mock.calls.findIndex((c) => c[0] === 'farm_template_save')]?.(null, { ok: true, template: saved, templates: [saved] }); });
    expect(screen.getByTestId('farm-tpl-tpl-1').textContent).toMatch(/Spring mix/);
    fireEvent.click(screen.getByTestId('farm-tpl-apply-tpl-1'));
    const apply = net.emit.mock.calls.find((c) => c[0] === 'farm_template_apply');
    expect(apply?.[1]).toMatchObject({ id: city.id, templateId: 'tpl-1', origin: 0 });
  });

  it('saving a selection packs a tight layout using the picked seed on empty tiles', () => {
    render(<FarmGame id={city.id} label={city.label} onClose={() => {}} />);
    act(() => { answerFarm(); answerTpl(); });
    fireEvent.click(screen.getByTestId('farm-seed-carrot'));
    fireEvent.click(screen.getByTestId('farm-tile-1'));
    fireEvent.click(screen.getByTestId('farm-tile-5'));
    fireEvent.change(screen.getByTestId('farm-tpl-name'), { target: { value: 'Corner' } });
    fireEvent.click(screen.getByTestId('farm-tpl-save'));
    const save = [...net.emit.mock.calls].reverse().find((c) => c[0] === 'farm_template_save');
    expect(save?.[1]).toMatchObject({ name: 'Corner', cols: 1, rows: 2, cells: [{ tile: 0, crop: 'carrot' }, { tile: 1, crop: 'carrot' }] });
  });
});
