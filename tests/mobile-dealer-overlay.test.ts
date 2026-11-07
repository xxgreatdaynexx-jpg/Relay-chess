// Mobile only (Dayne 2026-11-07 t1963/t1964): the map HUD (nav row, Trade Week bar) covered the car dealership's list,
// title and close X on phones. jsdom has no layout: this resolves the effective CSS per viewport from index.css and checks
// stacking/scroll/close-target rules; it is NOT a visual verification.
import { readFileSync } from 'node:fs';
import postcss, { type Rule, type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';
const css = postcss.parse(readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8'));
const src = (f: string) => readFileSync(new URL(`../client/src/components/${f}`, import.meta.url), 'utf8');
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
describe('mobile dealership overlay sits above the map HUD', () => {
  for (const [name, w, h] of PHONES) it(name, () => {
    const d = eff('.dealer:not(.fleet)', w, h);
    expect(d.position).toBe('fixed'); expect(d.inset).toBe('0');
    const hud = Math.max(Number(eff('.world-corner', w, h)['z-index']), Number(eff('.wev-mapbar', w, h)['z-index']), Number(eff('.world-clock', w, h)['z-index']));
    expect(Number(d['z-index'])).toBeGreaterThan(hud);
    const box = eff('.dealer:not(.fleet) > .dealer-box', w, h);
    expect(box['max-height']).toBe('100dvh'); expect(box.transform).toBe('none !important'); // a stale drag offset cannot push the header off-screen
    const head = eff('.dealer:not(.fleet) .dealer-box header', w, h); expect(head.position).toBe('sticky'); expect(head.top).toBe('0');
    const x = eff('.dealer:not(.fleet) .dealer-box header button', w, h); expect(x['min-width']).toBe('44px'); expect(x['min-height']).toBe('44px');
    const body = eff('.dealer:not(.fleet) .dealer-body', w, h); expect(body['overflow-y']).toBe('auto'); expect(body['min-height']).toBe('0');
    for (const s of ['.world-modal-open .world-corner', '.world-modal-open .wev-mapbar', '.world-modal-open .world-clock']) {
      expect(eff(s, w, h).visibility).toBe('hidden'); expect(eff(s, w, h)['pointer-events']).toBe('none');
    }
  });
  it('desktop keeps the original dealership and HUD rules', () => {
    for (const s of ['.dealer:not(.fleet)', '.dealer:not(.fleet) > .dealer-box', '.dealer:not(.fleet) .dealer-box header', '.world-modal-open .world-corner', '.world-modal-open .wev-mapbar'])
      expect(eff(s, 1440, 900)).toEqual({});
    expect(eff('.dealer', 1440, 900)).toMatchObject({ position: 'absolute', 'z-index': '3' });
  });
  it('the modal flag only exists while the dealership is open; dialog is labelled', () => {
    expect(src('WorldMap.tsx')).toContain("className={dealer ? 'world world-modal-open' : 'world'}");
    const d = src('Dealership.tsx'); expect(d).toContain('role="dialog" aria-modal="true" aria-labelledby="dealer-title"'); expect(d).toContain('<h3 id="dealer-title">');
    expect(d).toContain('aria-label="Close" data-testid="dealer-close"');
  });
});
