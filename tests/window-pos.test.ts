import { describe, expect, it } from 'vitest';
import { clampOffset, loadOffset, saveOffset } from '../shared/windowPos.js';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('window position helpers', () => {
  const base = { left: 100, top: 50, width: 300, height: 200 };
  it('keeps the panel inside the viewport', () => {
    expect(clampOffset({ dx: 20, dy: 30 }, base, 1000, 800)).toEqual({ dx: 20, dy: 30 });
    expect(clampOffset({ dx: -500, dy: -500 }, base, 1000, 800)).toEqual({ dx: -96, dy: -46 });
    expect(clampOffset({ dx: 5000, dy: 5000 }, base, 1000, 800)).toEqual({ dx: 596, dy: 546 });
  });
  it('re-clamps for a smaller viewport and pins oversized panels to the top-left', () => {
    expect(clampOffset({ dx: 596, dy: 546 }, base, 600, 400)).toEqual({ dx: 196, dy: 146 });
    expect(clampOffset({ dx: 0, dy: 0 }, { ...base, width: 900 }, 600, 400)).toEqual({ dx: -96, dy: 0 });
  });
  it('stores, reloads and clears offsets', () => {
    const s = mem();
    expect(loadOffset('bj', s)).toBeNull();
    saveOffset('bj', { dx: 12, dy: -4 }, s);
    expect(loadOffset('bj', s)).toEqual({ dx: 12, dy: -4 });
    saveOffset('bj', { dx: 0, dy: 0 }, s);
    expect(loadOffset('bj', s)).toBeNull();
    s.setItem('relay-win-x', '{bad');
    expect(loadOffset('x', s)).toBeNull();
  });
});

import { clampSize, contentScale, loadSize, saveSize, MIN_W, MIN_H } from '../shared/windowPos.js';
describe('window size helpers', () => {
  it('clamps to the minimum and the viewport', () => {
    expect(clampSize(10, 10, 1000, 800)).toEqual({ w: MIN_W, h: MIN_H });
    expect(clampSize(5000, 5000, 1000, 800)).toEqual({ w: 992, h: 792 });
    expect(clampSize(640.4, 500.6, 1000, 800)).toEqual({ w: 640, h: 501 });
  });
  it('scales content by the tighter axis, never below 1', () => {
    expect(contentScale(null)).toBe(1);
    expect(contentScale({ w: 840, h: 520, w0: 420, h0: 520 })).toBe(1);
    expect(contentScale({ w: 840, h: 1040, w0: 420, h0: 520 })).toBe(2);
    expect(contentScale({ w: 200, h: 200, w0: 420, h0: 520 })).toBe(1);
  });
  it('stores, reloads and clears sizes and rejects junk', () => {
    const s = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; })();
    saveSize('bj', { w: 600, h: 700, w0: 420, h0: 520 }, s);
    expect(loadSize('bj', s)).toEqual({ w: 600, h: 700, w0: 420, h0: 520 });
    saveSize('bj', null, s);
    expect(loadSize('bj', s)).toBeNull();
    s.setItem('relay-win-size-x', '{"w":-1,"h":2,"w0":1,"h0":1}');
    expect(loadSize('x', s)).toBeNull();
  });
});
