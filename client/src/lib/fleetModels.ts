// Procedural low-poly boats and jets (Marina / Hangar previews and the resort map). Caller owns disposal via `dispose(g)`.
import { addTail, addFuselage } from './planeNose';
import * as THREE from 'three';
import { nacelle } from './nacelle';
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
/** mu-visuals superyacht: a long dark-navy hull with stacked, set-back superstructure tiers built from a rounded,
 *  raked plan (no boxes): wraparound tinted glass bands, overhanging white deck lips, a sun deck with a pool and
 *  loungers, a radar arch, a foredeck helipad and a teak swim platform. Geometry cached + shared (userData.shared). */
const YG = new Map<string, THREE.BufferGeometry>();
const yg = (k: string, f: () => THREE.BufferGeometry) => { let x = YG.get(k); if (!x) { x = f(); x.userData.shared = true; YG.set(k, x); } return x; };
function tierShape(l: number, w: number) { const s = new THREE.Shape(); const h = w / 2, z0 = -l / 2, r = Math.min(h * 0.5, l * 0.08);
  s.moveTo(-h + r, z0); s.lineTo(h - r, z0); s.quadraticCurveTo(h, z0, h, z0 + r); s.lineTo(h, l * 0.18); s.quadraticCurveTo(h * 0.92, l * 0.42, h * 0.25, l / 2);
  s.lineTo(-h * 0.25, l / 2); s.quadraticCurveTo(-h * 0.92, l * 0.42, -h, l * 0.18); s.lineTo(-h, z0 + r); s.quadraticCurveTo(-h, z0, -h + r, z0); return s; }
