import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { furnShowroom } from '../client/src/components/Homes';
import { FURN_BY_ID } from '../shared/homes';
describe('Furniture Store showroom preview', () => {
  it.each(['fridge', 'bed', 'kingbed', 'sofa'])('%s sits in a showroom corner and fills the frame', (id) => {
    const f = FURN_BY_ID.get(id)!; const P = furnShowroom(f, 1.6); expect(P.scene.children.some((o) => o.userData.part === 'showroom')).toBe(true);
    P.camera.updateMatrixWorld(); const v = new THREE.Box3().setFromObject(P.piece); const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? v.max.x : v.min.x, i & 2 ? v.max.y : v.min.y, i & 4 ? v.max.z : v.min.z).project(P.camera));
    for (const p of pts) { expect(Math.abs(p.x)).toBeLessThan(1); expect(Math.abs(p.y)).toBeLessThan(1); }
    const ys = pts.map((p) => p.y); expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.6);
  });
  it('preview keeps the camera aspect in step with the canvas', () => { expect(readFileSync('client/src/components/Homes.tsx', 'utf8')).toMatch(/new ResizeObserver\(fit\)/); });
});
