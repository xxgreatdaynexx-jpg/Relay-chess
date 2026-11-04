import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addDepthProps, depthLook } from '../client/src/lib/mineDepthLook';
import { levelOf } from '../shared/mineFloors';
const walls = (f: number) => levelOf('mine', f).map.solids.filter((s) => s.mat === 'concrete' && s.z0 < 1).map((s) => [s.x0, s.y0, s.x1, s.y1] as [number, number, number, number]);
describe('QA#4 mine floors look different by depth', () => {
  it('floors 1/2/3 get distinct tints and prop sets', () => {
    const l = [1, 2, 3].map(depthLook); expect(new Set(l.map((x) => x.props)).size).toBe(3); expect(new Set(l.map((x) => x.wall)).size).toBe(3); expect(depthLook(4).props).toBe('timber');
  });
  it.each([1, 2, 3])('floor %i builds non-empty instanced props', (f) => {
    const s = new THREE.Scene(); const g = addDepthProps(s, depthLook(f), walls(f), levelOf('mine', f).nodes); let n = 0;
    g.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) n += (o as THREE.InstancedMesh).count; }); expect(n).toBeGreaterThan(10);
  });
});
