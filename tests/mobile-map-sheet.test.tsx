// Actual React output + DOM/stylesheet contracts. No browser layout/hit-testing claim.
// @vitest-environment jsdom
import { createElement as el, Fragment, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { MapSheet } from '../client/src/components/MapSheet';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
function media(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
function styles() {
  const out: string[] = [];
  postcss.parse(read('client/src/index.css')).walkRules((r) => {
    if (r.selector.includes('.map-sheet')) out.push(r.toString());
  });
  const s = document.createElement('style'); s.textContent = out.join('\n'); document.head.append(s);
}
const close = (cls = 'world-deed-x', fn = () => {}) => el('button', { className: cls, onClick: fn, 'aria-label': 'Close' }, '✕');
const long = () => Array.from({ length: 250 }, (_, i) => el('button', { key: i }, `Plot ${i}`));
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; document.head.querySelectorAll('style').forEach((x) => x.remove()); });
describe('real shared mobile header has no scroll/fixed-position dependency', () => {
  const cases = [
    ['deed/home/farm/list/fishing/employment', undefined, [close(), el('h3', {}, 'Real estate'), ...long()]],
    ['grocery', undefined, [close(), el('div', { className: 'grocery-front' }, 'CHUD FRESH'), ...long()]],
    ['city hall', undefined, [close(), el('div', { className: 'cityhall-front' }, 'CITY HALL'), ...long()]],
    ['conditional Fort/airport fragments', undefined, [close(), el(Fragment, {}, el('h3', {}, 'Airport'), ...long())]],
    ['Coral inventory', 'Coral Grotto storage', [close(), el('div', { className: 'bldg-inv' }, el('h4', {}, 'Inventory'), ...long())]],
    ['casino', undefined, [el('h3', {}, 'Casino'), ...long(), close('world-casino-x')]],
    ['furniture existing header', undefined, [el('header', {}, el('h3', {}, 'Furniture'), close('furn-close')), ...long()]],
  ] as const;
  for (const [name, heading, children] of cases) it(name, () => {
    media(true); styles();
    document.body.innerHTML = renderToStaticMarkup(el(MapSheet, { className: 'world-deed', heading }, ...children));
    const root = document.body.firstElementChild!;
    const header = root.querySelector(':scope > .map-sheet-header')!;
    const body = root.querySelector(':scope > .map-sheet-body')!;
    const x = header.querySelector('button[aria-label="Close"]')!;
    expect(header.nextElementSibling).toBe(body);
    expect(header.contains(x)).toBe(true); expect(body.contains(x)).toBe(false);
    expect(body.querySelector('h3, .grocery-front, .cityhall-front')).toBeNull();
    expect(header.textContent).toContain('✕');
    expect(getComputedStyle(root).overflow).toBe('hidden');
    expect(getComputedStyle(body).overflowY).toBe('auto'); expect(getComputedStyle(body).minHeight).toBe('0px');
    expect(getComputedStyle(header).flexShrink).toBe('0');
    expect(getComputedStyle(header).backgroundColor).toBe('rgb(16, 20, 24)');
    expect(getComputedStyle(x).position).toBe('static');
    expect(body.querySelectorAll('button').length).toBeGreaterThanOrEqual(250);
    (body as HTMLElement).scrollTop = 3000;
    // Structural invariant after scroll: the header and original close are NOT descendants of the scroller.
    expect(x.closest('.map-sheet-body')).toBeNull();
  });
  it('desktop renders the original div/children without header/body wrappers', () => {
    media(false);
    const children = [close(), el('h3', {}, 'Real estate'), el('p', {}, 'body')];
    expect(renderToStaticMarkup(el(MapSheet, { className: 'world-deed' }, ...children)))
      .toBe(renderToStaticMarkup(el('div', { className: 'world-deed' }, ...children)));
  });
  it('original close callback actually fires after content scroll; drag handler is not called', async () => {
    media(true); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const done = vi.fn(), drag = vi.fn(), host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(el(MapSheet, { className: 'world-deed', onPointerDown: drag }, close('world-deed-x', done), el('h3', {}, 'Real estate'), ...long())));
    host.querySelector<HTMLElement>('.map-sheet-body')!.scrollTop = 3000;
    const x = host.querySelector<HTMLButtonElement>('.map-sheet-header button')!;
    await act(async () => { x.dispatchEvent(new Event('pointerdown', { bubbles: true })); x.click(); });
    expect(done).toHaveBeenCalledTimes(1); expect(drag).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it('all actual legacy sheet families use this shared component; existing shop headers remain outside body', () => {
    for (const f of ['WorldMap','ResortMap','FortMcMap','FarmGame','FishingPanel','Venues']) {
      const s = read(`client/src/components/${f}.tsx`);
      expect(s).toContain("import { MapSheet }");
      expect(s).not.toMatch(/<div className=["{`]+world-deed/);
    }
    for (const f of ['Dealership','MechanicShop','FreightYard','CoopPanel','FleetStore']) {
      const s = read(`client/src/components/${f}.tsx`);
      expect(s).toMatch(/<header><h3/); expect(s.indexOf('</header>')).toBeLessThan(s.indexOf('className="dealer-body"') >= 0 ? s.indexOf('className="dealer-body"') : s.indexOf('className="freight-body'));
    }
  });
});
