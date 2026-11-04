import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBoat } from '../client/src/lib/fleetModels';
import { BOATS } from '../shared/fleet';
const yacht = () => buildBoat(BOATS.find((b) => b.id === 'superyacht')!);
describe('superyacht rebuild', () => {
  it('superstructure is rounded tiers, not big boxes', () => {
    const g = yacht(); g.updateMatrixWorld(true); const meshes: THREE.Mesh[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const bigBoxes = meshes.filter((m) => m.geometry.type === 'BoxGeometry' && m.position.y > 2.7).filter((m) => { const p = (m.geometry as THREE.BoxGeometry).parameters; return p.height > 0.5 && p.depth > 2; });
    expect(bigBoxes).toHaveLength(0);
    const tiers = meshes.filter((m) => m.geometry.type === 'ExtrudeGeometry' && m.position.y > 2.5); expect(tiers.length).toBeGreaterThanOrEqual(12);
    expect(tiers.every((m) => m.geometry.userData.shared)).toBe(true);
    const b = new THREE.Box3().setFromObject(g); expect(b.max.y).toBeGreaterThan(9); expect(b.max.z - b.min.z).toBeGreaterThan(30);
  });
  it('tier geometry is shared between copies', () => {
    const geos = (g: THREE.Group) => { const a: THREE.BufferGeometry[] = []; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.userData.shared) a.push(m.geometry); }); return a; };
    expect(geos(yacht())).toEqual(geos(yacht()));
  });
});
