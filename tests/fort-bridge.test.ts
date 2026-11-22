import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBridge, cableAnchors, PIER_Z } from '../client/src/lib/worldBridge';
import { BRIDGE_SITE as B, bridgeDeckY, inBridgeSite, inStadiumSite } from '../shared/coop';
import { outskirts, RURAL_ROADS } from '../shared/outskirts';
import { OCEAN, coastZ, HARBOUR, BREAKWATER } from '../shared/ocean';
import { MAP_VIEW, clampMapTarget } from '../shared/farm';
import { RESERVED_VENUES } from '../shared/worldLayout';
import { WEST_ROADS, WEST } from '../shared/westCity';

const tris = (g: THREE.Object3D) => { let n = 0; g.traverse((o) => { if (o.parent?.name === 'bridge-props' || o.name === 'bridge-props') return; const m = o as THREE.Mesh; if (m.isMesh) { const geo = m.geometry; const c = (geo.index ? geo.index.count : geo.attributes.position!.count) / 3; n += (m as THREE.InstancedMesh).isInstancedMesh ? c * (m as THREE.InstancedMesh).count : c; } }); return n; };
const STAGES: Array<[number, number]> = [[0, 0.5], [1, 0], [1, 0.5], [2, 0], [2, 0.5], [3, 0], [3, 0.5], [4, 0]];

describe('Fort McChud Bridge site', () => {
  it('approach leaves Sunset Coast Road through a strip clear of fields, buildings, the airport and West Chud', () => {
    // T-junction on the straight stretch of Sunset Coast Road: its south edge is where the approach starts
    const coast = WEST_ROADS.find((r) => r.id === 'w-coast')!; const near = coast.pts.filter(([x]) => Math.abs(x - B.x) <= B.halfW + 3);
    expect(near.length).toBeGreaterThan(4); for (const [, z] of near) expect(Math.abs(z + coast.width / 2 - B.roadZ)).toBeLessThan(0.5);
    // no other road crosses the approach between the coast road and the beach
    for (const r of WEST_ROADS) for (const [x, z] of r.pts) if (Math.abs(x - B.x) < B.halfW + 1) expect(z < B.roadZ + 0.6 || z > OCEAN.beachZ, r.id).toBe(true);
    for (const [[ax, az], [bx, bz]] of RURAL_ROADS) { const xs = [Math.min(ax, bx) - 3, Math.max(ax, bx) + 3], zs = [Math.min(az, bz), Math.max(az, bz)]; const hit = B.x > xs[0] && B.x < xs[1] && zs[1] > B.roadZ && zs[0] < OCEAN.beachZ; expect(hit).toBe(false); }
    const o = outskirts(); const x0 = B.x - B.halfW - 1.5, x1 = B.x + B.halfW + 1.5;
    for (const r of [...o.fields, ...o.buildings]) { const overlap = r.x + r.w / 2 > x0 && r.x - r.w / 2 < x1 && r.z + r.d / 2 > B.roadZ && r.z - r.d / 2 < OCEAN.beachZ; expect(overlap, JSON.stringify(r)).toBe(false); }
    const v = RESERVED_VENUES.airport; expect(B.roadZ).toBeGreaterThan(v.z1); // south of the airport
    expect(B.x).toBeGreaterThan(WEST.x1); // east of West Chud's land
  });
  it('ramp lands on the beach and the piers stand in the sea, well clear of the harbour and breakwater', () => {
    expect(B.rampZ0).toBeLessThan(OCEAN.beachZ); expect(PIER_Z[0]!).toBeGreaterThan(coastZ(B.x));
    for (const [x] of BREAKWATER) expect(Math.abs(x - B.x)).toBeGreaterThan(60); expect(Math.abs(HARBOUR.x - B.x)).toBeGreaterThan(100);
    expect(inStadiumSite(B.x, 200)).toBe(false); expect(inBridgeSite(B.x, 178)).toBe(true); expect(inBridgeSite(B.x + 20, 178)).toBe(false);
  });
  it('deck profile is continuous: ground road, eased ramp, crowned main span, flat viaduct', () => {
    expect(bridgeDeckY(160)).toBeCloseTo(0.06); expect(bridgeDeckY(B.rampZ1)).toBeCloseTo(B.deckY);
    let prev = bridgeDeckY(150); for (let z = 150; z <= B.farZ; z += 0.5) { const y = bridgeDeckY(z); expect(Math.abs(y - prev)).toBeLessThan(0.3); prev = y; }
    expect(bridgeDeckY((B.rampZ1 + B.mainZ1) / 2)).toBeCloseTo(B.deckY + B.crest); expect(bridgeDeckY(B.farZ)).toBe(B.deckY);
  });
  it('the camera can pan out over both towers', () => {
    expect(MAP_VIEW.z1).toBeGreaterThanOrEqual(B.towers[1] + 30); expect(MAP_VIEW.x0).toBeLessThan(B.x - 40);
    expect(clampMapTarget(B.x, B.towers[1])).toEqual([B.x, B.towers[1]]);
  });
  it('cable fans reach the deck on both sides of each tower, inside the main span and back span', () => {
    const a = cableAnchors(); expect(a.length).toBe(36);
    for (const c of a) { expect(c.z).toBeGreaterThan(B.rampZ1 - 4); expect(c.z).toBeLessThan(B.mainZ1); }
  });
});

describe('Fort McChud Bridge model', () => {
  it('surveyed site: buoys and a crane barge, no structure yet', () => {
    const g = buildBridge(0, 0); expect(g.getObjectByName('bridge-deck')).toBeFalsy(); expect(g.getObjectByName('bridge-props')!.children.length).toBeGreaterThan(5); expect(new THREE.Box3().setFromObject(g).max.y).toBeLessThan(B.towerH / 2);
  });
  it('every stage builds more of the bridge', () => {
    let prev = -1; for (const [d, f] of STAGES) { const n = tris(buildBridge(d, f)); expect(n, `${d}/${f}`).toBeGreaterThan(prev); prev = n; }
  });
  it('finished bridge: deck, cables, towers to full height; no construction props', () => {
    const g = buildBridge(4, 0); expect(g.getObjectByName('bridge-deck')).toBeTruthy(); expect(g.getObjectByName('bridge-cables')).toBeTruthy();
    expect(g.getObjectByName('bridge-props')).toBeFalsy(); const box = new THREE.Box3().setFromObject(g); expect(box.max.y).toBeGreaterThan(B.towerH); expect(box.max.z).toBeGreaterThan(B.farZ - 20);
  });
  it('low-gfx path is lighter and stays inside the map budget', () => {
    const hi = buildBridge(4, 0), lo = buildBridge(4, 0, true); expect(tris(lo)).toBeLessThan(tris(hi)); expect(tris(hi)).toBeLessThan(40_000);
  });
  it('no NaN attributes or out-of-range indices at any stage / gfx tier', () => {
    for (const low of [false, true]) for (const [d, f] of STAGES) buildBridge(d, f, low).traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh && !(o as THREE.LineSegments).isLineSegments) return;
      const geo = (m as THREE.Mesh).geometry; const p = geo.attributes.position!; for (let i = 0; i < p.array.length; i++) expect(Number.isFinite(p.array[i])).toBe(true);
      if (geo.index) for (let i = 0; i < geo.index.count; i++) expect(geo.index.getX(i)).toBeLessThan(p.count);
      if ((m as THREE.InstancedMesh).isInstancedMesh) { const im = m as THREE.InstancedMesh; for (let i = 0; i < im.count * 16; i++) expect(Number.isFinite(im.instanceMatrix.array[i])).toBe(true); } });
  });
});
