import { describe, expect, it } from 'vitest';
import {
  BULLET_RANGE, damageFalloff, AIRSTRIKE_DELAY_MS, AIRSTRIKE_LOCK_MS, AIRSTRIKE_WAIT_MS, DRONE_MS, fireWeapon, gridMap, JUMP_APEX, MAX_HP, NUKE_DELAY_MS, NUKE_RESPAWN_MS, WEAPON_ORDER, SCOPE_SETTLE_MS,
  splashFalloff, splashTargets, SWITCH_MS, UAV_MS, WEAPONS,
} from '../shared/fps.js';
import { ArenaWorld, FIRE_JITTER_MS } from '../server/arena-world.js';

const HALL = gridMap(['####################', '#..................#', '#..................#', '#..................#', '####################']);
const LONG = gridMap(['#'.repeat(60), '#' + '.'.repeat(58) + '#', '#' + '.'.repeat(58) + '#', '#' + '.'.repeat(58) + '#', '#'.repeat(60)]);
const SPLIT = gridMap(['#########', '#...#...#', '#########']);
/** A slight downward aim that lands in the chest (not the head) at the duel distances below. */
const CHEST = -0.06;

/** World with two fighters on a straight line: a at (2,2) facing east, b at (x,2). */
function duel(bx = 6, map = HALL) {
  const w = new ArenaWorld(map, () => 0.5);
  const a = w.join('a', 'Ann', 0);
  const b = w.join('b', 'Bob', 0);
  Object.assign(a, { x: 2, y: 2, a: 0, p: CHEST });
  Object.assign(b, { x: bx, y: 2, a: Math.PI });
  return { w, a, b };
}
const hp = (w: ArenaWorld, id: string) => w.fighters.get(id)!.hp;

describe('weapon damage', () => {
  it('each gun deals its spec damage at range', () => {
    for (const id of ['pistol', 'smg', 'sniper'] as const) {
      const { w, b } = duel();
      w.switchWeapon('a', id, 0);
      w.shoot('a', 0, 10_000);
      expect(MAX_HP - b.hp).toBe(Math.min(MAX_HP, WEAPONS[id].damage));
    }
  });
  it('bullets have no max range; shotgun pellets fall off with distance but never to zero', () => {
    for (const id of ['pistol', 'smg', 'shotgun', 'sniper'] as const) expect(WEAPONS[id].range).toBe(BULLET_RANGE);
    expect(damageFalloff(WEAPONS.shotgun, 4)).toBe(1);
    expect(damageFalloff(WEAPONS.shotgun, 8)).toBe(1);
    expect(damageFalloff(WEAPONS.shotgun, 16.5)).toBeCloseTo(0.675);
    expect(damageFalloff(WEAPONS.shotgun, 40)).toBe(0.35);
    for (const id of ['pistol', 'smg', 'sniper'] as const) expect(damageFalloff(WEAPONS[id], 300)).toBe(1);
    const pistolFar = fireWeapon({ id: 'a', x: 2, y: 2, z: 0, a: 0, p: -0.01 }, WEAPONS.pistol, [{ id: 'b', x: 45, y: 2, z: 0, alive: true }], { map: LONG, rand: () => 0.5 });
    expect(pistolFar.hits.get('b') ?? 0).toBeGreaterThanOrEqual(WEAPONS.pistol.damage); // 43 units, no falloff
  });
  it('shotgun fires several pellets and is weaker far away', () => {
    const close = fireWeapon({ id: 'a', x: 2, y: 2, z: 0, a: 0, p: -0.4 }, WEAPONS.shotgun, [{ id: 'b', x: 3, y: 2, z: 0, alive: true }], { map: HALL, rand: () => 0.5 });
    expect(close.rays).toHaveLength(WEAPONS.shotgun.pellets);
    expect(close.hits.get('b')).toBe(WEAPONS.shotgun.pellets * WEAPONS.shotgun.damage);
    const far = fireWeapon({ id: 'a', x: 2, y: 2, z: 0, a: 0, p: -0.01 }, WEAPONS.shotgun, [{ id: 'b', x: 30, y: 2, z: 0, alive: true }], { map: LONG, rand: () => 0.5 });
    expect(far.hits.get('b') ?? 0).toBeGreaterThan(0); // no cutoff: still hits at 28 units
    expect(far.hits.get('b') ?? 0).toBeLessThanOrEqual(Math.round(WEAPONS.shotgun.pellets * WEAPONS.shotgun.damage * 0.35));
  });
  it('buffed shotgun kills at close range and still hurts at mid range', () => {
    expect(WEAPONS.shotgun.pellets * WEAPONS.shotgun.damage).toBeGreaterThanOrEqual(150);
    const close = fireWeapon({ id: 'a', x: 2, y: 2, z: 0, a: 0, p: CHEST }, WEAPONS.shotgun, [{ id: 'b', x: 4, y: 2, z: 0, alive: true }], { map: HALL, rand: () => Math.random() });
    expect(close.hits.get('b') ?? 0).toBeGreaterThanOrEqual(100);
    const mid = fireWeapon({ id: 'a', x: 2, y: 2, z: 0, a: 0, p: CHEST }, WEAPONS.shotgun, [{ id: 'b', x: 8, y: 2, z: 0, alive: true }], { map: HALL, rand: () => 0.5 });
    expect(mid.hits.get('b') ?? 0).toBeGreaterThanOrEqual(30);
  });
  it('spread can make shots miss; the scoped sniper does not spread', () => {
    const target = [{ id: 'b', x: 18, y: 2, z: 0, alive: true }];
    const wide = fireWeapon({ id: 'a', x: 1.5, y: 2, z: 0, a: 0, p: -0.03 }, WEAPONS.sniper, target, { map: HALL, rand: () => 1 });
    expect(wide.hits.size).toBe(0);
    const scoped = fireWeapon({ id: 'a', x: 1.5, y: 2, z: 0, a: 0, p: -0.03 }, WEAPONS.sniper, target, { map: HALL, rand: () => 1, scoped: true });
    expect(scoped.hits.get('b')).toBe(WEAPONS.sniper.damage);
  });
  it('the server only treats the sniper as scoped after the settle time', () => {
    const { w, b } = duel(18);
    w.switchWeapon('a', 'sniper', 0);
    w.setScope('a', true, 1000);
    w.shoot('a', 0, 1000 + SCOPE_SETTLE_MS);
    expect(b.hp).toBe(MAX_HP - WEAPONS.sniper.damage);
  });
});

