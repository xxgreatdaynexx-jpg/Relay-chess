import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildJet } from '../client/src/lib/fleetModels';
import { plane as freightPlane } from '../client/src/lib/worldFreight';
import { plane as airportPlane } from '../client/src/lib/worldVenues';
import { JETS } from '../shared/fleet';

// mu-visuals tail fins: fin on the centreline, base flush with the fuselage top at the rear, swept back + tapered,
// horizontal stabilisers symmetric (T-tail on the Citation and G700).
const planes: Array<[string, THREE.Group, 'x' | 'z']> = [...JETS.map((j) => [j.id, buildJet(j), 'z'] as [string, THREE.Group, 'z']), ['freight', freightPlane(), 'x'], ['airport', airportPlane(), 'x']];
const parts = (g: THREE.Group, p: string) => g.children.filter((c) => c.userData.part === p) as THREE.Mesh[];
const box = (m: THREE.Mesh) => new THREE.Box3().setFromObject(m);
describe('plane tail fins', () => {
  it('covers every jet', () => expect(JETS.map((j) => j.id).sort()).toEqual(['chudone', 'citation', 'g700', 'global']));
  for (const [id, g, ax] of planes) it(id, () => {
    g.updateMatrixWorld(true);
    const [f] = parts(g, 'fuselage'), fins = parts(g, 'fin'), stabs = parts(g, 'stab'); expect(fins).toHaveLength(1); expect(stabs).toHaveLength(2);
    const fin = fins[0]!; const r = f!.userData.r as number; const fy = f!.position.y;
    const along = (v: THREE.Vector3) => (ax === 'z' ? v.z : v.x), side = (v: THREE.Vector3) => (ax === 'z' ? v.x : v.z);
    const fb = box(fin); const len = (f!.geometry as THREE.CylinderGeometry).parameters.height;
    // centreline + thin
    expect(Math.abs(side(fb.min) + side(fb.max))).toBeLessThan(1e-6); expect(side(fb.max) - side(fb.min)).toBeLessThan(r * 0.25);
    // base flush with the tube top: inside the top skin (no gap) but not buried (≤ 5% r)
    expect(fb.min.y).toBeLessThanOrEqual(fy + r * Math.cos(Math.PI / 24) + 1e-6); expect(fb.min.y).toBeGreaterThan(fy + r * 0.95);
    // root sits on the cylinder at the rear (not over the cone / not forward of the rear third)
    const pos = fin.geometry.getAttribute('position'); const v = new THREE.Vector3(); const root: number[] = [], tip: number[] = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(fin.matrixWorld); (Math.abs(v.y - fb.min.y) < 1e-6 ? root : Math.abs(v.y - fb.max.y) < 1e-6 ? tip : []).push(along(v)); }
    const rLE = Math.max(...root), rTE = Math.min(...root), tLE = Math.max(...tip), tTE = Math.min(...tip);
    expect(rTE).toBeGreaterThanOrEqual(along(f!.position) - len / 2 - 1e-6); expect(rLE).toBeLessThan(along(f!.position) - len / 6);
    expect(tLE).toBeLessThan(rLE - (fb.max.y - fb.min.y) * 0.5); // swept back (> ~27°)
    expect(tLE - tTE).toBeLessThan((rLE - rTE) * 0.8); // tapered
    expect(fb.max.y - fb.min.y).toBeGreaterThan(r * 1.8); expect(fb.max.y - fb.min.y).toBeLessThan(r * 4);
    // stabilisers mirror-symmetric
    const [a, b] = stabs.map(box) as [THREE.Box3, THREE.Box3];
    expect(side(a.max)).toBeCloseTo(-side(b.min), 6); expect(side(a.min)).toBeCloseTo(-side(b.max), 6);
    expect(a.min.y).toBeCloseTo(b.min.y, 6); expect(along(a.max)).toBeCloseTo(along(b.max), 6);
    const tT = id === 'citation' || id === 'g700' || id === 'global';
    expect(stabs[0]!.userData.tTail).toBe(tT);
    if (tT) { expect(a.max.y).toBeCloseTo(fb.max.y, 3); expect(along(a.max)).toBeLessThanOrEqual(tLE + 1e-6); }
    else { expect(a.min.y).toBeLessThan(fy + r); expect(a.max.y).toBeGreaterThan(fy - r); }
  });
});
