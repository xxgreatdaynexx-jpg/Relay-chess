import { describe, expect, it } from 'vitest';
import { gridMap, WEAPONS, WEAPON_ORDER, type WeaponId } from '../shared/fps.js';
import { ArenaWorld, DROP_CAP, DROP_MS, PICKUP_R, type ArenaFighter } from '../server/arena-world.js';

const OPEN = gridMap(['#############', '#...........#', '#...........#', '#...........#', '#############']);
const WALLED = gridMap(['#############', '#.....#.....#', '#.....#.....#', '#.....#.....#', '#############']);

function setup(map = OPEN, la: WeaponId = 'pistol', lb: WeaponId = 'smg') {
  const w = new ArenaWorld(map, () => 0.5);
  const a = w.join('a', 'Ann', 0, la);
  const b = w.join('b', 'Bob', 0, lb);
  Object.assign(a, { x: 2.5, y: 2.5, z: 0 });
  Object.assign(b, { x: 9.5, y: 2.5, z: 0 });
  return { w, a, b };
}
const kill = (w: ArenaWorld, by: string, f: ArenaFighter, now: number) => (w as unknown as { damage: (...x: unknown[]) => unknown }).damage(by, f.id, 9999, now, 'pistol');
const walkTo = (f: ArenaFighter, x: number, y: number) => Object.assign(f, { x, y });

describe('weapon drops', () => {
  it("drops the victim's spawn weapon (not the knife) at the death spot with ammo + skin", () => {
    const { w, b } = setup();
    w.skins.set('b', { smg: 'tok-smg-red' });
    b.ammo.smg = 7;
    kill(w, 'a', b, 100);
    expect(w.drops).toHaveLength(1);
    expect(w.drops[0]).toMatchObject({ w: 'smg', x: 9.5, y: 2.5, ammo: 7, sk: 'tok-smg-red', until: 100 + DROP_MS });
    const k = setup(OPEN, 'pistol', 'knife');
    kill(k.w, 'a', k.b, 100);
    expect(k.w.drops).toHaveLength(0);
  });

  it('picks up only when you do not already carry that weapon, with the drop ammo', () => {
    const { w, a, b } = setup();
    b.ammo.smg = 7;
    kill(w, 'a', b, 100);
    walkTo(a, 9.5 + PICKUP_R - 0.1, 2.5);
    const ev = w.stepDrops(200);
    expect(ev).toEqual([expect.objectContaining({ ev: 'fps_pickup', to: 'a', data: expect.objectContaining({ w: 'smg', ammo: 7 }) })]);
    expect(a.extra).toContain('smg');
    expect(a.ammo.smg).toBe(7);
    expect(w.drops).toHaveLength(0);
    expect(w.switchWeapon('a', 'smg', 300)).toBe(true);
    // a second smg drop is ignored now that Ann carries one
    const c = w.join('c', 'Cy', 0, 'smg');
    Object.assign(c, { x: a.x, y: a.y, z: 0 });
    kill(w, 'b', c, 400);
    expect(w.stepDrops(450)).toEqual([]);
    expect(w.drops).toHaveLength(1);
  });

  it('a player who already spawned with that weapon does not pick it up; out of range does nothing', () => {
    const { w, a, b } = setup(OPEN, 'smg', 'smg');
    kill(w, 'a', b, 100);
    walkTo(a, 9.5, 2.5);
    expect(w.stepDrops(200)).toEqual([]);
    const s = setup();
    kill(s.w, 'a', s.b, 100);
    walkTo(s.a, 9.5 - PICKUP_R - 0.2, 2.5);
    expect(s.w.stepDrops(200)).toEqual([]);
  });

  it('despawns after 3 seconds', () => {
    const { w, b } = setup();
    kill(w, 'a', b, 1000);
    w.stepDrops(1000 + DROP_MS - 1);
    expect(w.drops).toHaveLength(1);
    expect(w.snapshot(1000 + DROP_MS - 500).drops[0].left).toBe(500);
    w.stepDrops(1000 + DROP_MS);
    expect(w.drops).toHaveLength(0);
    expect(DROP_MS).toBe(3000);
  });

  it(`caps at ${DROP_CAP} drops, removing the oldest`, () => {
    const { w } = setup();
    for (let i = 0; i < DROP_CAP + 3; i++) {
      const v = w.join(`v${i}`, `V${i}`, 0, WEAPON_ORDER[i % 4 + 1]);
      Object.assign(v, { x: 6, y: 2.5, z: 0 });
      kill(w, 'a', v, 10 + i);
    }
    expect(w.drops).toHaveLength(DROP_CAP);
    expect(w.drops[0].at).toBe(13);
  });

  it('drops behind a wall are hidden from your snapshot (interest management)', () => {
    const { w, b } = setup(WALLED);
    kill(w, 'a', b, 100);
    expect(w.snapshotFor('a', 120).drops).toEqual([]);
    expect(w.snapshot(120).drops).toHaveLength(1);
  });

  it('picking up gives no chips and does not change the stake', () => {
    const { w, a, b } = setup();
    kill(w, 'a', b, 100);
    walkTo(a, 9.5, 2.5);
    w.stepDrops(150);
    expect(a.extra).toEqual(['smg']);
    expect(WEAPONS.smg.mag).toBeGreaterThan(0);
    expect(a.stake).toBe(0);
  });
});
