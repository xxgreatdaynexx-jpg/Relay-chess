import { describe, expect, it } from 'vitest';
import { ARENA_BOOM_GAIN, explosionMix, getExplosionVolume, ROCKET_LAUNCH_GAIN, setExplosionVolume } from '../client/src/lib/sounds';
describe('arena explosion mix', () => {
  it('is ~30% of the old level up close and falls off and dulls with distance', () => {
    expect(explosionMix(0).gain).toBeCloseTo(ARENA_BOOM_GAIN * getExplosionVolume());
    expect(getExplosionVolume()).toBe(0.5);
    expect(ROCKET_LAUNCH_GAIN).toBeLessThanOrEqual(0.15);
    expect(ARENA_BOOM_GAIN).toBeLessThanOrEqual(0.2);
    expect(explosionMix(20).gain).toBeLessThan(explosionMix(5).gain);
    expect(explosionMix(20).cutoff).toBeLessThan(explosionMix(2).cutoff);
  });
  it('the Explosions slider scales and can silence explosions', () => {
    setExplosionVolume(0);
    expect(explosionMix(0).gain).toBe(0);
    setExplosionVolume(0.5);
  });
});

describe('sniper clip', () => {
  it('uses the trimmed recording just above pistol level, and remote shots fall off with distance', async () => {
    const s = await import('../client/src/lib/sounds');
    expect(s.SNIPER_SHOT_URL).toBe('/sounds/sniper-shot.mp3');
    expect(s.SNIPER_SHOT_GAIN).toBeGreaterThan(0.4);
    expect(s.SNIPER_SHOT_GAIN).toBeLessThan(0.7);
    expect(s.shotFalloff(0)).toBe(1);
    expect(s.shotFalloff(30)).toBeLessThan(0.3);
    expect(s.shotFalloff(1e6)).toBe(0.15);
  });
});
