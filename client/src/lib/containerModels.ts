import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { C20, C40, boxLen, type Box } from './containerYard';
/**
 * mu-visuals containers: shared ISO container geometry (one per size, cached) for instancing.
 * Long axis = X. Corrugated long sides (trapezoid ribs displaced in the geometry, flat-shaded), a ribbed roof, door end
 * (+X) with 4 vertical lock bars + handles, plain front end, and 8 darker corner castings. Vertex colours carry the
 * light/dark parts so one instance colour paints the box.
 */
const cache = new Map<number, THREE.BufferGeometry>();
const tint = (g: THREE.BufferGeometry, v: number) => { const n = g.getAttribute('position').count; const c = new Float32Array(n * 3).fill(v); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); return g; };
const bx = (w: number, h: number, d: number, x: number, y: number, z: number, shade: number, sx = 1, sy = 1, sz = 1) => { const g = new THREE.BoxGeometry(w, h, d, sx, sy, sz); g.translate(x, y, z); return tint(g, shade); };
export function containerGeo(size: 20 | 40): THREE.BufferGeometry {
  const hit = cache.get(size); if (hit) return hit;
  const S = size === 40 ? C40 : C20; const L = S.len, W = S.w, H = S.h; const ribs = size === 40 ? 44 : 22; const rib = 0.028;
  // body: subdivided along X so alternate vertex columns can be pushed out into corrugations on the sides and roof
  const body = new THREE.BoxGeometry(L, H, W, ribs * 2, 1, 1); const p = body.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (Math.abs(Math.abs(x) - L / 2) < 1e-6) continue;
    const col = Math.round((x + L / 2) / (L / (ribs * 2))); if (col % 2) { if (Math.abs(Math.abs(z) - W / 2) < 1e-6) p.setZ(i, z + Math.sign(z) * rib); else if (Math.abs(y - H / 2) < 1e-6) p.setY(i, y + rib * 0.6); } }
  tint(body, 1);
  const parts: THREE.BufferGeometry[] = [body];
  const cs = 0.09; // corner castings
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) parts.push(bx(cs * 1.2, cs, cs * 1.2, sx * (L / 2 - cs * 0.55), sy * (H / 2 - cs * 0.45), sz * (W / 2 - cs * 0.55 + 0.012), 0.38));
  // corner posts + top/bottom rails at both ends
  for (const sx of [-1, 1]) { for (const sz of [-1, 1]) parts.push(bx(0.07, H, 0.07, sx * (L / 2 - 0.035), 0, sz * (W / 2 - 0.02), 0.78));
    for (const sy of [-1, 1]) parts.push(bx(0.06, 0.07, W, sx * (L / 2 - 0.03), sy * (H / 2 - 0.035), 0, 0.78)); }
  // door end (+X): door seam, 4 lock bars with cams + handles
  parts.push(bx(0.012, H * 0.92, 0.02, L / 2 + 0.006, 0, 0, 0.5));
  for (const z of [-0.36, -0.12, 0.12, 0.36]) { parts.push(bx(0.025, H * 0.9, 0.025, L / 2 + 0.018, 0, z * W, 0.55));
    for (const sy of [-1, 1]) parts.push(bx(0.03, 0.05, 0.06, L / 2 + 0.02, sy * H * 0.44, z * W, 0.4));
    parts.push(bx(0.03, 0.03, 0.1, L / 2 + 0.035, -H * 0.1, z * W + 0.04, 0.45)); }
  // bottom cross members (dark underside), forklift pockets on 20ft
  parts.push(bx(L * 0.98, 0.05, W * 0.98, 0, -H / 2 + 0.025, 0, 0.3));
  if (size === 20) for (const x of [-0.28, 0.28]) for (const sz of [-1, 1]) parts.push(bx(0.28, 0.09, 0.01, x * L, -H / 2 + 0.1, sz * (W / 2 + 0.003), 0.2));
  const g = mergeGeometries(parts.map((q) => q.index ? q.toNonIndexed() : q))!; g.computeVertexNormals(); g.userData.shared = true; cache.set(size, g); return g;
}
let mat: THREE.MeshStandardMaterial | null = null;
export const containerMat = () => (mat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.2, flatShading: true }));
let logoTex: THREE.CanvasTexture | null = null; let logoM: THREE.MeshBasicMaterial | null = null; let logoG: THREE.PlaneGeometry | null = null;
function logoMat() {
  if (logoM) return logoM; const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
  x.clearRect(0, 0, 256, 64); x.fillStyle = 'rgba(245,245,240,0.92)'; x.font = 'bold 40px sans-serif'; x.textBaseline = 'middle'; x.fillText('CHUD LINES', 12, 34);
  x.beginPath(); x.arc(232, 32, 18, 0, Math.PI * 2); x.lineWidth = 6; x.strokeStyle = 'rgba(245,245,240,0.92)'; x.stroke();
  logoTex = new THREE.CanvasTexture(c); logoTex.colorSpace = THREE.SRGBColorSpace; logoM = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); return logoM;
}
/** Instanced meshes for a laid-out yard: one per container size + one for side logos. Returns a group. */
export function containerMeshes(boxes: Box[], yaw = 0): THREE.Group {
  const g = new THREE.Group(); g.rotation.y = yaw; const m4 = new THREE.Matrix4(); const c = new THREE.Color();
  for (const size of [40, 20] as const) { const list = boxes.filter((b) => b.size === size); if (!list.length) continue;
    const im = new THREE.InstancedMesh(containerGeo(size), containerMat(), list.length); list.forEach((b, i) => { m4.makeTranslation(b.x, b.y, b.z); im.setMatrixAt(i, m4); im.setColorAt(i, c.setHex(b.color)); });
    im.userData.containers = list; im.castShadow = true; im.receiveShadow = true; g.add(im); }
  const logos = boxes.filter((b) => b.logo); if (typeof document !== 'undefined' && logos.length) {
    logoG ??= (() => { const p = new THREE.PlaneGeometry(1, 0.25); p.userData.shared = true; return p; })();
    const lm = new THREE.InstancedMesh(logoG, logoMat(), logos.length * 2); let k = 0; const q = new THREE.Quaternion(); const sc = new THREE.Vector3(); const v = new THREE.Vector3();
    for (const b of logos) for (const s of [-1, 1]) { const L = boxLen(b); sc.set(L * 0.55, L * 0.55, 1); q.setFromEuler(new THREE.Euler(0, s > 0 ? 0 : Math.PI, 0)); v.set(b.x, b.y + C40.h * 0.1, b.z + s * (C40.w / 2 + 0.045)); lm.setMatrixAt(k++, m4.compose(v, q, sc)); }
    g.add(lm); }
  return g;
}
