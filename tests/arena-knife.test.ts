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
  it('slash 50 (2-hit kill), stab 100 one-shots a full-HP body from the front', () => {
    expect(hits(duel().w.shoot('k', 0, 1000))).toEqual([50]);
    expect(hits(duel().w.shoot('k', 0, 1000, 0, undefined, true))).toEqual([100]);
  });
  it('heavy stab from behind is an instant kill; light slash from behind is not', () => {
    const a = duel(OPEN, 1.2, 0); // victim faces away from the attacker
    const ev = a.w.shoot('k', 0, 1000, 0, undefined, true);
    expect(ev.some((e) => e.ev === 'fps_kill')).toBe(true);
    expect(ev.find((e) => e.ev === 'fps_shot')!.data.backstab).toBe(true);
    expect(hits(duel(OPEN, 1.2, 0).w.shoot('k', 0, 1000))).toEqual([50]);
  });
  it('backstab angle: within 60° of the back only', () => {
    const t = { x: 0, y: 0, a: 0 };
    expect(isBackstab({ x: -1, y: 0 }, t)).toBe(true);
    expect(isBackstab({ x: -1, y: Math.tan((55 * Math.PI) / 180) }, t)).toBe(true);
    expect(isBackstab({ x: -1, y: Math.tan((65 * Math.PI) / 180) }, t)).toBe(false);
    expect(isBackstab({ x: 0, y: 1 }, t)).toBe(false);
    expect(isBackstab({ x: 1, y: 0 }, t)).toBe(false);
  });
  it('range ~3.2 to the body', () => {
    expect(hits(duel(OPEN, 3.4).w.shoot('k', 0, 1000))).toEqual([50]); // 3.4 − 0.3 radius = 3.1
    expect(hits(duel(OPEN, 3.8).w.shoot('k', 0, 1000))).toEqual([]);
  });
  it('buffed numbers: 3.2 reach, 50 slash, stab ≥ max HP, front stab kills at full HP, two slashes kill', async () => {
    const { MAX_HP, MELEE_RANGE, MELEE_SWEEP, MELEE_CONE } = await import('../shared/fps');
    expect(MELEE_RANGE).toBe(3.2); expect(WEAPONS.knife.range).toBe(3.2);
    expect(MELEE_SWEEP).toBe(0.7); expect(Math.round((MELEE_CONE * 180) / Math.PI)).toBe(65);
    expect(WEAPONS.knife.damage).toBe(50);
    expect(WEAPONS.knife.heavyDamage!).toBeGreaterThanOrEqual(MAX_HP);
    const d = duel(OPEN, 2.0);
    expect(d.w.shoot('k', 0, 1000, 0, undefined, true).some((e) => e.ev === 'fps_kill')).toBe(true);
    const s2 = duel(OPEN, 1.5);
    s2.w.shoot('k', 0, 1000);
    expect(s2.w.shoot('k', 0, 1500).some((e) => e.ev === 'fps_kill')).toBe(true);
  });
  it('near-miss: a body just off the swing line still connects (cone/sweep), nearest target wins', () => {
    const m = { id: 'k', x: 3, y: 2.5, z: 0, a: 0 };
    // 75° off-axis at point blank (outside the 65° cone) but within the 0.5 sweep of the line.
    const near = { id: 'n', x: 3 + 0.5 * Math.cos((75 * Math.PI) / 180), y: 2.5 + 0.5 * Math.sin((75 * Math.PI) / 180), z: 0, a: Math.PI, alive: true };
    expect(meleeHit(m, [near], false, OPEN)?.id).toBe('n');
    const far = { id: 'f', x: 5, y: 2.5, z: 0, a: Math.PI, alive: true };
    expect(meleeHit(m, [far, { ...near, x: 3.9, y: 2.5, id: 'c' }], false, OPEN)?.id).toBe('c');
    expect(meleeHit(m, [{ id: 'b', x: 1.5, y: 2.5, z: 0, a: 0, alive: true }], false, OPEN)).toBeNull(); // behind you
  });
  it('65° cone: 60° off hits, 80° off at range misses, nearest wins', () => {
    const m = { id: 'k', x: 3, y: 2.5, z: 0, a: 0 };
    const at = (deg: number, r: number, id = 'v') => ({ id, x: 3 + r * Math.cos((deg * Math.PI) / 180), y: 2.5 + r * Math.sin((deg * Math.PI) / 180), z: 0, a: Math.PI, alive: true });
    expect(meleeHit(m, [at(60, 2.5)], false, OPEN)?.id).toBe('v');
    expect(meleeHit(m, [at(80, 2.5)], false, OPEN)).toBeNull();
    expect(meleeHit(m, [at(0, 2.8, 'far'), at(40, 1.5, 'near')], false, OPEN)?.id).toBe('near');
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
    expect(hits(w.shoot('k', 0, 1000, 0, 900))).toEqual([50]);
    expect(hits(duel(OPEN, 1.2).w.shoot('k', 0, 1000))).toEqual([50]);
  });
  it('cooldowns: slash 240 ms (was 400, −40%), stab 585 ms (was 900, −35%); damage lands on the swing message itself', () => {
    expect(WEAPONS.knife.cooldownMs).toBe(240); expect(WEAPONS.knife.heavyCooldownMs).toBe(585);
    const { w } = duel();
    expect(hits(w.shoot('k', 0, 1000))).toHaveLength(1); // no wind-up: the hit is in the same tick as the swing
    expect(w.shoot('k', 0, 1150)).toEqual([]);
    expect(hits(w.shoot('k', 0, 1240, 0, undefined, true))).toHaveLength(1);
    expect(w.shoot('k', 0, 1700)).toEqual([]);
  });
  it('1.25× speed with the knife out, through speedOf (sprint and crouch still apply)', () => {
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
    // a speed hack is still clamped, and the clamp is 1.25x wider with the knife (validateMove uses speedOf)
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
    const src = (await import('node:fs')).readFileSync(new URL('../client/src/lib/arenaInput.ts', import.meta.url), 'utf8');
    const keys = src.match(/ARENA_GAME_KEYS = new Set\(\[([^\]]*)\]/)![1];
    expect(keys).toContain("'6'");
    expect(keys).toContain("'v'");
    expect(WEAPON_ORDER[5]).toBe('knife');
  });
});
