import { describe, expect, it } from 'vitest';
import { clampOffset, TOP_BAR } from '../shared/windowPos';

describe('window clamp below the top bar', () => {
  const base = { left: 12, top: 48, width: 400, height: 300 };
  it('never lets a window top go above the bar', () => {
    const o = clampOffset({ dx: 0, dy: -300 }, base, 1024, 640, 4, TOP_BAR);
    expect(base.top + o.dy).toBe(TOP_BAR);
  });
  it('pulls an old saved position that sat under the bar back into view', () => {
    const o = clampOffset({ dx: -50, dy: -40 }, base, 1024, 640, 4, TOP_BAR);
    expect(base.top + o.dy).toBeGreaterThanOrEqual(TOP_BAR);
    expect(base.left + o.dx).toBeGreaterThanOrEqual(4);
  });
  it('keeps a too-tall window pinned at the bar so its title bar stays grabbable', () => {
    const o = clampOffset({ dx: 0, dy: 0 }, { ...base, height: 900 }, 1024, 640, 4, TOP_BAR);
    expect(base.top + o.dy).toBe(TOP_BAR);
  });
});
