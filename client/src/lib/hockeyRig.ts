/**
 * Procedural hockey player rigs (skater + goalie) for the PvP Hockey renderer.
 *
 * Each rig is a small bone hierarchy (hip → torso → arms+stick, hip → thigh → shin+skate). The parts of every bone are
 * merged at build time into one geometry per material slot, and those merged geometries are cached per role + LOD, so
 * every skater shares the same ~20 buffers and draws ~16 meshes (8 on `?lowgfx`). Only materials vary per team/number.
 *
 * Rig frame: forward is +x, up is +y, the player's left is −z. Proportions follow a ~1.88 m player on skates.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Slot = 'jersey' | 'sleeve' | 'pants' | 'sock' | 'helmet' | 'visor' | 'skin' | 'glove' | 'black' | 'steel' | 'holder' | 'stick' | 'tape' | 'pad' | 'trim' | 'cage';
type Bone = 'hip' | 'torso' | 'arms' | 'thighL' | 'thighR' | 'shinL' | 'shinR';
type Parts = Partial<Record<Bone, { slot: Slot; geo: THREE.BufferGeometry }[]>>;

export interface PlayerRig {
  root: THREE.Group; body: THREE.Group; hip: THREE.Group; torso: THREE.Group; arms: THREE.Group;
  thighL: THREE.Group; thighR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group;
  /** Points that may touch the ice (blades, knees); the rig is dropped so the lowest one sits on y = 0. */
  feet: THREE.Object3D[];
  goalie: boolean; phase: number; bf: number; jersey: THREE.Material;
}

const HIP_Y = 0.92, THIGH = 0.44, SHIN = 0.36;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A capsule/cylinder from a to b (radius r, optionally tapering to r2). */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, seg: number, r2 = r, capsule = true): THREE.BufferGeometry {
  const d = b.clone().sub(a), L = d.length();
  const g = capsule && r === r2 ? new THREE.CapsuleGeometry(r, Math.max(0.001, L), 2, seg) : new THREE.CylinderGeometry(r2, r, L, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  g.scale(sx, sy, sz); g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))); g.translate(x, y, z); return g;
}
/** Box with its x-axis bent into a curve (stick blades): z += curve * x². */
function curvedBlade(len: number, h: number, t: number, curve: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, h, t, seg, 1, 1); g.translate(len / 2, 0, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) + curve * x * x); p.setY(i, p.getY(i) + (x > len * 0.85 ? -0.01 * (x - len * 0.85) / (len * 0.15) : 0)); }
  g.computeVertexNormals(); return g;
}

/** Hand and stick positions (torso-local) for the two stances. */
function pose(goalie: boolean) {
  return goalie
    ? { sh: 0.27, handL: V(0.42, 0.18, -0.46), handR: V(0.4, -0.02, 0.3) }
    : { sh: 0.24, handL: V(0.3, 0.1, -0.02), handR: V(0.46, -0.12, 0.24) };
}

