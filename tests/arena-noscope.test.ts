import { describe, expect, it } from 'vitest';
import { gridMap, type WeaponId } from '../shared/fps.js';
import { ArenaWorld, NOSCOPE_DEG, spinDegrees } from '../server/arena-world.js';
import { perksFor } from '../server/arena-anticheat.js';
import { feedParts } from '../client/src/lib/arenaFeed.js';

const OPEN = gridMap(['#############', '#...........#', '#...........#', '#...........#', '#############']);

function setup(w: WeaponId = 'sniper', shooter = 'a') {
  const world = new ArenaWorld(OPEN, () => 0.5);
  const a = world.join(shooter, 'Ann', 0, w);
  const b = world.join('b', 'Bob', 0);
  Object.assign(a, { x: 2.5, y: 2.5, z: 0, a: 0, p: 0, weapon: w });
  Object.assign(b, { x: 8.5, y: 2.5, z: 0, a: Math.PI, hp: 1 });
  return { world, a, b };
}
/** Spin `deg` degrees (one direction) over ~1.2 s ending facing +x, then fire. */
function spinAndShoot(world: ArenaWorld, id: string, deg: number, t0 = 10_000) {
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const ang = ((deg * (1 - i / steps)) * Math.PI) / 180;
    world.move(id, 2.5, 2.5, Math.atan2(Math.sin(ang), Math.cos(ang)), t0 + i * 50, 0);
  }
  return world.shoot(id, 0, t0 + steps * 50 + 10, 0);
}
const noscope = (ev: ReturnType<ArenaWorld['shoot']>) => ev.some((e) => e.ev === 'fps_noscope');

describe('360 no-scope', () => {
  it('spinDegrees handles wrap-around', () => {
    const h: Array<[number, number]> = [];
    for (let i = 0; i <= 36; i++) { const a = (i * 10 * Math.PI) / 180; h.push([i * 20, Math.atan2(Math.sin(a), Math.cos(a))]); }
    expect(spinDegrees(h, 720)).toBeCloseTo(360, 0);
  });

  it('unscoped sniper kill after a 360 spin triggers (sound event + feed tag)', () => {
    const { world, b } = setup();
    const ev = spinAndShoot(world, 'a', 360);
    expect(b.alive).toBe(false);
    expect(noscope(ev)).toBe(true);
    const kill = ev.find((e) => e.ev === 'fps_kill')!;
    expect(kill.data.noscope).toBe(true);
    expect(feedParts({ key: 1, killer: 'Ann', victim: 'Bob', cause: 'sniper', self: false, mine: true, head: true, noscope: true }).map((p) => p.t)).toEqual(['killer', 'weapon', 'noscope', 'head', 'victim']);
  });

  it('scoped does not count', () => {
    const { world, a, b } = setup();
    a.scopedSince = 9_000;
    expect(noscope(spinAndShoot(world, 'a', 360))).toBe(false);
    expect(b.alive).toBe(false);
  });

  it(`less than ${NOSCOPE_DEG}° does not count`, () => {
    const { world, b } = setup();
    expect(noscope(spinAndShoot(world, 'a', 300))).toBe(false);
    expect(b.alive).toBe(false);
  });

  it('non-sniper does not count', () => {
    const { world } = setup('pistol');
    expect(noscope(spinAndShoot(world, 'a', 360))).toBe(false);
  });

  it('bots cannot trigger it', () => {
    const { world } = setup('sniper', 'arena-bot-1');
    expect(noscope(spinAndShoot(world, 'arena-bot-1', 360))).toBe(false);
  });

  it('arenagawd aim assist still counts', () => {
    const { world } = setup();
    world.perks.set('a', perksFor('arenagawd'));
    expect(noscope(spinAndShoot(world, 'a', 365))).toBe(true);
  });
});