describe('fire rate, ammo and reload', () => {
  it('rejects shots faster than the weapon cooldown', () => {
    const { w, b } = duel();
    w.switchWeapon('a', 'smg', 0);
    const t0 = 1000;
    expect(w.shoot('a', 0, t0).length).toBeGreaterThan(0);
    expect(w.shoot('a', 0, t0 + WEAPONS.smg.cooldownMs - FIRE_JITTER_MS - 1)).toEqual([]);
    expect(w.shoot('a', 0, t0 + WEAPONS.smg.cooldownMs).length).toBeGreaterThan(0);
    expect(MAX_HP - b.hp).toBe(2 * WEAPONS.smg.damage);
  });
  it('blocks firing right after a weapon switch', () => {
    const { w } = duel();
    w.switchWeapon('a', 'shotgun', 1000);
    expect(w.shoot('a', 0, 1000 + SWITCH_MS - 1)).toEqual([]);
    expect(w.shoot('a', 0, 1000 + SWITCH_MS).length).toBeGreaterThan(0);
  });
  it('runs out of ammo, reloads, and refills after the reload time', () => {
    const { w, a } = duel(18);
    w.switchWeapon('a', 'rocket', 0);
    a.y = 3; // aim past b at the far wall
    let t = 1000;
    for (let i = 0; i < WEAPONS.rocket.mag; i++, t += WEAPONS.rocket.cooldownMs) expect(w.shoot('a', -0.0, t).length).toBeGreaterThan(0);
    expect(a.ammo.rocket).toBe(0);
    const reloadDone = t - WEAPONS.rocket.cooldownMs + WEAPONS.rocket.reloadMs;
    expect(w.shoot('a', 0, reloadDone - 1)).toEqual([]);
    expect(w.shoot('a', 0, reloadDone).length).toBeGreaterThan(0);
    expect(a.ammo.rocket).toBe(WEAPONS.rocket.mag - 1);
  });
  it('rejects unknown weapons', () => {
    const { w, a } = duel();
    expect(w.switchWeapon('a', 'laser', 0)).toBe(false);
    expect(a.weapon).toBe('pistol');
  });
});

describe('rocket splash', () => {
  it('falls off linearly with distance', () => {
    expect(splashFalloff(100, 2, 0)).toBe(100);
    expect(splashFalloff(100, 2, 1)).toBe(50);
    expect(splashFalloff(100, 2, 2)).toBe(0);
  });
  it('is blocked by walls', () => {
    const t = [{ id: 'x', x: 2.5, y: 1.5, z: 0, alive: true }, { id: 'y', x: 5.5, y: 1.5, z: 0, alive: true }];
    const hit = splashTargets({ x: 3.6, y: 1.5, z: 0.5 }, 3, 100, t, SPLIT).map((s) => s.id);
    expect(hit).toEqual(['x']);
  });
  it('direct hit does full damage, bystanders take splash, the shooter takes half', () => {
    const { w, a, b } = duel(4);
    const c = w.join('c', 'Cy', 0);
    Object.assign(c, { x: 4, y: 3 });
    w.switchWeapon('a', 'rocket', 0);
    a.x = 3; // close enough to catch own splash
    w.shoot('a', 0, 1000);
    expect(b.alive).toBe(true); // a real rocket: nothing happens until it flies there
    w.tick(1300);
    expect(b.alive).toBe(false);
    expect(c.hp).toBeLessThan(MAX_HP);
    expect(c.hp).toBeGreaterThan(0);
    expect(a.hp).toBeLessThan(MAX_HP);
    expect(MAX_HP - a.hp).toBeLessThan(WEAPONS.rocket.damage / 2);
  });
});