function build(goalie: boolean, low: boolean): Parts {
  const s = low ? 6 : 12, sm = low ? 4 : 8;
  const P: Parts = { hip: [], torso: [], arms: [], thighL: [], thighR: [], shinL: [], shinR: [] };
  const put = (b: Bone, slot: Slot, geo: THREE.BufferGeometry) => P[b]!.push({ slot, geo });
  const w = goalie ? 1.22 : 1; // goalies wear a chest protector: broader through the body
  // ---- hip: hockey pants (breezers) + belt
  put('hip', 'pants', at(new THREE.CylinderGeometry(0.2 * w, 0.24 * w, 0.34, s, 1), 0, -0.08, 0, 0.78, 1, 1));
  if (!low) put('hip', 'trim', at(new THREE.CylinderGeometry(0.205 * w, 0.205 * w, 0.04, s, 1, true), 0, 0.08, 0, 0.79, 1, 1));
  // ---- torso (pivot at the hips): jersey over shoulder pads, neck, head, helmet + visor or goalie mask
  put('torso', 'jersey', at(new THREE.CylinderGeometry(0.255 * w, 0.21 * w, 0.58, s * 2, 1), 0, 0.27, 0, 0.62, 1, 1));
  put('torso', 'sleeve', at(new THREE.SphereGeometry(0.255 * w, s * 2, sm, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.56, 0, 0.62, 0.32, 1));
  for (const z of [-1, 1]) put('torso', 'sleeve', at(new THREE.SphereGeometry(0.12 * w, s, sm), 0, 0.53, z * 0.25 * w, 1.05, 0.8, 1)); // shoulder caps
  if (!low) put('torso', 'trim', at(new THREE.CylinderGeometry(0.214 * w, 0.212 * w, 0.06, s * 2, 1, true), 0, 0.06, 0, 0.62, 1, 1)); // hem stripe
  put('torso', 'skin', limb(V(0, 0.6, 0), V(0.02, 0.7, 0), 0.06, sm, 0.06, false));
  put('torso', 'skin', at(new THREE.SphereGeometry(0.105, s, sm), 0.02, 0.77, 0, 1.05, 1.15, 0.95));
  if (goalie) {
    put('torso', 'helmet', at(new THREE.SphereGeometry(0.15, s, sm, 0, Math.PI * 2, 0, Math.PI * 0.62), 0.0, 0.78, 0, 1.12, 1.18, 1)); // mask shell
    put('torso', 'helmet', at(new THREE.SphereGeometry(0.15, s, sm, Math.PI * 0.12, Math.PI * 0.76, Math.PI * 0.55, Math.PI * 0.3), 0.0, 0.78, 0, 1.12, 1.18, 1)); // chin
    put('torso', 'cage', at(new THREE.CylinderGeometry(0.135, 0.12, 0.17, s, 1, true, Math.PI / 2 - 0.85, 1.7), 0.04, 0.75, 0, 1.05, 1, 1));
    if (!low) put('torso', 'pad', at(new THREE.CylinderGeometry(0.11, 0.13, 0.1, s, 1, true, Math.PI / 2 - 1.2, 2.4), 0.03, 0.62, 0, 1, 1, 1)); // throat guard
  } else {
    put('torso', 'helmet', at(new THREE.SphereGeometry(0.135, s, sm, 0, Math.PI * 2, 0, Math.PI * 0.56), -0.005, 0.785, 0, 1.12, 1.08, 0.98));
    for (const z of [-1, 1]) put('torso', 'helmet', at(new THREE.BoxGeometry(0.1, 0.1, 0.02), 0.0, 0.73, z * 0.125)); // ear guards
    put('torso', 'visor', at(new THREE.CylinderGeometry(0.145, 0.14, 0.07, s, 1, true, Math.PI / 2 - 0.95, 1.9), 0.0, 0.755, 0, 1.08, 1, 0.98));
  }
  // ---- arms + gloves + stick (one bone so the stick handling stays rigid)
  const { sh, handL, handR } = pose(goalie);
  for (const [z, hand] of [[-1, handL], [1, handR]] as const) {
    const S = V(0.0, 0.5, z * sh * w), E = S.clone().lerp(hand, 0.5).add(V(-0.06, -0.06, z * 0.07));
    put('arms', 'sleeve', limb(S, E, 0.07, sm));
    if (!low) put('arms', 'sleeve', at(new THREE.SphereGeometry(0.078, sm, sm), E.x, E.y, E.z)); // elbow pad bulge
    put('arms', 'sleeve', limb(E, hand.clone().lerp(E, 0.18), 0.062, sm, 0.07, false));
    if (goalie && z > 0) { // blocker
      put('arms', 'pad', at(new THREE.BoxGeometry(0.07, 0.38, 0.24), hand.x + 0.02, hand.y + 0.05, hand.z + 0.13));
      put('arms', 'trim', at(new THREE.BoxGeometry(0.074, 0.06, 0.245), hand.x + 0.02, hand.y + 0.18, hand.z + 0.13));
      put('arms', 'glove', at(new THREE.BoxGeometry(0.12, 0.1, 0.1), hand.x, hand.y, hand.z));
    } else if (goalie) { // catcher (trapper): cuff + pocket disc, opening forward
      put('arms', 'pad', at(new THREE.CylinderGeometry(0.17, 0.17, 0.08, s), hand.x + 0.04, hand.y + 0.06, hand.z - 0.04, 1, 1, 1, 0, 0, Math.PI / 2));
      put('arms', 'trim', at(new THREE.CylinderGeometry(0.1, 0.1, 0.085, s), hand.x + 0.045, hand.y + 0.08, hand.z - 0.04, 1, 1, 1, 0, 0, Math.PI / 2));
      put('arms', 'pad', at(new THREE.BoxGeometry(0.14, 0.12, 0.12), hand.x - 0.04, hand.y - 0.1, hand.z));
    } else {
      put('arms', 'glove', at(new THREE.BoxGeometry(0.15, 0.1, 0.11), hand.x, hand.y, hand.z));
      put('arms', 'glove', limb(hand.clone().add(V(-0.09, 0.02, 0)), hand.clone().add(V(-0.02, 0.02, 0)), 0.068, sm, 0.075, false)); // cuff
    }
  }
  // stick: from above the top hand, through the bottom hand, down to the heel on the ice (in the nominal lean)
  const lean = goalie ? 0.32 : 0.45, hipDrop = goalie ? 0.3 : 0.16;
  const iceY = -(HIP_Y - hipDrop); // ice height in torso-local coordinates before lean
  const unlean = new THREE.Matrix4().makeRotationZ(lean); // undo the forward lean so the blade lies flat on the ice
  const lean4 = new THREE.Matrix4().makeRotationZ(-lean);
  const top = (goalie ? handR.clone().add(V(-0.02, 0.2, 0.0)) : handL.clone().add(V(-0.02, 0.06, 0)));
  const mid = goalie ? handR : handR;
  const topW = top.clone().applyMatrix4(lean4), midW = mid.clone().applyMatrix4(lean4);
  const dir = midW.clone().sub(topW).normalize();
  const tHeel = (iceY + 0.03 - topW.y) / dir.y, heelW = topW.clone().addScaledVector(dir, tHeel);
  if (goalie) { heelW.x += 0.3; heelW.z = 0.26; }
  const heel = heelW.clone().applyMatrix4(unlean);
  const shaftTop = top.clone().addScaledVector(dir.clone().applyMatrix4(unlean), -0.08);
  put('arms', 'stick', limb(shaftTop, heel, goalie ? 0.022 : 0.016, low ? 4 : 6, goalie ? 0.022 : 0.016, false));
  if (!low) put('arms', 'tape', limb(shaftTop, shaftTop.clone().lerp(heel, 0.09), goalie ? 0.026 : 0.02, 6, goalie ? 0.026 : 0.02, false)); // knob tape
  if (goalie) { // paddle: the wide lower part of a goalie stick
    const pTop = heel.clone().lerp(shaftTop, 0.42);
    put('arms', 'stick', limb(pTop, heel, 0.045, 4, 0.045, false).scale(1, 1, 1));
  }
  // blade: horizontal in the world, pointing forward and curving toward the forehand
  const blade = curvedBlade(goalie ? 0.38 : 0.3, goalie ? 0.09 : 0.065, 0.012, goalie ? 0.25 : 0.6, low ? 3 : 8);
  const bm = new THREE.Matrix4().makeRotationY(goalie ? Math.PI / 2 - 0.15 : -0.2).premultiply(unlean);
  blade.applyMatrix4(bm); blade.translate(heel.x, heel.y + (goalie ? 0.045 : 0.032) - 0.03, heel.z);
  put('arms', 'stick', blade);
  if (!low) { const tp = curvedBlade(goalie ? 0.2 : 0.18, goalie ? 0.07 : 0.05, 0.016, goalie ? 0.25 : 0.6, 6); tp.translate(0.05, 0, 0); tp.applyMatrix4(bm); tp.translate(heel.x, heel.y + (goalie ? 0.045 : 0.032) - 0.03, heel.z); put('arms', 'tape', tp); }
  // ---- legs: pants leg → sock over the shin guard → skate (boot, holder, steel)
  for (const [side, th, sn] of [[-1, 'thighL', 'shinL'], [1, 'thighR', 'shinR']] as const) {
    void side;
    if (goalie) {
      put(th, 'pants', limb(V(0, 0, 0), V(0, -THIGH + 0.06, 0), 0.105, sm, 0.13, false));
      // leg pad: thigh rise, knee roll, long face down to the toe; trimmed in team colour
      put(sn, 'pad', at(new THREE.BoxGeometry(0.15, SHIN + 0.32, 0.27), 0.1, -SHIN / 2 + 0.07, 0, 1, 1, 1));
      put(sn, 'pad', at(new THREE.CylinderGeometry(0.1, 0.1, 0.27, sm), 0.12, 0.17, 0, 1, 1, 1, Math.PI / 2, 0, 0));
      if (!low) for (const y of [-0.05, -0.2]) put(sn, 'trim', at(new THREE.BoxGeometry(0.154, 0.035, 0.272), 0.1, y, 0));
      if (!low) put(sn, 'trim', at(new THREE.BoxGeometry(0.154, 0.3, 0.03), 0.1, -0.1, 0));
      put(sn, 'pad', at(new THREE.BoxGeometry(0.3, 0.1, 0.25), 0.1, -SHIN - 0.04, 0)); // toe bridge over the skate
    } else {
      put(th, 'pants', limb(V(0, 0.02, 0), V(0.01, -0.28, 0), 0.115, sm, 0.13, false));
      put(th, 'sock', limb(V(0.01, -0.26, 0), V(0.0, -THIGH, 0), 0.075, sm));
      put(sn, 'sock', limb(V(0, 0.02, 0), V(0.0, -SHIN + 0.06, 0), 0.08, sm, 0.07, false)); // sock over shin guard
      if (!low) put(sn, 'trim', limb(V(0, -0.1, 0), V(0, -0.16, 0), 0.083, sm, 0.081, false)); // sock stripe
    }
    // skate
    put(sn, 'black', at(new THREE.BoxGeometry(0.25, 0.12, 0.1), 0.04, -SHIN - 0.02, 0));
    if (!low) put(sn, 'black', at(new THREE.SphereGeometry(0.06, sm, sm), 0.16, -SHIN - 0.04, 0, 1, 0.7, 0.85)); // toe cap
    put(sn, 'holder', at(new THREE.BoxGeometry(0.28, 0.035, 0.03), 0.05, -SHIN - 0.0975, 0));
    put(sn, 'steel', at(new THREE.BoxGeometry(0.3, 0.016, 0.006), 0.05, -SHIN - 0.112, 0));
  }
  return P;
}

const cache = new Map<string, Record<Bone, { slot: Slot; geo: THREE.BufferGeometry }[]>>();
/** Merged geometries per bone + slot (cached per role/LOD, shared by every rig). */
function merged(goalie: boolean, low: boolean): Record<Bone, { slot: Slot; geo: THREE.BufferGeometry }[]> {
  const key = `${goalie ? 'G' : 'S'}${low ? 'L' : 'H'}`;
  const hit = cache.get(key); if (hit) return hit;
  const parts = build(goalie, low), out = {} as Record<Bone, { slot: Slot; geo: THREE.BufferGeometry }[]>;
  for (const bone of Object.keys(parts) as Bone[]) {
    const by = new Map<Slot, THREE.BufferGeometry[]>();
    for (const p of parts[bone]!) { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; g.deleteAttribute('uv1' as never); if (!by.has(p.slot)) by.set(p.slot, []); by.get(p.slot)!.push(g); }
    out[bone] = [...by].map(([slot, gs]) => ({ slot, geo: mergeGeometries(gs, false)! }));
  }
  cache.set(key, out); return out;
}
/** `?lowgfx`: bake each opaque, untextured slot's colour into vertex colours and merge them into ONE mesh per bone
 * (jersey + transparent slots stay separate), so a low-LOD rig is ~10 draw calls instead of ~35. Cached per role + palette. */
const vcCache = new Map<string, Record<Bone, { slot: Slot | 'vc'; geo: THREE.BufferGeometry }[]>>();
let vcMat: THREE.MeshLambertMaterial | null = null;
function bakedLow(goalie: boolean, mat: (slot: Slot) => THREE.Material) {
  const M = merged(goalie, true);
  const plain = (m: THREE.Material) => !m.transparent && !(m as THREE.MeshStandardMaterial).map && (m as THREE.MeshStandardMaterial).color;
  const slots = [...new Set(Object.values(M).flat().map((p) => p.slot))];
  const key = (goalie ? 'G' : 'S') + slots.map((sl) => { const m = mat(sl); return plain(m) ? (m as THREE.MeshStandardMaterial).color.getHexString() : 'x'; }).join('');
  const hit = vcCache.get(key); if (hit) return hit;
  const out = {} as Record<Bone, { slot: Slot | 'vc'; geo: THREE.BufferGeometry }[]>;
  for (const bone of Object.keys(M) as Bone[]) {
    const keep: { slot: Slot | 'vc'; geo: THREE.BufferGeometry }[] = [], bake: THREE.BufferGeometry[] = [];
    for (const p of M[bone]) {
      const m = mat(p.slot);
      if (!plain(m)) { keep.push(p); continue; }
      const g = p.geo.clone(), c = (m as THREE.MeshStandardMaterial).color, n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3)); bake.push(g);
    }
    if (bake.length) { const mg = mergeGeometries(bake, false)!; for (const b of bake) b.dispose(); keep.push({ slot: 'vc', geo: mg }); }
    out[bone] = keep;
  }
  vcCache.set(key, out); return out;
}
export function disposeRigCache(): void {
  for (const v of cache.values()) for (const b of Object.values(v)) for (const p of b) p.geo.dispose(); cache.clear();
  for (const v of vcCache.values()) for (const b of Object.values(v)) for (const p of b) if (p.slot === 'vc') p.geo.dispose(); vcCache.clear();
  vcMat?.dispose(); vcMat = null;
}

