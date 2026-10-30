import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/index.css', 'utf8');
const home = readFileSync('client/src/components/HomeScreen.tsx', 'utf8');
const intro = readFileSync('client/src/components/ScrollIntro.tsx', 'utf8');

describe('home page keeps scrolling', () => {
  it('never locks or snaps page scrolling', () => {
    expect(css).not.toMatch(/scroll-snap-type/);
    expect(css).not.toMatch(/(^|[\s,}])(html|body)\s*\{[^}]*overflow(-y)?\s*:\s*hidden/);
    expect(intro + home).not.toMatch(/preventDefault\(\)[^\n]*wheel|addEventListener\('wheel'/);
  });
  it('play area fills a screen and the page ends on a footer', () => {
    expect(css).toMatch(/\.home-play\s*\{[^}]*min-height:\s*100dvh/);
    expect(home).toMatch(/data-testid="home-footer"/);
  });
  it('intro dots hide once the intro is scrolled past', () => {
    expect(intro).toMatch(/si-dots-off/);
    expect(css).toMatch(/\.si-dots\.si-dots-off/);
  });
});
