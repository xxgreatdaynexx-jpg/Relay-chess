import { describe, expect, it } from 'vitest';
import { ArenaWorld, MATCH_MS } from '../server/arena-world.js';
import { KILLCAM_MS, KILLCAM_TTL_MS, KillCamBuffer } from '../server/killcam.js';
import { RESPAWN_PICK_MS as RESPAWN_MS, TICK_HZ } from '../shared/fps.js';
import { contentTime, fitSpeed, killCardText, playLength, sampleKillCam, SLOWMO_MS } from '../client/src/lib/killcam.js';

const T0 = 1_000_000;
const STEP = Math.round(1000 / TICK_HZ);
type Dmg = { damage: (by: string | null, t: string, n: number, now: number, cause: string, head?: boolean) => unknown };

function duel(killerId = 'a') {
  const w = new ArenaWorld();
  const a = w.join(killerId, 'Ace', T0), b = w.join('b', 'Bea', T0);
  let now = T0;
  for (let i = 0; i < TICK_HZ * 6; i++) { now += STEP; w.tick(now); w.killcam.shot(a.id); }
  Object.assign(a, { x: 2, y: 2, z: 0 }); Object.assign(b, { x: 5, y: 6, z: 0 });
  (w as unknown as Dmg).damage(a.id, 'b', 9999, now, 'sniper', true);
  return { w, a, b, now };
}

describe('kill cam ring buffer', () => {
  it('keeps only ~5 s of frames and slices the last 4 s of killer + victim', () => {
    const k = new KillCamBuffer();
    const fs = [{ id: 'a', alive: true, x: 0, y: 0, z: 0, a: 0, p: 0, weapon: 'pistol' }, { id: 'b', alive: true, x: 1, y: 1, z: 0, a: 0, p: 0, weapon: 'smg' }, { id: 'c', alive: true, x: 9, y: 9, z: 0, a: 0, p: 0, weapon: 'smg' }];
    for (let t = 0; t <= 10_000; t += 100) { if (t % 500 === 0) k.shot('a'); k.frame(t, fs); }
    expect(k.size).toBeLessThanOrEqual(3 * 51); // per-fighter samples, ~5 s each
    k.kill({ killerId: 'a', killer: 'A', victimId: 'b', weapon: 'pistol', dist: 1.4, head: false, bot: false, at: 10_000 });
    const got = k.get('b', 10_000)!;
    expect(got.track!.length).toBe(KILLCAM_MS / 100 + 1);
    expect(got.track![0].t).toBe(10_000 - KILLCAM_MS);
    expect(Object.keys(got.track![0].p).sort()).toEqual(['a', 'b']); // bystanders not sent
    expect(got.track!.some((f) => f.p.a[6] === 1)).toBe(true); // shots marked
    expect(k.get('b', 10_000 + KILLCAM_TTL_MS + 1)).toBeNull();
  });

  it('bot killers, suicides and missing data give a card only', () => {
    const k = new KillCamBuffer();
    k.kill({ killerId: 'arena-bot-1', killer: 'Bot', victimId: 'b', weapon: 'smg', dist: 3, head: false, bot: true, at: 50 });
    expect(k.get('b', 50)).toMatchObject({ card: { killer: 'Bot' }, track: null });
    k.kill({ killerId: 'b', killer: 'B', victimId: 'b', weapon: 'rocket', dist: 0, head: false, bot: false, at: 60 });
    expect(k.get('b', 60)!.track).toBeNull();
    k.kill({ killerId: 'x', killer: 'X', victimId: 'y', weapon: 'pistol', dist: 2, head: false, bot: false, at: 70 });
    expect(k.get('y', 70)!.track).toBeNull(); // no frames recorded
  });
});

describe('kill cam request (world)', () => {
  it('a dead player gets card + track during play; nothing once alive, never delays respawn', () => {
    const { w, b, now } = duel();
    const kc = w.killCamFor('b', now)!;
    expect(kc.card).toMatchObject({ killerId: 'a', killer: 'Ace', weapon: 'sniper', head: true, bot: false, dist: 5 });
    expect(kc.track!.length).toBeGreaterThan(TICK_HZ * 3);
    expect(kc.track!.every((f) => f.p.a)).toBe(true);
    expect(w.killCamFor('a', now)).toBeNull(); // alive
    // respawn timing is untouched by having asked
    w.tick(now + RESPAWN_MS + STEP);
    expect(b.alive).toBe(true);
    expect(w.killCamFor('b', now + RESPAWN_MS + STEP)).toBeNull();
  });

  it('is unavailable once respawns stop (sudden death / end screen)', () => {
    const { w, b, now } = duel();
    w.join('c', 'Cy', now);
    b.respawnAt = T0 + MATCH_MS + 60_000;
    w.tick(T0 + MATCH_MS + 1);
    expect(w.phase).toBe('sudden');
    expect(b.alive).toBe(false);
    expect(w.killCamFor('b', now)).toBeNull();
  });

  it('bot killer: card only', () => {
    const { w, now } = duel('arena-bot-7');
    const kc = w.killCamFor('b', now)!;
    expect(kc.card.bot).toBe(true);
    expect(kc.track).toBeNull();
  });
});

describe('kill cam playback', () => {
  it('slow-mo on the last 0.5 s and speed fitted to the respawn', () => {
    expect(playLength(4000)).toBeCloseTo(3500 + SLOWMO_MS / 0.35);
    expect(contentTime(4000, 3500)).toBe(3500);
    expect(contentTime(4000, 3600)).toBeCloseTo(3535);
    expect(contentTime(4000, 1e9)).toBe(4000);
    expect(fitSpeed(4000, 100_000)).toBe(1);
    expect(fitSpeed(4000, 1000)).toBeCloseTo(playLength(4000) / 1000);
    expect(fitSpeed(4000, 0)).toBe(Infinity);
  });
  it('interpolates poses and reports done', () => {
    const track = [{ t: 0, p: { a: [0, 0, 0, 0, 0, 0, 0, 'pistol'] as never, b: [10, 0, 0, 0, 0, 0, 0, 'smg'] as never } }, { t: 1000, p: { a: [2, 0, 0, 0, 0, 0, 1, 'pistol'] as never, b: [10, 4, 0, 0, 0, 0, 0, 'smg'] as never } }];
    const mid = sampleKillCam(track, 'a', 'b', 250);
    expect(mid.killer![0]).toBeCloseTo(0.5);
    expect(mid.victim![1]).toBeCloseTo(1);
    expect(sampleKillCam(track, 'a', 'b', 1e6).done).toBe(true);
    expect(killCardText({ killerId: 'a', killer: 'Ace', victimId: 'b', weapon: 'sniper', dist: 23.44, head: true, bot: false, at: 0 }, () => 'Sniper')).toBe('KILLED BY Ace — Sniper, 23.4 m, HS');
  });
});
