import { describe, expect, it } from 'vitest';
import { gridMap, isBackstab, isWeapon, canHold, spawnCost, KNIFE_SPEED_MULT, meleeHit, MOVE_SPEED, speedOf, SPRINT_MULT, CROUCH_SPEED_MULT, validateMove, WEAPON_ORDER, WEAPONS } from '../shared/fps';
import { ArenaWorld, type ArenaEvent } from '../server/arena-world';
import { gunGeometry } from '../client/src/lib/arenaGuns';

const OPEN = gridMap(['##############', ...Array(4).fill('#............#'), '##############']);
const WALLED = gridMap(['##############', '#.....#......#', '#.....#......#', '#.....#......#', '##############']);
function duel(map = OPEN, dist = 1.2, victimFacing = Math.PI) {
  const w = new ArenaWorld(map, () => 0.5);
  const k = w.join('k', 'dayne', 0), v = w.join('v', 'rook', 0);
  Object.assign(k, { x: 3, y: 2.5, z: 0, a: 0, switchedAt: -1e9, weapon: 'knife' });
  Object.assign(v, { x: 3 + dist, y: 2.5, z: 0, a: victimFacing });
  return { w, k, v };
}
const hits = (ev: ArenaEvent[]) => ev.filter((e) => e.ev === 'fps_hit').map((e) => e.data.dmg);

