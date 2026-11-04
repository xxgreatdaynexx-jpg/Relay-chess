import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildJet } from '../client/src/lib/fleetModels';
import { JETS } from '../shared/fleet';
// recheck #3: nothing flat pokes out of the fuselage side above the windows (old box cheat line / window band / slab winglet).
describe('recheck #3 jets: no flat block through the fuselage side', () => {
  it.each(JETS.map((j) => j.id))('%s', (id) => {
    const g = buildJet(JETS.find((j) => j.id === id)!); g.updateMatrixWorld(true);
    const parts = (p: string) => { const a: THREE.Mesh[] = []; g.traverse((o) => { if (o.userData.part === p) a.push(o as THREE.Mesh); }); return a; };
    const win = parts('window'); expect(win.length).toBeGreaterThan(4);
    const wy = win[0]!.getWorldPosition(new THREE.Vector3()).y; const wr = (win[0]!.geometry as THREE.CircleGeometry).parameters.radius;
    const fus = Math.abs(win[0]!.getWorldPosition(new THREE.Vector3()).x) / Math.cos(Math.asin(0.3)) / 1.012; const cy = wy - fus * 0.3; // fuselage radius + axis height
    for (const p of ['cheatline', 'windowBand']) { const m = parts(p); expect(m).toHaveLength(2);
      for (const mesh of m) { const a = mesh.geometry.attributes.position!; const v = new THREE.Vector3();
        for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(mesh.matrixWorld); expect(Math.hypot(v.x, v.y - cy)).toBeLessThan(fus * 1.012); } } }
    const boxes: THREE.Mesh[] = []; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.type === 'BoxGeometry') boxes.push(m); });
    expect(boxes.filter((m) => (m.geometry as THREE.BoxGeometry).parameters.width >= fus * 2)).toHaveLength(0);
    const wl = parts('winglet'); expect(wl).toHaveLength(2);
    for (const m of wl) { const b = new THREE.Box3().setFromObject(m); expect(b.max.y).toBeLessThan(wy - wr); expect(Math.min(Math.abs(b.min.x), Math.abs(b.max.x))).toBeGreaterThan(fus * 2);
      expect((m.geometry as THREE.ExtrudeGeometry).type).toBe('ExtrudeGeometry'); }
    expect(parts('wingFairing')).toHaveLength(1);
  });
});
