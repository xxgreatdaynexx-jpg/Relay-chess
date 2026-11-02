import { beforeEach, describe, expect, it } from 'vitest';
import { resetMines } from '../server/mines';
import { resetFactory } from '../server/factory';
import { resetBank } from '../server/casino-store';
import { gridOf, isSplitWeights, newState, splitSeq, splitWeights, step, type FState, type Storage } from '../shared/factory';

const mem = (): Storage => { const m: Record<string, number> = {}; return { get: (k) => m[k] ?? 0, add: (k, d) => { m[k] = (m[k] ?? 0) + d; } }; };
/** splitter at (2,2) facing E, fed one item per tick; output belts N (left), E (ahead), S (right) emptied each tick. */
function run(w: [number, number, number] | undefined, n: number, block?: number) {
  const s: FState = newState(3, 0);
  s.ents.push({ id: 1, k: 'splitter', x: 2, y: 2, d: 0, ...(w ? { w } : {}) });
  s.ents.push({ id: 2, k: 'belt', x: 2, y: 1, d: 3 }, { id: 3, k: 'belt', x: 3, y: 2, d: 0 }, { id: 4, k: 'belt', x: 2, y: 3, d: 1 });
  s.seq = 4; const g = gridOf(s); const st = mem(); const out: number[] = [];
  const sp = s.ents[0]; const outs = s.ents.slice(1);
  for (let i = 0; i < n; i++) {
    sp.it = 'ore:iron'; if (block !== undefined) outs[block].it = 'ore:coal';
    step(s, g, st);
    outs.forEach((b, j) => { if (b.it === 'ore:iron') { out.push(j); b.it = null; } });
  }
  return { out, s };
}
const count = (o: number[]) => [0, 1, 2].map((j) => o.filter((x) => x === j).length);

describe('splitter ratios (pt1301u)', () => {
  it('default is the old 1:1:1 round robin', () => {
    expect(splitSeq([1, 1, 1])).toEqual([0, 1, 2]);
    expect(run(undefined, 6).out).toEqual([0, 1, 2, 0, 1, 2]);
    expect(splitWeights({})).toEqual([1, 1, 1]);
  });
  it('weighted, deterministic and smooth', () => {
    expect(count(run([2, 0, 1], 30).out)).toEqual([20, 0, 10]);
    expect(count(run([3, 0, 1], 40).out)).toEqual([30, 0, 10]);
    expect(count(run([1, 2, 1], 40).out)).toEqual([10, 20, 10]);
    expect(splitSeq([2, 0, 1])).toEqual([0, 2, 0]);
    expect(run([5, 3, 1], 27).out).toEqual(run([5, 3, 1], 27).out);
  });
  it('0 weight shuts an output; a blocked output falls through without jamming', () => {
    expect(count(run([1, 0, 0], 5).out)).toEqual([5, 0, 0]);
    const r = run([2, 0, 1], 9, 0); expect(count(r.out)).toEqual([0, 0, 9]);
  });
  it('validates weights', () => {
    expect(isSplitWeights([0, 0, 0])).toBe(false); expect(isSplitWeights([10, 1, 1])).toBe(false);
    expect(isSplitWeights([1.5, 1, 1])).toBe(false); expect(isSplitWeights([0, 9, 0])).toBe(true);
  });
});

describe('fac_edit ratio', () => {
  beforeEach(() => { resetBank(); resetMines(); });
  it('only splitters, persisted on the entity, 1:1:1 clears it', () => {
    const f = resetFactory() as any;
    const s: FState = newState(3, 0); s.ents.push({ id: 1, k: 'splitter', x: 0, y: 0, d: 0 }, { id: 2, k: 'belt', x: 1, y: 0, d: 0 }); s.seq = 2;
    f.need = () => ({ s }); f.storage = () => mem(); f.markNow = () => {};
    f.edit('Dayne', { id: 1, w: [2, 0, 1] }, 0); expect(s.ents[0].w).toEqual([2, 0, 1]);
    expect(JSON.parse(JSON.stringify(s)).ents[0].w).toEqual([2, 0, 1]);
    expect(() => f.edit('Dayne', { id: 1, w: [0, 0, 0] }, 0)).toThrow(); expect(() => f.edit('Dayne', { id: 2, w: [2, 0, 1] }, 0)).toThrow();
    f.edit('Dayne', { id: 1, w: [1, 1, 1] }, 0); expect(s.ents[0].w).toBeUndefined();
  });
});
