import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { labelWidthFor } from '../client/src/lib/labelSprite';

const measure = (t: string, f: string) => t.length * (f.startsWith('800') ? 34 : 18); // deterministic stand-in for canvas measureText
describe('map labels (mu-visuals label audit)', () => {
  it('pill width always covers the measured title and subtitle', () => {
    for (const [t, s] of [['⚓ Chud Hub Harbour · cargo every 2h', undefined], ['🛢️ Upgrader & Refinery', 'Build · run · repair'], ['A', 'a very long subtitle line that is longer than the title'], ['Short', undefined]] as const) {
      const w = labelWidthFor(t, s, undefined, measure); expect(w).toBeGreaterThanOrEqual(measure(t, '800') + 42); if (s) expect(w).toBeGreaterThanOrEqual(measure(s, '600') + 42); expect(w).toBeGreaterThanOrEqual(512); }
  });
  it('no map label code truncates text with slice/ellipsis', () => {
    for (const f of ['world3d', 'fortmc3d', 'resort3d', 'worldFreight', 'mines3d', 'labelSprite', 'worldDrive', 'fishing3d']) { const src = readFileSync(`client/src/lib/${f}.ts`, 'utf8');
      expect(src).not.toMatch(/fillText\([^)]*\.slice\(/); expect(src).not.toMatch(/name\.slice\(0, \d+\) \+ '…'/); }
  });
  it('resort, Fort McChud, ports and mines use the Chud City label renderer', () => {
    for (const f of ['fortmc3d', 'resort3d', 'worldFreight', 'mines3d', 'world3d']) expect(readFileSync(`client/src/lib/${f}.ts`, 'utf8')).toMatch(/cityLabel\(/);
  });
});
