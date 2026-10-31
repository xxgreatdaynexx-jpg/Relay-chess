import { describe, expect, it } from 'vitest';
import {
  applyCrouch, canStand, canUncrouch, CROUCH_EYE_HEIGHT, CROUCH_HEIGHT, CROUCH_SPEED_MULT, eyeOf, gridMap, hitscan, moveHorizontal, MOVE_SPEED,
  PLAYER_HEIGHT, rayFighter, speedOf, stepVertical, tryJump, validateMove, EYE_HEIGHT, fireWeapon, WEAPONS, type ArenaMap, type Body,
} from '../shared/fps';
import { PoseHistory } from '../shared/netInterp';
import { ArenaWorld } from '../server/arena-world';

/** Open yard with a low 1.3 m-high table-like slab over x 5..7 (a crouch-only gap). */
const YARD: ArenaMap = { ...gridMap(['############', '#..........#', '#..........#', '#..........#', '############']), id: 'yard' };
YARD.solids.push({ x0: 5, y0: 1, x1: 7, y1: 4, z0: 1.3, z1: 1.6, mat: 'metal' });
const body = (x: number, y: number, crouch = false): Body => ({ x, y, z: 0, vz: 0, grounded: true, crouch });

describe('arena crouch: capsule', () => {
  it('crouched capsule is shorter, eye lower', () => {
    expect(CROUCH_HEIGHT).toBeLessThan(1.3);
    expect(CROUCH_HEIGHT).toBeLessThan(PLAYER_HEIGHT);
    expect(eyeOf({ x: 0, y: 0, z: 0, crouch: true }).z).toBeCloseTo(CROUCH_EYE_HEIGHT);
    expect(eyeOf({ x: 0, y: 0, z: 0 }).z).toBeCloseTo(EYE_HEIGHT);
    expect(canStand(6, 2, 0, YARD)).toBe(false);
    expect(canStand(6, 2, 0, YARD, CROUCH_HEIGHT)).toBe(true);
  });
  it('standing players are blocked by the low slab, crouched ones walk under it', () => {
    const s = body(4, 2), c = body(4, 2, true);
    for (let i = 0; i < 40; i++) { moveHorizontal(s, 0.05, 0, YARD); moveHorizontal(c, 0.05, 0, YARD); }
    expect(s.x).toBeLessThan(5 - 0.29);
    expect(c.x).toBeGreaterThan(5.5);
  });
  it("can't stand up under a low ceiling; stands once clear", () => {
    const b = body(6, 2, true);
    expect(canUncrouch(b, YARD)).toBe(false);
    expect(applyCrouch(b, false, YARD)).toBe(true);
    b.x = 3;
    expect(applyCrouch(b, false, YARD)).toBe(false);
    expect(applyCrouch(b, true, YARD)).toBe(true);
  });
  it('crouched jump bumps its head on the shorter capsule', () => {
    const b = body(6, 2, true);
    tryJump(b);
    for (let i = 0; i < 30; i++) stepVertical(b, 1 / 60, YARD);
    expect(b.z + CROUCH_HEIGHT).toBeLessThanOrEqual(1.3 + 1e-6);
  });
});

describe('arena crouch: speed and accuracy', () => {
  it('moves slower and the server caps crouched moves tighter', () => {
    expect(speedOf({ crouch: true })).toBeCloseTo(MOVE_SPEED * CROUCH_SPEED_MULT);
    const s = validateMove(body(2, 2), 4, 2, 200, YARD), c = validateMove(body(2, 2, true), 4, 2, 200, YARD);
    expect(c.x - 2).toBeLessThan(s.x - 2);
    expect(c.x - 2).toBeLessThanOrEqual(MOVE_SPEED * CROUCH_SPEED_MULT * 0.2 * 1.5 + 0.1 + 1e-6);
  });
  it('crouching tightens spread', () => {
    const rand = () => 1; // max deviation
    const sh = { id: 'a', x: 2, y: 2, z: 0, a: 0, p: 0 };
    const st = fireWeapon(sh, WEAPONS.smg, [], { rand, map: YARD }).rays[0];
    const cr = fireWeapon({ ...sh, crouch: true }, WEAPONS.smg, [], { rand, map: YARD }).rays[0];
    expect(Math.abs(cr.a)).toBeLessThan(Math.abs(st.a));
  });
});

