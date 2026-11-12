import { describe, expect, it } from 'vitest';
import { myHomeRows } from '../client/src/lib/myHome';
import { properties, propertyById } from '../shared/realEstate';
import { isHomeProperty } from '../shared/homes';

describe('My home panel rows (Tess QA #2)', () => {
  const farm = properties().find((p) => p.kind === 'farm')!, factory = properties().find((p) => p.kind === 'landmark' && p.type === 'casino')!;
  const furn = properties().find((p) => p.kind === 'landmark' && p.type === 'furniture'), house = properties().find((p) => isHomeProperty(p) && !p.retired)!;
  it('farm listed once, owned Casino listed, unowned Furniture Store not listed as owned, house enterable', () => {
    const owned = [farm, factory, house].map((p) => ({ id: p.id, owner: 'QA-Tess' })).concat([{ id: 'x', owner: 'Someone' }]);
    const r = myHomeRows(owned, 'qa-tess', propertyById);
    expect(r.farms).toEqual([farm.id]); expect(r.businesses).toEqual([factory.id]); expect(r.homes).toEqual([house.id]); expect(r.kitchens).toEqual([]);
    const all = [...r.farms, ...r.businesses, ...r.homes, ...r.kitchens]; expect(new Set(all).size).toBe(all.length); if (furn) expect(all).not.toContain(furn.id);
  });
  it('no house owned: no enter rows', () => { expect(myHomeRows([{ id: farm.id, owner: 'A' }], 'a', propertyById).homes).toEqual([]); });
});
