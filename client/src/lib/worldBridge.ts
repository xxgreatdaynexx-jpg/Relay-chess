/**
 * Co-op Fort McChud Bridge on the city map. A cable-stayed sea bridge off the south-west beach (shared/coop.ts
 * BRIDGE_SITE) that builds up with the server project, like the Hockey Stadium:
 *   0% surveyed: buoys on the pier line, a crane barge and "road closed" barriers at the junction
 *   stage 1 Piers & abutment: brick-clad embankment over the beach, then concrete hammerhead piers marching out to sea
 *   stage 2 Towers: two A-frame towers rising out of the water (tower cranes beside them while they climb)
 *   stage 3 Deck & road: the paved approach and the deck pushing out from the shore, parapets and lane markings
 *   stage 4 Cables & lights: stay-cable fans, then streetlights, aviation beacons and the gateway sign
 *   100%: open to traffic, cars run both ways and the lights follow day/night.
 * The stage in progress is drawn partially by its own %. A floating label + progress bar shows the overall %, polled
 * from GET /api/coop.
 */
import * as THREE from 'three';
import type { World } from './world3d';
import { cityLabel } from './labelSprite';
import { BRIDGE_SITE as B, bridgeDeckY } from '../../../shared/coop';
import { skyNow, parseTod } from '../../../shared/daynight';
import { detectWorldTier } from './worldTier';

type Summary = { id: string; name: string; icon: string; state: string; stage: number; pct: number };
const mats = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: number, rough = 0.8, metal = 0, emissive = 0, ei = 0) => {
  const k = `${color}|${rough}|${metal}|${emissive}|${ei}`; let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei, side: THREE.DoubleSide }); if (ei > 0) m.userData.ei = ei; mats.set(k, m); } return m;
};
const BOXG = new THREE.BoxGeometry(1, 1, 1); const CYLG = new THREE.CylinderGeometry(1, 1, 1, 10); const SPHG = new THREE.SphereGeometry(1, 10, 8);
const shared = new Set<THREE.BufferGeometry>([BOXG, CYLG, SPHG]);

/** Deck top surface y at world z (alias, for tests). */
export const deckY = bridgeDeckY;
/** Ramp piers, the transition pier, the back piers past tower 2, then the long viaduct into the fog. */
export const PIER_Z: number[] = (() => { const z = [214, 226, B.rampZ1, 452, 476, B.mainZ1]; for (let p = B.mainZ1 + 36; p <= B.farZ - 10; p += 36) z.push(p); return z; })();
/** Cable fans: per tower, per side (shore -1 / sea +1), anchors along the deck (inner → outer). */
const FAN_N = 9, FAN_IN = 9, FAN_OUT = 46;
export function cableAnchors(): Array<{ tower: number; z: number; k: number }> {
  const out: Array<{ tower: number; z: number; k: number }> = [];
  B.towers.forEach((tz, t) => { for (let i = 0; i < FAN_N; i++) for (const s of [-1, 1]) out.push({ tower: t, z: tz + s * (FAN_IN + ((FAN_OUT - FAN_IN) * i) / (FAN_N - 1)), k: i }); });
  return out;
}
/** A-frame leg x at height y (legs lean in from ±6.4 at the waterline to ±1.0 at the top). */
const legX = (y: number) => 6.4 - (5.4 * Math.max(0, y)) / B.towerH;

let signTex: THREE.Texture | null = null;
const signTexture = () => { if (signTex || typeof document === 'undefined') return signTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d'); if (!x) return null;
  x.fillStyle = '#0b5d2a'; x.fillRect(0, 0, 512, 128); x.strokeStyle = '#f4f4f4'; x.lineWidth = 6; x.strokeRect(6, 6, 500, 116);
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.font = '800 48px Outfit Variable, system-ui, sans-serif'; x.fillText('FORT McCHUD', 256, 60);
  x.font = '700 30px Outfit Variable, system-ui, sans-serif'; x.fillText('BRIDGE  ⬇  OPEN', 256, 104);
  signTex = new THREE.CanvasTexture(c); (signTex as THREE.CanvasTexture).colorSpace = THREE.SRGBColorSpace; return signTex; };

