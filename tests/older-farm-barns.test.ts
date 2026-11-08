import { describe, expect, it } from 'vitest';
import { farmBarns } from '../shared/farmBarns';
import { barnFarms, isBarnProperty } from '../shared/barnFarms';
import { outskirts } from '../shared/outskirts';
import { BARNS } from '../shared/farm';
import { properties, propertyById } from '../shared/realEstate';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
describe('older barns use existing farm deeds, never independent free grants', () => {
  it('both small farm-district barnyards map exactly to plot 10 and plot 20', () => {
    const d = farmBarns().filter((b) => b.family === 'district');
    expect(d.map((b) => b.farmId)).toEqual(['f:10', 'f:20']);
    expect(d.map(({ x, z, w, d, rot }) => ({ x, z, w, d, rot }))).toEqual(BARNS);
    expect(d.map((b) => propertyById(b.farmId)!.price)).toEqual([8000, 9000]);
  });
  it('all 19 surviving countryside barns carry their exact generated field association, no nearest-neighbor guesses', () => {
    const raw = outskirts().buildings.filter((b) => b.kind === 'barn');
    expect(raw).toHaveLength(20);
    const bs = raw.filter((b) => outskirts().fields.some((f) => `cf:${f.n}` === b.farmId));
    expect(bs).toHaveLength(19);
    for (const b of bs) {
      const f = outskirts().fields.find((f) => `cf:${f.n}` === b.farmId)!;
      expect(f).toBeTruthy(); expect(b.z).toBe(f.z - 3);
      expect(Math.abs(b.x - f.x)).toBeCloseTo(f.w / 2 + 4.5);
      expect(farmBarns().find((x) => x.family === 'country' && x.farmId === b.farmId)).toMatchObject({ x: b.x, z: b.z, w: b.w, d: b.d });
    }
    expect(farmBarns().some((b) => b.farmId === 'cf:23')).toBe(false); // jail removed this orphan barn's field; never invent a deed
    expect(raw.filter((b) => !bs.includes(b)).map((b) => b.farmId)).toEqual(['cf:23']);
    expect(propertyById('cf:23')).toBeUndefined();
  });
  it('all 29 barn deeds, including the existing eight Big Farms, unlock for existing owners only', () => {
    const bs = farmBarns(); expect(bs).toHaveLength(29); expect(new Set(bs.map((b) => b.id)).size).toBe(29);
    expect(bs.filter((b) => b.family === 'big')).toHaveLength(8);
    for (const b of bs) {
      expect(propertyById(b.farmId)?.kind).toBe('farm'); expect(isBarnProperty(b.farmId)).toBe(true);
      const row = { id: b.farmId, owner: 'Owner', price: 1, arrears: 0, boughtAt: 1 };
      expect(barnFarms('owner', [row]).unlocked).toBe(true);
      expect(barnFarms('Other', [row]).unlocked).toBe(false);
    }
  });
  it('catalog keeps all 509 ids, prices and geometry byte-equivalent to pre-extension baseline', () => {
    expect(properties()).toHaveLength(509);
    // Full catalog hash captured from clean 4d6e6ac-equivalent catalog before the metadata-only association.
    expect(createHash('sha256').update(JSON.stringify(properties())).digest('hex')).toBe('f356b36ad9902199b6fec8591fc2ec77f6fc6eb6e6cb23d8c026d4343f0bf756');
  });
  it('old barn body/roof and countryside instances route to the same ownership-preserving barn callback', () => {
    const s = readFileSync('client/src/lib/world3d.ts', 'utf8');
    expect(s).toContain("oldBarnMeshes.userData.barns = outb.map((b) => farmBarns().some((f) => f.family === 'country' && f.farmId === b.farmId) ? b.farmId : null)");
    expect(s).toContain("f.family === 'district'"); expect(s).toContain('o.userData.spot = `barn:${deed}`');
    expect(s).toContain('return `barn:${barnIds[hit.instanceId]}`'); expect(s).toContain('h.onBarn?.(id.slice(5))');
    const city = readFileSync('client/src/components/WorldMap.tsx', 'utf8');
    expect(city).toContain("o.owner.toLowerCase() === m.toLowerCase()) setPanel({ k: 'farms' }); else setDeed(id)");
  });
});
