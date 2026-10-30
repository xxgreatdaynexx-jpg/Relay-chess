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