describe('arena crouch: hitboxes', () => {
  const tgt = (crouch: boolean) => ({ id: 't', x: 6, y: 2, z: 0, alive: true, crouch });
  it('a shot at standing head height misses a crouched target, and lower shots hit its head', () => {
    const o = { x: 2, y: 2, z: 1.55 }, d = { x: 1, y: 0, z: 0 };
    expect(rayFighter(o, d, tgt(false))?.head).toBe(true);
    expect(rayFighter(o, d, tgt(true))).toBeNull();
    expect(rayFighter({ x: 2, y: 2, z: 1.02 }, d, tgt(true))?.head).toBe(true);
    expect(rayFighter({ x: 2, y: 2, z: 1.4 }, d, tgt(true))).toBeNull();
  });
  it('hitscan from a crouched shooter starts at the lower eye', () => {
    const t = { id: 't', x: 8, y: 2, z: 0, alive: true };
    const hit = hitscan({ id: 'a', x: 2, y: 2, z: 0, a: 0, p: 0, crouch: true }, [t], YARD);
    expect(hit?.head).toBe(false); // eye at 0.98 hits the body box, not the head
  });
  it('lag-comp history keeps crouch state', () => {
    const h = new PoseHistory();
    h.record('b', 0, 0, 0, 0, true); h.record('b', 100, 1, 0, 0, false);
    expect(h.at('b', 20)?.crouch).toBe(true);
    expect(h.at('b', 80)?.crouch).toBeFalsy();
  });
  it('server rewinds crouch: a target that was crouched at view time dodges a head-height shot, and state is restored', () => {
    const w = new ArenaWorld(gridMap(['####################', '#..................#', '#..................#', '#..................#', '####################']), () => 0.5);
    const a = w.join('a', 'Ann', 0), b = w.join('b', 'Bob', 0);
    Object.assign(a, { x: 2, y: 2, a: 0, p: 0, weapon: 'sniper' });
    Object.assign(b, { x: 8, y: 2, a: Math.PI });
    w.history.record('b', 9800, 8, 2, 0, true);
    w.history.record('b', 9990, 8, 2, 0, false);
    a.switchedAt = -1e9;
    w.setScope('a', true, 0);
    w.shoot('a', 0, 10_000, 0.0, 9800); // flat at standing head height
    expect(b.hp).toBe(100);
    expect(b.crouch).toBeFalsy();
    // And at 9990 (standing) the same shot is a headshot.
    a.lastShotAt.sniper = -1e9; a.ammo.sniper = 5; a.reloadUntil = 0;
    w.shoot('a', 0, 12_000, 0.0, 11_990);
    expect(b.hp).toBeLessThan(100);
  });
  it('server crouch input: stays crouched under a ceiling until clear, snapshot carries it, speed cap applies', () => {
    const w = new ArenaWorld(YARD, () => 0.5);
    const f = w.join('a', 'Ann', 0);
    Object.assign(f, { x: 6, y: 2, z: 0 });
    w.crouch('a', true);
    expect(w.snapshot(0).players[0]).toMatchObject({ c: true });
    w.crouch('a', false);
    w.tick(100);
    expect(f.crouch).toBe(true);
    f.x = 3; w.tick(200);
    expect(f.crouch).toBe(false);
    expect(w.snapshot(200).players[0].c).toBeUndefined();
  });
});

import { canSprint, sprintDirOk, SPRINT_MULT, SPRINT_FIRE_DELAY_MS, SPRINT_FIRE_SLACK_MS } from '../shared/fps';
import { ArenaAntiCheat } from '../server/arena-anticheat';

