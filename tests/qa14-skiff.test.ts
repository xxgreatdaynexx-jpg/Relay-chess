import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBoat } from '../client/src/lib/fleetModels';
import { BOATS } from '../shared/fleet';
describe('QA#14 skiff', () => {
  it('has twin transom outboards (cowling above, leg below) instead of black deck boxes', () => {
    const g = buildBoat(BOATS.find((b) => b.id === 'skiff')!); g.updateMatrixWorld(true); const obs: THREE.Object3D[] = []; let deckBoxes = 0;
    g.traverse((o) => { if (o.userData.part === 'outboard') obs.push(o); const m = o as THREE.Mesh; if (m.isMesh && m.parent === g && m.geometry.type === 'BoxGeometry' && Math.abs(m.position.z + 2.4) < 0.01) deckBoxes++; });
    expect(obs).toHaveLength(2); expect(deckBoxes).toBe(0);
    const hull = new THREE.Box3(); g.children.filter((c) => c.userData.part !== 'outboard').forEach((c) => hull.expandByObject(c));
    for (const o of obs) { const b = new THREE.Box3().setFromObject(o); expect(b.max.z).toBeLessThanOrEqual(hull.min.z + 0.2); expect(b.max.y).toBeGreaterThan(1.4); expect(b.min.y).toBeLessThan(0.5);
      expect(o.children.some((c) => (c as THREE.Mesh).geometry?.type === 'CapsuleGeometry')).toBe(true); }
  });
});
