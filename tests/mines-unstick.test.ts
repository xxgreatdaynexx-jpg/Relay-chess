import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MinesWorld, MineError, resetMines } from '../server/mines';
import { canStand, moveHorizontal, applyKnockback, depenetrate, entranceStand, nearestStand, type Body } from '../shared/fps';
import { CAVES, MINE_MAP, inExit, UNSTICK_COOLDOWN_MS, UNSTICK_AUTO_MS } from '../shared/mines';
import { levelOf, MAX_FLOOR, hasFloors } from '../shared/mineFloors';
import { expectChangelogEntry } from './helpers/changelog';
import type { CaveId } from '../shared/mines';

let w: MinesWorld;
beforeEach(() => { w = resetMines(); });

const body = (x: number, y: number, z = 0): Body => ({ x, y, z, vz: 0, grounded: true });

/** A standable point with a solid wall a short step along `dir`. */
function standByWall(map = MINE_MAP, dir: { dx: number; dy: number } = { dx: 1, dy: 0 }) {
  const len = Math.hypot(dir.dx, dir.dy) || 1;
  const ux = dir.dx / len, uy = dir.dy / len;
  for (let y = 1; y < map.d - 1; y += 0.5) for (let x = 1; x < map.w - 1; x += 0.5) {
    if (!canStand(x, y, 0, map)) continue;
    if (!canStand(x + ux * 1.2, y + uy * 1.2, 0, map) && canStand(x - ux * 0.2, y - uy * 0.2, 0, map)) {
      return { x, y, ux, uy };
    }
  }
  throw new Error('no wall-adjacent stand found');
}

describe('depenetration and safe spawn', () => {
  it('pushes a body spawned inside rock out to a standable cell', () => {
    // Centre of the border wall cell (0,0): definitely solid.
    const b = body(1, 1);
    expect(canStand(b.x, b.y, 0, MINE_MAP)).toBe(false);
    depenetrate(b, MINE_MAP);
    expect(canStand(b.x, b.y, b.z, MINE_MAP)).toBe(true);
    expect(Math.hypot(b.x - 1, b.y - 1)).toBeLessThan(8);
  });

  it('every cave floor entrance is standable, including generated deep floors', () => {
    const caves = Object.keys(CAVES) as CaveId[];
    for (const c of caves) {
      const last = hasFloors(c) ? MAX_FLOOR : 1;
      for (const f of [1, 2, 5, 10, 20, last]) {
        if (f > last) continue;
        const map = levelOf(c, f).map;
        const e = entranceStand(map);
        expect(canStand(e.x, e.y, e.z, map), `${c} floor ${f} entrance`).toBe(true);
        for (const s of map.spawns) expect(canStand(s[0], s[1], s[2] ?? 0, map), `${c} f${f} spawn ${s}`).toBe(true);
      }
    }
  });

  it('join and setFloor never place the miner inside rock', () => {
    const m = w.join('a', 'QA-Unstick', 0);
    expect(canStand(m.x, m.y, m.z, w.mapOf(m))).toBe(true);
    w.setFloor(m, 7, 1000);
    expect(m.floor).toBe(7);
    expect(canStand(m.x, m.y, m.z, w.mapOf(m))).toBe(true);
  });
});

describe('knockback into a wall', () => {
  it('does not place the miner inside solid (the old raw += would)', () => {
    const at = standByWall(MINE_MAP, { dx: 1, dy: 0 });
    const raw = body(at.x, at.y);
    raw.x += at.ux * 1.6; raw.y += at.uy * 1.6;
    expect(canStand(raw.x, raw.y, 0, MINE_MAP), 'unclamped knockback would clip the wall').toBe(false);

    const b = body(at.x, at.y);
    const applied = applyKnockback(b, at.ux * 1.6, at.uy * 1.6, MINE_MAP);
    expect(canStand(b.x, b.y, b.z, MINE_MAP)).toBe(true);
    expect(Math.hypot(applied.kx, applied.ky)).toBeLessThan(1.6);
    // Still on the open side — did not tunnel through the slab.
    expect(canStand(b.x + at.ux * 0.15, b.y + at.uy * 0.15, 0, MINE_MAP) === false || Math.hypot(b.x - at.x, b.y - at.y) < 1.2).toBe(true);
  });

  it('server hurt knockback stops at rock and keeps the miner standable', () => {
    const m = w.join('a', 'QA-Unstick', 0);
    const at = standByWall(w.mapOf(m), { dx: 1, dy: 0 });
    m.x = at.x; m.y = at.y; m.z = 0;
    const applied = applyKnockback(m, at.ux * 2.2, at.uy * 2.2, w.mapOf(m), { minX: 8.5 });
    expect(canStand(m.x, m.y, m.z, w.mapOf(m))).toBe(true);
    expect(Math.hypot(applied.kx, applied.ky)).toBeLessThan(2.2);
  });
});

