// Procedural low-poly boats and jets (Marina / Hangar previews and the resort map). Caller owns disposal via `dispose(g)`.
import * as THREE from 'three';
import type { FleetModel } from '../../../shared/fleet';

const M = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...o });
function add(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; }
/** Hull (mu-visuals): a top-view shape with a fine ogive bow and squared transom, extruded to the hull depth, with a
 *  flared sheer cap, a contrasting boot stripe at the waterline, a rub rail and stainless bow/side rails. */
function hullShape(len: number, beam: number) {
  const s = new THREE.Shape(); const h = beam / 2, z0 = -len / 2, zb = len * 0.12;
  s.moveTo(-h * 0.92, z0); s.lineTo(h * 0.92, z0); s.lineTo(h, zb); s.quadraticCurveTo(h * 0.95, len * 0.38, 0, len / 2); s.quadraticCurveTo(-h * 0.95, len * 0.38, -h, zb); s.lineTo(-h * 0.92, z0); return s;
}
function hullGeo(len: number, beam: number, depth: number) { const g = new THREE.ExtrudeGeometry(hullShape(len, beam), { depth, bevelEnabled: true, bevelThickness: depth * 0.12, bevelSize: beam * 0.03, bevelSegments: 2, curveSegments: 14 }); g.rotateX(Math.PI / 2); g.translate(0, depth, 0); return g; }
function hull(g: THREE.Object3D, len: number, beam: number, hgt: number, m: THREE.Material, stripe: THREE.Material) {
  const lower = add(g, hullGeo(len * 0.97, beam * 0.9, hgt * 0.45), stripe, 0, 0, 0); lower.scale.y = 1; // boot stripe / antifoul band
  add(g, hullGeo(len, beam, hgt * 0.6), m, 0, hgt * 0.4, 0);
  add(g, hullGeo(len * 1.005, beam * 1.03, hgt * 0.07), M(0x30363c, { roughness: 0.6 }), 0, hgt * 0.62, 0); // rub rail
  const deck = add(g, new THREE.ShapeGeometry(hullShape(len * 0.96, beam * 0.94), 14), M(0xf2efe8, { roughness: 0.7 }), 0, hgt + 0.02, 0); deck.rotation.x = Math.PI / 2;
  const chrome = M(0xdde4ea, { metalness: 0.9, roughness: 0.2 });
  for (const sx of [-1, 1]) { const r = add(g, new THREE.CylinderGeometry(0.035, 0.035, len * 0.62, 6), chrome, sx * beam * 0.44, hgt + 0.55, len * 0.02); r.rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.55, 5), chrome, sx * beam * 0.44, hgt + 0.28, -len * 0.29 + i * len * 0.155); }
}
export function buildBoat(m: FleetModel): THREE.Group {
  const g = new THREE.Group(); const white = M(m.color); const glass = M(0x2a4a6a, { metalness: 0.7, roughness: 0.1 }); const navy = M(0x1a3a6a); const teak = M(0xb07a48, { roughness: 0.8 }); const chrome = M(0xdde4ea, { metalness: 0.9, roughness: 0.2 });
  if (m.id === 'skiff') {
    hull(g, 6, 2.2, 0.8, white, navy); add(g, new THREE.BoxGeometry(1, 0.9, 0.8), white, 0, 1.2, 0); add(g, new THREE.BoxGeometry(1.05, 0.4, 0.1), glass, 0, 1.5, 0.42);
    for (const x of [-0.45, 0.45]) add(g, new THREE.BoxGeometry(0.35, 0.8, 0.4), M(0x222222), x, 0.9, -2.4);
  } else if (m.id === 'sportfisher') {
    hull(g, 12, 3.6, 1.6, white, navy); add(g, new THREE.BoxGeometry(3, 1.4, 4.5), white, 0, 2.3, 0.4); add(g, new THREE.BoxGeometry(3.05, 0.6, 4.4), glass, 0, 2.5, 0.4);
    add(g, new THREE.BoxGeometry(2.4, 0.15, 2.6), white, 0, 4.2, 0.6); for (const x of [-1, 1]) for (const z of [-0.5, 1.7]) add(g, new THREE.CylinderGeometry(0.05, 0.05, 1.2), chrome, x, 3.6, z);
    for (const s of [-1, 1]) { const r = add(g, new THREE.CylinderGeometry(0.04, 0.06, 7), chrome, s * 1.4, 4.5, 0); r.rotation.z = s * 0.7; }
    add(g, new THREE.BoxGeometry(3.4, 0.08, 4), teak, 0, 1.62, -3.6);
  } else {
    const big = m.id === 'superyacht'; const len = big ? 30 : 18, beam = big ? 6 : 4.6;
    hull(g, len, beam, big ? 2.6 : 1.8, white, big ? M(0xd8b25a, { metalness: 0.8, roughness: 0.3 }) : navy);
    const decks = big ? 4 : 2; for (let i = 0; i < decks; i++) { const w = beam * (0.9 - i * 0.12), l = len * (0.55 - i * 0.09), y = (big ? 2.6 : 1.8) + 0.9 + i * 1.5;
      add(g, new THREE.BoxGeometry(w, 1.3, l), white, 0, y, -len * 0.05 + i * 0.6); add(g, new THREE.BoxGeometry(w + 0.04, 0.55, l * 0.96), glass, 0, y + 0.1, -len * 0.05 + i * 0.6); }
    add(g, new THREE.BoxGeometry(beam * 0.9, 0.08, len * 0.22), teak, 0, (big ? 2.6 : 1.8) + 0.05, -len * 0.38);
    if (big) { add(g, new THREE.CylinderGeometry(2, 2, 0.12, 24), M(0x3a3a3a), 0, 2.7, -len * 0.4); add(g, new THREE.BoxGeometry(2.4, 0.15, 1.8), M(0x46d3e6, { emissive: 0x0a5a68, emissiveIntensity: 0.6 }), 0, 2.72 + 6 * 0.25, 2);
      add(g, new THREE.CylinderGeometry(0.12, 0.12, 3), chrome, 0, 2.6 + decks * 1.5 + 1.4, 1); add(g, new THREE.SphereGeometry(0.5, 12, 8), M(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }), 0, 2.6 + decks * 1.5 + 3, 1); }
  }
  return g;
}
export function buildJet(m: FleetModel): THREE.Group {
  const g = new THREE.Group(); const body = M(m.color, { metalness: 0.35, roughness: 0.3 }); const trim = M(m.id === 'chudone' ? 0xd8b25a : 0x1a3a6a, { metalness: 0.6, roughness: 0.3 }); const win = M(0x1a2430, { metalness: 0.8, roughness: 0.1 }); const eng = M(0x8a929a, { metalness: 0.8, roughness: 0.3 });
  const k = m.id === 'citation' ? 0.7 : m.id === 'g700' ? 1 : 1.8; const L = 16 * k, R = 0.9 * k * (m.id === 'chudone' ? 1.3 : 1);
  const f = add(g, new THREE.CylinderGeometry(R, R, L, 16), body, 0, R + 1, 0); f.rotation.x = Math.PI / 2;
  const nose = add(g, new THREE.SphereGeometry(R, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, R + 1, L / 2); nose.rotation.x = Math.PI / 2; nose.scale.set(1, 1.8, 1);
  const tail = add(g, new THREE.ConeGeometry(R, L * 0.25, 16), body, 0, R + 1 + R * 0.25, -L / 2 - L * 0.12); tail.rotation.x = -Math.PI / 2;
  add(g, new THREE.BoxGeometry(R * 2.02, R * 0.2, L * 0.9), trim, 0, R + 1 - R * 0.35, 0); add(g, new THREE.BoxGeometry(R * 2.04, R * 0.22, L * 0.78), win, 0, R + 1 + R * 0.35, 0.02 * L);
  if (m.id === 'chudone') add(g, new THREE.BoxGeometry(R * 1.4, R * 0.9, L * 0.28), body, 0, R * 2 + 1, L * 0.3);
  const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.lineTo(L * 0.55, -L * 0.22); wing.lineTo(L * 0.55, -L * 0.3); wing.lineTo(0, -L * 0.25);
  for (const s of [-1, 1]) { const w = add(g, new THREE.ExtrudeGeometry(wing, { depth: 0.12 * k, bevelEnabled: false }), body, 0, R + 0.6, L * 0.1); w.rotation.set(Math.PI / 2, 0, 0); w.scale.x = s;
    const st = add(g, new THREE.ExtrudeGeometry(wing, { depth: 0.08 * k, bevelEnabled: false }), body, 0, R * 1.4 + 1, -L * 0.42); st.rotation.set(Math.PI / 2, 0, 0); st.scale.set(s * 0.35, 0.35, 1); }
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-L * 0.18, L * 0.22); fin.lineTo(-L * 0.26, L * 0.22); fin.lineTo(-L * 0.2, 0);
  const tf = add(g, new THREE.ExtrudeGeometry(fin, { depth: 0.1 * k, bevelEnabled: false }), trim, 0.05 * k, R * 1.6 + 1, -L * 0.4); tf.rotation.y = Math.PI / 2;
  const engines = m.id === 'chudone' ? [-0.25, -0.45].flatMap((x) => [x * L, -x * L]) : [-R * 1.5, R * 1.5];
  for (const x of engines) { const e = add(g, new THREE.CylinderGeometry(R * 0.42, R * 0.36, L * 0.18, 12), eng, x, m.id === 'chudone' ? R * 0.2 + 0.6 : R * 1.4 + 1, m.id === 'chudone' ? L * 0.1 : -L * 0.3); e.rotation.x = Math.PI / 2; }
  for (const z of [L * 0.32, -L * 0.1]) for (const x of z > 0 ? [0] : [-R * 0.8, R * 0.8]) add(g, new THREE.CylinderGeometry(0.18 * k, 0.18 * k, 0.3 * k, 10), M(0x111111), x, 0.2, z).rotation.z = Math.PI / 2;
  // mu-visuals detail: cockpit windshield, cabin window row, winglets, landing-gear struts, nav lights.
  const ws = add(g, new THREE.SphereGeometry(R * 0.95, 14, 8, -Math.PI / 2, Math.PI, 0, Math.PI / 3), win, 0, R + 1 + R * 0.15, L / 2 - R * 0.2); ws.scale.set(1, 1, 1.6);
  for (let i = 0; i < Math.round(6 * k + 2); i++) for (const sx of [-1, 1]) { const wn = add(g, new THREE.CircleGeometry(R * 0.16, 10), win, sx * R * 1.01, R + 1 + R * 0.3, L * 0.3 - i * (L * 0.55 / Math.round(6 * k + 2))); wn.rotation.y = sx * Math.PI / 2; }
  for (const s of [-1, 1]) { const wl = add(g, new THREE.BoxGeometry(0.08 * k, 1.4 * k, 0.9 * k), body, s * L * 0.55, R + 0.6 + 0.7 * k, L * 0.1 - L * 0.26); wl.rotation.z = -s * 0.25;
    add(g, new THREE.SphereGeometry(0.12 * k, 8, 6), M(s < 0 ? 0xff2020 : 0x20ff40, { emissive: s < 0 ? 0xff2020 : 0x20ff40, emissiveIntensity: 1.5 }), s * L * 0.55, R + 0.62, L * 0.1 - L * 0.27); }
  for (const z of [L * 0.32, -L * 0.1]) for (const x of z > 0 ? [0] : [-R * 0.8, R * 0.8]) add(g, new THREE.CylinderGeometry(0.06 * k, 0.06 * k, 1 - 0.1 + R * 0.1, 6), eng, x, 0.6, z);
  return g;
}
export const buildCraft = (m: FleetModel) => (m.kind === 'boat' ? buildBoat(m) : buildJet(m));
export function disposeTree(g: THREE.Object3D) { g.traverse((o) => { const x = o as THREE.Mesh; if (x.geometry) x.geometry.dispose(); if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((mm) => mm.dispose()); }); }
