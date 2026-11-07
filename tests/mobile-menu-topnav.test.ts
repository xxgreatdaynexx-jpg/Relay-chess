// Source/DOM CSS contract regressions, NOT browser geometry or visual QA.
// Real App siblings reproduce why a z60 child of .world(z40) lost to TopTabs(z48).
// Flatten only active viewport rules so jsdom can evaluate selectors, visibility and header position.
// The scroll clamp below models sticky/fixed positioning; jsdom does not perform layout/hit testing.
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AtRule } from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = postcss.parse(read('client/src/index.css'));
const mediaOk = (q: string, w: number, h: number) => q.split(',').some((part) => {
  const conds = [...part.matchAll(/\((max|min)-(width|height):\s*(\d+)px\)/g)];
  return conds.length > 0 && conds.every(([, mm, dim, v]) => mm === 'max' ? (dim === 'width' ? w : h) <= +v : (dim === 'width' ? w : h) >= +v);
});
function mount(menu: string, w: number, h: number) {
  const style = document.createElement('style');
  const rules: string[] = [];
  css.walkRules((r) => {
    if (!/(?:\.world|\.top-tabs|\.dealer|\.freight|\.furn)/.test(r.selector)) return;
    let p = r.parent;
    while (p && p.type !== 'root') {
      if (p.type === 'atrule') {
        const a = p as AtRule;
        if (a.name !== 'media' || !mediaOk(a.params, w, h)) return;
      }
      p = p.parent;
    }
    rules.push(r.toString());
  });
  style.textContent = rules.join('\n'); document.head.append(style);
  document.body.innerHTML = `<div id="root"><nav class="top-tabs"><button>Games</button><div class="top-more-menu">More</div><button>Wallet</button><button>Chat</button></nav><div class="app-panels"></div><div class="world"><div class="world-corner">Map navigation</div><div class="world-clock">Clock</div><button class="wev-mapbar">Trade Week</button>${menu}</div></div>`;
  return { nav: document.querySelector<HTMLElement>('.top-tabs')!, world: document.querySelector<HTMLElement>('.world')! };
}
afterEach(() => { document.body.innerHTML = ''; document.head.querySelectorAll('style').forEach((x) => x.remove()); });
const deed = '<div class="world-deed world-deeds"><button class="world-deed-x">✕</button><h3>Real estate</h3><p>intro</p><button>Farm plot</button></div>';
const dealer = '<div class="dealer"><div class="dealer-box"><header><h3>Chud Motors</h3><button>✕</button></header><div class="dealer-body"><section class="dealer-main">Long inventory</section></div></div></div>';
const freight = '<div class="dealer freight"><div class="dealer-box"><header><h3>Logistics</h3><button>✕</button></header><nav class="freight-tabs">Tabs</nav><div class="freight-body">Long stock</div></div></div>';
describe('actual global-bar / world ancestor constraints', () => {
  it('fixtures follow actual App/TopTabs/deed structure rather than a flat z-index comparison', () => {
    const app = read('client/src/App.tsx'); expect(app.indexOf('<TopTabs />')).toBeLessThan(app.indexOf('<WorldMap '));
    expect(read('client/src/components/TopTabs.tsx')).toContain('<nav ref={navRef} className={`top-tabs');
    const wm = read('client/src/components/WorldMap.tsx');
    expect(wm).toContain('className="world-deed world-deeds" data-testid="world-deeds"');
    expect(wm).toMatch(/className="world-deed-x"[^\n]+\n\s*<h3>🏛 Real estate/);
    for (const f of ['Dealership.tsx', 'FreightYard.tsx']) expect(read('client/src/components/' + f)).toMatch(/<header><h3(?:\s[^>]*)?>/);
  });
  for (const [w, h] of [[390, 844], [740, 360]]) for (const [name, markup] of [['deed', deed], ['dealer', dealer], ['logistics', freight]]) it(`${name} ${w}x${h}: site bar suspended, viewport unclipped, navigation restored on close`, () => {
    const { nav, world } = mount(markup as string, w as number, h as number);
    // Still a lower stacking context! Raising only the descendant would not have fixed this.
    expect(+getComputedStyle(world).zIndex).toBeLessThan(+getComputedStyle(nav).zIndex);
    expect(getComputedStyle(nav).visibility).toBe('hidden'); expect(getComputedStyle(nav).pointerEvents).toBe('none');
    expect(getComputedStyle(world).inset).toBe('0px');
    expect(getComputedStyle(document.querySelector('.world-corner')!).visibility).toBe('hidden');
    document.querySelector('.world-deed, .dealer')!.remove();
    expect(getComputedStyle(nav).visibility).not.toBe('hidden');
    expect(getComputedStyle(world).inset).toBe('40px 0 0 0');
    expect(getComputedStyle(document.querySelector('.world-corner')!).visibility).not.toBe('hidden');
  });
  it('Wallet/global dialogs alone do not hide their own navigation ancestor', () => {
    const { nav } = mount('', 390, 844);
    nav.innerHTML += '<div class="wallet-panel" role="dialog"><button>Close wallet</button></div>';
    expect(getComputedStyle(nav).visibility).not.toBe('hidden');
  });
  it('desktop retains top bar, world inset and floating dealer header', () => {
    const { nav, world } = mount(dealer, 1440, 900);
    expect(getComputedStyle(nav).visibility).not.toBe('hidden');
    expect(getComputedStyle(world).inset).toBe('40px 0 0 0');
    expect(getComputedStyle(document.querySelector('.dealer')!).position).toBe('absolute');
    expect(getComputedStyle(document.querySelector('.dealer-box > header')!).position).not.toBe('sticky');
  });
});
describe('persistent title / close and separate content scrolling', () => {
  for (const markup of [deed, '<div class="world-deed"><button class="world-deed-x">✕</button><div class="grocery-front">CHUD FRESH</div><p>Stock</p></div>', '<div class="world-deed"><button class="world-deed-x">✕</button><div class="cityhall-front">CITY HALL</div><p>Projects</p></div>', '<div class="world-deed"><button class="world-deed-x">✕</button><div class="bldg-inv"><h4>Coral inventory</h4><p>Stock</p></div></div>']) it('actual deed/title families pin title while the sheet scrolls', () => {
    mount(markup, 390, 844);
    const sheet = document.querySelector('.world-deed')!;
    const title = sheet.querySelector('h3, .grocery-front, .cityhall-front, .bldg-inv > h4')!;
    const close = sheet.querySelector('.world-deed-x')!;
    expect(getComputedStyle(sheet).overflowY).toBe('auto');
    const t = getComputedStyle(title), x = getComputedStyle(close);
    expect(t.position).toBe('sticky'); expect(t.top).toBe('0px'); expect(t.paddingRight).toBe('56px');
    expect(x.position).toBe('fixed'); expect(x.minHeight).toBe('44px');
    // At large scroll, sticky clamps title's normal y to its top inset; fixed X is not part of scrolled flow.
    for (const scroll of [0, 100, 2000]) expect(Math.max(parseFloat(t.top), 10 - scroll)).toBeGreaterThanOrEqual(0);
  });
  for (const markup of [dealer, freight]) it('shop header is outside the independently scrolling content body', () => {
    mount(markup, 740, 360);
    const header = document.querySelector('.dealer-box > header')!;
    const body = document.querySelector('.dealer-body, .freight-body')!;
    expect(header.contains(body)).toBe(false); expect(body.contains(header)).toBe(false);
    expect(getComputedStyle(header).position).toBe('sticky'); expect(getComputedStyle(header).flexShrink).toBe('0');
    expect(getComputedStyle(body).overflowY).toBe('auto'); expect(getComputedStyle(body).minHeight).toBe('0px');
  });
});