/** Quad strip following the deck profile between two cross-section points (x, dy) from z0 to z1. */
function strip(z0: number, z1: number, step: number, a: [number, number], b: [number, number]): THREE.BufferGeometry {
  const n = Math.max(1, Math.ceil((z1 - z0) / step)); const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) { const z = z0 + ((z1 - z0) * i) / n; const y = bridgeDeckY(z); pos.push(a[0], y + a[1], z, b[0], y + b[1], z); }
  for (let i = 0; i < n; i++) { const q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
/** Vertical wall between ground (y0) and the deck underside along z (embankment retaining walls). */
function wall(z0: number, z1: number, step: number, x: number, y0: number, drop: number): THREE.BufferGeometry {
  const n = Math.max(1, Math.ceil((z1 - z0) / step)); const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) { const z = z0 + ((z1 - z0) * i) / n; pos.push(x, y0, z, x, Math.max(y0, bridgeDeckY(z) - drop), z); }
  for (let i = 0; i < n; i++) { const q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const up = new THREE.Vector3(0, 1, 0);
/** Matrix that turns the unit Y-cylinder into a rod from a to b with radius r. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m = new THREE.Matrix4()): THREE.Matrix4 {
  const d = b.clone().sub(a); const L = d.length(); const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
  return m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, L, r));
}

/** Build the bridge model for `done` finished stages (0..4) and `frac` of the next one (0..1). `low` = ?lowgfx path
 *  (coarser deck, line cables, fewer lights, no traffic). Model space: x relative to BRIDGE_SITE.x, y up, z = world z. */
export function buildBridge(done: number, frac: number, low = false): THREE.Group {
  const g = new THREE.Group(); g.name = `bridge-${done}`; const step = low ? 4 : 2;
  const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0); const complete = done >= 4;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, name?: string) => { const o = new THREE.Mesh(geo, m); o.castShadow = !low; o.receiveShadow = true; if (name) o.name = name; g.add(o); return o; };
  const Bx = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rz = 0) => { const o = new THREE.Mesh(BOXG, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = !low; g.add(o); return o; };
  const C = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(CYLG, m); o.scale.set(r, h, r); o.position.set(x, y, z); g.add(o); return o; };
  const concrete = M(0xc4beb2, 0.95), darkCon = M(0x948e84, 0.95), brick = M(0xb0705a, 0.95), asphalt = M(0x2a2c33, 0.95), steel = M(0x56677a, 0.4, 0.7),
    white = M(0xf2f2ee, 0.6), yellow = M(0xf5c518, 0.5, 0.2), orange = M(0xf59e0b, 0.6), towerM = M(0xe9e4d8, 0.7, 0.05), cableM = M(0xdfe6ee, 0.35, 0.6),
    gravel = M(0x8f8676, 1), lamp = M(0xfff3cf, 0.3, 0, 0xffe2a0, 2.2), beacon = M(0xff2020, 0.4, 0, 0xff2a2a, 2.4), hull = M(0x2f3640, 0.7, 0.3), accent = M(0x2f6db5, 0.5, 0.3);
  const props = new THREE.Group(); props.name = 'bridge-props'; // construction-only kit (cranes, barge, buoys, barriers)
  const toProps = (n0: number) => { for (const o of g.children.slice(n0)) props.add(o); };
  const hw = B.halfW; const JOIN_X = -121; // the rural ring road's south-west corner (shared/outskirts.ts)

  // ---- stage 1: Piers & abutment (embankment over the beach first, then the piers marching out to sea)
  const s0 = complete ? 1 : stage(0);
  const piers = [...PIER_Z, ...B.towers].sort((a, b) => a - b);
  if (s0 > 0) {
    const embZ1 = 210; // brick-clad retaining walls carry the ramp over the beach to the waterline
    for (const x of [-hw, hw]) add(wall(B.rampZ0, embZ1, step, x, 0, 0.2), brick);
    add(strip(B.rampZ0, embZ1, step, [-hw, -0.25], [hw, -0.25]), gravel); // fill top (paved later)
    { const ye = bridgeDeckY(embZ1) - 0.2; Bx(hw * 2 + 0.6, ye, 1.4, darkCon, 0, ye / 2, embZ1 - 0.5); Bx(hw * 2 + 1.4, 0.5, 2, concrete, 0, ye - 0.1, embZ1 - 0.4); } // abutment end wall + bank seat
    const n = complete ? piers.length : Math.ceil(s0 * piers.length - 1e-9);
    for (let i = 0; i < n; i++) { const z = piers[i]!; const isTower = (B.towers as readonly number[]).includes(z);
      if (isTower) { Bx(17, 1.4, 7, darkCon, 0, 0.2, z); continue; } // tower pile cap (the tower itself is stage 2)
      const top = bridgeDeckY(z) - 1.5; Bx(4.2, 1, 4.2, darkCon, 0, 0.1, z); Bx(2.2, top + 0.4, 2.4, concrete, 0, top / 2 - 0.2, z); Bx(hw * 2 + 0.8, 1.1, 2.8, concrete, 0, top + 0.3, z); }
  }
  // ---- stage 2: Towers (A-frames: two leaning legs, a cross beam under the deck, a head with the cable anchors)
  const s1 = complete ? 1 : stage(1); const H = B.towerH;
  B.towers.forEach((tz, t) => { const f = complete ? 1 : Math.max(0, Math.min(1, s1 * 2 - t)); if (f <= 0) return; const h = H * f;
    for (const s of [-1, 1]) { const a = new THREE.Vector3(s * legX(0), 0, tz), b = new THREE.Vector3(s * legX(h), h, tz); const o = new THREE.Mesh(BOXG, towerM);
      const mm = rod(a, b, 1); o.matrix.copy(mm); o.matrix.decompose(o.position, o.quaternion, o.scale); o.scale.set(1.7, a.distanceTo(b), 2); o.castShadow = !low; g.add(o); }
    const yb = bridgeDeckY(tz) - 1.7; if (h > yb) Bx(legX(yb) * 2, 1.4, 2.2, towerM, 0, yb, tz);
    if (f >= 1) { Bx(3, 8, 2.4, towerM, 0, H - 3.4, tz); Bx(3.6, 0.6, 3, darkCon, 0, H + 0.6, tz); Bx(legX(H * 0.55) * 2, 1.2, 1.8, towerM, 0, H * 0.55, tz); }
    if (!complete && done === 1) { // tower crane beside the climbing tower
      const n0 = g.children.length; const cx = 11, ch = h + 8; Bx(0.9, ch, 0.9, yellow, cx, ch / 2, tz); Bx(22, 0.7, 0.7, yellow, cx - 6, ch, tz); Bx(1.8, 1.4, 1.8, darkCon, cx + 4, ch - 0.4, tz); C(0.05, 6, steel, cx - 15, ch - 3, tz); toProps(n0); }
  });
  // ---- stage 3: Deck & road (paved approach, deck pushing out from the shore, parapets, lane markings)
  const s2 = complete ? 1 : stage(2);
  if (s2 > 0) {
    const vis = Math.min(1, s2 / 0.7); const front = s2 <= 0.7 ? B.rampZ0 + vis * (B.mainZ1 - B.rampZ0) : B.mainZ1 + ((s2 - 0.7) / 0.3) * (B.farZ - B.mainZ1);
    add(strip(B.roadZ - 1.6, B.rampZ0 + 0.2, step, [-hw + 0.4, 0], [hw - 0.4, 0]), asphalt, 'bridge-approach');
    { const x1 = JOIN_X + 2.25 - B.x, x0 = -hw + 0.4; const pad = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 6.5), asphalt); pad.rotation.x = -Math.PI / 2; pad.position.set((x0 + x1) / 2, 0.05, 151); g.add(pad); } // merge into the ring-road corner
    add(strip(B.rampZ0, front, step, [-hw, 0.02], [hw, 0.02]), asphalt, 'bridge-deck');
    if (front > 210) { const z0 = 210; add(strip(z0, front, step, [-hw, -1.3], [hw, -1.3]), darkCon); for (const x of [-hw, hw]) { add(strip(z0, front, step, [x, 0.02], [x * 0.92, -1.3]), concrete); add(strip(z0, front, step, [x * 1.004, -0.05], [x * 0.99, -0.42]), accent); } }
    for (const x of [-hw, hw]) { add(strip(B.rampZ0, front, step, [x, 0], [x, 1.0]), concrete); add(strip(B.rampZ0, front, step, [x * 0.97, 1.0], [x, 1.0]), concrete); }
    for (const x of [-(hw - 0.7), hw - 0.7]) add(strip(B.roadZ + 0.6, front, step, [x - 0.08, 0.05], [x + 0.08, 0.05]), white);
    const dash: number[] = []; for (let z = B.roadZ + 2.5; z < front - 2; z += 6) dash.push(z);
    if (dash.length) { const im = new THREE.InstancedMesh(BOXG, yellow, dash.length); const m4 = new THREE.Matrix4(); const e = new THREE.Euler();
      dash.forEach((z, i) => { const y = bridgeDeckY(z) + 0.06; const sl = Math.atan2(bridgeDeckY(z + 1) - bridgeDeckY(z - 1), 2); e.set(-sl, 0, 0); m4.compose(new THREE.Vector3(0, y, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(0.18, 0.04, 2.6)); im.setMatrixAt(i, m4); }); g.add(im); }
  } else if (s0 > 0 || done > 0) add(strip(B.roadZ - 1.6, B.rampZ0 + 0.2, step, [-hw + 0.4, 0], [hw - 0.4, 0]), gravel, 'bridge-approach'); // graded approach
  // ---- stage 4: Cables & lights (stay-cable fans per tower, inner → outer; then streetlights, beacons, gateway sign)
  const s3 = complete ? 1 : stage(3);
  if (s3 > 0) {
    const all = cableAnchors(); const nC = complete ? all.length : Math.round(Math.min(1, s3 / 0.6) * all.length); const segs: Array<[THREE.Vector3, THREE.Vector3]> = [];
    for (let i = 0; i < nC; i++) { const c = all[i]!; const tz = B.towers[c.tower]!; const yTop = H - 1 - (FAN_N - 1 - c.k) * 0.8;
      for (const s of [-1, 1]) segs.push([new THREE.Vector3(s * 0.9, yTop, tz + Math.sign(c.z - tz) * 0.9), new THREE.Vector3(s * (hw - 0.35), bridgeDeckY(c.z) + 0.9, c.z)]); }
    if (segs.length) {
      if (low) { const pts: number[] = []; for (const [a, b] of segs) pts.push(a.x, a.y, a.z, b.x, b.y, b.z); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xdfe6ee }))); }
      else { const im = new THREE.InstancedMesh(CYLG, cableM, segs.length); im.name = 'bridge-cables'; const m4 = new THREE.Matrix4(); segs.forEach(([a, b], i) => im.setMatrixAt(i, rod(a, b, 0.09, m4))); g.add(im); } }
    const lf = complete ? 1 : Math.max(0, (s3 - 0.6) / 0.4);
    if (lf > 0) { const every = low ? 48 : 24; const spots: Array<[number, number]> = []; for (let z = B.roadZ + 6; z < B.farZ - 6; z += every) for (const s of [-1, 1]) spots.push([s * (hw - 0.15), z + (s > 0 ? every / 2 : 0)]);
      const n = Math.round(lf * spots.length); const poles = new THREE.InstancedMesh(CYLG, steel, Math.max(1, n)), heads = new THREE.InstancedMesh(BOXG, lamp, Math.max(1, n)); const m4 = new THREE.Matrix4();
      for (let i = 0; i < n; i++) { const [x, z] = spots[i]!; const y = bridgeDeckY(z); m4.compose(new THREE.Vector3(x, y + 2.6, z), new THREE.Quaternion(), new THREE.Vector3(0.09, 5.2, 0.09)); poles.setMatrixAt(i, m4);
        m4.compose(new THREE.Vector3(x - Math.sign(x) * 0.7, y + 5.2, z), new THREE.Quaternion(), new THREE.Vector3(1.4, 0.18, 0.4)); heads.setMatrixAt(i, m4); }
      poles.count = n; heads.count = n; g.add(poles, heads);
      if (lf >= 1) for (const tz of B.towers) { const o = new THREE.Mesh(SPHG, beacon); o.scale.setScalar(0.5); o.position.set(0, H + 1.4, tz); g.add(o); }
    }
  }
  if (complete) { // gateway sign over the approach
    const z = B.roadZ + 6, t = signTexture(); for (const s of [-1, 1]) C(0.18, 7, steel, s * (hw + 0.6), 3.5, z); Bx(hw * 2 + 1.6, 0.3, 0.3, steel, 0, 6.8, z);
    const sm = t ? new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.6, side: THREE.DoubleSide }) : M(0x0b5d2a); if (t) sm.userData.ei = 0.6;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.8), sm); sign.position.set(0, 5.8, z - 0.2); sign.rotation.y = Math.PI; g.add(sign); const back = sign.clone(); back.position.z = z + 0.2; back.rotation.y = 0; g.add(back);
  } else { // building: road-closed barriers at the junction, survey buoys, the crane barge at the work front
    const n0 = g.children.length;
    for (const s of [-1, 1]) { Bx(3.2, 0.9, 0.3, orange, s * 2, 0.7, B.roadZ + 4); Bx(3.2, 0.25, 0.32, white, s * 2, 0.95, B.roadZ + 4); for (const k of [-1.3, 1.3]) Bx(0.15, 0.7, 0.15, white, s * 2 + k, 0.35, B.roadZ + 4); }
    if (s0 < 1) for (const z of piers.slice(Math.ceil(s0 * piers.length))) { if (z > 560) break; const o = new THREE.Mesh(SPHG, orange); o.scale.set(0.7, 0.9, 0.7); o.position.set(0, 0.1, z); g.add(o); }
    const workZ = done === 0 ? (piers[Math.min(piers.length - 1, Math.ceil(s0 * piers.length))] ?? 240) : done === 1 ? B.towers[s1 < 0.5 ? 0 : 1] : done === 2 ? Math.min(B.mainZ1, B.rampZ0 + Math.min(1, s2 / 0.7) * (B.mainZ1 - B.rampZ0)) : B.towers[s3 < 0.3 ? 0 : 1];
    const bz = Math.min(430, Math.max(222, workZ)); const bx = -14; // keep the barge in the visible stretch
    Bx(8, 1.6, 16, hull, bx, 0.3, bz); Bx(8.2, 0.3, 16.2, orange, bx, 1.1, bz); Bx(3, 2.4, 3, white, bx, 2.3, bz + 6);
    const jib = new THREE.Group(); jib.position.set(bx, 1.2, bz - 3); jib.rotation.y = -0.6; g.add(jib);
    const j = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0) => { const o = new THREE.Mesh(BOXG, yellow); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.z = rz; jib.add(o); };
    j(2.4, 2, 2.4, 0, 1, 0); j(0.8, 26, 0.8, 7, 12, 0, -0.55); C(0.05, 8, steel, bx + 4.2, 14, bz - 3); toProps(n0);
  }
  if (props.children.length) g.add(props);
  return g;
}

