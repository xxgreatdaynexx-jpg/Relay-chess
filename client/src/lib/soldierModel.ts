import * as THREE from 'three';
import { MODEL_HEAD_Y } from './soldierPose';
import { addRim, lowDetail, rbox } from './charLook';

/** Arena third-person body (visual only; hitboxes are server-side). Same proportions and pivots as before;
 *  bevelled parts, boots, plate carrier, pads, visor and a soft rim light (pt1340u). Low tier skips the extras. */
export function buildSoldierBody(color: string) {
  const outer = new THREE.Group();
  const rig = new THREE.Group(); outer.add(rig);
  const body = addRim(new THREE.MeshLambertMaterial({ color, transparent: true }), 0xffffff, 0.28);
  const skin = addRim(new THREE.MeshLambertMaterial({ color: 0xc89a70, transparent: true }), 0xffe0c0, 0.22);
  const dark = addRim(new THREE.MeshLambertMaterial({ color: 0x2b2a26, transparent: true }), 0xbfd0ff, 0.3);
  const plate = addRim(new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), transparent: true }), 0xffffff, 0.25);
  const visor = new THREE.MeshLambertMaterial({ color: 0x0f1a24, emissive: 0x2aa8ff, emissiveIntensity: 0.55, transparent: true });
  const mats: THREE.MeshLambertMaterial[] = [body, skin, dark, plate, visor];
  const lo = lowDetail();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = rig) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o;
  };
  const legs: THREE.Object3D[] = [];
  for (const side of [-0.11, 0.11]) {
    const pivot = new THREE.Group(); pivot.position.set(0, 0.8, side); rig.add(pivot);
    add(rbox(0.18, 0.8, 0.17, 0.05), dark, 0, -0.4, 0, pivot);
    if (!lo) {
      add(rbox(0.25, 0.12, 0.2, 0.04), plate, 0.03, -0.75, 0, pivot); // boot
      add(rbox(0.06, 0.12, 0.13, 0.025), plate, 0.095, -0.38, 0, pivot); // knee pad
    }
    legs.push(pivot);
  }
  add(rbox(0.3, 0.58, 0.48, 0.07), body, 0, 1.08, 0); // torso
  add(rbox(0.16, 0.12, 0.5, 0.03), dark, 0.02, 0.86, 0); // belt
  add(rbox(0.26, 0.26, 0.24, 0.06), skin, 0, MODEL_HEAD_Y, 0); // head
  add(rbox(0.29, 0.1, 0.27, 0.04), body, 0, 1.68, 0); // helmet/cap
  add(rbox(0.06, 0.06, 0.2, 0.02), lo ? dark : visor, 0.13, 1.56, 0); // goggles / visor
  if (!lo) {
    add(rbox(0.06, 0.36, 0.4, 0.03), plate, 0.165, 1.12, 0); // plate carrier front
    add(rbox(0.05, 0.3, 0.38, 0.03), plate, -0.165, 1.14, 0); // back plate
    add(rbox(0.05, 0.08, 0.08, 0.015), dark, 0.2, 1.06, -0.1); add(rbox(0.05, 0.08, 0.08, 0.015), dark, 0.2, 1.06, 0.1); // mag pouches
    add(rbox(0.04, 0.05, 0.07, 0.012), body, 0.105, 0.86, 0); // buckle
    for (const z of [-0.25, 0.25]) add(rbox(0.22, 0.08, 0.1, 0.035), plate, 0, 1.33, z); // shoulder pads
    add(rbox(0.03, 0.02, 0.08, 0.008), dark, 0.135, 1.44, 0); // mouth line
    add(rbox(0.12, 0.05, 0.25, 0.02), dark, 0.09, 1.66, 0); // helmet brim
  }
  const aim = new THREE.Group(); aim.position.set(0.04, 1.3, 0.05); rig.add(aim);
  return { outer, rig, body, legs, aim, mats };
}
