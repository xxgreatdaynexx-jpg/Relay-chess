import { describe, expect, it } from 'vitest';
import {
  canStand, groundAt, MAPS, mapById, moveHorizontal, MOVE_SPEED, PLAYER_HEIGHT, stepVertical, tryJump, type ArenaMap, type Body,
} from '../shared/fps.js';
import { isMapId, MAP_ROTATION } from '../shared/arenaMaps.js';

/** Lets a body settle onto whatever is below it (up to 3 s of simulated falling). */
function settle(b: Body, map: ArenaMap): Body {
  for (let i = 0; i < 60 && !b.grounded; i++) stepVertical(b, 0.05, map);
  return b;
}

/**
 * Flood-fills where a player can get to on foot using the real game physics: walking (with step-ups, ramps and
 * stairs) and running jumps in 8 directions. Nodes are 1-unit cells per height, so it is coarse but honest.
 */
function reachable(map: ArenaMap, start: [number, number, number]): Body[] {
  const key = (b: Body) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.z * 4)}`;
  const first = settle({ x: start[0], y: start[1], z: start[2], vz: 0, grounded: false }, map);
  const seen = new Map<string, Body>([[key(first), first]]);
  const queue = [first];
  const dirs = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
  const visit = (b: Body) => {
    if (!b.grounded) return;
    const k = key(b);
    if (!seen.has(k)) { seen.set(k, b); queue.push(b); }
  };
  while (queue.length) {
    const n = queue.shift()!;
    for (const [dx, dy] of dirs) {
      // walk one unit
      const w: Body = { ...n };
      for (let i = 0; i < 4; i++) { moveHorizontal(w, dx * 0.25, dy * 0.25, map); stepVertical(w, 0.05, map); }
      settle(w, map);
      visit(w);
      // running jump
      const j: Body = { ...n };
      if (tryJump(j)) {
        const step = MOVE_SPEED * 0.05;
        for (let i = 0; i < 30; i++) {
          moveHorizontal(j, dx * step, dy * step, map);
          stepVertical(j, 0.05, map);
          if (j.grounded) break;
        }
        settle(j, map);
        visit(j);
      }
    }
  }
  return [...seen.values()];
}

const near = (spots: Body[], [x, y, z]: [number, number, number]) => spots.some((b) => Math.hypot(b.x - x, b.y - y) < 1.6 && Math.abs(b.z - z) < 0.3);

describe('arena maps', () => {
  it('has at least three maps, all in the rotation, and they load', () => {
    expect(Object.keys(MAPS).length).toBeGreaterThanOrEqual(3);
    expect(new Set(MAP_ROTATION)).toEqual(new Set(Object.keys(MAPS)));
    for (const id of MAP_ROTATION) {
      const m = mapById(id);
      expect(m.id).toBe(id);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.solids.length).toBeGreaterThan(20);
      expect(m.spawns.length).toBeGreaterThanOrEqual(12);
      expect((m.levels ?? []).length).toBeGreaterThanOrEqual(3);
      for (const s of m.solids) { expect(s.x1).toBeGreaterThan(s.x0); expect(s.y1).toBeGreaterThan(s.y0); expect(s.z1).toBeGreaterThan(s.z0); }
    }
  });

  it('validates map ids (unknown, prototype keys and junk fall back to the default)', () => {
    expect(isMapId('depot')).toBe(true);
    for (const bad of ['', 'nope', '__proto__', 'constructor', 'toString', 7, null, undefined, { id: 'depot' }]) {
      expect(isMapId(bad)).toBe(false);
      expect(mapById(bad).id).toBe('dunes');
    }
  });

  for (const id of Object.keys(MAPS)) {
    const map = MAPS[id];
    it(`${map.name}: every spawn stands on a surface, inside the map and clear of geometry`, () => {
      for (const [x, y, z] of map.spawns) {
        expect(x > 0.5 && x < map.w - 0.5 && y > 0.5 && y < map.d - 0.5).toBe(true);
        expect(groundAt(x, y, z + 0.45, map)).toBeCloseTo(z, 5);
        expect(canStand(x, y, z, map)).toBe(true);
        // headroom: nothing within a player's height above the feet
        const b: Body = { x, y, z, vz: 0, grounded: true };
        expect(tryJump(b)).toBe(true);
        stepVertical(b, 0.05, map);
        expect(b.z).toBeGreaterThan(z);
        expect(PLAYER_HEIGHT).toBeLessThan(2);
      }
    });
    it(`${map.name}: every walkable level and every spawn is reachable on foot from the first spawn`, () => {
      const spots = reachable(map, map.spawns[0]);
      for (const l of map.levels ?? []) expect(near(spots, l.at), `${map.name}: ${l.name}`).toBe(true);
      for (const s of map.spawns) expect(near(spots, s), `${map.name}: spawn ${s.join(',')}`).toBe(true);
    }, 60_000);
  }
});
