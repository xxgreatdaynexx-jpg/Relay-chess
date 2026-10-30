import { describe, expect, it } from 'vitest';
import { RED, WHEEL } from '../shared/casino';

describe('roulette colours', () => {
  it('uses the standard European red set', () => {
    expect([...RED].sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  });
  it('wheel pockets alternate red/black after the single green 0', () => {
    expect(WHEEL[0]).toBe(0);
    expect(new Set(WHEEL).size).toBe(37);
    WHEEL.slice(1).forEach((n, i) => expect(RED.has(n)).toBe(i % 2 === 0));
  });
});