const tierGeo = (l: number, w: number, hgt: number) => yg(`t${l}|${w}|${hgt}`, () => { const g = new THREE.ExtrudeGeometry(tierShape(l, w), { depth: hgt, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 2, curveSegments: 10 }); g.rotateX(Math.PI / 2); g.translate(0, hgt, 0); return g; }); // plan +y → bow (+Z)
function superyacht(g: THREE.Group, m: FleetModel, glass: THREE.Material, teak: THREE.Material, chrome: THREE.Material) {
  const len = 30, beam = 6, hh = 2.6; const white = M(0xf6f6f2, { roughness: 0.35 }), navy = M(m.color, { metalness: 0.3, roughness: 0.3 }), gold = M(0xd8b25a, { metalness: 0.8, roughness: 0.3 });
  const tint = M(0x16242f, { metalness: 0.85, roughness: 0.08 });
  hull(g, len, beam, hh, navy, gold);
  // superstructure tiers: [length, width, z centre]; each a white lip, a glass band and a white cap
  const tiers: [number, number, number][] = [[len * 0.62, beam * 0.86, -len * 0.04], [len * 0.48, beam * 0.76, -len * 0.02], [len * 0.34, beam * 0.66, 0], [len * 0.18, beam * 0.5, len * 0.03]];
  let y = hh + 0.02;
  tiers.forEach(([l, w, z], i) => { const top = i === tiers.length - 1;
    const body = new THREE.Mesh(tierGeo(l, w, 1.2), white); body.position.set(0, y, z); g.add(body);
    const band = new THREE.Mesh(tierGeo(l * 0.985, w * 1.015, 0.6), tint); band.position.set(0, y + 0.35, z + l * 0.005); g.add(band);
    const lip = new THREE.Mesh(tierGeo(l + 0.9, w + 0.35, 0.14), white); lip.position.set(0, y + 1.2, z - 0.25); g.add(lip);
    if (top) { const hard = new THREE.Mesh(tierGeo(l * 0.7, w * 0.8, 0.5), white); hard.position.set(0, y + 1.34, z - 0.3); g.add(hard); }
    y += 1.34; });
  const sun = hh + 1.34 * 3 + 0.16; // sun deck = top of tier 3 lip
  // pool + loungers on the aft sun deck, teak around it
  const [l3, , z3] = tiers[2]!; const pz = z3 - l3 * 0.36;
  add(g, new THREE.BoxGeometry(beam * 0.5, 0.06, 3.4), teak, 0, sun, pz);
  add(g, new THREE.BoxGeometry(beam * 0.32, 0.08, 2), M(0x46d3e6, { emissive: 0x0a5a68, emissiveIntensity: 0.6, roughness: 0.1 }), 0, sun + 0.03, pz);
  for (const sx of [-1, 1]) for (const dz of [-0.6, 0.6]) add(g, new THREE.BoxGeometry(0.45, 0.12, 1.2), white, sx * beam * 0.3, sun + 0.1, pz + dz);
  // radar arch + mast on the top tier
  const yt = hh + 1.34 * 4 + 0.5; const arch = new THREE.Mesh(yg('arch', () => new THREE.TorusGeometry(1.3, 0.13, 6, 16, Math.PI)), white); arch.position.set(0, yt - 0.1, tiers[3]![2] - 0.6); g.add(arch);
  add(g, new THREE.CylinderGeometry(0.07, 0.1, 2.2, 6), chrome, 0, yt + 1.9, tiers[3]![2] - 0.6);
  add(g, new THREE.SphereGeometry(0.45, 12, 8), M(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.5 }), 0, yt + 1.4, tiers[3]![2] + 0.2);
  // foredeck helipad (with H ring) and an aft teak swim platform with steps
  const hz = len * 0.3; add(g, new THREE.CylinderGeometry(2.1, 2.1, 0.1, 28), M(0x3a3a3a, { roughness: 0.7 }), 0, hh + 0.36, hz);
  const ring = new THREE.Mesh(yg('hring', () => new THREE.RingGeometry(1.6, 1.75, 28)), M(0xf2d24a)); ring.rotation.x = -Math.PI / 2; ring.position.set(0, hh + 0.42, hz); g.add(ring);
  for (const x of [-0.45, 0.45]) add(g, new THREE.BoxGeometry(0.16, 0.02, 1.2), M(0xffffff), x, hh + 0.42, hz); add(g, new THREE.BoxGeometry(0.9, 0.02, 0.16), M(0xffffff), 0, hh + 0.42, hz);
  add(g, new THREE.BoxGeometry(beam * 0.84, 0.12, 1.6), teak, 0, 1.0, -len / 2 - 1.0);
  for (let i = 0; i < 3; i++) add(g, new THREE.BoxGeometry(beam * 0.5, 0.1, 0.45), teak, 0, 1.05 + i * 0.5, -len / 2 + 0.25 + i * 0.45);
}
export function buildBoat(m: FleetModel): THREE.Group {
  const g = new THREE.Group(); const white = M(m.color); const glass = M(0x2a4a6a, { metalness: 0.7, roughness: 0.1 }); const navy = M(0x1a3a6a); const teak = M(0xb07a48, { roughness: 0.8 }); const chrome = M(0xdde4ea, { metalness: 0.9, roughness: 0.2 });
  if (m.id === 'skiff') {
    hull(g, 6, 2.2, 0.8, white, navy); add(g, new THREE.BoxGeometry(1, 0.9, 0.8), white, 0, 1.2, 0); add(g, new THREE.BoxGeometry(1.05, 0.4, 0.1), glass, 0, 1.5, 0.42);
    for (const x of [-0.45, 0.45]) add(g, new THREE.BoxGeometry(0.35, 0.8, 0.4), M(0x222222), x, 0.9, -2.4);
  } else if (m.id === 'sportfisher') {
    hull(g, 12, 3.6, 1.6, white, navy); add(g, new THREE.BoxGeometry(3, 1.4, 4.5), white, 0, 2.3, 0.4); add(g, new THREE.BoxGeometry(3.05, 0.6, 4.4), glass, 0, 2.5, 0.4);
    add(g, new THREE.BoxGeometry(2.4, 0.15, 2.6), white, 0, 4.2, 0.6); for (const x of [-1, 1]) for (const z of [-0.5, 1.7]) add(g, new THREE.CylinderGeometry(0.05, 0.05, 1.2), chrome, x, 3.6, z);
    // QA#3: outriggers stand on the cabin sides and splay OUTWARD into a V (never cross over the bridge), with a base clamp.
    for (const s of [-1, 1]) { const a = 0.5, h = 7; const r = add(g, new THREE.CylinderGeometry(0.04, 0.06, h), chrome, s * (1.25 + Math.sin(a) * h / 2), 3.4 + Math.cos(a) * h / 2, 0.2); r.rotation.z = -s * a; r.userData.part = 'outrigger';
      add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.35, 8), chrome, s * 1.3, 3.4, 0.2); }
    add(g, new THREE.BoxGeometry(3.4, 0.08, 4), teak, 0, 1.62, -3.6);
  } else if (m.id === 'superyacht') {
    superyacht(g, m, glass, teak, chrome);
  } else {
    const big = false; const len = big ? 30 : 18, beam = big ? 6 : 4.6;
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
  // QA#2: real lengths CJ4 16 m, G700 33.5 m, BBJ 33.6 m (much fatter) -> G700 2x Citation, BBJ ~G700 length with a 1.5x thicker fuselage.
  const k = m.id === 'citation' ? 0.5 : m.id === 'g700' ? 1 : 1.1; const L = 16 * k, R = 0.9 * k * (m.id === 'chudone' ? 1.55 : 1);
  // mu-visuals nose fix: one coaxial fuselage + rounded blunt nose + tail cone, same radius/segments at each joint (no seam, no step).
  addFuselage(g, { r: R, len: L, nose: R * 1.9, tail: L * 0.25, y: R + 1, body, glass: win });
  add(g, new THREE.BoxGeometry(R * 2.02, R * 0.2, L * 0.9), trim, 0, R + 1 - R * 0.35, 0); add(g, new THREE.BoxGeometry(R * 2.04, R * 0.22, L * 0.78), win, 0, R + 1 + R * 0.35, 0.02 * L);
  if (m.id === 'chudone') add(g, new THREE.BoxGeometry(R * 1.4, R * 0.9, L * 0.28), body, 0, R * 2 + 1, L * 0.3);
  const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.lineTo(L * 0.55, -L * 0.22); wing.lineTo(L * 0.55, -L * 0.3); wing.lineTo(0, -L * 0.25);
  for (const s of [-1, 1]) { const w = add(g, new THREE.ExtrudeGeometry(wing, { depth: 0.12 * k, bevelEnabled: false }), body, 0, R + 0.6, L * 0.1); w.rotation.set(Math.PI / 2, 0, 0); w.scale.x = s; }
  // mu-visuals tail fins: swept, tapered fin flush on the centreline at the rear; T-tail on the Citation and G700.
  addTail(g, { r: R, len: L, y: R + 1, fin: trim, stab: body, tTail: m.id !== 'chudone', h: m.id === 'chudone' ? 2.4 : 2.9, c: m.id === 'chudone' ? 2.6 : 2.8 });
  // mu-visuals: rounded turbofan nacelles (intake lip, fan, spinner, nozzle) hung under the wings on pylons, in the plane's colour.
  const wingY = R + 0.6 - 0.12 * k, nr = R * (m.id === 'chudone' ? 0.36 : 0.42), nl = L * 0.2, pyl = 0.28 * k;
  // QA#1: bizjets (Citation, G700) carry two engines on the aft fuselage sides on horizontal pylons; only the BBJ (chudone) keeps underwing pods.
  if (m.id === 'chudone') { for (const sx of [0.2, 0.36]) for (const s of [-1, 1]) { const x = s * sx * L, le = L * 0.1 - sx * L * 0.4;
    const n = nacelle({ len: nl, r: nr, pylon: pyl, body, lipColor: 0xd8b25a }); n.position.set(x, wingY - pyl - nr, le + nl * 0.05); g.add(n); } }
  else for (const s of [-1, 1]) { const ar = R * 0.46, apy = R * 0.28;
    const n = nacelle({ len: L * 0.17, r: ar, pylon: apy, body }); n.rotation.z = s * Math.PI / 2; n.position.set(s * (R * 0.92 + apy + ar), R + 1 + R * 0.4, -L * 0.33); n.userData.part = 'aftEngine'; g.add(n); }
  for (const z of [L * 0.32, -L * 0.1]) for (const x of z > 0 ? [0] : [-R * 0.8, R * 0.8]) add(g, new THREE.CylinderGeometry(0.18 * k, 0.18 * k, 0.3 * k, 10), M(0x111111), x, 0.2, z).rotation.z = Math.PI / 2;
  // mu-visuals detail: cockpit windshield, cabin window row, winglets, landing-gear struts, nav lights.
  for (let i = 0; i < Math.round(6 * k + 2); i++) for (const sx of [-1, 1]) { const wn = add(g, new THREE.CircleGeometry(R * 0.16, 10), win, sx * R * 1.01, R + 1 + R * 0.3, L * 0.3 - i * (L * 0.55 / Math.round(6 * k + 2))); wn.rotation.y = sx * Math.PI / 2; }
  for (const s of [-1, 1]) { const wl = add(g, new THREE.BoxGeometry(0.08 * k, 1.4 * k, 0.9 * k), body, s * L * 0.55, R + 0.6 + 0.7 * k, L * 0.1 - L * 0.26); wl.rotation.z = -s * 0.25;
    add(g, new THREE.SphereGeometry(0.12 * k, 8, 6), M(s < 0 ? 0xff2020 : 0x20ff40, { emissive: s < 0 ? 0xff2020 : 0x20ff40, emissiveIntensity: 1.5 }), s * L * 0.55, R + 0.62, L * 0.1 - L * 0.27); }
  for (const z of [L * 0.32, -L * 0.1]) for (const x of z > 0 ? [0] : [-R * 0.8, R * 0.8]) add(g, new THREE.CylinderGeometry(0.06 * k, 0.06 * k, 1 - 0.1 + R * 0.1, 6), eng, x, 0.6, z);
  return g;
}
export const buildCraft = (m: FleetModel) => (m.kind === 'boat' ? buildBoat(m) : buildJet(m));
export function disposeTree(g: THREE.Object3D) { g.traverse((o) => { const x = o as THREE.Mesh; if (x.geometry && !x.geometry.userData.shared) x.geometry.dispose(); if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((mm) => mm.dispose()); }); }
