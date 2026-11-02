import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('client/src/lib/arenaGuns.ts', 'utf8');
describe('AR-15 red dot', () => {
  it('has a sight point for ADS alignment and no solid body or lens blocking the window', () => {
    const ar = src.slice(src.indexOf('ar15: (b)'), src.indexOf('sniper: (b)'));
    expect(ar).toMatch(/sight: \[0, 0\.101, -0\.02\]/);
    expect(ar).not.toMatch(/red-dot body/);
    expect(ar).not.toMatch(/'glass'/);
  });
});
