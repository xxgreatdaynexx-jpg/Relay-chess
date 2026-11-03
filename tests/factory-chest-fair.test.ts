import { describe, expect, it } from 'vitest';
import { advance, fairOrder, newState, TICK_MS, type Storage } from '../shared/factory';

// r21: with a scarce stack (one item banked at a time) the first Input Chest in build order took every item.
const store = (m: Record<string, number>): Storage => ({ get: (k) => m[k] ?? 0, add: (k, d) => { m[k] = (m[k] ?? 0) + d; } });
function rig(n: number, f: string) {
  const s = newState(3, 0); let id = 0;
  for (let i = 0; i < n; i++) { s.ents.push({ id: ++id, k: 'chest_in', x: 0, y: i * 2, d: 0, f } as any); s.ents.push({ id: ++id, k: 'belt', x: 1, y: i * 2, d: 0 } as any); }
  s.seq = id; return s;
}
// One item trickles in per tick; whatever a chest put on its belt is taken away (consumed) and credited to it.
function run(n: number, ticks: number, key: string, f = key) {
  const s = rig(n, f); const m: Record<string, number> = {}; const st = store(m); const got = Array(n).fill(0); const first: number[] = [];
  let t = 0;
  for (let k = 0; k < ticks; k++) {
    m[key] = (m[key] ?? 0) + 1; t += TICK_MS; advance(s, st, t);
    s.ents.filter((e) => e.k === 'belt').forEach((b, i) => { if (b.it) { got[i]++; if (first.length < 2 * n) first.push(i); b.it = null; } });
  }
  return { got, first, m };
}
describe('input chests share inbound items fairly', () => {
  it('scarce iron is spread evenly across 3 chests (not all to the first)', () => {
    const { got } = run(3, 300, 'ore:iron');
    expect(got.reduce((a, b) => a + b, 0)).toBeGreaterThan(250);
    expect(Math.max(...got) - Math.min(...got)).toBeLessThanOrEqual(1);
  });
  it('the winning chest rotates (no chest always goes first)', () => {
    const { first } = run(3, 60, 'ore:iron');
    expect(new Set(first.slice(0, 3)).size).toBe(3);
    expect(first.slice(0, 3)).toEqual(first.slice(3, 6));
  });
  it('pantry-crop fallback still feeds, and fairly', () => {
    const { got, m } = run(2, 200, 'food:sunflower', 'good:crop_sunflower');
    expect(m['food:sunflower'] ?? 0).toBeLessThanOrEqual(1);
    expect(Math.abs(got[0] - got[1])).toBeLessThanOrEqual(1); expect(got[0]).toBeGreaterThan(80);
  });
  it('fairOrder: least-filled first, ties round-robin from a rotating start', () => {
    const L = ['a', 'b', 'c'], z = () => 0;
    expect(fairOrder(L, z, 0)).toEqual(['a', 'b', 'c']); expect(fairOrder(L, z, 1)).toEqual(['b', 'c', 'a']); expect(fairOrder(L, z, 5)).toEqual(['c', 'a', 'b']);
    const fill: Record<string, number> = { a: 2, b: 0, c: 1 };
    expect(fairOrder(L, (x) => fill[x], 7)).toEqual(['b', 'c', 'a']);
  });
});