describe('large-dt tunnelling', () => {
  it('a multi-metre dash into a wall does not pop out the other side or end inside rock', () => {
    const at = standByWall(MINE_MAP, { dx: 1, dy: 0 });
    const dash = 8; // well above a 500ms sprint step
    // Naive teleport would skip through a 2-unit wall.
    const naive = body(at.x, at.y);
    naive.x += at.ux * dash; naive.y += at.uy * dash;
    const b = body(at.x, at.y);
    moveHorizontal(b, at.ux * dash, at.uy * dash, MINE_MAP);
    expect(canStand(b.x, b.y, b.z, MINE_MAP)).toBe(true);
    // Did not travel nearly the full dash (the wall stopped us).
    expect(Math.hypot(b.x - at.x, b.y - at.y)).toBeLessThan(2);
    // And we are not at the naive far-side point.
    expect(Math.hypot(b.x - naive.x, b.y - naive.y)).toBeGreaterThan(3);
  });

  it('moveHorizontal unsticks a body that started already inside solid', () => {
    const b = body(1, 1);
    expect(canStand(b.x, b.y, 0, MINE_MAP)).toBe(false);
    moveHorizontal(b, 0.1, 0, MINE_MAP);
    expect(canStand(b.x, b.y, b.z, MINE_MAP)).toBe(true);
  });
});

describe('unstick safety net', () => {
  it('manual Unstick / /stuck teleports to the floor entrance without changing ore, floor or deepest', () => {
    const m = w.join('a', 'QA-Unstick', 0);
    w.setFloor(m, 6, 1000);
    m.deepest = 12;
    const floor = m.floor;
    const map = w.mapOf(m);
    // Walk the miner out toward the ladder (far from the lift).
    const far = nearestStand(90, 12, 0, map);
    expect(far).toBeTruthy();
    m.x = far!.x; m.y = far!.y; m.z = far!.z;
    m.carried.set('ore:iron', { type: 'ore', id: 'iron', qty: 4 });
    const before = w.carried('a');
    const r = w.unstick('a', 2000, 'manual');
    expect(r.floor).toBe(floor);
    expect(m.floor).toBe(floor);
    expect(m.deepest).toBe(12);
    expect(w.carried('a')).toEqual(before);
    expect(canStand(m.x, m.y, m.z, map)).toBe(true);
    expect(inExit(m.x, m.y) || Math.hypot(m.x - entranceStand(map).x, m.y - entranceStand(map).y) < 4).toBe(true);
    expect(Math.hypot(m.x - far!.x, m.y - far!.y)).toBeGreaterThan(20);
  });

  it('manual unstick has a short cooldown and auto unstick pulls out of a wall', () => {
    const m = w.join('a', 'QA-Unstick', 0);
    w.unstick('a', 1000, 'manual');
    expect(() => w.unstick('a', 1000 + UNSTICK_COOLDOWN_MS - 1, 'manual')).toThrow(MineError);
    expect(() => w.unstick('a', 1000 + UNSTICK_COOLDOWN_MS - 1, 'manual')).toThrow(/wait/i);
    expect(() => w.unstick('a', 1000 + UNSTICK_COOLDOWN_MS, 'manual')).not.toThrow();

    // Auto: drop them in the border wall; they should pop to a nearby open tile, not skip a floor.
    m.x = 1; m.y = 1; m.z = 0; m.floor = 1; m.deepest = 1;
    expect(canStand(m.x, m.y, 0, w.mapOf(m))).toBe(false);
    const auto = w.unstick('a', 50_000, 'auto');
    expect(auto.via).toBe('auto');
    expect(m.floor).toBe(1);
    expect(m.deepest).toBe(1);
    expect(canStand(m.x, m.y, m.z, w.mapOf(m))).toBe(true);
    expect(() => w.unstick('nobody', 0, 'manual')).toThrow(/join/i);
  });

  it('auto unstick of a free miner does not teleport them to the entrance', () => {
    const m = w.join('a', 'QA-Unstick', 0);
    const map = w.mapOf(m);
    const far = nearestStand(90, 12, 0, map)!;
    m.x = far.x; m.y = far.y; m.z = far.z;
    w.unstick('a', 1000, 'auto');
    expect(Math.hypot(m.x - far.x, m.y - far.y)).toBeLessThan(0.01);
  });
});

describe('mine UI safety net', () => {
  it('the mine has an Unstick button, uses collision-aware knockback, and auto-unsticks after ~0.5s', () => {
    const src = readFileSync(new URL('../client/src/components/MinesPanel.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/data-testid="mines-unstick"/);
    expect(src).toMatch(/requestUnstick/);
    expect(src).toMatch(/applyKnockback/);
    expect(src).not.toMatch(/m\.x \+= h\.kx/);
    expect(src).toMatch(/UNSTICK_AUTO_MS/);
    expect(UNSTICK_AUTO_MS).toBe(500);
    expect(src).toMatch(/mines_unstick/);
    expect(src).toMatch(/\/stuck/);
  });

  it('chat intercepts /stuck and /unstick instead of broadcasting them', () => {
    const src = readFileSync(new URL('../client/src/components/ChatDrawer.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/stuck\|unstick/);
    expect(src).toMatch(/mines_unstick/);
  });
});

describe('changelog', () => {
  it('records the stuck-in-wall fix', () => {
    expectChangelogEntry(/stuck in the walls/i, { from: '2026-11-09T00:00:00-06:00', to: '2026-11-10T00:00:00-06:00' });
  });
});
