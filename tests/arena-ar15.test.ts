import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADS_MOVE_MULT, fireWeapon, gridMap, moveAllowance, MOVE_SPEED, SPAWN_PRICE, speedOf, WEAPON_ORDER, WEAPONS, weaponSpread } from '../shared/fps';
import { viewZoom } from '../client/src/lib/arenaInput';
import { ArenaWorld } from '../server/arena-world';

const ar = WEAPONS.ar15;

describe('AR-15', () => {
  it('matches the spec and costs 25 per spawn', () => {
    expect(ar).toMatchObject({ damage: 30, cooldownMs: 110, spread: 0.008, mag: 30, reloadMs: 2400, semi: true, headMult: 2.2, moveSpread: 3, sprintSpread: 6, adsZoom: 1.5, adsSpreadMult: 0.5, recoil: 0.012 });
    expect(SPAWN_PRICE.ar15).toBe(25);
    expect(WEAPON_ORDER.indexOf('ar15')).toBe(WEAPON_ORDER.indexOf('knife') - 1);
  });
  it('spread blooms with movement and sprint, tightens with ADS', () => {
    const still = weaponSpread(ar), walk = weaponSpread(ar, { speed: MOVE_SPEED }), sprint = weaponSpread(ar, { sprinting: true });
    expect(walk).toBeCloseTo(still * 4); expect(sprint).toBeCloseTo(still * 7);
    expect(weaponSpread(ar, { scoped: true })).toBeCloseTo(still * 0.5);
    expect(weaponSpread(WEAPONS.smg, { speed: MOVE_SPEED })).toBe(WEAPONS.smg.spread); // others unchanged
  });
  it('headshot does 66 (2.2×), body 30', () => {
    const map = gridMap(['#########', '#.......#', '#.......#', '#########']);
    const t = { id: 't', x: 6, y: 1.5, z: 0, alive: true };
    const body = fireWeapon({ id: 's', x: 1.5, y: 1.5, z: 0, a: 0, p: -0.12 }, ar, [t], { rand: () => 0.5, map });
    expect(body.hits.get('t')).toBeCloseTo(30);
    const head = fireWeapon({ id: 's', x: 1.5, y: 1.5, z: 0, a: 0, p: 0.0 }, ar, [t], { rand: () => 0.5, map });
    if (head.heads.has('t')) expect(head.hits.get('t')).toBeCloseTo(66);
  });
  it('move speed goes through speedOf: base speed, ADS halves it, server cap covers sprint', () => {
    expect(speedOf({ weapon: 'ar15' })).toBe(MOVE_SPEED);
    expect(speedOf({ weapon: 'ar15', scoped: true })).toBe(MOVE_SPEED * ADS_MOVE_MULT);
    expect(moveAllowance({ weapon: 'ar15', sprint: true }, 100)).toBeGreaterThan(speedOf({ weapon: 'ar15', sprint: true }) * 0.1);
    const src = readFileSync('client/src/components/ArenaPanel.tsx', 'utf8');
    expect(src).toContain('const sp = (speedOf(m) * 0.95 * dt) / len;');
  });
  it('ADS keeps the viewmodel visible; the sniper scope still hides it', () => {
    expect(viewZoom(1.5, 0, true).showGun).toBe(true);
    expect(viewZoom(3.5, 0).showGun).toBe(false);
  });
  it('server: AR can ADS (no sprint while aimed) and fires semi-auto at the 110 ms cooldown', () => {
    const w = new ArenaWorld(gridMap(['#########', '#.......#', '#.......#', '#########']), () => 0.5);
    const f = w.join('a', 'a', 0, 'ar15');
    w.switchWeapon('a', 'ar15', 0);
    w.setScope('a', true, 1000);
    expect(f.scopedSince).toBe(1000);
    const before = f.ammo.ar15;
    w.shoot('a', 0, 2000); w.shoot('a', 0, 2050); w.shoot('a', 0, 2120);
    expect(before - f.ammo.ar15).toBe(2);
  });
  it('client: semi-auto needs a fresh trigger pull', () => {
    const src = readFileSync('client/src/components/ArenaPanel.tsx', 'utf8');
    expect(src).toContain("(!WEAPONS[m.weapon].semi || m.semiPending)");
    expect(src).toContain('m.semiPending = false;');
  });
});

describe('AR-15 with drops', () => {
  it('an AR-15 spawn drops on death and can be picked up', async () => {
    const { ArenaWorld } = await import('../server/arena-world.js');
    const { gridMap } = await import('../shared/fps.js');
    const w = new ArenaWorld(gridMap(['#########', '#.......#', '#.......#', '#########']), () => 0.5);
    const a = w.join('a', 'Ann', 0, 'pistol');
    const b = w.join('b', 'Bob', 0, 'ar15');
    Object.assign(a, { x: 1.5, y: 1.5, z: 0 }); Object.assign(b, { x: 6.5, y: 1.5, z: 0 });
    w.skins.set('b', { ar15: 'tok-ar' });
    b.ammo.ar15 = 12;
    (w as unknown as { damage: (...x: unknown[]) => unknown }).damage('a', 'b', 9999, 100, 'pistol');
    expect(w.drops[0]).toMatchObject({ w: 'ar15', ammo: 12, sk: 'tok-ar' });
    Object.assign(a, { x: 6.5 });
    expect(w.stepDrops(200)[0]?.data).toMatchObject({ w: 'ar15', ammo: 12 });
    expect(w.switchWeapon('a', 'ar15', 300)).toBe(true);
  });
});
