import { describe, it, expect } from 'vitest';
import { LAUNCH_AT, fmtCountdown, mapCountdownLabel } from '../shared/launchCountdown';

describe('Millionaire Update countdown', () => {
  it('launches Nov 6 8:00 PM CST', () => { expect(new Date(LAUNCH_AT).toISOString()).toBe('2026-11-07T02:00:00.000Z'); });
  it('formats Xd Xh Xm Xs', () => {
    expect(fmtCountdown(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000)).toBe('2d 3h 4m 5s');
    expect(fmtCountdown(1)).toBe('0d 0h 0m 1s');
    expect(fmtCountdown(59_999)).toBe('0d 0h 1m 0s');
    expect(mapCountdownLabel(LAUNCH_AT - 61_000)).toBe('Millionaire Update: 0d 0h 1m 1s');
  });
  it('switches to soon at or after zero', () => {
    expect(fmtCountdown(0)).toBeNull(); expect(fmtCountdown(-5000)).toBeNull(); expect(fmtCountdown(NaN)).toBeNull();
    expect(mapCountdownLabel(LAUNCH_AT)).toBe('Millionaire Update: soon');
    expect(mapCountdownLabel(LAUNCH_AT + 3_600_000)).toBe('Millionaire Update: soon');
  });
});
