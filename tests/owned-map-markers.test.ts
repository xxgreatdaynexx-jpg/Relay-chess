import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyWorldOwned } from '../client/src/lib/worldOwned';
import { isHomeProperty } from '../shared/homes';
import { propertyById, type OwnedProperty } from '../shared/realEstate';

/** Seeded rich player: houses, a lot, farms, a penthouse and a factory — the same mix the map must show as owned. */
const SEED: OwnedProperty[] = [
  { id: 'b:house:-899:665', owner: 'QAOwner', price: 15_000, boughtAt: 1, arrears: 0 },
  { id: 'b:rowhouse:-1051:373', owner: 'QAOwner', price: 20_000, boughtAt: 1, arrears: 0 },
  { id: 'p:lot:549:-843', owner: 'QAOwner', price: 8_000, boughtAt: 1, arrears: 0 },
  { id: 'cf:10', owner: 'QAOwner', price: 5_000, boughtAt: 1, arrears: 0 },
  { id: 'f:8', owner: 'QAOwner', price: 4_000, boughtAt: 1, arrears: 0 },
  { id: 'sky:6', owner: 'QAOwner', price: 4_500_000, boughtAt: 1, arrears: 0 },
  { id: 'fac:2', owner: 'QAOwner', price: 100_000, boughtAt: 1, arrears: 0 },
];

describe('owned property on the 3D map after a world remount', () => {
  it('every seed id is still in the catalog (houses, lot, farms, penthouse, factory)', () => {
    for (const o of SEED) {
      const p = propertyById(o.id);
      expect(p, o.id).toBeTruthy();
    }
    expect(isHomeProperty(propertyById('b:house:-899:665'))).toBe(true);
    expect(isHomeProperty(propertyById('sky:6'))).toBe(true);
    expect(isHomeProperty(propertyById('cf:10'))).toBe(false);
    expect(isHomeProperty(propertyById('p:lot:549:-843'))).toBe(false);
    expect(isHomeProperty(propertyById('fac:2'))).toBe(false);
  });

  it('applyWorldOwned marks every owned id and puts owner tags on homes, including a penthouse', () => {
    const setOwned = vi.fn();
    const setOwnerLabels = vi.fn();
    const owned = new Map(SEED.map((o) => [o.id, o]));
    applyWorldOwned({ setOwned, setOwnerLabels }, owned);
    expect(setOwned).toHaveBeenCalledTimes(1);
    expect(setOwned).toHaveBeenCalledWith(SEED.map((o) => o.id));
    const labels: Array<{ id: string; owner: string }> = setOwnerLabels.mock.calls[0]![0];
    expect(labels.map((l) => l.id).sort()).toEqual(['b:house:-899:665', 'b:rowhouse:-1051:373', 'sky:6'].sort());
    expect(new Set(labels.map((l) => l.owner))).toEqual(new Set(['QAOwner']));
    expect(labels.some((l) => l.id === 'cf:10' || l.id === 'p:lot:549:-843' || l.id === 'fac:2')).toBe(false);
  });

  it('is a no-op when the 3D world is not ready yet (fetch can finish first)', () => {
    expect(() => applyWorldOwned(null, new Map(SEED.map((o) => [o.id, o])))).not.toThrow();
  });

  it('WorldMap applies ownership immediately after createWorld, not only on the owned/loading effect', () => {
    const src = readFileSync('client/src/components/WorldMap.tsx', 'utf8');
    expect(src).toMatch(/applyWorldOwned\(worldRef\.current, owned\)/);
    expect(src).toMatch(/applyWorldOwned\(w, ownedRef\.current\)/);
    expect(src).toMatch(/setLoading\(true\)/);
    const iCreate = src.indexOf('worldRef.current = createWorld');
    const iApply = src.indexOf('applyWorldOwned(w, ownedRef.current)');
    const iDone = src.indexOf('setLoading(false)', iCreate);
    expect(iCreate).toBeGreaterThan(0);
    expect(iApply).toBeGreaterThan(iCreate);
    expect(iApply).toBeLessThan(iDone);
  });
});
