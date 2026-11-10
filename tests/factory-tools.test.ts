import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { FactoryWorld, resetFactory } from '../server/factory';
import { resetMines } from '../server/mines';
import { getBank, resetBank } from '../server/casino-store';
import { clipKitMissing, clipToPlaceItems, entsToClip } from '../shared/factoryClipboard';
import type { Ent } from '../shared/factory';

const rich = (n: string, chips: number) => getBank().transfer(n, chips - getBank().account(n).chips, { game: 'test' });
beforeEach(() => { resetBank(); resetMines(); resetFactory(); });
afterEach(() => { vi.useRealTimers(); });

describe('factory clipboard', () => {
  it('anchors relative offsets and builds place payloads', () => {
    const ents = [
      { id: 1, k: 'belt' as const, x: 5, y: 7, d: 0 as const },
      { id: 2, k: 'belt' as const, x: 6, y: 7, d: 0 as const },
      { id: 3, k: 'smelter' as const, x: 7, y: 7, d: 1 as const, r: 's_iron' },
    ] as Ent[];
    const clip = entsToClip(ents);
    expect(clip.items.map((i) => [i.k, i.ox, i.oy, i.d, i.r])).toEqual([
      ['belt', 0, 0, 0, undefined],
      ['belt', 1, 0, 0, undefined],
      ['smelter', 2, 0, 1, 's_iron'],
    ]);
    expect(clipToPlaceItems(clip, 10, 2)).toEqual([
      { k: 'belt', x: 10, y: 2, d: 0 },
      { k: 'belt', x: 11, y: 2, d: 0 },
      { k: 'smelter', x: 12, y: 2, d: 1, r: 's_iron' },
    ]);
    expect(clipKitMissing(clip, { belt: 1, smelter: 1 })).toMatch(/belt/i);
    expect(clipKitMissing(clip, { belt: 2, smelter: 1 })).toBeNull();
  });
});

describe('factory moveMany', () => {
  it('slides a group without kit changes and rejects blocked targets', () => {
    const f = resetFactory(); const A = 'QA-Tools'; rich(A, 50_000);
    f.expand(A, 0);
    f.buy(A, 'belt', 4, 0);
    f.place(A, [{ k: 'belt', x: 1, y: 1, d: 0 }, { k: 'belt', x: 2, y: 1, d: 0 }], 0);
    const s0 = f.get(A, 0)!;
    const ids = s0.ents.filter((e) => e.k === 'belt').map((e) => e.id);
    const kitBefore = s0.kit.belt;
    f.moveMany(A, { ids, dx: 2, dy: 1 }, 0);
    const s1 = f.get(A, 0)!;
    expect(s1.ents.filter((e) => e.k === 'belt').map((e) => [e.x, e.y]).sort()).toEqual([[3, 2], [4, 2]]);
    expect(s1.kit.belt).toBe(kitBefore);
    f.place(A, [{ k: 'belt', x: 0, y: 0, d: 0 }], 0);
    expect(() => f.moveMany(A, { ids, dx: -3, dy: -2 }, 0)).toThrow();
  });
});
