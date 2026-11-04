import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../client/src/lib/fortmc3d.ts', import.meta.url), 'utf8');
describe('QA#13 refinery realism', () => {
  it('pipe rack clears a truck, tanks sit in bunds, columns get platforms + ladders', () => {
    expect(Number(/RACK_H = ([\d.]+)/.exec(src)![1])).toBeGreaterThanOrEqual(6);
    expect(src.match(/bund\((g|unitsG), /g)?.length).toBeGreaterThanOrEqual(2);
    expect(src.match(/towerAccess\((g|parent), /g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/userData\.part = 'ladder'/); expect(src).toMatch(/userData\.part = 'platform'/);
    expect(src.indexOf('const bund =')).toBeLessThan(src.indexOf("s.id === 'f-plant'"));
  });
});