export function makeRig(goalie: boolean, low: boolean, mat: (slot: Slot) => THREE.Material, shadows: boolean): PlayerRig {
  const M = low ? bakedLow(goalie, mat) : merged(goalie, low);
  const g = (name: string) => { const o = new THREE.Group(); o.name = name; return o; };
  const root = g('root'), body = g('body'), hip = g('hip'), torso = g('torso'), arms = g('arms');
  const thighL = g('thighL'), thighR = g('thighR'), kneeL = g('kneeL'), kneeR = g('kneeR');
  root.add(body); body.add(hip); hip.position.y = HIP_Y; hip.add(torso); torso.position.y = 0.06; torso.add(arms);
  const w = goalie ? 0.15 : 0.11;
  thighL.position.set(0, -0.06, -w); thighR.position.set(0, -0.06, w); hip.add(thighL, thighR);
  kneeL.position.y = kneeR.position.y = -THIGH; thighL.add(kneeL); thighR.add(kneeR);
  const into = (bone: Bone, parent: THREE.Object3D) => { for (const p of M[bone]) { const m = new THREE.Mesh(p.geo, p.slot === 'vc' ? (vcMat ??= new THREE.MeshLambertMaterial({ vertexColors: true })) : mat(p.slot)); m.castShadow = shadows && p.slot !== 'visor' && p.slot !== 'cage'; m.userData.slot = p.slot; parent.add(m); } };
  into('hip', hip); into('torso', torso); into('arms', arms); into('thighL', thighL); into('thighR', thighR); into('shinL', kneeL); into('shinR', kneeR);
  const foot = (k: THREE.Object3D, x: number, y: number) => { const o = new THREE.Object3D(); o.position.set(x, y, 0); k.add(o); return o; };
  const feet = [foot(kneeL, -0.1, -SHIN - 0.12), foot(kneeL, 0.2, -SHIN - 0.12), foot(kneeR, -0.1, -SHIN - 0.12), foot(kneeR, 0.2, -SHIN - 0.12)];
  if (goalie) feet.push(foot(kneeL, 0.17, 0.05), foot(kneeR, 0.17, 0.05), foot(kneeL, 0.17, -SHIN - 0.05), foot(kneeR, 0.17, -SHIN - 0.05));
  return { root, body, hip, torso, arms, thighL, thighR, kneeL, kneeR, feet, goalie, phase: Math.random() * 6, bf: 0, jersey: mat('jersey') };
}

