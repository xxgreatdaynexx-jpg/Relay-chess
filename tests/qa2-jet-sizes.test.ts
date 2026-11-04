import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildJet } from '../client/src/lib/fleetModels';
import { JETS } from '../shared/fleet';
const size = (id: string) => new THREE.Box3().setFromObject(buildJet(JETS.find((j) => j.id === id)!)).getSize(new THREE.Vector3());
describe('QA#2 jet scale', () => {
  it('G700 is ~2x the Citation length', () => { const r = size('g700').z / size('citation').z; expect(r).toBeGreaterThan(1.7); expect(r).toBeLessThan(2.3); });
  // recheck #4: the 747-8 BBJ is ~2.2x the G700 (76 m vs 33.5 m) in length, span and height
  it('BBJ (747-8) is ~2.2x the G700', () => { const c = size('chudone'), g = size('g700');
    for (const ax of ['x', 'y', 'z'] as const) { expect(c[ax] / g[ax]).toBeGreaterThan(1.9); expect(c[ax] / g[ax]).toBeLessThan(2.6); } });
});
