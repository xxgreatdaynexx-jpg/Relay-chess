// Civic buildings spread around the city (Dayne 2026-11-07 t1962u). Placement only: lots under a plot are RETIRED (kept in
// the catalog with the same id/price, not for sale, drawn only while owned), never deleted, so an owner - including one who
// buys during a rollout - keeps the lot. Every other catalog id/geometry/price and the countryside are unchanged.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILDING_IDS, CIVIC_PLOTS, civicPad, civicPlot, inCivic } from '../shared/city';
import { properties, propertyById } from '../shared/realEstate';
import { outskirts } from '../shared/outskirts';
import { clearOfRoads, landmarks, nearestTangent, obbOverlap, PARK_AREA, PLATE, roadClearance } from '../shared/worldLayout';
import { RealEstate, PropertyError } from '../server/realEstate';
const h = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
// Catalog after rf:13–20 (e74f9fa) plus in-place resort road clearance (owned ids unchanged). Countryside buildings/fields unchanged since 6c9544d.
const BASE = { n: 549, ids: '13f008cdee337fa0', geo: '8f76dea92770cd85', buildings: '3ddcb810ef6cda9a', fields: 'd7ab945b01921d8a' };
const RETIRED = ['b:apartment:-90:-585', 'b:apartment:131:-380', 'b:house:-1042:-487', 'b:house:-106:-644', 'b:house:-165:-629', 'b:house:-570:-747', 'b:house:-639:-701', 'b:house:-982:-483',
  'b:house:1010:-460', 'b:house:1065:-459', 'b:house:947:-486', 'b:rowhouse:-174:-579', 'b:rowhouse:-628:-789', 'b:rowhouse:186:-350', 'b:rowhouse:68:-360', 'b:tower:110:-315',
  'p:lot:-948:-583', 'p:park:388:145', 'p:park:666:-134'];
// Read-only ownership snapshot (properties table, 2026-11-07 ~13:40 UTC-6): the city lots that were owned.
const OWNED_CITY = ['b:house:-899:665', 'b:house:-952:686', 'b:house:1053:-523', 'b:house:1127:-940'];

describe('civic plots', () => {
  it('all 7 buildings keep their ids and get a street-facing plot on the plate, clear of roads, landmarks and each other', () => {
    expect(Object.keys(CIVIC_PLOTS).sort()).toEqual([...BUILDING_IDS].sort());
    const lms = Object.values(landmarks());
    BUILDING_IDS.forEach((id, i) => {
      const p = civicPad(id); expect(civicPlot(i)).toMatchObject({ x: p.x, z: p.z, rot: p.rot, w: 12, d: 7 });
      expect(Math.abs(p.x)).toBeLessThan(PLATE - 6); expect(Math.abs(p.z)).toBeLessThan(PLATE - 6);
      expect(clearOfRoads(p, 0.8)).toBe(true); expect(roadClearance(p.x, p.z, 32)).toBeLessThanOrEqual(10); // fronts a street, not floating mid-block
      const t = -nearestTangent(p.x, p.z); const da = Math.abs(((p.rot - t) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2); expect(da).toBeLessThan(0.02); // faces its street
      for (const l of lms) expect(obbOverlap(l, p, 2)).toBe(false);
      expect(obbOverlap(PARK_AREA, p, 2)).toBe(false);
      for (const o of BUILDING_IDS) if (o !== id) expect(obbOverlap(civicPad(o), p, 3)).toBe(false);
    });
  });
  it('old west strip is free again (inCivic false there); pads report inCivic', () => {
    for (let z = -114; z <= -56; z += 4) expect(inCivic(-135.5, z)).toBe(false);
    for (const id of BUILDING_IDS) expect(inCivic(CIVIC_PLOTS[id].x, CIVIC_PLOTS[id].z)).toBe(true);
  });
});

describe('ownership and stable ids', () => {
  const ps = properties();
  it('catalog ids, geometry and prices are byte-identical to the base; countryside unchanged', () => {
    const added = ['cf:1008', 'cf:1009', 'cf:1010', 'cf:1011', 'barn:big:1008', 'barn:big:1009', 'barn:big:1010', 'barn:big:1011', 'sky:1', 'sky:2', 'sky:3', 'sky:4', 'sky:5', 'sky:6', 'isl:1', 'isl:2', 'isl:3', 'isl:4'];
    const isExp = (id: string) => /^(lot:estate:|winery:|b:mansion:)/.test(id) || /^cf:2\d{3}$/.test(id);
    const prior = ps.filter((p) => !added.includes(p.id) && !isExp(p.id));
    expect(ps.filter((p) => added.includes(p.id)).map((p) => p.id).sort()).toEqual([...added].sort());
    expect(prior.length).toBe(BASE.n); expect(ps.filter((p) => /^rf:(1[3-9]|20)$/.test(p.id)).map((p) => p.id).sort()).toEqual(['rf:13','rf:14','rf:15','rf:16','rf:17','rf:18','rf:19','rf:20']);
    expect(h(prior.map((p) => p.id).sort())).toBe(BASE.ids);
    expect(h(prior.map((p) => [p.id, p.x, p.z, p.w, p.d, p.rot, p.price]))).toBe(BASE.geo);
    expect(h(outskirts().buildings)).toBe(BASE.buildings); expect(h(outskirts().fields)).toBe(BASE.fields);
  });
  it('exactly the 19 lots under plots are retired (still resolvable), and none of the owned city lots', () => {
    expect(ps.filter((p) => p.retired).map((p) => p.id).sort()).toEqual(RETIRED);
    for (const id of RETIRED) expect(propertyById(id)?.retired).toBe(true);
    for (const id of OWNED_CITY) { expect(propertyById(id)).toBeTruthy(); expect(propertyById(id)!.retired).toBeUndefined(); }
    expect(ps.filter((p) => p.retired).every((p) => p.kind === 'building' || p.kind === 'patch')).toBe(true); // never cf:/f:/rf:/landmarks
  });
  it('the server refuses to quote or buy a retired lot before touching the database', async () => {
    const pool = new Proxy({}, { get: () => { throw new Error('database touched'); } });
    const re = new RealEstate(pool as never);
    await expect(re.buy('Alice', RETIRED[0])).rejects.toBeInstanceOf(PropertyError);
    await expect(re.quote('Alice', RETIRED[0])).rejects.toThrow(/not for sale/);
  });
});