describe('jumping (server-simulated)', () => {
  it('arcs up and lands, with height coming from the server only', () => {
    const { w, a } = duel();
    expect(w.jump('a', 1000)).toHaveLength(1);
    w.tick(1000 + 200);
    expect(a.z).toBeGreaterThan(0.5);
    expect(a.z).toBeLessThanOrEqual(JUMP_APEX + 1e-6);
    w.tick(1000 + 1500);
    expect(a.z).toBe(0);
    expect(a.grounded).toBe(true);
  });
  it('cannot be spammed in mid-air', () => {
    const { w } = duel();
    expect(w.jump('a', 1000)).toHaveLength(1);
    expect(w.jump('a', 1100)).toEqual([]);
    w.tick(3000);
    expect(w.jump('a', 3000)).toHaveLength(1);
  });
  it('a jumping target can dodge a shot aimed at its chest', () => {
    const { w, b } = duel();
    w.jump('b', 1000);
    w.tick(1000 + 280); // near the top of the jump
    w.shoot('a', 0, 1000 + 280, -0.12);
    expect(b.hp).toBe(MAX_HP);
  });
});

describe('headshots', () => {
  it('a shot at head height does double damage and is reported', () => {
    const { w, a, b } = duel();
    const ev = w.shoot('a', 0, 10_000, 0);
    expect(MAX_HP - b.hp).toBe(Math.min(MAX_HP, WEAPONS.pistol.damage * 2));
    expect(ev.find((e) => e.ev === 'fps_hit')?.data.head).toBe(true);
    expect(a.headshots).toBe(1);
  });
});

/** Kills b n times (respawning it in place each time). */
function farm(w: ArenaWorld, n: number, start = 10_000) {
  const events = [];
  let t = start;
  w.switchWeapon('a', 'sniper', 0);
  for (let i = 0; i < n; i++) {
    const b = w.fighters.get('b')!;
    Object.assign(b, { alive: true, hp: 1, x: 6, y: 2, z: 0 });
    w.fighters.get('a')!.ammo.sniper = 5;
    events.push(...w.shoot('a', 0, t));
    t += 2000;
  }
  return { events, t };
}

