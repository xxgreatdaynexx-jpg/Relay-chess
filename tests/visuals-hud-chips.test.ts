import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8');
describe('HUD chips (mobile)', () => {
  it('world corner chips wrap so Co-op and the 2D map stay on screen', () => {
    expect(css).toMatch(/\.world-corner \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.world-corner button \{[^}]*white-space: nowrap/);
  });
  it('clock sits below two wrapped chip rows', () => {
    expect(css).toMatch(/\.world-clock \{ top: 148px/);
  });
  it('top bar still fades at the edge', () => {
    expect(css).toMatch(/\.top-tabs \{[^}]*mask-image/);
  });
});
