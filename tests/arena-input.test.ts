import { describe, expect, it } from 'vitest';
import { fpsFrom, hotkeyFor, isLockedTo, readFpsPref } from '../client/src/lib/arenaInput.js';

describe('arena input state', () => {
  it('locked state follows the real pointerLockElement only', () => {
    const canvas = {};
    expect(isLockedTo(canvas, canvas)).toBe(true);
    expect(isLockedTo(null, canvas)).toBe(false);
    expect(isLockedTo({}, canvas)).toBe(false);
    expect(isLockedTo(null, null)).toBe(false);
  });
  it('maps hotkeys and ignores auto-repeat', () => {
    expect(hotkeyFor('m')).toBe('picker');
    expect(hotkeyFor('M')).toBe('picker');
    expect(hotkeyFor('F3')).toBe('fps');
    expect(hotkeyFor('Escape')).toBe('release');
    expect(hotkeyFor('m', true)).toBeNull();
    expect(hotkeyFor('w')).toBeNull();
    expect(hotkeyFor('Tab')).toBeNull();
  });
  it('computes fps and reads the persisted toggle', () => {
    expect(fpsFrom([])).toBe(0);
    expect(fpsFrom([0, 16.67, 33.33, 50, 66.67])).toBe(60);
    expect(readFpsPref({ getItem: () => '1' })).toBe(true);
    expect(readFpsPref({ getItem: () => null })).toBe(false);
    expect(readFpsPref({ getItem: () => { throw new Error('x'); } })).toBe(false);
  });
});
