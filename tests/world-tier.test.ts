import { describe, expect, it } from 'vitest';
import { labelScale, worldTier } from '../client/src/lib/worldTier';
describe('world tier + labels', () => {
  it('tiers devices', () => {
    expect(worldTier({ cores: 4, memory: 8 })).toBe('low');
    expect(worldTier({ cores: 8, memory: 8, touch: true })).toBe('mid');
    expect(worldTier({ cores: 12, memory: 8, width: 1440 })).toBe('high');
  });
  it('clamps label size (bigger floor on portrait phones)', () => {
    expect(labelScale(10, false)).toBe(5.5); expect(labelScale(1000, false)).toBe(12);
    expect(labelScale(10, true)).toBe(7); expect(labelScale(1000, true)).toBe(15);
    expect(labelScale(130, false)).toBeCloseTo(8.06, 1);
  });
});
