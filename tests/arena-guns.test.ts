import { describe, expect, it } from 'vitest';
import { GUN_IDS, GUN_TRI_BUDGET, buildGun, gunGeometry, gunMaterials } from '../client/src/lib/arenaGuns.js';
import { WEAPON_ORDER } from '../shared/fps.js';

describe('arena gun models', () => {
  it('has a model for every weapon id', () => {
    expect([...GUN_IDS].sort()).toEqual([...WEAPON_ORDER].sort());
    for (const w of WEAPON_ORDER) expect(buildGun(w).root.children.length).toBeGreaterThan(0);
  });
  it('stays within the triangle budget and merges per material', () => {
    for (const w of WEAPON_ORDER) {
      const g = gunGeometry(w);
      expect(g.triangles).toBeGreaterThan(50);
      expect(g.triangles).toBeLessThan(GUN_TRI_BUDGET);
      const mats = g.body.map((b) => b.mat);
      expect(new Set(mats).size).toBe(mats.length);
      expect(g.body.length + g.mag.length).toBeLessThanOrEqual(8);
      if (w !== 'knife') expect(g.mag.length).toBeGreaterThan(0); // a knife has no magazine
    }
  });
  it('shares geometry and materials between instances', () => {
    const a = buildGun('smg'), b = buildGun('smg');
    const ma = a.root.children[0] as unknown as { geometry: unknown; material: unknown };
    const mb = b.root.children[0] as unknown as { geometry: unknown; material: unknown };
    expect(ma.geometry).toBe(mb.geometry);
    expect(ma.material).toBe(mb.material);
    expect(Object.values(gunMaterials()).length).toBeGreaterThan(3);
  });
  it('proportions: muzzle forward, sniper longest, pistol shortest', () => {
    const len = (w: (typeof WEAPON_ORDER)[number]) => { const g = gunGeometry(w); g.body[0].geo.computeBoundingBox(); return -g.muzzle[2]; };
    for (const w of WEAPON_ORDER) expect(gunGeometry(w).muzzle[2]).toBeLessThan(0);
    expect(len('sniper')).toBeGreaterThan(len('shotgun'));
    expect(len('shotgun')).toBeGreaterThan(len('smg'));
    expect(len('smg')).toBeGreaterThan(len('pistol'));
  });
});