/** Night factor 0..1 for the bridge's own glows (the city scales its glows once at boot, before this model loads). */
const nightK = () => { try { return skyNow(new Date(), parseTod(new URLSearchParams(location.search).get('tod'))).lights; } catch { return 0; } };
const applyNight = (g: THREE.Object3D, k: number) => g.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
  if (m?.isMeshStandardMaterial && m.userData.ei != null) m.emissiveIntensity = (m.userData.ei as number) * (0.1 + 0.9 * k); });
const disposeModel = (g: THREE.Object3D) => g.traverse((o) => { const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; if (geo && !shared.has(geo)) geo.dispose(); if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });

/** Traffic once the bridge is open: a few cars both ways (southbound on the west lane, northbound on the east). */
function buildTraffic(): { group: THREE.Group; step: (dt: number) => void } {
  const group = new THREE.Group(); group.name = 'bridge-traffic'; const colors = [0xd7263d, 0x2e86de, 0xf5f5f5, 0x27ae60, 0xf39c12, 0x34495e, 0x8e44ad, 0xe8e8e8];
  const L0 = B.roadZ - 1, L1 = B.farZ - 10, span = L1 - L0; const cars: Array<{ o: THREE.Group; s: number; dir: number; v: number }> = [];
  colors.forEach((c, i) => { const o = new THREE.Group(); const body = new THREE.Mesh(BOXG, M(c, 0.45, 0.4)); body.scale.set(1.7, 0.7, 3.6); body.position.y = 0.55; const cab = new THREE.Mesh(BOXG, M(0x1b2430, 0.2, 0.5)); cab.scale.set(1.5, 0.55, 1.8); cab.position.set(0, 1.15, -0.2);
    const hl = new THREE.Mesh(BOXG, M(0xffffff, 0.3, 0, 0xfff6d0, 2)); hl.scale.set(1.5, 0.2, 0.1); hl.position.set(0, 0.6, 1.82); const tl = new THREE.Mesh(BOXG, M(0x550000, 0.3, 0, 0xff2020, 1.6)); tl.scale.set(1.5, 0.2, 0.1); tl.position.set(0, 0.6, -1.82);
    o.add(body, cab, hl, tl); group.add(o); cars.push({ o, s: (i * 0.137 + (i % 2) * 0.5) % 1, dir: i % 2 ? -1 : 1, v: 15 + (i % 3) * 3 }); });
  const step = (dt: number) => { for (const c of cars) { c.s = (c.s + (c.v * dt) / span) % 1; const z = c.dir > 0 ? L0 + c.s * span : L1 - c.s * span; const x = c.dir > 0 ? -1.7 : 1.7; const y = bridgeDeckY(z);
    const sl = Math.atan2(bridgeDeckY(z + 1) - bridgeDeckY(z - 1), 2); c.o.position.set(x, y, z); c.o.rotation.set(-sl * c.dir, c.dir > 0 ? 0 : Math.PI, 0, 'YXZ'); } };
  step(0); return { group, step };
}

