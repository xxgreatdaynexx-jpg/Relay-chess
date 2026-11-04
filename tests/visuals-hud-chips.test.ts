import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8');
describe('HUD chip truncation (mobile)', () => {
  const block = css.slice(css.indexOf('visuals HUD audit'));
  it('world corner chips stay one line and scroll', () => {
    expect(block).toMatch(/\.world-corner button \{[^}]*white-space: nowrap/);
    expect(block).toMatch(/\.world-corner \{[^}]*overflow-x: auto/);
  });
  it('clock sits below the chip row', () => { expect(block).toMatch(/\.world-clock \{ top: 84px/); });
  it('top bar fades at the edge', () => { expect(block).toMatch(/\.top-tabs \{[^}]*mask-image/); });
});
