import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mouseLook } from '../client/src/lib/arenaInput';

// Mines camera (mines3d.ts): position (x, z, y), rotation order YXZ, rotation (p, -a - PI/2, 0).
function camBasis(a: number) {
  const c = new THREE.PerspectiveCamera(); c.rotation.order = 'YXZ'; c.rotation.set(0, -a - Math.PI / 2, 0); c.updateMatrixWorld();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion), r = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion);
  return { fwd: [f.x, f.z], right: [r.x, r.z] }; // back to world (x, y)
}
// MinesPanel movement: f = W-S, s = D-A.
const move = (a: number, f: number, s: number) => [Math.cos(a) * f + Math.cos(a - Math.PI / 2) * -s, Math.sin(a) * f + Math.sin(a - Math.PI / 2) * -s];
const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1];

describe('mines controls match arena', () => {
  for (const a of [0, 0.7, 2, -2.5]) {
    it(`W follows camera facing, D goes camera-right (a=${a})`, () => {
      const b = camBasis(a);
      expect(dot(move(a, 1, 0), b.fwd)).toBeCloseTo(1, 5);
      expect(dot(move(a, 0, 1), b.right)).toBeCloseTo(1, 5);
      expect(dot(move(a, 0, -1), b.right)).toBeCloseTo(-1, 5);
    });
  }
  it('mouse +x turns the camera right', () => {
    const [da] = mouseLook({ sens: 1, scope: 1, invertY: false } as never, false, 10, 0);
    expect(da).toBeGreaterThan(0);
    const src = readFileSync(new URL('../client/src/components/MinesPanel.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/m\.a \+= da/);
    const a = 0.3, before = camBasis(a), after = camBasis(a + da);
    expect(dot(after.fwd, before.right)).toBeGreaterThan(0); // new facing swung toward old camera-right
  });
});
