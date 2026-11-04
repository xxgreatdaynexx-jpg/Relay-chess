import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// fortmc3d needs a WebGL renderer, so this guards the turbine package recipe at source level.
const src = readFileSync(new URL('../client/src/lib/fortmc3d.ts', import.meta.url), 'utf8');
describe('QA#7 gas-turbine packages', () => {
  it('uses light matte paint, an intake filter house, a 9-tall stack and a lit lamp', () => {
    const c = parseInt(/tPkg = mat\(\{ color: 0x([0-9a-f]{2})/.exec(src)![1]!, 16); expect(c).toBeGreaterThan(0xb0);
    expect(src).toMatch(/tIntake = mat/); expect(src).toMatch(/cyl\(0\.75, 9, tPkg/); expect(src).toMatch(/navRed, x \+ 0\.8, 11\.4/);
    expect(src).not.toMatch(/box\(4, 3\.4, 7, steel/);
  });
});
