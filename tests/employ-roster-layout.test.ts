import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8');

describe('Employment Office roster stays visible', () => {
  it('gives hire and the worker list equal share, a usable minimum height, and their own scroll', () => {
    expect(css).toMatch(/\.employ-roster \{[^}]*flex: 1 1 50%;[^}]*min-height: 160px;[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.employ-hire \{[^}]*flex: 1 1 50%;[^}]*min-height: 220px;[^}]*max-height: none;[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.hub-win\.sol-panel\.employ-panel[^}]*height: min\(90dvh, calc\(100dvh - 60px\)\)/);
    expect(css).toMatch(/\.win-sized\.employ-panel > :not\(\.sol-bar\):not\(\.win-grip\) \{ zoom: 1; \}/);
    expect(css).toMatch(/\.world-deed\.employ-panel \{[^}]*overflow: hidden/);
  });

  it('on a phone-sized sheet, both lists flow in the window scroller instead of nesting', () => {
    const i = css.indexOf('@media (max-width: 640px), (max-height: 500px)');
    expect(i).toBeGreaterThan(-1);
    const mq = css.slice(i, i + 1200);
    expect(mq).toMatch(/\.employ-roster \{ flex: none; overflow: visible; min-height: 0; \}/);
    expect(mq).toMatch(/\.employ-hire \{ flex: none; min-height: 0; max-height: none; overflow: visible; \}/);
  });
});
