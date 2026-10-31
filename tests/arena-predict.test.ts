import { describe, expect, it } from 'vitest';
import { gridMap, WEAPONS } from '../shared/fps';
import { predictShot, ShotPredictor, cleanSid, PREDICT_TIMEOUT_MS } from '../shared/arenaPredict';
import { LAG_COMP_MAX_MS } from '../shared/netInterp';
import { ArenaWorld } from '../server/arena-world';

const LANE = gridMap(['####################', '#..................#', '#..................#', '#..................#', '####################']);

function duel() {
  const w = new ArenaWorld(LANE, () => 0.5);
  const a = w.join('a', 'Ann', 0), b = w.join('b', 'Bob', 0);
  Object.assign(a, { x: 2, y: 2, z: 0, a: 0, p: -0.05, weapon: 'pistol' });
  Object.assign(b, { x: 8, y: 2, z: 0, a: Math.PI });
  a.switchedAt = -1e9; a.reloadUntil = 0;
  return { w, a, b };
}
const shotEv = (evs: Array<{ ev: string; data: Record<string, unknown> }>) => evs.find((e) => e.ev === 'fps_shot')!.data;

describe('arena predicted shots (client)', () => {
  it('predicts a hit on the displayed target and a miss when aiming away', () => {
    const me = { id: 'a', x: 2, y: 2, z: 0, a: 0, p: -0.05 };
    const t = [{ id: 'b', x: 8, y: 2, z: 0, alive: true }];
    const hit = predictShot(me, WEAPONS.pistol, t, LANE);
    expect(hit.hits.has('b')).toBe(true);
    expect(hit.dmg).toBeGreaterThan(0);
    expect(hit.rays[0].hit).toBe(true);
    expect(predictShot({ ...me, a: 1.2 }, WEAPONS.pistol, t, LANE).hits.size).toBe(0);
  });
  it('flags a predicted headshot', () => {
    const r = predictShot({ id: 'a', x: 2, y: 2, z: 0, a: 0, p: 0 }, WEAPONS.pistol, [{ id: 'b', x: 8, y: 2, z: 0, alive: true }], LANE);
    expect(r.head).toBe(true);
  });
  it('ShotPredictor: confirm, deny, late hit, miss, unknown sid', () => {
    const p = new ShotPredictor();
    const s1 = p.newSid(), s2 = p.newSid(), s3 = p.newSid(), s4 = p.newSid();
    expect(new Set([s1, s2, s3, s4]).size).toBe(4);
    p.add(s1, true, false, 0); p.add(s2, true, true, 0); p.add(s3, false, false, 0); p.add(s4, false, false, 0);
    expect(p.resolve(s1, true)).toBe('confirm');
    expect(p.resolve(s2, false)).toBe('deny');
    expect(p.resolve(s3, true)).toBe('late-hit');
    expect(p.resolve(s4, false)).toBe('miss');
    expect(p.resolve(s1, true)).toBeNull();
    expect(p.resolve('x', true)).toBeNull();
    expect(p.size).toBe(0);
  });
  it('ShotPredictor: unanswered predicted hits expire as denied', () => {
    const p = new ShotPredictor();
    p.add(1, true, false, 0); p.add(2, false, false, 0);
    expect(p.expire(PREDICT_TIMEOUT_MS - 1)).toEqual([]);
    expect(p.expire(PREDICT_TIMEOUT_MS + 1)).toEqual([1]);
    expect(p.size).toBe(0);
  });
  it('cleanSid accepts only sane positive integers', () => {
    expect(cleanSid(5)).toBe(5);
    for (const bad of [0, -1, 1.5, '3', null, 2 ** 31, {}]) expect(cleanSid(bad)).toBeUndefined();
  });
});

describe('arena lag compensation + confirm/deny (server)', () => {
  it('echoes the sid with the authoritative hit verdict (confirm)', () => {
    const { w, b } = duel();
    const ev = shotEv(w.shoot('a', 0, 10_000, -0.05, 10_000, undefined, 42) as never);
    expect(ev.sid).toBe(42);
    expect((ev.rays as number[][])[0][3]).toBe(1);
    expect(b.hp).toBeLessThan(100);
  });
  it('denies when the target was not where the client saw it, and ignores junk sids', () => {
    const { w, b } = duel();
    w.history.record('b', 9900, 8, 3.5, 0); // at view time Bob was off the line
    w.history.record('b', 10_000, 8, 2, 0);
    const ev = shotEv(w.shoot('a', 0, 10_000, -0.05, 9900, undefined, 'evil') as never);
    expect(ev.sid).toBeUndefined();
    expect((ev.rays as number[][])[0][3]).toBe(0);
    expect(b.hp).toBe(100);
    expect(b.y).toBe(2); // restored after rewind
  });
  it('rewinds to the shooter view time: hit where the target was displayed', () => {
    const { w, b } = duel();
    b.y = 3.5; // now off the line...
    w.history.record('b', 9900, 8, 2, 0); // ...but on it when the shooter saw it
    w.history.record('b', 10_000, 8, 3.5, 0);
    const ev = shotEv(w.shoot('a', 0, 10_000, -0.05, 9900, undefined, 7) as never);
    expect((ev.rays as number[][])[0][3]).toBe(1);
    expect(b.hp).toBeLessThan(100);
    expect(b.y).toBe(3.5);
  });
  it(`caps the rewind at ${LAG_COMP_MAX_MS} ms`, () => {
    const { w, b } = duel();
    b.y = 3.5;
    w.history.record('b', 9500, 8, 2, 0); // on the line 500 ms ago only
    w.history.record('b', 10_000 - LAG_COMP_MAX_MS, 8, 3.5, 0);
    w.history.record('b', 10_000, 8, 3.5, 0);
    w.shoot('a', 0, 10_000, -0.05, 9500, undefined, 8);
    expect(b.hp).toBe(100);
  });
});
