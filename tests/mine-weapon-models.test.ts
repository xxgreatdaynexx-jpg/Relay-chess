import { describe, it, expect } from 'vitest';
import { WEAPONS } from '../shared/mineCombat';
import { WEAPON_MODELS, weaponModelSpec, buildWeaponModel } from '../client/src/lib/mineWeaponModels';
import * as THREE from 'three';

const size = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
describe('mine weapon models match their names', () => {
  it('every store weapon has its own model spec', () => {
    for (const w of WEAPONS) expect(WEAPON_MODELS[w.id]).toBeDefined();
    const sig = new Set(WEAPONS.map((w) => { const s = WEAPON_MODELS[w.id]; return `${s.blade}|${s.bladeShape}`; }));
    expect(sig.size).toBe(WEAPONS.length);
    expect(Object.keys(WEAPON_MODELS).sort()).toEqual(WEAPONS.map((w) => w.id).sort());
  });
  it('names map to the right look', () => {
    expect(WEAPON_MODELS.rusty_sword).toMatchObject({ bladeShape: 'chipped', pits: true });
    expect(WEAPON_MODELS.crystal_blade).toMatchObject({ bladeShape: 'faceted', translucent: true });
    expect(WEAPON_MODELS.crystal_blade.emissive).toBeTruthy();
    expect(WEAPON_MODELS.diamond_saber).toMatchObject({ bladeShape: 'curved', sparkle: true, ornate: true });
    expect(WEAPON_MODELS.steel_claymore.bladeShape).toBe('great');
    expect(WEAPON_MODELS.iron_sword.guardW).toBeGreaterThan(WEAPON_MODELS.copper_sword.guardW);
  });
  it('unknown / missing ids fall back to the Rusty Sword', () => {
    expect(weaponModelSpec(null)).toBe(WEAPON_MODELS.rusty_sword);
    expect(weaponModelSpec('bogus')).toBe(WEAPON_MODELS.rusty_sword);
    expect(weaponModelSpec('diamond_saber')).toBe(WEAPON_MODELS.diamond_saber);
  });
  it('the claymore is much bigger than the one-handers', () => {
    const big = size(buildWeaponModel('steel_claymore')).y;
    for (const id of ['rusty_sword', 'copper_sword', 'iron_sword'] as const) expect(big).toBeGreaterThan(size(buildWeaponModel(id)).y * 1.3);
  });
  it('low gfx uses cheap Lambert materials and adds no lights', () => {
    for (const w of WEAPONS) {
      const g = buildWeaponModel(w.id, true); let lights = 0, std = 0;
      g.traverse((o) => { if ((o as THREE.Light).isLight) lights++; const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) std++; });
      expect(lights).toBe(0); expect(std).toBe(0); expect(g.name).toBe(`weapon:${w.id}`);
    }
  });
});
