import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildJet } from '../client/src/lib/fleetModels';
import { plane as freightPlane } from '../client/src/lib/worldFreight';
import { plane as airportPlane } from '../client/src/lib/worldVenues';
import { JETS } from '../shared/fleet';
import { noseGeo } from '../client/src/lib/planeNose';

// mu-visuals nose fix: every plane's nose is coaxial with its fuselage, matches its radius at the joint, and is blunt.
const planes: Array<[string, THREE.Group, 'x' | 'z']> = [...JETS.map((j) => [j.id, buildJet(j), 'z'] as [string, THREE.Group, 'z']), ['freight', freightPlane(), 'x'], ['airport', airportPlane(), 'x']];
const part = (g: THREE.Group, p: string) => g.children.find((c) => c.userData.part === p) as THREE.Mesh;
describe('plane noses', () => {
  for (const [id, g, ax] of planes) it(id, () => {
    g.updateMatrixWorld(true); const f = part(g, 'fuselage'), n = part(g, 'nose'); expect(f && n).toBeTruthy();
    const off = ax === 'z' ? ['x', 'y'] as const : ['y', 'z'] as const;
    for (const k of off) expect(Math.abs(n.position[k] - f.position[k])).toBeLessThan(1e-9); // same axis
    expect(n.userData.r).toBe(f.userData.r);
    // joint ring: nose vertices at the joint plane sit exactly on the fuselage radius, around the same axis
    const pos = n.geometry.getAttribute('position'); const v = new THREE.Vector3(); let ring = 0;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const a = ax === 'z' ? v.z : v.x; if (Math.abs(a) < 1e-6) { ring++; expect(Math.hypot(v[off[0]], v[off[1]])).toBeCloseTo(f.userData.r, 6); } }
    expect(ring).toBeGreaterThan(8);
    // fuselage end meets the nose joint exactly (no gap/overlap)
    const fb = new THREE.Box3().setFromObject(f), nb = new THREE.Box3().setFromObject(n);
    expect(nb.min[ax]).toBeCloseTo(fb.max[ax], 6);
  });
  it('nose is blunt and rounded (slope 0 at the joint, rounded tip) and geometry is shared', () => {
    expect(noseGeo(1, 2)).toBe(noseGeo(1, 2));
    const pos = noseGeo(1, 2).getAttribute('position'); const v = new THREE.Vector3(); let rNear = 0;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); if (Math.abs(v.z - 2 / 14) < 1e-6) rNear = Math.max(rNear, Math.hypot(v.x, v.y)); }
    expect(rNear).toBeGreaterThan(0.99); // nearly full radius a step past the joint = tangent blend
  });
});
