// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { panelDragAllowed, usePanelDrag } from '../client/src/lib/panelDrag';

const dir = join(process.cwd(), 'client/src/components');
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
const src = (f: string) => readFileSync(join(dir, f), 'utf8');

/** Full-screen overlays (nothing to move) and the fishing dock (owned by the fishing worker). */
const EXEMPT = new Set(['FishingPanel.tsx', 'Requests.tsx', 'Changelog.tsx', 'ConquestPanel.tsx:cq-overlay']);
const PANEL_ROOT = /<div[^>]*(className="[^"]*\b(world-deed|inv-win|dealer-box|acct-panel|wallet-panel|cq-rules|cq-rules-card|sol-panel)[" ]|role="dialog")/g;

describe('every floating panel uses the shared drag behaviour', () => {
  const expected: Record<string, string[]> = {
    'CookingPanels.tsx': ['grocery', 'kitchen'], 'EmploymentPanel.tsx': ['employ'], 'MechanicShop.tsx': ['mechanic'], 'DailyReport.tsx': ['daily'],
    'Venues.tsx': ['venue'], 'FarmGame.tsx': ['farm'], 'ResortMap.tsx': ['resortDeeds', 'resortAir'], 'WorldMap.tsx': ['deed', 'deeds', 'home'],
    'Dealership.tsx': ['dealer'], 'MarketPage.tsx': ['market'], 'StocksPage.tsx': ['stocks'], 'Skills.tsx': ['skills'], 'SkinsPanel.tsx': ['inventory'],
    'PlayerProfile.tsx': ['profile'], 'AccountPanel.tsx': ['account'], 'WalletButton.tsx': ['wallet'], 'ConquestPanel.tsx': ['cqRules'],
    'AdminPopup.tsx': ['admin'], 'RoomScreen.tsx': ['bailout'],
  };
  for (const [f, ids] of Object.entries(expected)) it(`${f} panels are draggable`, () => {
    const s = src(f);
    expect(s).toContain("from '@/lib/panelDrag'");
    for (const id of ids) { expect(s).toContain(`usePanelDrag('${id}')`); expect(s).toContain(`data-drag-panel="${id}"`); expect(s).toMatch(new RegExp(`\\{drag\\w+\\.handle\\}`)); }
  });
  it('no panel root is left without drag (source scan)', () => {
    const missing: string[] = [];
    for (const f of files) {
      if (EXEMPT.has(f)) continue;
      const s = src(f);
      for (const m of s.matchAll(PANEL_ROOT)) {
        const tag = s.slice(m.index!, s.indexOf('>', m.index! + m[0].length - 1) + 400);
        const open = tag.slice(0, 600);
        if (/cq-overlay/.test(open) || /alertdialog/.test(open)) continue;
        if (/data-drag-panel=|win\.(style|className)|winRef|wrapRef|useWindowDrag/.test(open) || (/sol-panel/.test(open) && s.includes('useWindowDrag'))) continue;
        missing.push(`${f}: ${open.slice(0, 90)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('usePanelDrag', () => {
  afterEach(() => { cleanup(); localStorage.clear(); });
  const Panel = () => {
    const d = usePanelDrag('t');
    return createElement('div', { ref: d.ref, style: d.style(), onPointerDown: d.onPointerDown, 'data-drag-panel': 't', 'data-testid': 'p' },
      d.handle, createElement('h3', null, 'Title'), createElement('input', { 'data-testid': 'in' }), createElement('button', { type: 'button', 'data-testid': 'b' }, 'x'));
  };
  const box = (el: HTMLElement, dx = 0, dy = 0) => { el.getBoundingClientRect = () => ({ left: 100 + dx, top: 100 + dy, width: 200, height: 150, right: 300 + dx, bottom: 250 + dy, x: 100, y: 100, toJSON() {} }) as DOMRect; };
  const drag = (target: HTMLElement, x: number, y: number) => {
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, pointerType: 'touch', clientX: 110, clientY: 105 });
    act(() => { window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 110 + x, clientY: 105 + y })); });
    act(() => { window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 110 + x, clientY: 105 + y })); });
  };
  it('drags by the header grip (touch/pointer), persists the spot', () => {
    render(createElement(Panel));
    const p = screen.getByTestId('p'); box(p);
    drag(screen.getByTestId('panel-drag-t'), 40, 30);
    expect(p.style.transform).toBe('translate(40px, 30px)');
    expect(JSON.parse(localStorage.getItem('relay-win-panel-t')!)).toMatchObject({ dx: 40, dy: 30 });
  });
  it('clamps to the screen', () => {
    Object.assign(window, { innerWidth: 800, innerHeight: 600 });
    render(createElement(Panel));
    const p = screen.getByTestId('p'); box(p);
    drag(screen.getByTestId('panel-drag-t'), 5000, 5000);
    const [, dx, dy] = /translate\((-?\d+)px, (-?\d+)px\)/.exec(p.style.transform)!.map(Number);
    expect(100 + dx + 200).toBeLessThanOrEqual(800); expect(100 + dy + 150).toBeLessThanOrEqual(600);
  });
  it('inputs and buttons in the header never start a drag', () => {
    render(createElement(Panel));
    const p = screen.getByTestId('p'); box(p);
    drag(screen.getByTestId('in'), 50, 50); drag(screen.getByTestId('b'), 50, 50);
    expect(p.style.transform).toBe('');
    expect(panelDragAllowed(screen.getByTestId('b'), 100, 105)).toBe(false);
    expect(panelDragAllowed(screen.getByText('Title'), 100, 110)).toBe(true);
    expect(panelDragAllowed(screen.getByText('Title'), 100, 400)).toBe(false);
  });
});
