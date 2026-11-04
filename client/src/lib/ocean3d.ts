/**
 * Ocean, beach, breakwater and harbour pieces shared by the city, resort and Fort McChud maps (mu-visuals).
 * Mobile budget: one big low-poly wave plane (vertex waves, analytic normals), instanced rocks/containers/bollards/lamps,
 * module-level shared geometries + materials. Nothing here moves existing layout; callers place it outside old bounds.
 */
import { containerYard } from './containerYard';
import { containerMeshes } from './containerModels';
import * as THREE from 'three';

const G = new Map<string, THREE.BufferGeometry>();
/** Cached geometry by key: every harbour/vehicle shares one copy. */
export const sg = <T extends THREE.BufferGeometry>(k: string, f: () => T): T => { let g = G.get(k); if (!g) { g = f(); G.set(k, g); } return g as T; };
const MM = new Map<string, THREE.MeshStandardMaterial>();
/** Cached standard material by colour/rough/metal/emissive. */
export const sm = (color: number, rough = 0.7, metal = 0, emissive = 0, ei = 0) => { const k = `${color}|${rough}|${metal}|${emissive}|${ei}`; let m = MM.get(k); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei }); MM.set(k, m); } return m; };
export const BOX = () => sg('box', () => new THREE.BoxGeometry(1, 1, 1));
export const CYL = () => sg('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 14));
export const CYL8 = () => sg('cyl8', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
export const SPH = () => sg('sph', () => new THREE.SphereGeometry(0.5, 12, 8));
/** Mesh helper: unit geometry scaled (keeps the cache shared). */
export function part(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o;
}

// ---------- ocean water ----------
export interface OceanOpts { x0: number; x1: number; z0: number; z1: number; coast: (x: number) => number; segX?: number; segZ?: number; facing?: 1 | -1 }
/** Animated ocean: Gerstner-ish summed sines in the vertex shader, deep/shallow colour by distance from the coast, fresnel
 * sky reflection, sun glint, breaking-surf foam bands. `uDay` 0..1 brightens it for daytime; `uTime` animates. */
export function oceanMaterial(coastA: [number, number, number, number, number], facing = 1) {
  return new THREE.ShaderMaterial({
    fog: true, transparent: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDay: { value: 0.6 }, uCoast: { value: new THREE.Vector4(...coastA.slice(0, 4)) }, uShore: { value: coastA[4] }, uFace: { value: facing }, uSun: { value: new THREE.Vector3(0.4, 0.6, 0.5).normalize() } }]),
    vertexShader: `uniform float uTime; uniform vec4 uCoast; uniform float uShore; uniform float uFace; varying vec3 vW; varying vec3 vN; varying float vD;
      #include <fog_pars_vertex>
      float coast(float x) { return uShore + uCoast.x * sin(x / uCoast.y + 0.7) + uCoast.z * sin(x / uCoast.w + 2.1); }
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0); float d = max(0.0, (wp.z - coast(wp.x)) * uFace); vD = d;
        float amp = smoothstep(0.0, 28.0, d) * 0.55 + 0.08; vec2 p = wp.xz; float t = uTime;
        float a1 = dot(p, vec2(0.05, 0.11)) - t * 0.9, a2 = dot(p, vec2(-0.13, 0.07)) - t * 1.3, a3 = dot(p, vec2(0.21, 0.17)) - t * 1.9;
        float h = (sin(a1) * 0.6 + sin(a2) * 0.3 + sin(a3) * 0.12) * amp;
        vec2 g = (cos(a1) * 0.6 * vec2(0.05, 0.11) + cos(a2) * 0.3 * vec2(-0.13, 0.07) + cos(a3) * 0.12 * vec2(0.21, 0.17)) * amp;
        wp.y += h; vW = wp.xyz; vN = normalize(vec3(-g.x, 1.0, -g.y));
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform float uDay; uniform vec3 uSun; varying vec3 vW; varying vec3 vN; varying float vD;
      #include <fog_pars_fragment>
      void main() {
        vec3 n = normalize(vN + vec3(sin(vW.x * 0.9 + uTime * 1.7) * 0.05, 0.0, cos(vW.z * 0.8 - uTime * 1.3) * 0.05));
        vec3 v = normalize(cameraPosition - vW); float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        float depth = smoothstep(0.0, 60.0, vD);
        vec3 shallowD = vec3(0.16, 0.62, 0.66), deepD = vec3(0.03, 0.22, 0.42), shallowN = vec3(0.025, 0.09, 0.12), deepN = vec3(0.004, 0.025, 0.07);
        vec3 c = mix(mix(shallowN, deepN, depth), mix(shallowD, deepD, depth), uDay);
        vec3 sky = mix(vec3(0.04, 0.06, 0.12), vec3(0.62, 0.78, 0.92), uDay);
        c = mix(c, sky, fr * 0.55);
        vec3 hh = normalize(uSun + v); float spec = min(pow(max(dot(n, hh), 0.0), 220.0) * (0.3 + 0.45 * uDay), 0.7);
        float surf = (1.0 - smoothstep(0.0, 9.0, vD)); float band = pow(max(0.0, sin(vD * 0.8 + uTime * 1.6)), 8.0) * surf;
        float edge = 1.0 - smoothstep(0.0, 1.6, vD);
        float foam = clamp(band * 0.75 + edge * (0.6 + 0.4 * sin(vW.x * 1.3 + uTime * 2.0)), 0.0, 1.0);
        float cap = smoothstep(0.52, 0.62, vW.y) * 0.5;
        gl_FragColor = vec4(c + spec * vec3(1.0, 0.95, 0.85) + (foam + cap) * mix(vec3(0.5, 0.6, 0.65), vec3(0.95), uDay), 1.0);
        #include <fog_fragment>
      }`,
  });
}
export function buildOcean(o: OceanOpts, coastA: [number, number, number, number, number]) {
  const sx = o.segX ?? 140, sz = o.segZ ?? 60;
  // rows bunch up near the coast (where waves + foam need detail) and stretch out to the horizon
  const g = new THREE.PlaneGeometry(o.x1 - o.x0, 1, sx, sz); g.rotateX(-Math.PI / 2); const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + (o.x0 + o.x1) / 2; const tt = p.getZ(i) + 0.5; const f = o.facing === -1 ? 1 - tt : tt; const zz = o.z0 + (o.z1 - o.z0) * Math.pow(f, 2.2); p.setXYZ(i, x, 0, zz); }
  g.computeBoundingSphere(); const m = oceanMaterial(coastA, o.facing ?? 1); const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.userData.noShadow = true; mesh.renderOrder = 0; return { mesh, mat: m, geo: g };
}
/** Beach: a sand ribbon from the land edge down into the surf, wet sand at the waterline (vertex colours). */
export function buildBeach(x0: number, x1: number, landZ: number, coast: (x: number) => number, n = 160) {
  const rows: Array<[(x: number) => number, number, number]> = [[() => landZ - 1.5, 0.0, 0x5d7a3a], [() => landZ + 1.2, 0.05, 0xb9a57a], [(x) => (landZ + coast(x)) / 2, 0.04, 0xe3cf9e], [(x) => coast(x) - 1.2, 0.0, 0xc8b07c], [(x) => coast(x) + 1.0, -0.22, 0x9a8456], [(x) => coast(x) + 6, -0.7, 0x6f6040]];
  const pos: number[] = [], col: number[] = [], idx: number[] = []; const c = new THREE.Color(); const R = rows.length;
  for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; for (const [zf, y, hx] of rows) { pos.push(x, y, zf(x)); c.setHex(hx); const j = 0.94 + 0.06 * Math.sin(x * 2.3 + i); col.push(c.r * j, c.g * j, c.b * j); } }
  for (let i = 0; i < n; i++) for (let r = 0; r < R - 1; r++) { const a = i * R + r, b = (i + 1) * R + r; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
}
/** Rubble-mound breakwater: instanced boulders along a polyline, a concrete cap path, and a lighthouse at the tip. */
export function buildBreakwater(pts: Array<[number, number]>, glow?: THREE.MeshStandardMaterial) {
  const g = new THREE.Group(); const rocks: THREE.Matrix4[] = []; const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3(); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const capGeo: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!; const L = Math.hypot(bx - ax, bz - az); const nx = -(bz - az) / L, nz = (bx - ax) / L;
    for (let t = 0; t < L; t += 1.6) { const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L;
      for (const off of [-3.4, -1.8, 0, 1.8, 3.4]) { const k = 1 - Math.abs(off) / 5; e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e); const r = 1.1 + rnd() * 0.9; s.set(r, r * (0.7 + k * 0.5), r); v.set(x + nx * off + (rnd() - 0.5), -0.6 + k * 1.4, z + nz * off + (rnd() - 0.5)); rocks.push(new THREE.Matrix4().compose(v, q, s)); } }
    capGeo.push(ax, az, bx, bz); }
  const im = new THREE.InstancedMesh(sg('rock', () => new THREE.DodecahedronGeometry(0.9, 0)), sm(0x777b80, 0.95), rocks.length); rocks.forEach((m, i) => im.setMatrixAt(i, m)); g.add(im);
  for (let i = 0; i < capGeo.length; i += 4) { const [ax, az, bx, bz] = capGeo.slice(i, i + 4) as [number, number, number, number]; const L = Math.hypot(bx - ax, bz - az); const c = part(g, BOX(), sm(0xa8a39a, 0.9), 2.4, 0.5, L + 1.2, (ax + bx) / 2, 1.25, (az + bz) / 2); c.rotation.y = Math.atan2(bx - ax, bz - az); }
  const [tx, tz] = pts[pts.length - 1]!; const lh = new THREE.Group(); lh.position.set(tx, 1.4, tz); g.add(lh);
  part(lh, CYL(), sm(0xf8fafc, 0.6), 2.2, 9, 2.2, 0, 4.5, 0); for (const y of [2.2, 5.6]) part(lh, CYL(), sm(0xdc2626, 0.6), 2.25, 1.4, 2.25, 0, y, 0);
  part(lh, CYL8(), sm(0x334155, 0.5, 0.4), 2.8, 0.3, 2.8, 0, 9.1, 0); part(lh, CYL8(), glow ?? sm(0xfff2b0, 0.4, 0, 0xffd76a, 2.2), 1.4, 1.4, 1.4, 0, 10, 0); part(lh, sg('cone', () => new THREE.ConeGeometry(0.5, 1, 10)), sm(0xdc2626, 0.6), 1.9, 1.2, 1.9, 0, 11.3, 0);
  return g;
}

