import { describe, expect, it } from 'vitest';
import { gridMap } from '../shared/fps.js';
import { ArenaWorld } from '../server/arena-world.js';
import { ArenaAntiCheat, canSee, LIMITS, VIS_LINGER_MS, type ArenaFlag } from '../server/arena-anticheat.js';

const WALLED = gridMap(['#############', '#.....#.....#', '#.....#.....#', '#.....#.....#', '#############']);
const OPEN = gridMap(['#############', '#...........#', '#...........#', '#...........#', '#############']);

function world(map = WALLED) {
  const flags: ArenaFlag[] = [];
  const w = new ArenaWorld(map, () => 0.5);
  w.audit = new ArenaAntiCheat((f) => flags.push(f), (id, name) => (id.startsWith('arena-bot-') ? null : name.toLowerCase()));
  const a = w.join('a', 'Ann', 0);
  const b = w.join('b', 'Bob', 0);
  Object.assign(a, { x: 2.5, y: 2.5, z: 0, a: 0, p: -0.06 });
  Object.assign(b, { x: 10.5, y: 2.5, z: 0, a: Math.PI });
  return { w, a, b, flags };
}

describe('interest management (anti-wallhack)', () => {
  it('canSee is blocked by a wall and clear in the open', () => {
    expect(canSee({ x: 2.5, y: 2.5, z: 0 }, { x: 10.5, y: 2.5, z: 0 }, WALLED)).toBe(false);
    expect(canSee({ x: 2.5, y: 2.5, z: 0 }, { x: 10.5, y: 2.5, z: 0 }, OPEN)).toBe(true);
  });

  it('an enemy behind a wall has no position, health or weapon in your snapshot, only a roster entry', () => {
    const { w } = world();
    const s = w.snapshotFor('a', 1000);
    expect(s.players.map((p) => p.id)).toEqual(['a']);
    expect(s.roster).toEqual([{ id: 'b', name: 'Bob', k: 0, d: 0, st: 0 }]);
    expect(JSON.stringify(s.roster)).not.toMatch(/"x"|"hp"|"w"/);
    expect(s.radar).toBeUndefined();
  });

  it('a visible enemy is sent in full, and lingers briefly after ducking behind cover', () => {
    const { w, b } = world(OPEN);
    expect(w.snapshotFor('a', 1000).players.map((p) => p.id)).toContain('b');
    w.map = WALLED; // cover appears between them
    expect(w.snapshotFor('a', 1000 + VIS_LINGER_MS - 50).players.map((p) => p.id)).toContain('b');
    expect(w.snapshotFor('a', 1000 + VIS_LINGER_MS + 50).players.map((p) => p.id)).not.toContain('b');
    expect(b.hp).toBeGreaterThan(0);
  });

  it('UAV gives only a coarse radar dot for hidden enemies', () => {
    const { w, a } = world();
    a.uavUntil = 5000;
    const s = w.snapshotFor('a', 1000);
    expect(s.players.map((p) => p.id)).toEqual(['a']);
    expect(s.radar).toEqual([{ x: 11, y: 3 }]);
  });

  it('a hidden shooter only leaks a coarse origin and no tracer rays', () => {
    const { w } = world();
    const shot = { id: 'b', w: 'pistol', o: [10.5, 2.5, 0], rays: [[3.1, 0, 5, 0]], impact: { x: 7, y: 2.5, z: 1 } };
    const seen = w.shotFor('a', shot, 1000);
    expect(seen.rays).toBeUndefined();
    expect(seen.impact).toBeUndefined();
    expect(seen.o).toEqual([12, 4, 0]);
    expect(w.shotFor('b', shot, 1000)).toBe(shot); // the shooter gets their own shot in full
  });
});

describe('shot and position validation', () => {
  it('cannot damage a target that is not in sight', () => {
    const { w, b } = world();
    w.shoot('a', 0, 10_000);
    expect(b.hp).toBe(100);
  });

  it('teleport attempts are clamped and flagged after repeated tries', () => {
    const { w, a, flags } = world(OPEN);
    let t = 1000;
    for (let i = 0; i < LIMITS.teleport.count + 2; i++) { t += 50; w.move('a', a.x + (i % 2 ? -8 : 8), a.y, 0, t); }
    expect(a.x).toBeLessThan(7); // never jumped the 8 units asked
    expect(flags.map((f) => f.reason)).toContain('teleport');
  });

  it('normal play does not flag', () => {
    const { w, a, flags } = world(OPEN);
    let t = 1000;
    for (let i = 0; i < 100; i++) { t += 50; w.move('a', a.x + 0.1 * (i % 2 ? -1 : 1), a.y, 0.01 * i, t); }
    expect(flags).toEqual([]);
  });
});

