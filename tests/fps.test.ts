import { describe, expect, it } from 'vitest';
import {
  applyDamage, canStand, DAMAGE, dirFrom, EYE_HEIGHT, gridMap, groundAt, guestName, hitscan, JUMP_APEX, MAP, MAX_HP, maybeRespawn,
  moveHorizontal, normAngle, rayWorld, RESPAWN_MS, stepVertical, STEP_HEIGHT, tryJump, validateMove, type ArenaMap, type Body, type Fighter,
} from '../shared/fps.js';

const BOX = gridMap(['#####', '#...#', '#...#', '#...#', '#####']);
const WALLED = gridMap(['#######', '#..#..#', '#######']);
/** Flat 12×6 yard with a crate (0.9 tall), a tall crate (1.6), stairs and a 3 m catwalk on posts. */
const YARD: ArenaMap = {
  ...gridMap(['############', '#..........#', '#..........#', '#..........#', '#..........#', '############']),
  id: 'yard',
};
YARD.solids.push(
  { x0: 3, y0: 1, x1: 4, y1: 2, z0: 0, z1: 0.9, mat: 'crate' },
  { x0: 5, y0: 1, x1: 6, y1: 2, z0: 0, z1: 1.6, mat: 'crate' },
  { x0: 7, y0: 3, x1: 8, y1: 4, z0: 0, z1: 0.3, mat: 'concrete' },
  { x0: 8, y0: 3, x1: 9, y1: 4, z0: 0, z1: 0.6, mat: 'concrete' },
  { x0: 2, y0: 3.5, x1: 6, y1: 4.5, z0: 2.7, z1: 3, mat: 'metal' },
);

function body(x: number, y: number, z = 0): Body { return { x, y, z, vz: 0, grounded: true }; }
function fighter(id: string, x: number, y: number, a = 0): Fighter {
  return { id, name: id, x, y, z: 0, vz: 0, grounded: true, p: 0, a, hp: MAX_HP, kills: 0, deaths: 0, alive: true, respawnAt: 0, lastShot: 0, lastMove: 0 };
}
/** Runs vertical physics for `ms` in 15 Hz server ticks. */
function fall(b: Body, ms: number, map: ArenaMap) { for (let t = 0; t < ms; t += 66) stepVertical(b, 0.066, map); }
const eye = (x: number, y: number, z = 0) => ({ x, y, z: z + EYE_HEIGHT });

describe('3D raycast', () => {
  it('hits the east wall at the right distance', () => {
    expect(rayWorld(eye(1.5, 2.5), dirFrom(0, 0), BOX, 20)).toBeCloseTo(2.5, 5);
  });
  it('hits the floor when looking down and flies over a low crate when looking up', () => {
    expect(rayWorld(eye(1.5, 2.5), dirFrom(0, -Math.PI / 4), BOX, 20)).toBeCloseTo(EYE_HEIGHT * Math.SQRT2, 3);
    // Level shot at a 0.9 m crate passes over it; a downward one hits it.
    expect(rayWorld(eye(1.5, 1.5), dirFrom(0, 0), YARD, 3)).toBe(3);
    expect(rayWorld(eye(1.5, 1.5), dirFrom(0, -0.4), YARD, 3)).toBeLessThan(3);
  });
});

describe('hitscan with height', () => {
  const shooter = { id: 'a', x: 1.5, y: 2.5, z: 0, a: 0, p: 0 };
  it('a level shot at someone standing at the same height is a headshot', () => {
    expect(hitscan(shooter, [{ id: 'b', x: 3.5, y: 2.5, z: 0, alive: true }], BOX)).toMatchObject({ id: 'b', head: true });
  });
  it('aiming at the chest is a body shot', () => {
    const p = -Math.atan2(EYE_HEIGHT - 1, 2);
    expect(hitscan({ ...shooter, p }, [{ id: 'b', x: 3.5, y: 2.5, z: 0, alive: true }], BOX)).toMatchObject({ id: 'b', head: false });
  });
  it('shooting over the head of someone below, or under someone up high, misses', () => {
    expect(hitscan({ ...shooter, p: 0.6 }, [{ id: 'b', x: 3.5, y: 2.5, z: 0, alive: true }], BOX)).toBeNull();
    expect(hitscan(shooter, [{ id: 'b', x: 3.5, y: 2.5, z: 2.5, alive: true }], BOX)).toBeNull();
  });
  it('can hit someone up on a catwalk by aiming up', () => {
    const target = [{ id: 'b', x: 4.5, y: 4, z: 3, alive: true }];
    const a = Math.atan2(2, 3);
    expect(hitscan({ id: 'a', x: 1.5, y: 2, z: 0, a, p: 0 }, target, YARD)).toBeNull();
    const p = Math.atan2(3 + 1 - EYE_HEIGHT, Math.hypot(3, 2));
    expect(hitscan({ id: 'a', x: 1.5, y: 2, z: 0, a, p }, target, YARD)?.id).toBe('b');
  });
  it('a catwalk floor blocks shots from below', () => {
    const p = Math.atan2(3 + 1 - EYE_HEIGHT, 0.6);
    expect(hitscan({ id: 'a', x: 3.9, y: 4, z: 0, a: 0, p }, [{ id: 'b', x: 4.5, y: 4, z: 3, alive: true }], YARD)).toBeNull();
  });
  it('cannot shoot through walls, ignores self and dead, picks the nearest', () => {
    expect(hitscan({ id: 'a', x: 1.5, y: 1.5, z: 0, a: 0, p: 0 }, [{ id: 'b', x: 4.5, y: 1.5, z: 0, alive: true }], WALLED)).toBeNull();
    const r = hitscan({ id: 'a', x: 1.2, y: 2.5, z: 0, a: 0, p: 0 }, [
      { id: 'a', x: 1.2, y: 2.5, z: 0, alive: true },
      { id: 'dead', x: 1.8, y: 2.5, z: 0, alive: false },
      { id: 'far', x: 3.5, y: 2.5, z: 0, alive: true },
      { id: 'near', x: 2.5, y: 2.5, z: 0, alive: true },
    ], BOX);
    expect(r?.id).toBe('near');
  });
});

