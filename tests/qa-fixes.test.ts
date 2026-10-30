import { afterEach, describe, expect, it } from 'vitest';
import { canStand, MAP, pickSpawn, SPAWNS, spawnClear } from '../shared/fps';
import { edgeAt, TOP_BAR } from '../shared/windowPos';
import { addQaBots, resetArena } from '../server/fps';

describe('arena spawns', () => {
  it('never picks a point inside a wall, even with a broken spawn list on a custom map', () => {
    // Bury every listed spawn inside a tall pillar.
    const m = { ...MAP, solids: [...MAP.solids, ...SPAWNS.map(([x, y]) => ({ x0: x - 0.6, y0: y - 0.6, x1: x + 0.6, y1: y + 0.6, z0: 0, z1: 9, mat: 'concrete' as const }))] };
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = pickSpawn([], Math.random, m);
      expect(canStand(x, y, z, m)).toBe(true);
    }
  });
  it('avoids spawning on top of a living player', () => {
    const others = SPAWNS.slice(0, -1).map(([x, y, z]) => ({ x, y, z, alive: true }));
    const [x, y, z] = pickSpawn(others, () => 0.5);
    expect(spawnClear(x, y, others, MAP, z)).toBe(true);
  });
});

describe('window edges', () => {
  const r = { left: 100, top: 100, right: 500, bottom: 400 };
  it('detects every edge and corner', () => {
    expect(edgeAt(499, 250, r)).toBe('e');
    expect(edgeAt(101, 250, r)).toBe('w');
    expect(edgeAt(300, 101, r)).toBe('n');
    expect(edgeAt(300, 399, r)).toBe('s');
    expect(edgeAt(499, 399, r)).toBe('se');
    expect(edgeAt(101, 101, r)).toBe('nw');
    expect(edgeAt(300, 250, r)).toBe('');
    expect(edgeAt(600, 250, r)).toBe('');
  });
  it('uses one top edge for all windows', () => expect(TOP_BAR).toBe(48));
});

describe('arena QA bots', () => {
  afterEach(() => { delete process.env.ARENA_QA_BOTS; resetArena(); });
  it('are off by default', () => expect(addQaBots(3)).toBe(0));
  it('spawn when ARENA_QA_BOTS=1, capped', () => {
    process.env.ARENA_QA_BOTS = '1';
    expect(addQaBots(2)).toBe(2);
    expect(addQaBots(2)).toBe(0);
    expect(addQaBots(99)).toBe(4);
  });
});