describe('knife', () => {
  it("is a normal, skinnable weapon id 'knife' with its own material slots", () => {
    expect(isWeapon('knife')).toBe(true);
    expect(WEAPON_ORDER).toContain('knife');
    expect(WEAPONS.knife.melee).toBe(true);
    const mats = gunGeometry('knife').body.map((b) => b.mat);
    expect(mats).toEqual(expect.arrayContaining(['blade', 'handle', 'metal']));
  });
  it('slash 35, stab 65 from the front', () => {
    expect(hits(duel().w.shoot('k', 0, 1000))).toEqual([35]);
    expect(hits(duel().w.shoot('k', 0, 1000, 0, undefined, true))).toEqual([65]);
  });
  it('heavy stab from behind is an instant kill; light slash from behind is not', () => {
    const a = duel(OPEN, 1.2, 0); // victim faces away from the attacker
    const ev = a.w.shoot('k', 0, 1000, 0, undefined, true);
    expect(ev.some((e) => e.ev === 'fps_kill')).toBe(true);
    expect(ev.find((e) => e.ev === 'fps_shot')!.data.backstab).toBe(true);
    expect(hits(duel(OPEN, 1.2, 0).w.shoot('k', 0, 1000))).toEqual([35]);
  });
  it('backstab angle: within 60° of the back only', () => {
    const t = { x: 0, y: 0, a: 0 };
    expect(isBackstab({ x: -1, y: 0 }, t)).toBe(true);
    expect(isBackstab({ x: -1, y: Math.tan((55 * Math.PI) / 180) }, t)).toBe(true);
    expect(isBackstab({ x: -1, y: Math.tan((65 * Math.PI) / 180) }, t)).toBe(false);
    expect(isBackstab({ x: 0, y: 1 }, t)).toBe(false);
    expect(isBackstab({ x: 1, y: 0 }, t)).toBe(false);
  });
  it('range ~1.8 to the body', () => {
    expect(hits(duel(OPEN, 2.0).w.shoot('k', 0, 1000))).toEqual([35]); // 2.0 − 0.3 radius = 1.7
    expect(hits(duel(OPEN, 2.3).w.shoot('k', 0, 1000))).toEqual([]);
  });
  it('needs line of sight', () => {
    const m = { id: 'k', x: 5.5, y: 2.5, z: 0, a: 0 };
    expect(meleeHit(m, [{ id: 'v', x: 7.3, y: 2.5, z: 0, a: Math.PI, alive: true }], false, WALLED)).toBeNull();
    expect(meleeHit(m, [{ id: 'v', x: 7.3, y: 2.5, z: 0, a: Math.PI, alive: true }], false, OPEN)).not.toBeNull();
  });
  it('lag compensation: hits where the victim was at the attacker view time', () => {
    const { w, v } = duel(OPEN, 1.2);
    w.history.record('v', 900, v.x, v.y, 0, false);
    v.x = 9; // ran away since
    w.history.record('v', 1000, v.x, v.y, 0, false);
    expect(hits(w.shoot('k', 0, 1000, 0, 900))).toEqual([35]);
    expect(hits(duel(OPEN, 1.2).w.shoot('k', 0, 1000))).toEqual([35]);
  });
  it('cooldowns: slash 400 ms, stab 900 ms', () => {
    const { w } = duel();
    expect(hits(w.shoot('k', 0, 1000))).toHaveLength(1);
    expect(w.shoot('k', 0, 1100)).toEqual([]);
    expect(hits(w.shoot('k', 0, 1400, 0, undefined, true))).toHaveLength(1);
    expect(w.shoot('k', 0, 2000)).toEqual([]);
  });
  it('1.15× speed with the knife out, through speedOf (sprint and crouch still apply)', () => {
    expect(speedOf({ weapon: 'knife' })).toBeCloseTo(MOVE_SPEED * KNIFE_SPEED_MULT);
    expect(speedOf({ weapon: 'knife', sprint: true })).toBeCloseTo(MOVE_SPEED * SPRINT_MULT * KNIFE_SPEED_MULT);
    expect(speedOf({ weapon: 'knife', crouch: true })).toBeCloseTo(MOVE_SPEED * CROUCH_SPEED_MULT * KNIFE_SPEED_MULT);
    expect(speedOf({ weapon: 'pistol' })).toBe(MOVE_SPEED);
  });
  it('server movement cap allows knife speed but not much more', () => {
    const run = (weapon: string, speed: number) => {
      const { w, k } = duel(OPEN, 8);
      Object.assign(k, { weapon, x: 2, lastMove: 1000, physAt: 1000 });
      for (let t = 1; t <= 10; t++) w.move('k', 2 + speed * 0.05 * t, k.y, 0, 1000 + 50 * t);
      return k.x - 2;
    };
    const knifeRun = MOVE_SPEED * KNIFE_SPEED_MULT * 0.5;
    expect(run('knife', MOVE_SPEED * KNIFE_SPEED_MULT)).toBeCloseTo(knifeRun, 1);
    // a speed hack is still clamped, and the clamp is 1.15x wider with the knife (validateMove uses speedOf)
    const kc = run('knife', MOVE_SPEED * 4), pc = run('pistol', MOVE_SPEED * 4);
    expect(kc).toBeLessThan(MOVE_SPEED * 4 * 0.5 * 0.7);
    expect(kc).toBeGreaterThan(pc);
    expect((kc - 1) / (pc - 1)).toBeCloseTo(KNIFE_SPEED_MULT, 1);
  });
  it('knife is always carried and free; knife-only holds nothing else', () => {
    expect(spawnCost('knife')).toBe(0);
    for (const w of ['pistol', 'smg', 'sniper'] as const) expect(canHold(w, 'knife')).toBe(true);
    expect(canHold('knife', 'pistol')).toBe(false);
    expect(canHold('knife', 'knife')).toBe(true);
    const { w, k } = duel();
    Object.assign(k, { loadout: 'knife', weapon: 'knife' });
    expect(w.switchWeapon('k', 'pistol', 1000)).toBe(false);
    Object.assign(k, { loadout: 'sniper', lifeId: 'L1', weapon: 'sniper' });
    expect(w.switchWeapon('k', 'knife', 2000)).toBe(true);
  });
  it('no headshots with the knife', () => {
    const ev = duel(OPEN, 1.2, 0).w.shoot('k', 0, 1000, 0, undefined, true);
    expect(ev.find((e) => e.ev === 'fps_kill')!.data.headshot).toBeUndefined();
  });
});

describe('knife keys', () => {
  it('6 and V are game keys that select the knife', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../client/src/components/ArenaPanel.tsx', import.meta.url), 'utf8');
    const keys = src.match(/GAME_KEYS = new Set\(\[([^\]]*)\]/)![1];
    expect(keys).toContain("'6'");
    expect(keys).toContain("'v'");
    expect(WEAPON_ORDER[5]).toBe('knife');
  });
});
