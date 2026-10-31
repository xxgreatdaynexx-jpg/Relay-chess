import { describe, expect, it } from 'vitest';
import { gridMap } from '../shared/fps';
import { TagVisibility, tagVisible, TAG_FADE_MS } from '../client/src/lib/arenaTags';
const M = gridMap(['#########', '#...#...#', '#.......#', '#########']);
describe('arena health bars respect walls', () => {
  it('hidden behind a wall, shown in the open', () => {
    expect(tagVisible({ x: 2, y: 1.5, z: 1.6 }, { x: 6, y: 1.5, z: 0 }, M)).toBe(false);
    expect(tagVisible({ x: 2, y: 2.5, z: 1.6 }, { x: 6, y: 2.5, z: 0 }, M)).toBe(true);
  });
  it('throttles checks and fades', () => {
    const v = new TagVisibility(); let calls = 0; let vis = true;
    const c = () => { calls++; return vis; };
    expect(v.alpha('b', 0, c)).toBe(1);
    v.alpha('b', 50, c); expect(calls).toBe(1);
    vis = false; v.alpha('b', 100, c); expect(calls).toBe(2);
    expect(v.alpha('b', 100 + TAG_FADE_MS, c)).toBe(0);
  });
});
