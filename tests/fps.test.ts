import { describe, expect, it } from 'vitest';
import {
  applyDamage, canStand, castRay, DAMAGE, guestName, hitscan, MAX_HP, maybeRespawn, normAngle,
  RESPAWN_MS, validateMove, type Fighter,
} from '../shared/fps.js';

const BOX = ['#####', '#...#', '#...#', '#...#', '#####'];
const WALLED = ['#######', '#..#..#', '#######'];

function fighter(id: string, x: number, y: number, a = 0): Fighter {
  return { id, name: id, x, y, a, hp: MAX_HP, kills: 0, deaths: 0, alive: true, respawnAt: 0, lastShot: 0, lastMove: 0 };
}

describe('raycast', () => {
  it('hits the east wall at the right distance', () => {
    const hit = castRay(1.5, 2.5, 0, BOX);
    expect(hit.dist).toBeCloseTo(2.5, 5);
    expect(hit.cellX).toBe(4);
  });
  it('hits the north wall looking up', () => {
    const hit = castRay(2.5, 2.5, -Math.PI / 2, BOX);
    expect(hit.dist).toBeCloseTo(1.5, 5);
    expect(hit.side).toBe(1);
  });
  it('handles diagonals', () => {
    const hit = castRay(2.5, 2.5, Math.PI / 4, BOX);
    expect(hit.dist).toBeGreaterThan(2);
    expect(hit.dist).toBeLessThan(2.2);
  });
});

describe('hitscan', () => {
  it('hits a target straight ahead', () => {
    expect(hitscan({ id: 'a', x: 1.5, y: 2.5, a: 0 }, [{ id: 'b', x: 3, y: 2.5, alive: true }], BOX)?.id).toBe('b');
  });
  it('misses a target off to the side or behind', () => {
    expect(hitscan({ id: 'a', x: 1.5, y: 2.5, a: 0 }, [{ id: 'b', x: 3, y: 1.5, alive: true }], BOX)).toBeNull();
    expect(hitscan({ id: 'a', x: 2.5, y: 2.5, a: Math.PI }, [{ id: 'b', x: 3.2, y: 2.5, alive: true }], BOX)).toBeNull();
  });
  it('cannot shoot through walls', () => {
    expect(hitscan({ id: 'a', x: 1.5, y: 1.5, a: 0 }, [{ id: 'b', x: 4.5, y: 1.5, alive: true }], WALLED)).toBeNull();
  });
  it('picks the nearest target and ignores self and dead', () => {
    const r = hitscan({ id: 'a', x: 1.2, y: 2.5, a: 0 }, [
      { id: 'a', x: 1.2, y: 2.5, alive: true },
      { id: 'dead', x: 1.8, y: 2.5, alive: false },
      { id: 'far', x: 3.5, y: 2.5, alive: true },
      { id: 'near', x: 2.5, y: 2.5, alive: true },
    ], BOX);
    expect(r?.id).toBe('near');
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
  it('respawns only after the timer, at full health', () => {
    const f = fighter('b', 2, 2);
    f.hp = 0; f.alive = false; f.respawnAt = 5000;
    expect(maybeRespawn(f, 4999, [f])).toBe(false);
    expect(maybeRespawn(f, 5000, [f, fighter('c', 1.5, 1.5)])).toBe(true);
    expect(f.alive).toBe(true);
    expect(f.hp).toBe(MAX_HP);
    expect(canStand(f.x, f.y)).toBe(true);
  });
});

describe('move validation', () => {
  it('clamps teleports to the speed limit', () => {
    const p = validateMove({ x: 1.5, y: 1.5 }, 14.5, 1.5, 100);
    expect(p.x - 1.5).toBeLessThan(0.7);
  });
  it('rejects junk and walls', () => {
    expect(validateMove({ x: 1.5, y: 1.5 }, 'x', NaN, 100)).toEqual({ x: 1.5, y: 1.5 });
    const p = validateMove({ x: 2.5, y: 2.5 }, 3.9, 2.5, 500, BOX);
    expect(p.x).toBe(2.5);
  });
  it('normalizes angles and names guests', () => {
    expect(normAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2);
    expect(normAngle('a')).toBeNull();
    expect(guestName(() => 0.5)).toBe('Guest550');
  });
});
