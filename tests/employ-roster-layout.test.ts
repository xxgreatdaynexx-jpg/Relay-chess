import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8');

describe('Employment Office roster stays visible', () => {
  it('gives the hired-worker list a minimum height and lets the hire list shrink and scroll', () => {
    expect(css).toMatch(/\.employ-roster \{[^}]*min-height: min\(40vh, 240px\);[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.employ-hire \{[^}]*flex: 0 1 auto;[^}]*max-height: 45%;[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.world-deed\.employ-panel \{[^}]*overflow: hidden/);
  });

  it('on a phone-sized sheet, both lists flow in the page scroller instead of nesting', () => {
    const i = css.indexOf('@media (max-width: 640px), (max-height: 500px)');
    expect(i).toBeGreaterThan(-1);
    const mq = css.slice(i, i + 800);
    expect(mq).toMatch(/\.employ-roster \{ flex: none; overflow: visible; min-height: 0; \}/);
    expect(mq).toMatch(/\.employ-hire \{ flex: none; max-height: none; overflow: visible; \}/);
  });
});