describe('killstreaks', () => {
  it('count kills and reset on death', () => {
    const { w, a } = duel();
    farm(w, 2);
    expect(a.streak).toBe(2);
    a.hp = 1;
    w.fighters.get('b')!.alive = true;
    Object.assign(w.fighters.get('b')!, { x: 6, y: 2, weapon: 'pistol', switchedAt: -1e9 });
    w.shoot('b', Math.PI, 30_000);
    expect(a.alive).toBe(false);
    expect(a.streak).toBe(0);
    expect(a.kills).toBe(2);
  });
  it('3 kills gives the radar for 20s', () => {
    const { w, a } = duel();
    const { events, t } = farm(w, 3);
    expect(events.find((e) => e.ev === 'fps_streak')?.data.kind).toBe('uav');
    const lastKill = t - 2000;
    expect(a.uavUntil).toBe(lastKill + UAV_MS);
    expect(w.snapshot(lastKill).players.find((p) => p.id === 'a')!.uav).toBe(UAV_MS);
  });
  it('5 kills calls an airstrike that waits for a live enemy, tracks them and kills them', () => {
    const { w, a } = duel();
    const { events, t } = farm(w, 5);
    expect(events.some((e) => e.ev === 'fps_strike')).toBe(true);
    const marked = t - 2000;
    const b = w.fighters.get('b')!;
    expect(b.alive).toBe(false);
    // The only enemy is dead, so the strike is pending, not wasted on an empty aim point.
    w.tick(marked + 500);
    expect(w.strikes).toHaveLength(1);
    expect(w.snapshot(marked + 500).strikes[0].inMs).toBe(-1);
    // Bob respawns; the strike locks on to him.
    Object.assign(b, { alive: true, hp: MAX_HP, x: 12, y: 2 });
    const aimed = marked + 1000;
    w.tick(aimed);
    expect(w.strikes[0].trackId).toBe('b');
    // He walks a bit before lock-on; the zone follows.
    b.x = 15;
    w.tick(aimed + AIRSTRIKE_DELAY_MS - AIRSTRIKE_LOCK_MS - 10);
    expect(w.strikes[0].x).toBe(15);
    let ev: ReturnType<ArenaWorld['tick']> = [];
    for (let dt = 0; dt <= 600; dt += 50) ev = ev.concat(w.tick(aimed + AIRSTRIKE_DELAY_MS + dt));
    expect(ev.filter((e) => e.ev === 'fps_boom')).toHaveLength(3);
    const kill = ev.find((e) => e.ev === 'fps_kill');
    expect(kill?.data).toMatchObject({ killerId: 'a', victimId: 'b', cause: 'airstrike' });
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(6);
    expect(a.alive).toBe(true);
    expect(w.strikes).toHaveLength(0);
  });
  it('an airstrike can be outrun after lock-on, and spares the caller', () => {
    const { w, a } = duel();
    const { t } = farm(w, 5);
    const b = w.fighters.get('b')!;
    Object.assign(b, { alive: true, hp: MAX_HP, x: 16, y: 2 });
    const aimed = t - 2000 + 100;
    w.tick(aimed);
    w.tick(aimed + AIRSTRIKE_DELAY_MS - AIRSTRIKE_LOCK_MS + 10); // locked at x=16
    b.x = 2.5; // sprints next to the caller
    a.x = 2;
    for (let dt = 0; dt <= 600; dt += 50) w.tick(aimed + AIRSTRIKE_DELAY_MS + dt);
    expect(b.hp).toBe(MAX_HP);
    expect(a.hp).toBe(MAX_HP);
  });
  it('an airstrike with no enemies eventually drops on the aim point', () => {
    const { w } = duel();
    const { t } = farm(w, 5);
    w.leave('b');
    const ev = w.tick(t - 2000 + AIRSTRIKE_WAIT_MS + 1);
    expect(ev.some((e) => e.ev === 'fps_boom')).toBe(true);
    expect(w.strikes).toHaveLength(0);
  });
  it('7 kills launches a drone that shoots enemies, then leaves', () => {
    const { w } = duel();
    const { t } = farm(w, 7);
    const start = t - 2000;
    expect(w.drones.has('a')).toBe(true);
    const b = w.fighters.get('b')!;
    Object.assign(b, { alive: true, hp: MAX_HP, x: 5, y: 2 });
    w.tick(start + 1000);
    expect(b.hp).toBeLessThan(MAX_HP);
    w.tick(start + DRONE_MS);
    expect(w.drones.has('a')).toBe(false);
  });
  it('11 kills arms the nuke: everyone goes down and the round resets', () => {
    const { w, a } = duel();
    const c = w.join('c', 'Cy', 0);
    const { events, t } = farm(w, 11);
    expect(events.some((e) => e.ev === 'fps_nuke' && e.data.phase === 'armed')).toBe(true);
    const armed = t - 2000;
    Object.assign(w.fighters.get('b')!, { alive: true, hp: MAX_HP });
    // c now spawns on open floor (spawns are wall-checked), so the drone may have tagged it while farming.
    Object.assign(c, { alive: true, hp: MAX_HP, respawnAt: 0 });
    w.drones.clear();
    w.strikes = [];
    w.tick(armed + NUKE_DELAY_MS - 1);
    expect(c.alive).toBe(true);
    const ev = w.tick(armed + NUKE_DELAY_MS);
    expect(ev.some((e) => e.ev === 'fps_nuke' && e.data.phase === 'boom')).toBe(true);
    for (const f of w.fighters.values()) {
      expect(f.alive).toBe(false);
      expect(f.kills).toBe(0);
      expect(f.streak).toBe(0);
    }
    expect(a.deaths).toBe(0);
    // Everyone redeploys (the match keeps going) with every gun refilled, even ones emptied before the nuke.
    Object.assign(a, { weapon: 'smg', reloadUntil: 0 });
    a.ammo.smg = 12; a.ammo.sniper = 0; a.ammo.rocket = 0;
    c.ammo.pistol = 3;
    w.tick(armed + NUKE_DELAY_MS + NUKE_RESPAWN_MS + 1);
    for (const f of w.fighters.values()) {
      expect(f.alive).toBe(true);
      for (const id of WEAPON_ORDER) expect(f.ammo[id]).toBe(WEAPONS[id].mag);
      expect(f.reloadUntil).toBe(0);
    }
  });
  it('every normal respawn refills all weapons too', () => {
    const { w, a, b } = duel();
    b.ammo.smg = 1; b.ammo.shotgun = 0; b.weapon = 'smg';
    b.hp = 1;
    w.shoot('a', 0, 10_000);
    expect(b.alive).toBe(false);
    w.tick(b.respawnAt + 1);
    expect(b.alive).toBe(true);
    for (const id of WEAPON_ORDER) expect(b.ammo[id]).toBe(WEAPONS[id].mag);
    void a;
  });
});
