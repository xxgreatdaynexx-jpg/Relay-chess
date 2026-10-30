import { describe, expect, it } from 'vitest';
import { becameYourTurn, shouldTimeAlarm } from '../shared/alerts';

const base = { mySide: 'white' as const, active: 'white' as const, running: true, remainingMs: 9_900, ply: 4, alarmedPly: null };

describe('10-second alarm', () => {
  it('rings for the side to move at 10 s', () => {
    expect(shouldTimeAlarm(base)).toBe(true);
    expect(shouldTimeAlarm({ ...base, remainingMs: 10_000 })).toBe(true);
  });
  it('stays quiet above 10 s, after flag, or when paused', () => {
    expect(shouldTimeAlarm({ ...base, remainingMs: 10_001 })).toBe(false);
    expect(shouldTimeAlarm({ ...base, remainingMs: 0 })).toBe(false);
    expect(shouldTimeAlarm({ ...base, running: false })).toBe(false);
  });
  it('only rings for that side, once per ply', () => {
    expect(shouldTimeAlarm({ ...base, mySide: 'black' })).toBe(false);
    expect(shouldTimeAlarm({ ...base, mySide: null })).toBe(false);
    expect(shouldTimeAlarm({ ...base, alarmedPly: 4 })).toBe(false);
    expect(shouldTimeAlarm({ ...base, alarmedPly: 2 })).toBe(true);
  });
});

describe('your-turn ping', () => {
  it('fires only on the transition into your move', () => {
    expect(becameYourTurn(null, true)).toBe(false);
    expect(becameYourTurn(false, true)).toBe(true);
    expect(becameYourTurn(true, true)).toBe(false);
    expect(becameYourTurn(false, false)).toBe(false);
  });
});