export interface HarbourOpts { x: number; z0: number; z1: number; quayW: number; quayD: number; side?: 1 | -1; cranes?: number; stacks?: number; label?: THREE.Object3D }
/** Container terminal: concrete quay + pier on piles, fenders and bollards, 2 STS gantry cranes, instanced container stacks,
 * a warehouse, reefer racks and lamp masts. The pier runs z0 → z1 at x (ships berth on the +x side when side=1). */
/** Top of the quay apron (containers sit exactly here). */
export const QUAY_TOP = 1.0;
export function buildHarbour(o: HarbourOpts) {
  const g = new THREE.Group(); const side = o.side ?? 1; const pierW = 9; const len = Math.abs(o.z1 - o.z0); const zc = (o.z0 + o.z1) / 2; const dir = Math.sign(o.z1 - o.z0) || 1;
  const conc = sm(0x9ca3af, 0.92), concD = sm(0x6b7280, 0.95), yel = sm(0xfacc15, 0.6), dark = sm(0x1f2937, 0.6), steel = sm(0x94a3b8, 0.45, 0.5);
  // quay apron along the shore + the pier deck on piles
  part(g, BOX(), conc, o.quayW, 1.2, o.quayD, o.x, QUAY_TOP - 0.6, o.z0 - dir * o.quayD / 2 + dir * 1);
  part(g, BOX(), conc, pierW, 1.0, len, o.x, 0.9, zc); part(g, BOX(), yel, 0.25, 0.06, len, o.x + side * (pierW / 2 - 0.5), 1.42, zc);
  const piles: THREE.Matrix4[] = []; for (let t = 2; t < len; t += 4) for (const dx of [-pierW / 2 + 0.6, pierW / 2 - 0.6]) piles.push(new THREE.Matrix4().compose(new THREE.Vector3(o.x + dx, -1.2, o.z0 + dir * t), new THREE.Quaternion(), new THREE.Vector3(0.7, 3.4, 0.7)));
  const pm = new THREE.InstancedMesh(CYL8(), concD, piles.length); piles.forEach((m, i) => pm.setMatrixAt(i, m)); g.add(pm);
  // fenders + bollards along the berth face
  const fen: THREE.Matrix4[] = [], bol: THREE.Matrix4[] = []; const rx = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  for (let t = 3; t < len; t += 5) { fen.push(new THREE.Matrix4().compose(new THREE.Vector3(o.x + side * (pierW / 2 + 0.25), 0.7, o.z0 + dir * t), rx, new THREE.Vector3(0.8, 1.4, 0.8))); bol.push(new THREE.Matrix4().compose(new THREE.Vector3(o.x + side * (pierW / 2 - 1.1), 1.7, o.z0 + dir * (t + 2.5)), new THREE.Quaternion(), new THREE.Vector3(0.45, 0.6, 0.45))); }
  const fm = new THREE.InstancedMesh(sg('tyre', () => new THREE.TorusGeometry(0.35, 0.18, 6, 10)), sm(0x111111, 0.9), fen.length); fen.forEach((m, i) => fm.setMatrixAt(i, m)); g.add(fm);
  const bm = new THREE.InstancedMesh(CYL8(), sm(0x222222, 0.5, 0.5), bol.length); bol.forEach((m, i) => bm.setMatrixAt(i, m)); g.add(bm);
  // STS gantry cranes: legs on quay rails on the pier deck, boom out over the ship berthed alongside (QA#6), backreach over land
  const red = sm(0xd9480f, 0.55, 0.2), white = sm(0xf1f5f9, 0.5);
  for (let c = 0; c < (o.cranes ?? 2); c++) { const cr = new THREE.Group(); cr.position.set(o.x, 1.4, o.z0 + dir * (len * (0.35 + c * 0.35))); g.add(cr);
    for (const dx of [-3.4, 3.4]) for (const dz of [-2.2, 2.2]) part(cr, BOX(), red, 0.6, 15, 0.6, dx, 7.5, dz);
    for (const dz of [-2.2, 2.2]) { part(cr, BOX(), red, 7.4, 0.6, 0.6, 0, 8, dz); const b = part(cr, BOX(), red, 22, 0.7, 0.7, side * 7, 15, dz); b.userData.boom = true; }
    part(cr, BOX(), red, 0.6, 0.6, 5, side * 17, 15, 0); part(cr, BOX(), red, 0.6, 0.6, 5, -3.4, 15, 0);
    const ap = part(cr, BOX(), red, 0.5, 6, 0.5, -3.2, 18, 0); ap.rotation.z = 0; for (const dz of [-2.2, 2.2]) { const st = part(cr, BOX(), steel, 0.12, 0.12, 15, side * 6, 16.6, dz); st.rotation.set(0, Math.PI / 2, side * 0.18); }
    part(cr, BOX(), white, 2, 1.6, 2.2, side * 4, 13.6, 0); part(cr, BOX(), sm(0x93c5fd, 0.2, 0.3, 0x60a5fa, 0.5), 2.05, 0.6, 2.25, side * 4, 13.8, 0);
    part(cr, BOX(), dark, 1.8, 0.8, 4.4, side * 9, 13.9, 0); for (const dz of [-0.6, 0.6]) part(cr, BOX(), steel, 0.05, 2.5, 0.05, side * 9, 12.3, dz);
    for (const dx of [-3.4, 3.4]) part(cr, BOX(), dark, 1.2, 0.7, 5.6, dx, 0.35, 0); }
  // container yard on the quay (mu-visuals): grid-snapped rows parallel to the quay, identical orientation, flush stacks
  // (max 3) sitting on the deck, no overlap (was: random 1-3 stacks of 6-deep boxes at 2.6 spacing, overlapping and
  // spilling off the apron).
  const zq = o.z0 - dir * o.quayD / 2 + dir * 1; const xa = o.x - side * (pierW / 2 + 1.5), xb = o.x - side * (o.quayW / 2 - 1.5);
  const yard = containerYard({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: zq - o.quayD / 2 + 1, z1: zq + o.quayD / 2 - 1, deckY: QUAY_TOP, seed: Math.abs(Math.round(o.x * 13 + o.z0)) + 3 });
  const ym = containerMeshes(yard); ym.userData.yard = yard; g.add(ym);
  // terminal shed + office
  const shedX = o.x + side * (o.quayW / 2 - 9); const shz = o.z0 - dir * (o.quayD / 2 - 0.5);
  part(g, BOX(), sm(0xcbd5e1, 0.7), 14, 5, 8, shedX, 3.5, shz); part(g, BOX(), sm(0x475569, 0.6, 0.3), 14.6, 0.5, 8.6, shedX, 6.2, shz);
  for (let i = 0; i < 3; i++) part(g, BOX(), sm(0x64748b, 0.6, 0.3), 3, 3.4, 0.1, shedX - 4.5 + i * 4.5, 2.7, shz + dir * 4.05);
  part(g, BOX(), sm(0xe2e8f0, 0.5, 0, 0xfde68a, 0.25), 4, 6, 4, shedX - side * 10, 4, shz); part(g, BOX(), sm(0x1e3a8a, 0.3, 0.2, 0x60a5fa, 0.6), 4.05, 1, 4.05, shedX - side * 10, 5.6, shz);
  // lamp masts
  const lampM = sm(0xfff3c4, 0.4, 0, 0xffd27a, 1.6); for (const [dx, dz] of [[0, 0.15], [0, 0.85]] as const) { const lz = o.z0 + dir * len * dz; part(g, CYL8(), steel, 0.25, 12, 0.25, o.x - side * (pierW / 2 - 0.6), 7, lz); part(g, BOX(), lampM, 1.4, 0.4, 0.8, o.x - side * (pierW / 2 - 0.6), 13, lz); }
  if (o.label) { o.label.position.set(o.x, 20, zc); g.add(o.label); }
  g.traverse((x) => { x.userData.noShadow = x.userData.noShadow ?? false; });
  return g;
}
let rib: THREE.CanvasTexture | null = null;
/** Corrugated container side texture (shared). */
export function ribTexture() {
  if (rib) return rib; const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 16);
  for (let i = 0; i < 64; i += 4) { x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(i, 0, 1.5, 16); } x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, 64, 1); x.fillRect(0, 15, 64, 1);
  rib = new THREE.CanvasTexture(c); rib.colorSpace = THREE.SRGBColorSpace; return rib;
}
