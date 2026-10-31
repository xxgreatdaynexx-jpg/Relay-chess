import { describe, expect, it } from 'vitest';
import { gridMap, launchRocket } from '../shared/fps.js';
import { ArenaWorld } from '../server/arena-world.js';
import { HOMING_TURN, perksFor } from '../server/arena-anticheat.js';

const WALLED = gridMap(['#############', '#.....#.....#', '#.....#.....#', '#.....#.....#', '#############']);
const OPEN = gridMap(['#############', '#...........#', '#...........#', '#...........#', '#############']);

function setup(map: ReturnType<typeof gridMap>, perk: string | null, by = 3.6) {
  const w = new ArenaWorld(map, () => 0.5);
  const a = w.join('a', 'Ann', 0);
  const b = w.join('b', 'Bob', 0);
  Object.assign(a, { x: 2.5, y: 2.5, z: 0, a: 0, p: 0 });
  Object.assign(b, { x: 8.5, y: by, z: 0, a: Math.PI });
  if (perk) w.perks.set('a', perksFor(perk));
  return { w, a, b };
}
function fire(w: ArenaWorld, a: Parameters<typeof launchRocket>[1], seek: boolean) {
  const r = Object.assign(launchRocket(1, a, 0), seek ? { seek: true as const, lock: w.acquire(launchRocket(1, a, 0)) } : {});
  w.rockets.push(r);
  return r;
}
const heading = (r: { vx: number; vy: number }) => Math.atan2(r.vy, r.vx);

describe('homing RPG perk', () => {
  it('only arenagawd has it', () => {
    expect(perksFor('arenagawd').has('homingRpg')).toBe(true);
    expect(perksFor('dayne').has('homingRpg')).toBe(false);
  });

  it("arenagawd's rocket locks onto an off-axis enemy and curves into them", () => {
    const { w, a, b } = setup(OPEN, 'arenagawd');
    const r = fire(w, a, true);
    expect(r.lock).toBe('b');
    const hp = b.hp;
    let boomed = false;
    for (let t = 50; t <= 3000 && !boomed; t += 50) boomed = w.stepRockets(t).some((e) => e.ev === 'fps_boom');
    expect(boomed).toBe(true);
    expect(b.hp).toBeLessThan(hp - 50); // direct-ish hit, not grazing splash
  });

  it("a normal player's rocket flies straight", () => {
    const { w, a } = setup(OPEN, null);
    const r = fire(w, a, false);
    const h0 = heading(r);
    w.stepRockets(200);
    expect(Math.abs(heading(r) - h0)).toBeLessThan(1e-9);
  });

  it('does not lock outside ~25° cone', () => {
    const { w, a } = setup(OPEN, 'arenagawd', 3.6);
    Object.assign(w.fighters.get('b')!, { x: 3.5, y: 3.9 }); // ~54° off-axis
    expect(w.acquire(launchRocket(1, a, 0))).toBeNull();
  });

  it('turn rate is capped at 120°/s and speed is kept', () => {
    const { w, a, b } = setup(OPEN, 'arenagawd');
    const r = Object.assign(launchRocket(1, a, 0), { lock: 'b' as string | null });
    Object.assign(b, { x: r.x, y: r.y + 1.5 }); // 90° to the side
    const sp = Math.hypot(r.vx, r.vy, r.vz), h0 = heading(r);
    w.steerRocket(r, 0.1);
    const d = Math.acos((Math.cos(h0) * r.vx + Math.sin(h0) * r.vy) / Math.hypot(r.vx, r.vy, r.vz));
    expect(d).toBeLessThanOrEqual(HOMING_TURN * 0.1 + 1e-6);
    expect(d).toBeGreaterThan(HOMING_TURN * 0.1 * 0.9);
    expect(Math.hypot(r.vx, r.vy, r.vz)).toBeCloseTo(sp, 6);
  });

  it('still hits walls: no lock through a wall and it bursts on the wall', () => {
    const { w, a, b } = setup(WALLED, 'arenagawd', 2.5);
    const r = fire(w, a, true);
    expect(r.lock).toBeNull();
    const hp = b.hp;
    let boom: { x: number } | undefined;
    for (let t = 50; t <= 3000 && !boom; t += 50) boom = w.stepRockets(t).find((e) => e.ev === 'fps_boom')?.data as { x: number } | undefined;
    expect(boom!.x).toBeLessThan(6.01);
    expect(b.hp).toBe(hp);
  });
});
