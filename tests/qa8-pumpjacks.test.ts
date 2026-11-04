import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../client/src/lib/fortmc3d.ts', import.meta.url), 'utf8');
const num = (re: RegExp) => Number(re.exec(src)![1]);
describe('QA#8 pumpjack vs flowline scale', () => {
  it('jacks are scaled up, flowlines are thin, and two scaled jacks fit side by side on a 30-wide pad', () => {
    const k = num(/JACK_SCALE = ([\d.]+)/); expect(k).toBeGreaterThanOrEqual(1.4);
    const [r0, r1] = /FLOW_R = \[([\d.]+), ([\d.]+)\]/.exec(src)!.slice(1).map(Number); expect(r0).toBeLessThan(0.35 / 2); expect(r1).toBeLessThan(0.55 / 2);
    // jack footprint along x: counterweight back edge -5.55 .. rod +4.45 (unscaled); columns at -6.5 and +8.1
    const L = (x: number) => [x - 5.55 * k, x + 4.45 * k]; const a = L(-6.5), b = L(8.1);
    expect(a[0]).toBeGreaterThan(-15); expect(b[1]).toBeLessThan(15); expect(b[0] - a[1]).toBeGreaterThan(0);
    expect(src).toMatch(/g\.scale\.setScalar\(JACK_SCALE\)/); expect(src).toMatch(/pumpjack\(g, -6\.5 \+ \(i % 2\) \* 14\.6,/);
  });
});