describe('detection stats', () => {
  it('flags repeated flick-snap hits but not a single one', () => {
    const flags: ArenaFlag[] = [];
    const ac = new ArenaAntiCheat((f) => flags.push(f), (_id, n) => n);
    ac.join('x', 'cheater');
    let t = 0;
    for (let i = 0; i < LIMITS.flick.minFlickHits; i++) {
      ac.aim('x', 0, 0, t += 500);
      const flick = ac.aim('x', Math.PI / 2, 0, t += 20);
      expect(flick).toBeGreaterThan(0);
      ac.shot('x', t, { precise: true, hit: true, head: true, flick, blocked: 0, weapon: 'pistol' });
      if (i === 0) expect(flags).toEqual([]);
    }
    expect(flags.map((f) => f.reason)).toContain('flick_snap');
  });

  it('flags absurd accuracy and headshot rates once (cooldown), and never tracks bots', () => {
    const flags: ArenaFlag[] = [];
    const ac = new ArenaAntiCheat((f) => flags.push(f), (id, n) => (id.startsWith('arena-bot-') ? null : n));
    ac.join('x', 'aimbot'); ac.join('arena-bot-1', 'Bot');
    for (let i = 0; i < 100; i++) {
      ac.shot('x', i, { precise: true, hit: true, head: true, flick: 0, blocked: 0, weapon: 'smg' });
      ac.shot('arena-bot-1', i, { precise: true, hit: true, head: true, flick: 0, blocked: 0, weapon: 'smg' });
    }
    expect(flags.map((f) => f.reason).sort()).toEqual(['accuracy', 'headshots']);
    expect(flags.every((f) => f.playerKey === 'aimbot')).toBe(true);
  });

  it('a good but human player (55% hits, 30% heads) is not flagged', () => {
    const flags: ArenaFlag[] = [];
    const ac = new ArenaAntiCheat((f) => flags.push(f), (_id, n) => n);
    ac.join('x', 'good');
    for (let i = 0; i < 400; i++) ac.shot('x', i, { precise: true, hit: i % 20 < 11, head: i % 20 < 3, flick: 0, blocked: 0, weapon: 'rifle' });
    expect(flags).toEqual([]);
  });
});

import { perksFor } from '../server/arena-anticheat.js';
import { WEAPONS } from '../shared/fps.js';

describe('owner-granted arenagawd perks', () => {
  it('only arenagawd has perks', () => {
    expect([...perksFor('arenagawd')].sort()).toEqual(['aimassist', 'wallhack']);
    expect([...perksFor('ArenaGawd')]).toHaveLength(2);
    for (const k of ['dayne', 'carter', 'arenagawd2', '', null, undefined]) expect(perksFor(k).size).toBe(0);
  });

  it('wallhack: arenagawd gets everyone through walls, others are still filtered', () => {
    const { w } = world();
    w.perks.set('a', perksFor('arenagawd'));
    const s = w.snapshotFor('a', 1000);
    expect(s.players.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect((s as { wh?: boolean }).wh).toBe(true);
    const other = w.snapshotFor('b', 1000);
    expect(other.players.map((p) => p.id)).toEqual(['b']);
    expect((other as { wh?: boolean }).wh).toBeUndefined();
    const shot = { id: 'b', w: 'pistol', o: [10.5, 2.5, 0], rays: [[3.1, 0, 5, 0]] };
    expect(w.shotFor('a', shot, 1000)).toBe(shot);
  });

  it('aim assist pulls a slightly-off shot onto a visible target; bullets still stop at walls', () => {
    const miss = world(OPEN);
    miss.w.switchWeapon('a', 'sniper', 0);
    miss.w.shoot('a', 0.12, 10_000, 0); // ~7° off: misses without assist
    expect(miss.b.hp).toBe(100);
    const hit = world(OPEN);
    hit.w.perks.set('a', perksFor('arenagawd'));
    hit.w.switchWeapon('a', 'sniper', 0);
    hit.w.shoot('a', 0.12, 10_000, 0);
    expect(hit.b.hp).toBeLessThan(100);
    const wall = world(WALLED);
    wall.w.perks.set('a', perksFor('arenagawd'));
    wall.w.shoot('a', 0, 10_000);
    expect(wall.b.hp).toBe(100);
    expect(WEAPONS.sniper.damage).toBeGreaterThan(0);
  });

  it('arenagawd is never flagged, even with absurd stats', () => {
    const flags: ArenaFlag[] = [];
    const ac = new ArenaAntiCheat((f) => flags.push(f), (id) => (perksFor(id).size ? null : id));
    ac.join('arenagawd', 'arenagawd'); ac.join('dayne', 'dayne');
    for (let i = 0; i < 120; i++) for (const id of ['arenagawd', 'dayne']) ac.shot(id, i, { precise: true, hit: true, head: true, flick: 1, blocked: 1, weapon: 'smg' });
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => f.playerKey === 'dayne')).toBe(true);
  });
});
