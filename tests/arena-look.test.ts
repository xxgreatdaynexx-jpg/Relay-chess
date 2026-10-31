import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, mouseLook, normalizeLook, readLook } from '../client/src/lib/arenaInput';
describe('arena look prefs', () => {
  it('defaults keep the original feel', () => {
    const [a, p] = mouseLook(DEFAULT_LOOK, false, 10, 10);
    expect(a).toBeCloseTo(0.035); expect(p).toBeCloseTo(-0.035);
    expect(mouseLook(DEFAULT_LOOK, true, 10, 0)[0]).toBeCloseTo(0.0035 * 0.31 * 10);
  });
  it('clamps, inverts and survives junk', () => {
    expect(normalizeLook({ sens: 99, scope: -1, invertY: 'yes', touch: 0 })).toEqual({ sens: 5, scope: 0.05, invertY: false, touch: 0.1 });
    expect(mouseLook({ ...DEFAULT_LOOK, sens: 2, invertY: true }, false, 0, 10)[1]).toBeCloseTo(0.07);
    expect(readLook({ getItem: () => '{bad' })).toEqual(DEFAULT_LOOK);
  });
});
