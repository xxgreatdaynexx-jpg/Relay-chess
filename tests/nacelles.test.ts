import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildJet } from '../client/src/lib/fleetModels';
import { plane } from '../client/src/lib/worldFreight';
import { JETS } from '../shared/fleet';

// Each nacelle = Group(barrel Group(body, lip torus, fan, spinner, nozzle, plug), pylon). Find them by the torus lip.
function nacelles(root: THREE.Object3D) { root.updateMatrixWorld(true); const out: { lip: THREE.Vector3; mid: THREE.Vector3; top: number }[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry?.type === 'TorusGeometry' && o.parent?.parent) { const n = o.parent.parent; const bb = new THREE.Box3().setFromObject(n);
    out.push({ lip: new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()), mid: new THREE.Box3().setFromObject(o.parent).getCenter(new THREE.Vector3()), top: bb.max.y }); } }); return out; }
describe('plane engines (mu-visuals)', () => {
  for (const j of JETS) it(`${j.id}: paired under-wing nacelles pointing forward (+Z)`, () => { const g = buildJet(j); const ns = nacelles(g); expect(ns.length).toBeGreaterThanOrEqual(2); expect(ns.length % 2).toBe(0);
    const fus = new THREE.Box3().setFromObject(g); for (const n of ns) { expect(n.lip.z).toBeGreaterThan(n.mid.z); expect(Math.abs(n.mid.x)).toBeGreaterThan(0.5); expect(n.mid.y).toBeLessThan((fus.min.y + fus.max.y) / 2); } });
  it('freight / Fort plane: two nacelles pointing forward (+X), below the wing', () => { const ns = nacelles(plane()); expect(ns.length).toBe(2); for (const n of ns) { expect(n.lip.x).toBeGreaterThan(n.mid.x); expect(n.top).toBeLessThanOrEqual(-0.3); } });
});
