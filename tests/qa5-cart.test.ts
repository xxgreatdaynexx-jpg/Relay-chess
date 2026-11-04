import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCar } from '../client/src/lib/carModels';
import { CARS } from '../shared/cars';
describe('QA#5 shopping cart model', () => {
  it('has a wire basket and a handle attached (not floating)', () => {
    const g = buildCar(CARS.find((c) => c.id === 'cart')!, 0xc81e1e); let h: THREE.Object3D | undefined; let n = 0; g.traverse((o) => { if (o.userData.part === 'cartHandle') h = o; if ((o as THREE.Mesh).isMesh) n++; });
    expect(h).toBeDefined(); expect(n).toBeGreaterThan(40);
    const hb = new THREE.Box3().setFromObject(h!); let touching = false; g.traverse((o) => { if (o !== h && (o as THREE.Mesh).isMesh && new THREE.Box3().setFromObject(o).expandByScalar(0.01).intersectsBox(hb)) touching = true; });
    expect(touching).toBe(true);
  });
});