describe('arena sprint', () => {
  const OPEN = gridMap(['##############################', ...Array(6).fill('#............................#'), '##############################']);
  it('runs at 1.5× and the server cap allows it', () => {
    expect(SPRINT_MULT).toBeCloseTo(1.5);
    expect(speedOf({ sprint: true })).toBeCloseTo(MOVE_SPEED * 1.5);
    expect(speedOf({ sprint: true, crouch: true })).toBeCloseTo(MOVE_SPEED * CROUCH_SPEED_MULT);
  });
  it('forward and diagonal-forward only', () => {
    expect(sprintDirOk(0, 1, 0)).toBe(true);
    expect(sprintDirOk(0, 1, 1)).toBe(true);
    expect(sprintDirOk(0, 1, -1)).toBe(true);
    expect(sprintDirOk(0, 0, 1)).toBe(false);
    expect(sprintDirOk(0, -1, 0)).toBe(false);
    expect(sprintDirOk(Math.PI, -1, 0.01)).toBe(true);
  });
  it('blocked while crouched or scoped', () => {
    expect(canSprint({ a: 0 }, 1, 0, false)).toBe(true);
    expect(canSprint({ a: 0, crouch: true }, 1, 0, false)).toBe(false);
    expect(canSprint({ a: 0 }, 1, 0, true)).toBe(false);
  });
  const world = () => { const w = new ArenaWorld(OPEN, () => 0.5); const f = w.join('a', 'Ann', 0); Object.assign(f, { x: 3, y: 4, z: 0, a: 0, lastMove: 0, physAt: 0 }); return { w, f }; };
  it('server: sprinting forward covers 1.5× ground; sideways sprint requests get normal speed', () => {
    const { w, f } = world();
    let t = 0;
    for (let i = 0; i < 10; i++) { t += 50; w.move('a', f.x + 10, f.y, 0, t, 0, false, true); }
    expect(f.sprint).toBe(true);
    const sprinted = f.x - 3;
    const g = world();
    t = 0;
    for (let i = 0; i < 10; i++) { t += 50; g.w.move('a', g.f.x, g.f.y + 10, 0, t, 0, false, true); }
    expect(g.f.sprint).toBe(false);
    expect(sprinted).toBeGreaterThan((g.f.y - 4) * 1.4);
  });
  it('server: crouch (Ctrl/C) and scope cancel sprint', () => {
    const { w, f } = world();
    w.move('a', f.x + 1, f.y, 0, 50, 0, false, true);
    expect(f.sprint).toBe(true);
    w.crouch('a', true);
    expect(f.sprint).toBe(false);
    w.move('a', f.x + 1, f.y, 0, 100, 0, true, true);
    expect(f.sprint).toBe(false);
    const g = world(); g.f.weapon = 'sniper';
    g.w.move('a', g.f.x + 1, g.f.y, 0, 50, 0, false, true); expect(g.f.sprint).toBe(true);
    g.w.setScope('a', true, 60); expect(g.f.sprint).toBe(false);
  });
  it('server: firing ends the sprint, and the shot needs the sprint-to-fire delay', () => {
    const { w, f } = world();
    f.switchedAt = -1e9;
    w.move('a', f.x + 1, f.y, 0, 1000, 0, false, true);
    expect(f.sprint).toBe(true);
    const ammo = f.ammo[f.weapon];
    w.shoot('a', 0, 1010, 0);
    expect(f.sprint).toBe(false);
    expect(f.ammo[f.weapon]).toBe(ammo);
    w.shoot('a', 0, 1010 + SPRINT_FIRE_DELAY_MS - SPRINT_FIRE_SLACK_MS - 5, 0);
    expect(f.ammo[f.weapon]).toBe(ammo);
    w.shoot('a', 0, 1010 + SPRINT_FIRE_DELAY_MS, 0);
    expect(f.ammo[f.weapon]).toBe(ammo - 1);
  });
  it('anti-cheat: sustained sprinting is never flagged as teleport', () => {
    const w = new ArenaWorld(OPEN, () => 0.5);
    const flags: unknown[] = [];
    w.audit = new ArenaAntiCheat((x) => { flags.push(x); }, () => 'player-key');
    const f = w.join('a', 'Ann', 0); Object.assign(f, { x: 3, y: 4, z: 0, a: 0, lastMove: 0, physAt: 0 });
    expect(w.audit.stats('a')).toBeTruthy();
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += 50;
      const nx = f.x + MOVE_SPEED * SPRINT_MULT * 0.05 * 1.05;
      w.move('a', nx > 26 ? 3 : nx, f.y, 0, t, 0, false, true);
      if (nx > 26) Object.assign(f, { x: 3 });
    }
    expect(f.sprint).toBe(true);
    expect(flags.filter((x) => JSON.stringify(x).includes('teleport'))).toEqual([]);
  });
});
