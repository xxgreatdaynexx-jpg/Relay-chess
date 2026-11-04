// Farming machinery (mu-visuals): low-poly tractor, combine harvester, grain trailer and seed drill. Each model is built
// once and cloned (clones share geometry + materials, so dozens on the map cost a handful of draw-call templates).
// Units: metres-ish, +Z forward, wheels on y = 0. Shared resources are flagged userData.shared (disposers skip them).
import * as THREE from 'three';

const mats = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: number, rough = 0.55, metal = 0.2, extra: THREE.MeshStandardMaterialParameters = {}) => {
  const k = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`; let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }); m.userData.shared = true; mats.set(k, m); }
  return m;
};
const geos = new Map<string, THREE.BufferGeometry>();
const G = (k: string, f: () => THREE.BufferGeometry) => { let g = geos.get(k); if (!g) { g = f(); g.userData.shared = true; geos.set(k, g); } return g; };
const BOX = () => G('box', () => new THREE.BoxGeometry(1, 1, 1));
function part(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) { const o = new THREE.Mesh(geo, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; }
/** Tyre with lugs + painted rim, axis along X. */
function wheel(g: THREE.Object3D, r: number, w: number, x: number, z: number, rim: THREE.Material) {
  const tyre = G(`tyre${r}|${w}`, () => { const t = new THREE.CylinderGeometry(r, r, w, 20, 1); t.rotateZ(Math.PI / 2); return t; });
  const lug = G(`lug${r}|${w}`, () => { const parts: THREE.BufferGeometry[] = []; return new THREE.BoxGeometry(w * 1.02, r * 0.12, r * 0.22); });
  const rimG = G(`rim${r}|${w}`, () => { const t = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w * 1.04, 14); t.rotateZ(Math.PI / 2); return t; });
  const hub = G('hub', () => { const t = new THREE.CylinderGeometry(0.5, 0.5, 1, 8); t.rotateZ(Math.PI / 2); return t; });
  const rubber = M(0x1c1c1e, 0.95, 0);
  const tg = new THREE.Group(); tg.position.set(x, r, z); g.add(tg);
  const t = new THREE.Mesh(tyre, rubber); t.castShadow = true; tg.add(t); tg.add(new THREE.Mesh(rimG, rim));
  const h = new THREE.Mesh(hub, M(0x9aa0a6, 0.4, 0.7)); h.scale.set(w * 1.12, r * 0.3, r * 0.3); tg.add(h);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const l = new THREE.Mesh(lug, rubber); l.position.set(0, Math.cos(a) * r, Math.sin(a) * r); l.rotation.x = -a + (i % 2 ? 0.35 : -0.35); tg.add(l); }
}
const cache = new Map<string, THREE.Group>();
function once(k: string, f: () => THREE.Group) { let g = cache.get(k); if (!g) { g = f(); cache.set(k, g); } const c = g.clone(); c.userData.machine = k; return c; }

/** Tractor: long hood with grille + exhaust stack, glass cab with roof, big lugged rear wheels, small front wheels, 3-point hitch. */
export function buildTractor(color = 0x2f8f3a): THREE.Group {
  return once(`tractor${color}`, () => {
    const g = new THREE.Group(); const body = M(color, 0.45, 0.25), dark = M(0x26292d, 0.6, 0.3), rim = M(0xf2c230, 0.5, 0.3), glass = M(0x9cc7e0, 0.08, 0.6, { transparent: true, opacity: 0.55 });
    part(g, BOX(), dark, 1.0, 0.5, 3.6, 0, 0.9, 0.2); // chassis
    part(g, BOX(), body, 1.05, 0.95, 2.1, 0, 1.45, 1.05); // hood
    part(g, BOX(), M(0x111214, 0.7, 0.3), 0.9, 0.7, 0.06, 0, 1.4, 2.12); // grille
    for (const s of [-1, 1]) part(g, BOX(), M(0xfff2c0, 0.3, 0, { emissive: 0xffe0a0, emissiveIntensity: 0.5 }), 0.18, 0.12, 0.05, s * 0.36, 1.8, 2.13);
    part(g, G('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10)), M(0x3a3d42, 0.4, 0.8), 0.14, 1.1, 0.14, 0.35, 2.4, 1.5); // exhaust
    part(g, BOX(), body, 1.5, 0.35, 1.7, 0, 1.25, -0.75); // fenders base
    for (const s of [-1, 1]) part(g, BOX(), body, 0.62, 0.12, 1.75, s * 0.95, 2.05, -0.75); // rear fenders
    part(g, BOX(), glass, 1.3, 1.25, 1.4, 0, 2.6, -0.7); // cab glass
    for (const [x, z] of [[-0.64, -0.01], [0.64, -0.01], [-0.64, -1.39], [0.64, -1.39]]) part(g, BOX(), dark, 0.07, 1.25, 0.07, x!, 2.6, z! + 0); // cab pillars
    part(g, BOX(), body, 1.5, 0.14, 1.6, 0, 3.28, -0.7); // roof
    part(g, BOX(), M(0x2a2a2a, 0.5), 0.35, 0.3, 0.35, 0, 2.2, -0.9); // seat
    part(g, BOX(), dark, 0.9, 0.12, 0.5, 0, 0.9, -2.1); // hitch
    wheel(g, 0.95, 0.6, -0.98, -0.75, rim); wheel(g, 0.95, 0.6, 0.98, -0.75, rim);
    wheel(g, 0.55, 0.38, -0.78, 1.55, rim); wheel(g, 0.55, 0.38, 0.78, 1.55, rim);
    return g;
  });
}

/** Combine harvester: wide header with reel + tines, feeder house, tall body with grain tank, unloading auger, cab. */
export function buildHarvester(color = 0x3a8a3a): THREE.Group {
  return once(`harvester${color}`, () => {
    const g = new THREE.Group(); const body = M(color, 0.45, 0.25), dark = M(0x26292d, 0.6, 0.3), yellow = M(0xe8c230, 0.45, 0.3), glass = M(0x9cc7e0, 0.08, 0.6, { transparent: true, opacity: 0.55 });
    part(g, BOX(), body, 2.6, 2.4, 5.2, 0, 2.2, -0.4); // main body
    part(g, BOX(), body, 2.3, 1.1, 2.6, 0, 3.95, -1.1); // grain tank
    part(g, BOX(), M(0x1a1a1a, 0.8), 2.15, 0.06, 2.4, 0, 4.52, -1.1); // tank opening (dark)
    part(g, BOX(), glass, 1.6, 1.4, 1.5, 0, 4.0, 1.5); part(g, BOX(), body, 1.75, 0.15, 1.65, 0, 4.78, 1.5); // cab
    part(g, BOX(), body, 1.3, 1.0, 2.2, 0, 1.6, 2.9); // feeder house
    part(g, BOX(), yellow, 6.4, 0.7, 1.4, 0, 0.75, 4.2); // header trough
    part(g, BOX(), dark, 6.5, 0.08, 0.3, 0, 0.42, 4.95); // cutter bar
    const reel = new THREE.Group(); reel.position.set(0, 1.55, 4.55); g.add(reel);
    const ax = G('reelAx', () => { const c = new THREE.CylinderGeometry(0.08, 0.08, 6.2, 8); c.rotateZ(Math.PI / 2); return c; });
    reel.add(new THREE.Mesh(ax, dark));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const b = new THREE.Mesh(ax, M(0xd94a2a, 0.5, 0.2)); b.position.set(0, Math.cos(a) * 0.55, Math.sin(a) * 0.55); reel.add(b); }
    for (const x of [-3, -1, 1, 3]) { const sp = new THREE.Mesh(BOX(), dark); sp.scale.set(0.06, 1.15, 0.06); sp.position.x = x; reel.add(sp); const sp2 = sp.clone(); sp2.rotation.x = Math.PI / 2; reel.add(sp2); }
    for (const s of [-1, 1]) part(g, BOX(), yellow, 0.1, 1.2, 1.5, s * 3.2, 1.0, 4.2); // header end plates
    const aug = part(g, G('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10)), yellow, 0.36, 4.2, 0.36, -2.6, 4.3, -1.6); aug.rotation.z = Math.PI / 2 - 0.15; // unloading auger
    part(g, BOX(), dark, 2.0, 0.6, 0.8, 0, 1.4, -3.2); // rear chaff spreader
    part(g, G('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10)), M(0x3a3d42, 0.4, 0.8), 0.16, 1.0, 0.16, 0.9, 5.0, -0.3); // exhaust
    for (const s of [-1, 1]) part(g, BOX(), M(0xff7a2a, 0.3, 0, { emissive: 0xff6a10, emissiveIntensity: 0.6 }), 0.12, 0.12, 0.12, s * 0.7, 4.95, 2.25); // beacons
    wheel(g, 1.15, 0.75, -1.65, 1.6, yellow); wheel(g, 1.15, 0.75, 1.65, 1.6, yellow);
    wheel(g, 0.7, 0.45, -1.45, -2.6, yellow); wheel(g, 0.7, 0.45, 1.45, -2.6, yellow);
    return g;
  });
}

/** Grain trailer: tipping box with ribs, drawbar, tandem axle. */
export function buildTrailer(color = 0xb5342a): THREE.Group {
  return once(`trailer${color}`, () => {
    const g = new THREE.Group(); const body = M(color, 0.5, 0.25), dark = M(0x26292d, 0.6, 0.3), rim = M(0x9aa0a6, 0.4, 0.6);
    part(g, BOX(), dark, 1.6, 0.25, 4.6, 0, 0.95, 0);
    part(g, BOX(), body, 2.2, 1.3, 4.4, 0, 1.75, 0);
    for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) part(g, BOX(), M(color, 0.6, 0.3), 0.06, 1.3, 0.12, s * 1.12, 1.75, i * 0.95);
    part(g, BOX(), M(0xd9b45a, 0.9, 0), 2.05, 0.1, 4.25, 0, 2.35, 0); // grain load
    part(g, BOX(), dark, 0.18, 0.18, 1.8, 0, 0.9, 3.0); // drawbar
    for (const z of [-0.6, 0.6]) { wheel(g, 0.6, 0.4, -1.0, z, rim); wheel(g, 0.6, 0.4, 1.0, z, rim); }
    return g;
  });
}

/** Seed drill / cultivator: wide frame with discs and a hopper. */
export function buildSeeder(color = 0x2a5aa8): THREE.Group {
  return once(`seeder${color}`, () => {
    const g = new THREE.Group(); const body = M(color, 0.5, 0.25), dark = M(0x26292d, 0.6, 0.3);
    part(g, BOX(), dark, 4.2, 0.15, 0.2, 0, 0.75, 0); part(g, BOX(), dark, 4.2, 0.15, 0.2, 0, 0.75, -1.0);
    part(g, BOX(), body, 3.8, 0.8, 0.9, 0, 1.35, -0.5); part(g, BOX(), M(0x1a1a1a), 3.6, 0.04, 0.7, 0, 1.76, -0.5);
    const disc = G('disc', () => { const c = new THREE.CylinderGeometry(0.32, 0.32, 0.04, 14); c.rotateZ(Math.PI / 2); return c; });
    for (let i = 0; i < 12; i++) { const d = new THREE.Mesh(disc, M(0xb0b6bc, 0.35, 0.8)); d.position.set(-1.9 + i * 0.345, 0.32, -0.6 + (i % 2) * 0.35); g.add(d); }
    part(g, BOX(), dark, 0.14, 0.14, 1.4, 0, 0.75, 0.8);
    for (const s of [-1, 1]) wheel(g, 0.42, 0.3, s * 2.25, -0.5, M(0x9aa0a6, 0.4, 0.6));
    return g;
  });
}

/** Where machinery parks on the Farm district: the yard strips between the field fences and the barn doors / beside the
 * silos, clear of plots, barns, silos and the dirt lanes (tests/farm-machines.test.ts checks footprints). Pure data. */
export interface MachineSpot { kind: 'tractor' | 'harvester' | 'trailer' | 'seeder'; x: number; z: number; yaw: number }
export const FARM_MACHINES: MachineSpot[] = [
  { kind: 'tractor', x: 127.5, z: 49, yaw: Math.PI / 2 },
  { kind: 'seeder', x: 139, z: 49.2, yaw: 0 },
  { kind: 'tractor', x: 165, z: 46.6, yaw: -Math.PI / 2 },
  { kind: 'trailer', x: 172, z: 46.6, yaw: -Math.PI / 2 },
  { kind: 'harvester', x: 180.2, z: 46.6, yaw: Math.PI / 2 },
];
export function buildMachine(k: MachineSpot['kind']): THREE.Group { return k === 'tractor' ? buildTractor() : k === 'harvester' ? buildHarvester() : k === 'trailer' ? buildTrailer() : buildSeeder(); }