const tmp = new THREE.Vector3();
/**
 * Pose one frame. `sp` is ground speed (m/s), `bf` (goalies) blends ready stance → butterfly.
 * Skaters: a hockey stride — each leg pushes out and back while the other recovers under the hips, knees flexed, trunk
 * leaning forward, arms and stick swinging with the stride.
 */
export function poseRig(r: PlayerRig, dt: number, sp: number, carry: boolean, bfTarget: number): void {
  if (r.goalie) {
    r.bf += (bfTarget - r.bf) * (1 - Math.exp(-dt * (bfTarget > r.bf ? 14 : 5)));
    const b = r.bf, k = 1 - b;
    r.phase += dt * 1.5;
    const shuffle = Math.min(1, sp / 3) * Math.sin(r.phase * 3) * 0.08 * k;
    // ready: wide, knees bent, pads square; butterfly: knees together on the ice, pads flared flat
    for (const [th, kn, s] of [[r.thighL, r.kneeL, -1], [r.thighR, r.kneeR, 1]] as const) {
      th.rotation.set(s * (-0.22 * k - 0.0 * b), 0, 0.75 * k + 1.35 * b + shuffle * s, 'XYZ');
      th.rotation.x = -s * (0.22 * k - 0.18 * b);
      kn.rotation.set(-s * 1.25 * b, 0, -1.05 * k - 0.35 * b, 'ZYX');
      kn.rotation.y = s * 0.0;
      kn.rotation.x = -s * 1.35 * b;
    }
    r.torso.rotation.z = -(0.3 * k + 0.12 * b);
    r.arms.rotation.y = 0.04 * Math.sin(r.phase);
    r.arms.rotation.z = 0.15 * b; // stick down to seal the five-hole
  } else {
    const a = Math.min(1, sp / 7.5);
    r.phase += dt * (1.2 + sp * 0.95);
    const s1 = Math.sin(r.phase);
    for (const [th, kn, side, ph] of [[r.thighL, r.kneeL, -1, s1], [r.thighR, r.kneeR, 1, -s1]] as const) {
      const push = Math.max(0, -ph), rec = Math.max(0, ph);
      th.rotation.set(-side * (0.06 + a * 0.42 * push), 0, 0.5 + 0.1 * a + a * 0.45 * ph, 'XYZ');
      kn.rotation.set(0, 0, -(0.75 + 0.15 * a) - a * 0.55 * rec + a * 0.3 * push, 'XYZ');
    }
    r.torso.rotation.z = -(0.32 + a * 0.28);
    r.torso.rotation.y = a * 0.12 * s1;
    r.arms.rotation.y = (carry ? 0.05 : -0.05) + a * 0.18 * s1;
    r.arms.rotation.z = carry ? 0.05 : 0.12 * a;
  }
  // drop the body so the lowest blade/knee touches the ice
  r.body.position.y = 0; r.root.updateMatrixWorld(true);
  let minY = Infinity; for (const f of r.feet) { f.getWorldPosition(tmp); minY = Math.min(minY, tmp.y - r.root.position.y); }
  r.body.position.y = -minY;
}
