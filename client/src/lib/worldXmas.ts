import * as THREE from 'three';
import { SNOW_COUNT } from '../../../shared/holiday';
import type { WorldTier } from './worldTier';

/**
 * Christmas dressing for the 3D city and resort (request #17). Cosmetic only.
 * Snow is a single GPU-animated Points cloud (no per-frame CPU work), roof snow caps and building lights are instanced /
 * one Points draw each, so the whole theme adds ~8 draw calls. Low-tier devices get a fraction of the snow and lights.
 */
export interface XmasRoof { x: number; z: number; w: number; d: number; top: number; rot: number; gable?: boolean }
export interface XmasDecor { x: number; z: number; rot?: number; scale?: number; big?: boolean }
export interface XmasOpts { tier: WorldTier; half: number; roofs: XmasRoof[]; decor: XmasDecor[]; frost?: boolean }

const LIGHT_COLORS = [0xff3040, 0x30e070, 0xffd040, 0x40a0ff, 0xff70d0];

export function addXmas(scene: THREE.Scene, o: XmasOpts) {
  const root = new THREE.Group(); root.name = 'xmas'; scene.add(root);
  const disposables: { dispose(): void }[] = [];
  const low = o.tier === 'low';
  const uTime = { value: 0 };

  // Snowfall: positions wrap in the vertex shader.
  { const n = SNOW_COUNT[o.tier]; const H = 90; const p = new Float32Array(n * 3); const sd = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() * 2 - 1) * o.half; p[i * 3 + 1] = Math.random() * H; p[i * 3 + 2] = (Math.random() * 2 - 1) * o.half; sd[i] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H / 2, 0), o.half * 1.5);
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime, uH: { value: H }, uSize: { value: low ? 2.2 : 2.8 } },
      vertexShader: `attribute float seed; uniform float uTime, uH, uSize; varying float vA;
        void main() { vec3 q = position; float sp = 3.0 + seed * 3.0; q.y = mod(q.y - uTime * sp, uH);
          q.x += sin(uTime * 0.6 + seed * 40.0) * 1.6; q.z += cos(uTime * 0.5 + seed * 25.0) * 1.2;
          vec4 mv = modelViewMatrix * vec4(q, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * (0.6 + seed) * 160.0 / -mv.z, 1.0, 7.0); vA = smoothstep(0.0, 6.0, q.y); }`,
      fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, (1.0 - d * 2.0) * 0.9 * vA); }` });
    disposables.push(g, m); const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5; root.add(pts); }

  // Frosty ground: a faint white layer over the plate (roads and water draw above it).
  if (o.frost !== false) { const g = new THREE.PlaneGeometry(o.half * 2, o.half * 2); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.17, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    disposables.push(g, m); const f = new THREE.Mesh(g, m); f.position.y = 0.045; f.renderOrder = 0; root.add(f); }

  // Snow caps on rooftops + string lights around each roof edge.
  if (o.roofs.length) {
    const g = new THREE.BoxGeometry(1, 1, 1); const m = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9 }); disposables.push(g, m);
    const caps = new THREE.InstancedMesh(g, m, o.roofs.length); const d = new THREE.Object3D();
    o.roofs.forEach((r, i) => { d.position.set(r.x, r.top + (r.gable ? -0.05 : 0.1), r.z); d.rotation.set(0, r.rot, 0); d.scale.set(r.gable ? Math.max(0.6, r.w * 0.35) : r.w + 0.15, 0.22, r.d + 0.35); d.updateMatrix(); caps.setMatrixAt(i, d.matrix); });
    root.add(caps);
    const per = low ? 6 : 14; const max = low ? 1500 : 6000; const pos: number[] = []; const col: number[] = []; const ph: number[] = []; const c = new THREE.Color();
    const step = Math.max(1, Math.ceil(o.roofs.length * per / max));
    o.roofs.forEach((r, ri) => { if (ri % step) return; const y = r.gable ? r.top - Math.min(1.6, r.d * 0.45) : r.top; const cs = Math.cos(r.rot), sn = Math.sin(r.rot);
      for (let k = 0; k < per; k++) { const t = k / per * 4; const side = Math.floor(t), f = t - side; const hw = r.w / 2 + 0.05, hd = r.d / 2 + 0.05;
        const [lx, lz] = side === 0 ? [-hw + f * 2 * hw, -hd] : side === 1 ? [hw, -hd + f * 2 * hd] : side === 2 ? [hw - f * 2 * hw, hd] : [-hw, hd - f * 2 * hd];
        pos.push(r.x + lx * cs + lz * sn, y + 0.05, r.z - lx * sn + lz * cs); c.setHex(LIGHT_COLORS[(ri + k) % LIGHT_COLORS.length]); col.push(c.r, c.g, c.b); ph.push(Math.random() * 6.28); } });
    root.add(lightPoints(pos, col, ph, low ? 0.9 : 1.1));
  }

  // Trees + presents at key spots.
  for (const dc of o.decor) root.add(tree(dc));

  function lightPoints(pos: number[], col: number[], ph: number[], size: number) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('ph', new THREE.Float32BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime, uSize: { value: size } },
      vertexShader: `attribute vec3 color; attribute float ph; uniform float uTime, uSize; varying vec3 vC; varying float vB;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vB = 0.55 + 0.45 * sin(uTime * 2.2 + ph); vC = color;
          gl_PointSize = clamp(uSize * 220.0 / -mv.z, 1.5, 10.0); }`,
      fragmentShader: `varying vec3 vC; varying float vB; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = pow(1.0 - d * 2.0, 1.6); gl_FragColor = vec4(vC * (0.6 + vB), a * vB); }` });
    disposables.push(g, m); const p = new THREE.Points(g, m); p.renderOrder = 6; return p; }

  function tree(dc: XmasDecor) {
    const s = dc.scale ?? 1; const g = new THREE.Group(); g.position.set(dc.x, 0, dc.z); g.rotation.y = dc.rot ?? 0; g.scale.setScalar(s);
    const green = new THREE.MeshStandardMaterial({ color: 0x1f6b35, roughness: 0.8, flatShading: true }); const trunk = new THREE.MeshStandardMaterial({ color: 0x5a3a22 });
    const snow = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9, flatShading: true });
    const star = new THREE.MeshStandardMaterial({ color: 0xffd84a, emissive: 0xffc020, emissiveIntensity: 1.4 }); disposables.push(green, trunk, snow, star);
    const add = (geom: THREE.BufferGeometry, m: THREE.Material, y: number, x = 0, z = 0) => { disposables.push(geom); const me = new THREE.Mesh(geom, m); me.position.set(x, y, z); g.add(me); return me; };
    add(new THREE.CylinderGeometry(0.35, 0.45, 1.4, 8), trunk, 0.7);
    const tiers = [[2.6, 3.4, 2.4], [2.0, 3.0, 4.2], [1.4, 2.6, 5.8]] as const;
    for (const [r, h, y] of tiers) { add(new THREE.ConeGeometry(r, h, 9), green, y); add(new THREE.ConeGeometry(r * 0.55, h * 0.3, 9), snow, y + h * 0.36); }
    add(new THREE.OctahedronGeometry(0.45, 0), star, 7.4);
    // ornaments as lights spiralling the cone
    const pos: number[] = []; const col: number[] = []; const ph: number[] = []; const c = new THREE.Color(); const n = low ? 16 : 40;
    for (let i = 0; i < n; i++) { const t = i / n; const y = 1.4 + t * 5.6; const rr = 2.6 * (1 - t * 0.85) + 0.05; const a = t * Math.PI * 9;
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr); c.setHex(LIGHT_COLORS[i % LIGHT_COLORS.length]); col.push(c.r, c.g, c.b); ph.push(i * 0.7); }
    g.add(lightPoints(pos, col, ph, 1.3 * s));
    // presents
    const pc = [0xd8283a, 0x2a8a4a, 0x2a5ad8, 0xe0b030];
    for (let i = 0; i < (dc.big ? 6 : 3); i++) { const a = i / (dc.big ? 6 : 3) * Math.PI * 2 + 0.4; const sz = 0.6 + (i % 3) * 0.2;
      const pm = new THREE.MeshStandardMaterial({ color: pc[i % pc.length], roughness: 0.6 }); disposables.push(pm);
      add(new THREE.BoxGeometry(sz, sz, sz), pm, sz / 2, Math.cos(a) * 3, Math.sin(a) * 3).rotation.y = a; }
    return g; }

  return {
    root,
    step(dt: number) { uTime.value += dt; },
    dispose() { scene.remove(root); disposables.forEach((x) => x.dispose()); },
  };
}
export type Xmas = ReturnType<typeof addXmas>;
