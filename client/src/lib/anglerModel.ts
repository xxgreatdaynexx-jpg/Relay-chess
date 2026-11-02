import * as THREE from 'three';
import { addRim, lowDetail, rbox } from './charLook';

/** Fishing dock angler (you + other anglers on the lake dock and Reef Pier). Faces -z, feet at y=0.
 *  Proper fisherman look (pt1340u): bucket hat, khaki vest with pockets, beard, waders + boots, belt,
 *  plus idle breathing and arm poses for casting / reeling. Geometry + materials are shared by every angler. */
type Mats = Record<'skin' | 'shirt' | 'vest' | 'pocket' | 'hat' | 'band' | 'wader' | 'boot' | 'beard' | 'belt' | 'eye' | 'buckle', THREE.Material>;
let M: Mats | null = null;
const G = new Map<string, THREE.BufferGeometry>();
function geo(k: string, make: () => THREE.BufferGeometry) { let g = G.get(k); if (!g) { g = make(); G.set(k, g); } return g; }
function mats(): Mats {
  if (M) return M;
  const L = (c: number, rim = 0.22) => addRim(new THREE.MeshLambertMaterial({ color: c }), 0xfff2dc, rim);
  M = {
    skin: L(0xd9a27a, 0.18), shirt: L(0x2f6fb0), vest: L(0x8a8456), pocket: L(0x6f6a42), hat: L(0xc9b98a), band: L(0xff5f8a),
    wader: L(0x3d4a35), boot: L(0x1f2420), beard: L(0x6a4a2e, 0.15), belt: L(0x3a2818),
    eye: new THREE.MeshBasicMaterial({ color: 0x1a1410 }), buckle: new THREE.MeshLambertMaterial({ color: 0xc9a640, emissive: 0x3a2a08 }),
  };
  return M;
}
export interface AnglerRig { root: THREE.Group; disposables: (THREE.Material | THREE.BufferGeometry)[]; animate: (t: number, pose: string, k?: number) => void }

