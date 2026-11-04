import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FARM_MACHINES, buildMachine } from '../client/src/lib/farmMachines';
import { farmPlots, BARNS, SILOS, FARM_LANES, FARM_LANE_W, FARM_X0, FARM_X1, FARM_Z0, FARM_Z1 } from '../shared/farm';

const rect = (x: number, z: number, w: number, d: number) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
type R = ReturnType<typeof rect>; const hit = (a: R, b: R) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const foot = FARM_MACHINES.map((m) => { const o = buildMachine(m.kind); o.position.set(m.x, 0, m.z); o.rotation.y = m.yaw; o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); return { m, r: { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }, y0: b.min.y }; });
describe('farm machinery', () => {
  it('has every kind', () => expect(new Set(FARM_MACHINES.map((m) => m.kind))).toEqual(new Set(['tractor', 'harvester', 'trailer', 'seeder'])));
  it('parks clear of plots, barns, silos, lanes and each other, inside the farm, on the ground', () => {
    const solid: R[] = [...farmPlots().map((p) => rect(p.x, p.z, p.w + 0.4, p.d + 0.4)), ...BARNS.map((b) => rect(b.x, b.z, b.w + 0.6, b.d + 0.6)), ...SILOS.map(([x, z]) => rect(x, z, 3.4, 3.4)),
      ...FARM_LANES.map(([[x0, z0], [x1, z1]]) => ({ x0: Math.min(x0!, x1!) - FARM_LANE_W / 2, x1: Math.max(x0!, x1!) + FARM_LANE_W / 2, z0: Math.min(z0!, z1!), z1: Math.max(z0!, z1!) }))];
    foot.forEach((f, i) => {
      expect(f.r.x0).toBeGreaterThan(FARM_X0); expect(f.r.x1).toBeLessThan(FARM_X1); expect(f.r.z0).toBeGreaterThan(FARM_Z0); expect(f.r.z1).toBeLessThan(FARM_Z1);
      expect(Math.abs(f.y0)).toBeLessThan(0.15);
      for (const s of solid) expect(hit(f.r, s), `${f.m.kind}@${f.m.x}`).toBe(false);
      foot.forEach((g, j) => { if (j > i) expect(hit(f.r, g.r)).toBe(false); });
    });
  });
  it('shares geometry and materials between copies', () => {
    const a = buildMachine('tractor'), b = buildMachine('tractor'); const ga: THREE.BufferGeometry[] = [], gb: THREE.BufferGeometry[] = [];
    a.traverse((o) => { if ((o as THREE.Mesh).isMesh) ga.push((o as THREE.Mesh).geometry); }); b.traverse((o) => { if ((o as THREE.Mesh).isMesh) gb.push((o as THREE.Mesh).geometry); });
    expect(ga.length).toBeGreaterThan(5); expect(ga).toEqual(gb); expect(ga.every((g) => g.userData.shared)).toBe(true);
  });
});
