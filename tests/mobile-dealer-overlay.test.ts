// @vitest-environment jsdom
// All mobile menus (Dayne t1965): map HUD must stay behind open menus, not only the car shop. jsdom has no layout: this resolves the effective CSS per viewport from index.css and checks
// stacking/scroll/close-target rules; it is NOT a visual verification.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule, type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';
const css = postcss.parse(readFileSync(resolve(process.cwd(), 'client/src/index.css'), 'utf8'));
const src = (f: string) => readFileSync(resolve(process.cwd(), `client/src/components/${f}`), 'utf8');
const mediaOk = (q: string, w: number, h: number) => q.split(',').some((part) => {
  const conds = [...part.matchAll(/\((max|min)-(width|height):\s*(\d+)px\)/g)]; if (!conds.length) return false;
  return conds.every(([, mm, dim, v]) => { const x = dim === 'width' ? w : h; return mm === 'max' ? x <= Number(v) : x >= Number(v); });
});
const eff = (sel: string, w: number, h: number) => {
  const out: Record<string, string> = {};
  css.walkRules((r: Rule) => {
    if (!r.selectors.includes(sel)) return;
    const p = r.parent as AtRule | undefined;
    if (p?.type === 'atrule' && (p.name !== 'media' || !mediaOk(p.params, w, h))) return;
    r.walkDecls((d) => { out[d.prop] = d.value + (d.important ? ' !important' : ''); });
  });
  return out;
};
const PHONES: Array<[string, number, number]> = [['360 portrait', 360, 740], ['390 portrait', 390, 844], ['412 portrait', 412, 915], ['740x360 landscape', 740, 360]];
const hud = '.world-modal-open :is(.world-corner, .wev-mapbar, .world-clock)';
const hostedHud = 'body:has(.world-deed, .dealer, .world-casino, .furn-store, .home-int, .inv-backdrop, .sol-panel, [role="dialog"], .chat-drawer) .world :is(.world-corner, .wev-mapbar, .world-clock)';
describe('all mobile map menus', () => {
  for (const [name, w, h] of PHONES) it(name, () => {
    expect(eff('.dealer', w, h)).toMatchObject({ position: 'fixed', inset: '0', 'z-index': '60' });
    expect(eff('.dealer > .dealer-box', w, h)).toMatchObject({ height: '100dvh', 'max-height': '100dvh', transform: 'none !important' });
    expect(eff('.dealer-box > header', w, h)).toMatchObject({ position: 'sticky', 'flex-wrap': 'wrap' });
    expect(eff('.dealer-box > header button', w, h)).toMatchObject({ 'min-width': '44px', 'min-height': '44px' });
    expect(eff('.dealer .dealer-body', w, h)).toMatchObject({ 'overflow-y': 'auto', 'min-height': '0', 'grid-template-columns': 'minmax(0, 1fr)' });
    expect(eff('.dealer .freight-body', w, h)).toMatchObject({ 'flex': '1 1 auto', 'min-height': '0', 'overflow-y': 'auto' });
    expect(eff('.world .world-deed', w, h)).toMatchObject({ position: 'fixed !important', inset: '0 !important', height: '100dvh !important', 'overflow-y': 'auto !important', transform: 'none !important' });
    expect(eff('.world .world-deed', w, h).padding).toContain('env(safe-area-inset-top)');
    expect(eff('.world .world-deed > .world-deed-x', w, h)).toMatchObject({ position: 'fixed', 'min-width': '44px', 'min-height': '44px' });
    for (const selector of [hud, hostedHud]) expect(eff(selector, w, h)).toMatchObject({ visibility: 'hidden', 'pointer-events': 'none' });
    expect(eff('.world .world-casino > div', w, h)['overflow-y']).toBe('auto');
    expect(eff('.furn-store > .furn-box', w, h).height).toBe('100dvh');
  });
  it('desktop keeps existing layout and visible HUD', () => {
    for (const s of [hud, hostedHud, '.world .world-deed', '.dealer > .dealer-box', '.world .world-casino > div']) expect(eff(s, 1440, 900)).toEqual({});
    expect(eff('.dealer', 1440, 900)).toMatchObject({ position: 'absolute', 'z-index': '3' });
    expect(eff('.dealer.fleet', 1440, 900)).toMatchObject({ position: 'fixed', 'z-index': '60' });
  });
  it('all city panel states hide HUD, and closing restores its base class', () => {
    expect(src('WorldMap.tsx')).toContain("className={panel.k !== 'none' ? 'world world-modal-open' : 'world'}");
    expect(src('WorldMap.tsx')).toContain('onClick={() => setPanel(NONE)}');
    expect(src('Dealership.tsx')).toContain('role="dialog" aria-modal="true" aria-labelledby="dealer-title"');
  });
  it('shared shop rules cover actual dealer, mechanic, freight, co-op AND fleet roots', () => {
    for (const [file, cls] of [['Dealership.tsx','dealer'], ['MechanicShop.tsx','dealer'], ['FreightYard.tsx','dealer freight'], ['CoopPanel.tsx','dealer coop'], ['FleetStore.tsx','dealer fleet']] as const) {
      // FleetStore uses a template literal for className, so match class tokens rather than a fixed quoted attr.
      expect(src(file)).toContain(cls);
      document.body.innerHTML = `<div class="world resort"><div class="world-corner"></div><div class="${cls}"><div class="dealer-box"><header><button>X</button></header><div class="dealer-body"></div></div></div></div>`;
      expect(document.querySelector('.dealer > .dealer-box')).not.toBeNull();
      expect(document.querySelector(hostedHud)).not.toBeNull();
      document.querySelector('.dealer')!.remove();
      expect(document.querySelector(hostedHud)).toBeNull();
    }
    document.body.innerHTML = '';
  });
  it('real deed family roots include property, home, farm, fishing, cooking, employment, city hall and Fort menus', () => {
    for (const f of ['FarmGame.tsx','FishingPanel.tsx','CookingPanels.tsx','EmploymentPanel.tsx','CityHallPanel.tsx','FortMcMap.tsx','ResortMap.tsx','WorldMap.tsx']) expect(src(f)).toContain('world-deed');
    for (const cls of ['world-deed', 'world-deed world-farm', 'world-deed world-venue fish-panel', 'world-casino', 'furn-store', 'home-int']) {
      document.body.innerHTML = `<div class="world fortmc"><div class="world-corner"></div><div class="${cls}"></div></div>`;
      expect(document.querySelector(hostedHud)).not.toBeNull();
      document.body.innerHTML = '';
      expect(document.querySelector(hostedHud)).toBeNull();
    }
  });
});
