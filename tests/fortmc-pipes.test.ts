import { describe, it, expect } from 'vitest';
import { pipeRoute, PLANT_INLET, PAD_W, PAD_D } from '../shared/fortmcPipes';
import { tractInfo, TRACTS } from '../shared/fortmc';

describe('Fort McChud pipeline routing (visual)', () => {
  it('every segment is axis-aligned (90° corners only)', () => {
    for (let n = 1; n <= TRACTS; n++) { const r = pipeRoute(n); for (let i = 1; i < r.length; i++) { const [a, b] = [r[i - 1]!, r[i]!]; expect(a[0] === b[0] || a[1] === b[1]).toBe(true); } }
  });
  it('connections are unchanged: tract n still feeds the plant inlet, starting on its own pad', () => {
    for (let n = 1; n <= TRACTS; n++) { const t = tractInfo(n), r = pipeRoute(n), s = r[0]!, e = r[r.length - 1]!;
      expect(Math.abs(s[0] - t.x) <= PAD_W / 2 && Math.abs(s[1] - t.z) <= PAD_D / 2).toBe(true);
      expect(Math.hypot(e[0] - PLANT_INLET.x, e[1] - PLANT_INLET.z)).toBeLessThan(6); }
  });
  it('no line crosses another tract pad', () => {
    for (let n = 1; n <= TRACTS; n++) { const r = pipeRoute(n); for (let i = 1; i < r.length; i++) for (let k = 0; k <= 20; k++) { const x = r[i - 1]![0] + (r[i]![0] - r[i - 1]![0]) * k / 20, z = r[i - 1]![1] + (r[i]![1] - r[i - 1]![1]) * k / 20;
      for (let m = 1; m <= TRACTS; m++) if (m !== n) { const t = tractInfo(m); expect(Math.abs(x - t.x) < PAD_W / 2 && Math.abs(z - t.z) < PAD_D / 2).toBe(false); } } }
  });
});