describe('3D movement', () => {
  it('walks up low steps but not into a crate', () => {
    const b = body(6.5, 3.5);
    moveHorizontal(b, 1, 0, YARD);
    expect(b.x).toBeCloseTo(7.5);
    expect(b.z).toBeCloseTo(0.3);
    moveHorizontal(b, 1, 0, YARD);
    expect(b.z).toBeCloseTo(0.6);
    const c = body(2.2, 1.5);
    moveHorizontal(c, 1, 0, YARD);
    expect(c.x).toBeLessThan(3);
    expect(c.z).toBe(0);
  });
  it('jumps onto a 0.9 m crate but not a 1.6 m one', () => {
    expect(JUMP_APEX).toBeGreaterThan(0.9 + 0.1);
    expect(JUMP_APEX).toBeLessThan(1.6);
    const b = body(2.5, 1.5);
    expect(tryJump(b)).toBe(true);
    expect(tryJump(b)).toBe(false); // no double jumps
    for (let i = 0; i < 20; i++) { stepVertical(b, 0.025, YARD); moveHorizontal(b, 0.06, 0, YARD); }
    fall(b, 1000, YARD);
    expect(b.x).toBeGreaterThan(3.2);
    expect(b.z).toBeCloseTo(0.9);
    expect(b.grounded).toBe(true);
    const c = body(4.5, 1.5);
    tryJump(c);
    for (let i = 0; i < 20; i++) { stepVertical(c, 0.025, YARD); moveHorizontal(c, 0.06, 0, YARD); }
    fall(c, 1000, YARD);
    expect(c.x).toBeLessThan(5);
    expect(c.z).toBe(0);
  });
  it('falls off a ledge and lands on the ground', () => {
    const b = body(3.5, 1.5, 0.9);
    moveHorizontal(b, -1, 0, YARD);
    expect(b.grounded).toBe(false);
    fall(b, 1000, YARD);
    expect(b.z).toBe(0);
    expect(b.grounded).toBe(true);
  });
  it('bumps its head on the catwalk', () => {
    const b = body(4, 4);
    tryJump(b);
    let top = 0;
    for (let t = 0; t < 1000; t += 16) { stepVertical(b, 0.016, YARD); top = Math.max(top, b.z); }
    expect(top).toBeLessThan(2.7 - 1.6);
  });
  it('the Dunes map has walkable spawns and real height (stairs, plateau, catwalk)', () => {
    for (const [x, y, z] of MAP.spawns) expect(canStand(x, y, groundAt(x, y, z + STEP_HEIGHT, MAP), MAP)).toBe(true);
    const heights = new Set(MAP.solids.map((s) => Math.round(s.z1)));
    expect([...heights].some((h) => h >= 3)).toBe(true);
    expect(MAP.ramps.length).toBeGreaterThan(0);
  });
});

describe('server move validation', () => {
  it('clamps teleports to the speed limit', () => {
    const b = body(1.5, 1.5);
    validateMove(b, 14.5, 1.5, 100, YARD);
    expect(b.x - 1.5).toBeLessThan(0.8);
  });
  it('rejects junk and walls', () => {
    const b = validateMove(body(1.5, 1.5), 'x', NaN, 100, YARD);
    expect([b.x, b.y]).toEqual([1.5, 1.5]);
    const w = validateMove(body(2.5, 2.5), 3.9, 2.5, 500, BOX);
    expect(w.x).toBeLessThan(3.71);
  });
  it('never lets the client choose its height: no flying, only server gravity', () => {
    const b = body(1.5, 1.5);
    validateMove(b, 1.6, 1.5, 100, YARD);
    expect(b.z).toBe(0);
    const up = body(4.5, 4);
    tryJump(up);
    fall(up, 2000, YARD);
    expect(up.z).toBe(0);
  });
});

describe('damage and respawn', () => {
  it('takes three hits to eliminate someone', () => {
    const f = fighter('b', 2, 2);
    expect(applyDamage(f, 0)).toBe(false);
    expect(applyDamage(f, 0)).toBe(false);
    expect(f.hp).toBe(MAX_HP - 2 * DAMAGE);
    expect(applyDamage(f, 1000)).toBe(true);
    expect(f.alive).toBe(false);
    expect(f.deaths).toBe(1);
    expect(f.respawnAt).toBe(1000 + RESPAWN_MS);
    expect(applyDamage(f, 1000)).toBe(false);
  });
  it('respawns only after the timer, at full health, standing on something', () => {
    const f = fighter('b', 2, 2);
    f.hp = 0; f.alive = false; f.respawnAt = 5000; f.z = -3;
    expect(maybeRespawn(f, 4999, [f])).toBe(false);
    expect(maybeRespawn(f, 5000, [f, fighter('c', 1.5, 1.5)])).toBe(true);
    expect(f.alive).toBe(true);
    expect(f.hp).toBe(MAX_HP);
    expect(canStand(f.x, f.y, f.z)).toBe(true);
    expect(groundAt(f.x, f.y, f.z + 0.01, MAP)).toBeCloseTo(f.z);
  });
  it('normalizes angles and names guests', () => {
    expect(normAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2);
    expect(normAngle('a')).toBeNull();
    expect(guestName(() => 0.5)).toBe('Guest550');
  });
});
