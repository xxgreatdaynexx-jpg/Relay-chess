import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBoat } from '../client/src/lib/fleetModels';
import { BOATS } from '../shared/fleet';
describe('QA#3 sportfisher outriggers', () => {
  it('splay outward into a V (tips further out than bases, no crossing)', () => {
    const g = buildBoat(BOATS.find((b) => b.id === 'sportfisher')!); const rs: THREE.Mesh[] = []; g.traverse((o) => { if (o.userData.part === 'outrigger') rs.push(o as THREE.Mesh); });
    expect(rs).toHaveLength(2); g.updateMatrixWorld(true);
    for (const r of rs) { const top = new THREE.Vector3(0, 3.5, 0).applyMatrix4(r.matrixWorld), bot = new THREE.Vector3(0, -3.5, 0).applyMatrix4(r.matrixWorld);
      expect(Math.sign(top.x)).toBe(Math.sign(bot.x)); expect(Math.abs(top.x)).toBeGreaterThan(Math.abs(bot.x) + 2); expect(top.y).toBeGreaterThan(bot.y); }
  });
});
