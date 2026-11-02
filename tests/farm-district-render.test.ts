import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client/src/lib/world3d.ts', import.meta.url), 'utf8');
const farm = src.slice(src.indexOf('const crops = (() => {'), src.indexOf('// crops: one instance per tile'));

describe('farm district fields render solid (bug 12:28 AM)', () => {
  it('the grass apron has no negative polygonOffset and sits below y=0', () => {
    const apronLine = farm.split('\n').find((l) => l.includes('const apron ='))!;
    expect(apronLine).not.toMatch(/polygonOffset/);
    expect(farm).toMatch(/apron\.position\.set\([^,]+, -1\.5 - 0\.02,/);
  });
  it('soil fill exists per plot and furrows sit above the soil top (0.14)', () => {
    expect(farm).toMatch(/const soil = new THREE\.InstancedMesh\(unitBox,.*plots\.length\)/);
    const m = farm.match(/d\.position\.set\(p\.x, ([\d.]+), p\.z - \(p\.rows \* TILE\)/)!;
    expect(Number(m[1]) - 0.015).toBeGreaterThan(0.14);
  });
});
