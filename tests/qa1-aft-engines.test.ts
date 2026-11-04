import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildJet } from '../client/src/lib/fleetModels';
import { JETS } from '../shared/fleet';
const parts = (id: string) => { const g = buildJet(JETS.find((j) => j.id === id)!); const a: THREE.Object3D[] = []; g.traverse((o) => { if (o.userData.part === 'aftEngine') a.push(o); }); return { g, a }; };
describe('QA#1 bizjet engines', () => {
  it.each(['citation', 'g700'])('%s has two aft-fuselage engines, mirrored, behind the wing', (id) => {
    const { a } = parts(id); expect(a).toHaveLength(2); expect(a[0]!.position.x).toBeCloseTo(-a[1]!.position.x); for (const n of a) expect(n.position.z).toBeLessThan(0);
  });
  it('BBJ keeps underwing pods only', () => { expect(parts('chudone').a).toHaveLength(0); });
});
