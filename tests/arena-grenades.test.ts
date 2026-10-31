import { describe, expect, it, vi } from 'vitest';
import { gridMap, GRENADE_FUSE_MS, GRENADE_RADIUS, GRENADE_THROW_MS, GRENADES_PER_LIFE, grenadeDamage, stepGrenade, throwGrenade } from '../shared/fps.js';
import { ArenaWorld, type ArenaFighter } from '../server/arena-world.js';

const OPEN = gridMap(['#############', '#...........#', '#...........#', '#...........#', '#############']);
const WALLED = gridMap(['#############', '#.....#.....#', '#.....#.....#', '#.....#.....#', '#############']);

function setup(map = OPEN) {
  const w = new ArenaWorld(map, () => 0.5);
  const a = w.join('a', 'Ann', 0, 'pistol');
  const b = w.join('b', 'Bob', 0, 'smg');
  Object.assign(a, { x: 2.5, y: 2.5, z: 0, a: 0, p: 0 });
  Object.assign(b, { x: 9.5, y: 2.5, z: 0 });
  return { w, a, b };
}
const runTo = (w: ArenaWorld, from: number, to: number) => { const ev = []; for (let t = from; t <= to; t += 50) ev.push(...w.tick(t)); return ev; };

describe('frag grenades', () => {
  it('arcs, bounces off a wall and stays inside the map until the fuse', () => {
    const g = throwGrenade(1, { id: 'a', x: 2.5, y: 2.5, z: 0, a: 0, p: 0.2 }, 0);
    let maxZ = g.z, bounced = false, lastVx = g.vx;
    for (let t = 50; t <= GRENADE_FUSE_MS; t += 50) {
      const done = stepGrenade(g, t, OPEN);
      maxZ = Math.max(maxZ, g.z);
      if (Math.sign(g.vx) !== Math.sign(lastVx) && lastVx !== 0) bounced = true;
      lastVx = g.vx;
      expect(g.x).toBeGreaterThan(0.9); expect(g.x).toBeLessThan(12.1); expect(g.z).toBeGreaterThanOrEqual(0);
      if (t === GRENADE_FUSE_MS) expect(done).toBe(true); else expect(done).toBe(false);
    }
    expect(maxZ).toBeGreaterThan(1.7);
    expect(bounced).toBe(true);
  });

  it('radius damage falls off with distance, needs line of sight, thrower takes half', () => {
    const t = (id: string, x: number) => ({ id, x, y: 2.5, z: 0, alive: true }) as never;
    const near = grenadeDamage({ x: 3, y: 2.5, z: 0.1 }, 'z', [t('n', 3.5), t('f', 6), t('o', 3 + GRENADE_RADIUS + 0.5)], OPEN);
    expect(near.get('n')!).toBeGreaterThan(near.get('f')!);
    expect(near.has('o')).toBe(false);
    const self = grenadeDamage({ x: 3, y: 2.5, z: 0.1 }, 'n', [t('n', 3.5)], OPEN);
    expect(self.get('n')).toBe(Math.round(near.get('n')! / 2));
    const wall = grenadeDamage({ x: 5.5, y: 2.5, z: 0.1 }, 'z', [t('x', 7.5)], WALLED);
    expect(wall.has('x')).toBe(false);
  });

  it('2 per life, throw-rate floor flagged to anti-cheat, refills on respawn', () => {
    const { w, a } = setup();
    const nadeSpam = vi.fn();
    w.audit = { nadeSpam } as never;
    expect(w.throwNade('a', 0, 1000)).toHaveLength(1);
    expect(w.throwNade('a', 0, 1100)).toHaveLength(0);
    expect(nadeSpam).toHaveBeenCalledOnce();
    expect(w.throwNade('a', 0, 1000 + GRENADE_THROW_MS)).toHaveLength(1);
    expect(a.nades).toBe(0);
    expect(w.throwNade('a', 0, 5000)).toHaveLength(0);
    expect(w.grenades).toHaveLength(2);
    expect((w.snapshotFor('a', 5000) as { players: Array<{ id: string; gn?: number }> }).players.find((p) => p.id === 'a')?.gn).toBe(0);
    (w as unknown as { damage: (...x: unknown[]) => unknown }).damage('b', 'a', 9999, 6000, 'smg');
    runTo(w, 6000, 15000);
    expect(a.alive).toBe(true);
    expect(a.nades).toBe(GRENADES_PER_LIFE);
  });

  it('explodes after the fuse with a grenade boom and kill-feed cause', () => {
    const { w, a, b } = setup();
    a.p = -0.3;
    w.throwNade('a', 0, 0);
    const ev = runTo(w, 50, GRENADE_FUSE_MS + 100);
    const boom = ev.find((e) => e.ev === 'fps_boom');
    expect(boom?.data).toMatchObject({ cause: 'grenade', r: GRENADE_RADIUS, ownerId: 'a' });
    expect(ev.some((e) => e.ev === 'fps_hit' || e.ev === 'fps_kill')).toBe(true);
    expect(b.hp).toBeLessThan(100);
    expect(w.grenades).toHaveLength(0);
  });

  it('works in sudden death and not on the end screen', () => {
    const { w } = setup();
    (w as unknown as { phase: string }).phase = 'sudden';
    expect(w.throwNade('a', 0, 100)).toHaveLength(1);
    (w as unknown as { phase: string }).phase = 'ended';
    expect(w.throwNade('b', 0, 100)).toHaveLength(0);
  });
});
