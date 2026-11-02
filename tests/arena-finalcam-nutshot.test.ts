import { describe, expect, it } from 'vitest';
import { fireWeapon, rayFighter, WEAPONS, NUTSHOT_MULT, gridMap } from '../shared/fps';
import { KillCamBuffer, FINAL_CAM_MS } from '../server/killcam';
import { combatXp } from '../server/skills';
import { feedParts } from '../client/src/lib/arenaFeed';
import { finalCamSpeed, finalCardText, killCardText } from '../client/src/lib/killcam';

const tgt = (extra: Record<string, unknown> = {}) => ({ id: 't', x: 4, y: 0, z: 0, alive: true, ...extra });

describe('nut shot hitbox', () => {
  it('a ray at pelvis height is a nut shot; chest is not; head wins', () => {
    const d = { x: 1, y: 0, z: 0 };
    expect(rayFighter({ x: 0, y: 0, z: 0.82 }, d, tgt())).toMatchObject({ head: false, nut: true });
    expect(rayFighter({ x: 0, y: 0, z: 1.2 }, d, tgt())?.nut).toBeFalsy();
    const h = rayFighter({ x: 0, y: 0, z: 1.62 }, d, tgt());
    if (h) expect(h.nut).toBeFalsy();
  });
  it('crouched groin moves down', () => {
    const d = { x: 1, y: 0, z: 0 };
    expect(rayFighter({ x: 0, y: 0, z: 0.5 }, d, tgt({ crouch: true }))?.nut).toBe(true);
    expect(rayFighter({ x: 0, y: 0, z: 0.82 }, d, tgt({ crouch: true }))?.nut).toBeFalsy();
  });
  it('fireWeapon applies the 1.5x multiplier and reports nuts', () => {
    const map = gridMap(['#########', '#.......#', '#.......#', '#########']);
    const t = { id: 't', x: 5.5, y: 1.5, z: 0, alive: true };
    const r = fireWeapon({ id: 's', x: 1.5, y: 1.5, z: 0, a: 0, p: Math.atan2(0.82 - 1.52, 4) }, WEAPONS.pistol, [t], { rand: () => 0.5, map });
    expect(r.nuts.has('t')).toBe(true);
    expect(r.hits.get('t')).toBeCloseTo(WEAPONS.pistol.damage * NUTSHOT_MULT, 5);
    const body = fireWeapon({ id: 's', x: 1.5, y: 1.5, z: 0, a: 0, p: Math.atan2(1.15 - 1.52, 4) }, WEAPONS.pistol, [t], { rand: () => 0.5, map });
    expect(body.nuts.has('t')).toBe(false);
    expect(body.hits.get('t')).toBeCloseTo(WEAPONS.pistol.damage, 5);
  });
});

describe('final killcam buffer', () => {
  const f = (id: string, x: number) => ({ id, alive: true, x, y: 0, z: 0, a: 0, p: 0, weapon: 'pistol' });
  it('keeps the last kill of the match (even a bot killer) and drops stale ones', () => {
    const k = new KillCamBuffer();
    for (let t = 0; t <= 3000; t += 25) { k.sample(t, f('a', 0)); k.sample(t, f('b', 5)); k.frame(t, [f('a', 0), f('b', 5)]); }
    k.kill({ killerId: 'a', killer: 'Ace', victimId: 'b', victim: 'Bea', weapon: 'pistol', dist: 5, head: false, nut: true, bot: true, at: 3000 });
    const fc = k.final(3500)!;
    expect(fc.card).toMatchObject({ killer: 'Ace', victim: 'Bea', nut: true });
    expect(fc.track!.length).toBeGreaterThan(10);
    expect(k.final(3000 + 25_000)).toBeNull();
    k.clear();
    expect(k.final(3500)).toBeNull();
  });
  it('fits playback inside the replay window', () => {
    expect(finalCamSpeed(4000, FINAL_CAM_MS)).not.toBeNull();
    expect(finalCamSpeed(4000, 500)).toBeNull();
  });
});

describe('end of match carries the final cam without delaying payouts', () => {
  it('endMatch emits finalCam, extends the end screen by the replay, and calls onMatchEnd immediately', async () => {
    const { ArenaWorld } = await import('../server/arena-world.js');
    const w = new ArenaWorld(undefined, () => 0.5);
    const calls: number[] = [];
    (w as unknown as { onMatchEnd: unknown }).onMatchEnd = () => calls.push(1);
    const kc = (w as unknown as { killcam: KillCamBuffer }).killcam;
    const now = 1_000_000;
    for (let t = now - 3000; t <= now - 500; t += 25) { kc.sample(t, f2('a', 0)); kc.sample(t, f2('b', 5)); kc.frame(t, [f2('a', 0), f2('b', 5)]); }
    kc.kill({ killerId: 'a', killer: 'Ace', victimId: 'b', victim: 'Bea', weapon: 'pistol', dist: 5, head: true, bot: false, at: now - 500 });
    const wa = w as unknown as { endMatch: (now: number, reason: string) => Array<{ ev: string; data: Record<string, unknown> }>; endScreenUntil: number; finalCamMs: number };
    const evs = wa.endMatch(now, 'cap');
    const fc = evs[0].data.finalCam as { card: { killer: string; head: boolean }; ms: number };
    expect(fc.card).toMatchObject({ killer: 'Ace', head: true });
    expect(fc.ms).toBe(FINAL_CAM_MS);
    expect(calls.length).toBe(1);
    expect(wa.finalCamMs).toBe(FINAL_CAM_MS);
    expect(wa.endScreenUntil - now).toBe(10_000 + FINAL_CAM_MS);
  });
});
const f2 = (id: string, x: number) => ({ id, alive: true, x, y: 0, z: 0, a: 0, p: 0, weapon: 'pistol' });

describe('nut shot UI + XP', () => {
  it('feed shows a nut icon (headshot wins)', () => {
    const base = { key: 1, killer: 'A', victim: 'B', cause: 'pistol', self: false, mine: false };
    expect(feedParts({ ...base, nut: true }).map((p) => p.t)).toEqual(['killer', 'weapon', 'nut', 'victim']);
    expect(feedParts({ ...base, nut: true, head: true }).map((p) => p.t)).toEqual(['killer', 'weapon', 'head', 'victim']);
  });
  it('cards read right', () => {
    const c = { killerId: 'a', killer: 'Ace', victimId: 'b', victim: 'Bea', weapon: 'pistol', dist: 5, head: false, nut: true, bot: false, at: 0 };
    expect(finalCardText(c, (w) => w)).toBe('Ace ➜ Bea — pistol, 5.0 m, NUT SHOT');
    expect(killCardText(c, (w) => w)).toContain('NUT SHOT');
  });
  it('precision hits (HS + NS) earn small capped Combat XP', () => {
    const base = combatXp({ kills: 2, participationMs: 120_000 }, false);
    expect(combatXp({ kills: 2, participationMs: 120_000, hs: 1, ns: 2 }, false)).toBe(base + 15);
    expect(combatXp({ kills: 2, participationMs: 120_000, hs: 50, ns: 50 }, false)).toBe(base + 100);
  });
});