export function createBridge(w: World) {
  const root = new THREE.Group(); root.name = 'coop-bridge'; root.position.set(B.x, 0, 0); w.scene.add(root);
  const low = detectWorldTier() === 'low'; let model: THREE.Group | null = null; let key = ''; let dead = false; let label: THREE.Sprite | null = null;
  let traffic: ReturnType<typeof buildTraffic> | null = null; let raf = 0; let last = 0;
  const LZ = 222, LY = 30;
  const bar = document.createElement('canvas'); bar.width = 512; bar.height = 64; const barTex = new THREE.CanvasTexture(bar); barTex.colorSpace = THREE.SRGBColorSpace;
  const barSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: barTex, depthTest: false, transparent: true, sizeAttenuation: false })); barSp.scale.set(0.16, 0.02, 1); barSp.center.set(0.5, 1); barSp.renderOrder = 11; barSp.position.set(0, LY, LZ); root.add(barSp);
  const drawBar = (p: number) => { const c = bar.getContext('2d')!; c.clearRect(0, 0, 512, 64); c.fillStyle = 'rgba(10,8,22,0.85)'; c.beginPath(); c.roundRect(2, 2, 508, 60, 30); c.fill();
    c.fillStyle = '#38bdf8'; c.beginPath(); c.roundRect(8, 8, Math.max(0, 496 * Math.min(1, p)), 48, 24); c.fill();
    c.fillStyle = '#fff'; c.font = '800 34px Outfit Variable, system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(`${(p * 100).toFixed(p > 0 && p < 0.1 ? 1 : 0)}%`, 256, 45); barTex.needsUpdate = true; };
  const setLabel = (text: string, sub: string) => { if (label) { root.remove(label); (label.material as THREE.SpriteMaterial).map?.dispose(); label.material.dispose(); }
    const t = cityLabel(text, '#7dd3fc', sub); const d = t.userData as { w: number; h: number };
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, premultipliedAlpha: true, toneMapped: false, sizeAttenuation: false })); label.scale.set(0.09 * d.w, 0.0225 * d.h, 1); label.center.set(0.5, 0); label.renderOrder = 11; label.position.set(0, LY, LZ); root.add(label); };
  const tick = (t: number) => { if (dead) return; const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t; traffic?.step(dt); raf = requestAnimationFrame(tick); };
  const apply = (s: Summary) => {
    const done = s.state === 'complete' ? 4 : s.state === 'active' ? s.stage : 0; const frac = s.state === 'active' ? Math.max(0, Math.min(1, s.pct * 4 - done)) : 0;
    const k = `${done}|${Math.round(frac * 20)}`;
    if (k !== key) { key = k; if (model) { root.remove(model); disposeModel(model); } model = buildBridge(done, frac, low); root.add(model);
      if (done >= 4 && !low && !traffic) { traffic = buildTraffic(); root.add(traffic.group); raf = requestAnimationFrame(tick); } }
    if (model) applyNight(model, nightK()); if (traffic) applyNight(traffic.group, nightK());
    const stageName = ['Piers & abutment', 'Towers', 'Deck & road', 'Cables & lights'][Math.min(3, done)];
    setLabel(`${s.icon} Fort McChud Bridge`, s.state === 'complete' ? 'Open · half-price Fort McChud tickets' : s.state === 'locked' ? '📐 Surveyed · next co-op build' : `🚧 ${stageName} · co-op build`);
    barSp.visible = s.state === 'active'; drawBar(s.pct);
  };
  const load = () => { void fetch('/api/coop').then((r) => r.json()).then((j: { projects?: Summary[] }) => { const s = j?.projects?.find((p) => p.id === 'bridge'); if (!dead && s) apply(s); }).catch(() => {}); };
  apply({ id: 'bridge', name: 'Fort McChud Bridge', icon: '🌉', state: 'locked', stage: 0, pct: 0 }); load();
  const poll = window.setInterval(load, 30_000);
  return { refresh: load, dispose() { dead = true; cancelAnimationFrame(raf); window.clearInterval(poll); w.scene.remove(root); if (model) disposeModel(model); barTex.dispose(); } };
}
