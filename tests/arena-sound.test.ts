import { describe, expect, it } from 'vitest';
import { ARENA_BOOM_GAIN, explosionMix } from '../client/src/lib/sounds';
describe('arena explosion mix', () => {
  it('is ~30% of the old level up close and falls off and dulls with distance', () => {
    expect(explosionMix(0).gain).toBeCloseTo(ARENA_BOOM_GAIN);
    expect(ARENA_BOOM_GAIN).toBeLessThanOrEqual(0.35);
    expect(explosionMix(20).gain).toBeLessThan(explosionMix(5).gain);
    expect(explosionMix(20).cutoff).toBeLessThan(explosionMix(2).cutoff);
  });
});
