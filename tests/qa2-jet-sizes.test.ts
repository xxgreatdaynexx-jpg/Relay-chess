import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildJet } from '../client/src/lib/fleetModels';
import { JETS } from '../shared/fleet';
const size = (id: string) => new THREE.Box3().setFromObject(buildJet(JETS.find((j) => j.id === id)!)).getSize(new THREE.Vector3());
describe('QA#2 jet scale', () => {
  it('G700 is ~2x the Citation length', () => { const r = size('g700').z / size('citation').z; expect(r).toBeGreaterThan(1.7); expect(r).toBeLessThan(2.3); });
  it('BBJ is about G700 length but visibly thicker', () => { const c = size('chudone'), g = size('g700'); expect(c.z / g.z).toBeGreaterThan(0.95); expect(c.z / g.z).toBeLessThan(1.3); });
});
