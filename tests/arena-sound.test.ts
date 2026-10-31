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
    expect(s.SNIPER_SHOT_URL).toBe('/sounds/sniper-shot.wav');
    expect(s.SNIPER_SHOT_GAIN).toBeGreaterThan(0.4);
    expect(s.SNIPER_SHOT_GAIN).toBeLessThan(0.7);
    expect(s.shotFalloff(0)).toBe(1);
    expect(s.shotFalloff(30)).toBeLessThan(0.3);
    expect(s.shotFalloff(1e6)).toBe(0.15);
  });
});

import { readFileSync } from 'node:fs';
describe('sniper clip timing', () => {
  it('the crack starts within 10 ms of t=0 (no lead-in delay)', () => {
    const b = readFileSync(new URL('../client/public/sounds/sniper-shot.wav', import.meta.url));
    let o = 12; let rate = 44100; let data = 0; let len = 0;
    while (o < b.length) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'fmt ') rate = b.readUInt32LE(o + 12); if (id === 'data') { data = o + 8; len = sz; break; } o += 8 + sz; }
    const n = len / 2; let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(b.readInt16LE(data + i * 2)));
    let i = 0; while (i < n && Math.abs(b.readInt16LE(data + i * 2)) < peak * 0.18) i++; // -15 dB
    expect((i / rate) * 1000).toBeLessThan(10);
  });
});

describe('rocket chain loudness', () => {
  it('explosion bus ceiling keeps every rocket/explosion sound under -20 dBFS', async () => {
    const { EXPLOSION_CEILING, explosionCurve } = await import('../client/src/lib/sounds');
    expect(20 * Math.log10(EXPLOSION_CEILING)).toBeLessThan(-20);
    const c = explosionCurve();
    expect(Math.max(...Array.from(c, Math.abs))).toBeLessThanOrEqual(EXPLOSION_CEILING * 1.0001);
    // small signals pass ~unchanged
    expect(c[Math.round((c.length - 1) * (0.5 + 0.005 / 2))]).toBeCloseTo(0.005, 3);
  });
  it('default Explosions slider is 50% and is persisted', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    setExplosionVolume(0.3);
    expect(store.get('arena-explosion-volume')).toBe('0.3');
    delete (globalThis as { localStorage?: unknown }).localStorage;
    setExplosionVolume(0.5);
    expect(getExplosionVolume()).toBe(0.5);
  });
  it('every explosion/rocket path routes through the explosion bus, none straight to the master compressor', () => {
    const src = readFileSync(new URL('../client/src/lib/sounds.ts', import.meta.url), 'utf8');
    for (const fn of ['playArenaExplosion', 'playExplosion']) {
      const body = src.slice(src.indexOf(`export function ${fn}(`), src.indexOf('\n}\n', src.indexOf(`export function ${fn}(`)));
      expect(body).toContain('explosionOut(ctx)');
      expect(body).not.toContain('output(ctx)');
    }
    const shot = src.slice(src.indexOf('export function playWeaponShot('));
    const rocket = shot.slice(shot.indexOf("weapon === 'rocket'"), shot.indexOf('return;', shot.indexOf("weapon === 'rocket'")) + 400);
    expect(rocket).toContain('explosionOut(ctx)');
    expect(ROCKET_LAUNCH_GAIN).toBeLessThanOrEqual(0.12);
  });
});