export function buildAngler(): AnglerRig {
  const m = mats(); const lo = lowDetail(); const seg = lo ? 8 : 14;
  const root = new THREE.Group(); root.name = 'angler';
  const mesh = (g: THREE.BufferGeometry, mt: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => { const o = new THREE.Mesh(g, mt); o.position.set(x, y, z); parent.add(o); return o; };
  // legs: waders + boots
  for (const x of [-0.13, 0.13]) {
    mesh(geo('leg' + seg, () => new THREE.CylinderGeometry(0.12, 0.11, 0.78, seg)), m.wader, x, 0.42, 0, root);
    mesh(rbox(0.2, 0.12, 0.3, 0.05), m.boot, x, 0.06, -0.04, root);
  }
  const body = new THREE.Group(); body.position.y = 0.8; root.add(body);
  mesh(geo('torso' + seg, () => new THREE.CapsuleGeometry(0.3, 0.5, 4, seg)), m.shirt, 0, 0.35, 0, body);
  mesh(rbox(0.5, 0.36, 0.08, 0.03), m.wader, 0, 0.12, -0.25, body); // wader bib
  mesh(geo('belt' + seg, () => new THREE.CylinderGeometry(0.315, 0.315, 0.07, seg)), m.belt, 0, 0.0, 0, body);
  const vest = mesh(geo('vest' + seg, () => new THREE.CylinderGeometry(0.33, 0.34, 0.5, seg, 1, true)), m.vest, 0, 0.42, 0, body);
  (vest.material as THREE.Material).side = THREE.DoubleSide;
  if (!lo) {
    for (const [x, y] of [[-0.16, 0.5], [0.16, 0.5], [-0.17, 0.3], [0.17, 0.3]] as const) mesh(rbox(0.13, 0.11, 0.05, 0.02), m.pocket, x, y, -0.32, body);
    mesh(rbox(0.06, 0.06, 0.04, 0.01), m.buckle, 0, 0.0, -0.315, body);
    mesh(geo('fly', () => new THREE.SphereGeometry(0.025, 6, 4)), m.band, 0.18, 0.6, -0.33, body); // lure pinned to the vest
  }
  // head: face, beard, bucket hat
  const head = new THREE.Group(); head.position.y = 0.95; body.add(head);
  mesh(geo('head' + seg, () => new THREE.SphereGeometry(0.24, seg, seg - 2)), m.skin, 0, 0, 0, head);
  mesh(geo('beard' + seg, () => new THREE.SphereGeometry(0.21, seg, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55)), m.beard, 0, -0.04, -0.06, head).scale.set(1.05, 1, 0.95);
  mesh(geo('hatTop' + seg, () => new THREE.CylinderGeometry(0.2, 0.25, 0.16, seg)), m.hat, 0, 0.17, 0, head);
  mesh(geo('hatBrim' + seg, () => new THREE.CylinderGeometry(0.38, 0.4, 0.025, seg + 4)), m.hat, 0, 0.1, 0, head);
  mesh(geo('band' + seg, () => new THREE.CylinderGeometry(0.252, 0.252, 0.04, seg)), m.band, 0, 0.12, 0, head);
  if (!lo) {
    const eye = geo('eye', () => new THREE.SphereGeometry(0.03, 6, 5));
    mesh(eye, m.eye, -0.08, 0.04, -0.215, head); mesh(eye, m.eye, 0.08, 0.04, -0.215, head);
    mesh(geo('nose', () => new THREE.SphereGeometry(0.045, 8, 6)), m.skin, 0, -0.01, -0.24, head);
  }
  // arms on shoulder pivots, reaching forward to the rod grip
  const arm = (x: number) => {
    const p = new THREE.Group(); p.position.set(x, 0.62, -0.02); body.add(p);
    mesh(geo('arm' + seg, () => new THREE.CapsuleGeometry(0.08, 0.42, 3, seg)), m.shirt, 0, -0.27, 0, p);
    mesh(geo('hand', () => new THREE.SphereGeometry(0.075, 8, 6)), m.skin, 0, -0.55, 0, p);
    return p;
  };
  const armR = arm(0.3), armL = arm(-0.3);
  const disposables: (THREE.Material | THREE.BufferGeometry)[] = [];
  /** pose: idle | charge | flying | cast | wait | bite | reel | catch | show. k = 0..1 (charge power). */
  const animate = (t: number, pose: string, k = 0) => {
    const br = Math.sin(t * 1.6);
    body.position.y = 0.8 + br * 0.008; body.scale.set(1 + br * 0.008, 1, 1 + br * 0.008);
    head.rotation.set(Math.sin(t * 0.4) * 0.04, Math.sin(t * 0.27) * 0.12, 0);
    let rx = 1.15, lx = 1.0, rz = 0.25, lz = -0.3;
    if (pose === 'charge') { rx = 1.15 + 1.4 * k; lx = 1.0 + 1.2 * k; }
    else if (pose === 'cast' || pose === 'flying') { rx = 1.45; lx = 1.25; }
    else if (pose === 'reel') { rx = 1.15 + Math.sin(t * 14) * 0.25; rz = 0.25 + Math.cos(t * 14) * 0.18; lx = 1.2; }
    else if (pose === 'bite') { rx = 1.3 + Math.sin(t * 20) * 0.05; lx = 1.15; }
    else if (pose === 'catch' || pose === 'show') { rx = 2.2; lx = 2.0; }
    else { rx += Math.sin(t * 0.9) * 0.05; lx += Math.sin(t * 0.9 + 1) * 0.04; } // idle / wait: small sway
    const ease = 0.25;
    armR.rotation.x += (rx - armR.rotation.x) * ease; armR.rotation.z += (rz - armR.rotation.z) * ease;
    armL.rotation.x += (lx - armL.rotation.x) * ease; armL.rotation.z += (lz - armL.rotation.z) * ease;
  };
  armR.rotation.set(1.15, 0, 0.25); armL.rotation.set(1.0, 0, -0.3);
  return { root, disposables, animate };
}
