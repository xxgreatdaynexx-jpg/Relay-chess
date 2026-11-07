// Mobile usability (Dayne 2026-11-07 07:36 UTC-6): the weekly event bar covered the phone nav row (Real estate / My home /
// My farm / Drive...). jsdom has no layout, so this resolves the effective CSS for a viewport from index.css (cascade order,
// media queries) and checks the HUD bands do not overlap at 360-456 px portrait and short landscape.
import { readFileSync } from 'node:fs';
import postcss, { type Rule, type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';
const css = postcss.parse(readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8'));
const mediaOk = (q: string, w: number, h: number) => q.split(',').some((part) => {
  const conds = [...part.matchAll(/\((max|min)-(width|height):\s*(\d+)px\)/g)]; if (!conds.length) return false;
  return conds.every(([, mm, dim, v]) => { const x = dim === 'width' ? w : h; return mm === 'max' ? x <= Number(v) : x >= Number(v); });
});
/** Effective declarations for an exact selector at a viewport (later rules win; specificity equal for these selectors). */
const eff = (sel: string, w: number, h: number) => {
  const out: Record<string, string> = {};
  css.walkRules((r: Rule) => {
    if (!r.selectors.includes(sel)) return;
    const p = r.parent as AtRule | undefined;
    if (p?.type === 'atrule' && (p.name !== 'media' || !mediaOk(p.params, w, h))) return;
    r.walkDecls((d) => { out[d.prop] = d.value; });
  });
  return out;
};
const px = (v: string | undefined) => Number(String(v).replace('px', ''));
const VIEWS: Array<[string, number, number]> = [['360 portrait', 360, 740], ['390 portrait', 390, 844], ['412 portrait', 412, 915], ['456 portrait', 456, 1000], ['740x360 landscape', 740, 360], ['915x412 landscape', 915, 412]];
describe('phone HUD: nav row, clock and weekly bar never overlap', () => {
  for (const [name, w, h] of VIEWS) it(name, () => {
    const nav = eff('.world-corner', w, h), btn = eff('.world-corner button', w, h), clock = eff('.world-clock', w, h), wev = eff('.wev-mapbar', w, h);
    expect(px(nav.top)).toBe(46); expect(nav['overflow-x']).toBe('auto'); // one scrollable row, not clipped
    expect(px(btn['min-height'])).toBeGreaterThanOrEqual(44); // recommended touch target
    const navBottom = px(nav.top) + px(btn['min-height']);
    expect(px(clock.top)).toBeGreaterThanOrEqual(navBottom + 4); // clock below the nav row
    expect(px(wev.top)).toBeGreaterThanOrEqual(px(clock.top) + 28); // weekly bar below the clock (~26px tall)
    expect(wev.transform).toBe('none'); expect(wev['max-width']).toBe('calc(100% - 20px)'); // fits the width
    expect(clock['white-space']).toBe('nowrap'); expect(wev['white-space']).toBe('nowrap'); // single-line bands (the height assumptions below)
    expect(px(eff('.world-grid', w, h)['padding-top'])).toBeGreaterThanOrEqual(px(wev.top) + 28); // 2D tiles not under the HUD
    expect(Number(wev['z-index'])).toBeLessThan(Number(eff('.world-corner', w, h)['z-index'] ?? 5)); // nav stays tappable
  });
  it('desktop keeps its original layout', () => {
    const wev = eff('.wev-mapbar', 1440, 900); expect(wev.top).toBe('56px'); expect(wev.transform).toBe('translateX(-50%)');
    expect(eff('.world-corner', 1440, 900).top).toBe('12px'); expect(eff('.world-grid', 1440, 900)['padding-top']).toBeUndefined();
  });
  it('backpack inventory fits the visible viewport and its close button stays reachable on phones', () => {
    const win = eff('.inv-win[aria-label="Inventory"]', 390, 700); expect(win.height).toContain('dvh'); expect(win['max-height']).toBe('calc(100dvh - 16px)');
    expect(eff('.inv-win[aria-label="Inventory"] .inv-head', 390, 700)['flex-wrap']).toBe('wrap');
    expect(eff('.inv-win[aria-label="Inventory"] .inv-head > button[aria-label="Close inventory"]', 390, 700)['margin-left']).toBe('auto');
    expect(eff('.res-win', 390, 700).height).toBe('100dvh'); // other inventory windows untouched
  });
});
