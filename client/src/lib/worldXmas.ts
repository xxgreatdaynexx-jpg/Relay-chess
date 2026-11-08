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
export interface XmasOpts { tier: WorldTier; half: number; roofs: XmasRoof[]; decor: XmasDecor[]; frost?: boolean; roads?: THREE.BufferGeometry[]; footprints?: XmasRoof[]; ground?: { x0: number; x1: number; z0: number; z1: number }; pads?: XmasRoof[] }

const LIGHT_COLORS = [0xff3040, 0x30e070, 0xffd040, 0x40a0ff, 0xff70d0];

export function addXmas(scene: THREE.Scene, o: XmasOpts) {
  const root = new THREE.Group(); root.name = 'xmas'; scene.add(root);
  const disposables: { dispose(): void }[] = [];
  const low = o.tier === 'low';
  const uTime = { value: 0 };

  // Snowfall: positions wrap in the vertex shader. The volume (see snowVolume) is re-centred on the view every frame and
  // sized with zoom; flakes stay world-anchored while it moves (wrap is toroidal) and its outer quarter fades out, so the
  // snow never ends in a visible box edge on the expanded maps. Particle count is fixed per tier.
  const uCenter = { value: new THREE.Vector2(0, 0) }; const uHalf = { value: o.half };
  { const n = SNOW_COUNT[o.tier]; const H = 90; const p = new Float32Array(n * 3); const sd = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = Math.random(); p[i * 3 + 1] = Math.random() * H; p[i * 3 + 2] = Math.random(); sd[i] = Math.random(); } // x/z normalised 0..1, placed around the view in the shader
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H / 2, 0), 1e5); // shader places flakes around the view; never culled (frustumCulled = false)
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime, uCenter, uHalf, uH: { value: H }, uSize: { value: low ? 2.2 : 2.8 } },
      vertexShader: `attribute float seed; uniform float uTime, uH, uSize, uHalf; uniform vec2 uCenter; varying float vA;
        void main() { vec3 q = position; vec2 r = fract(position.xz - uCenter / (2.0 * uHalf)) * 2.0 - 1.0; q.xz = uCenter + r * uHalf; float sp = 3.0 + seed * 3.0; q.y = mod(q.y - uTime * sp, uH);
          q.x += sin(uTime * 0.6 + seed * 40.0) * 1.6; q.z += cos(uTime * 0.5 + seed * 25.0) * 1.2;
          vec4 mv = modelViewMatrix * vec4(q, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * (0.6 + seed) * 160.0 / -mv.z, 1.0, 7.0); vA = smoothstep(0.0, 6.0, q.y) * (1.0 - smoothstep(0.75, 1.0, max(abs(r.x), abs(r.y)))); }`,
      fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, (1.0 - d * 2.0) * 0.9 * vA); }` });
    disposables.push(g, m); const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5; root.add(pts); }

  // Ground snow (pt1331u "make the snow on the ground nicer"): a noise-textured snow sheet (soft white, blue in the
  // low spots, glossy glints via a low roughness map), drifts piled against building bases and trees, slush on roads,
  // and a scatter of twinkling glints. Low tier: smaller texture, fewer drifts and glints.
  const tex = snowTextures(low ? 128 : 256); disposables.push(tex.map, tex.rough, tex.slush);
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xf2f6ff, map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0, emissive: 0x1a2238, emissiveIntensity: 0.6 });
  disposables.push(snowMat);
  const gb = o.ground ?? { x0: -o.half, x1: o.half, z0: -o.half, z1: o.half }; const gw = gb.x1 - gb.x0, gd = gb.z1 - gb.z0;
  if (o.frost !== false) { const g = new THREE.PlaneGeometry(gw, gd); g.rotateX(-Math.PI / 2); g.translate((gb.x0 + gb.x1) / 2, 0, (gb.z0 + gb.z1) / 2);
    // Opaque sheet just above every ground layer (plate 0, farm apron -0.02, outskirts -0.03) and well under anything
    // raised (dirt lanes 0.05, roads/patches 0.08, farm soil 0.14), pushed *back* in depth so nothing flat fights it.
    const m = snowMat.clone(); m.map = tex.map.clone(); m.map.repeat.set(gw / 44, gd / 44); m.map.needsUpdate = true; m.roughnessMap = m.map;
    m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; disposables.push(g, m, m.map);
    const f = new THREE.Mesh(g, m); f.position.y = 0.02; root.add(f);
    // city parks / plazas / lots sit at 0.08: a snow top a hair above each, so they read as snowy yards, not dark outlines
    if (o.pads?.length) { const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2); disposables.push(pg);
      const pm = new THREE.InstancedMesh(pg, snowMat, o.pads.length); const d = new THREE.Object3D();
      o.pads.forEach((r, i) => { d.position.set(r.x, 0.092, r.z); d.rotation.set(0, r.rot, 0); d.scale.set(r.w - 0.2, 1, r.d - 0.2); d.updateMatrix(); pm.setMatrixAt(i, d.matrix); }); root.add(pm); } }
  // slushy, partly cleared roads: the road surface again, streaked with grey-white slush that thins toward the middle
  const slushMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0xc9d2e0, alphaMap: tex.slush, transparent: true, opacity: 0.7, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(slushMat);
  const addRoads = (srcs: THREE.BufferGeometry[]) => { for (const src of srcs) { const rg = src.clone(); const pa = rg.attributes.position as THREE.BufferAttribute; const uv = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i++) { uv[i * 2] = pa.getX(i) / 9; uv[i * 2 + 1] = pa.getZ(i) / 9; } rg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); disposables.push(rg);
    const me = new THREE.Mesh(rg, slushMat); me.renderOrder = 1; root.add(me); } };
  addRoads(o.roads ?? []);
  // drifts: flattened lumpy mounds hugging building edges (city houses + landmark/resort footprints) and tree bases
  { const spots: [number, number, number, number, number][] = []; const rnd = mulberry(1225);
    const maxD = low ? 350 : o.tier === 'mid' ? 1400 : 2600;
    const edge = (r: XmasRoof, n: number) => { const cs = Math.cos(r.rot), sn = Math.sin(r.rot);
      for (let k = 0; k < n; k++) { const side = Math.floor(rnd() * 4), f = rnd() * 2 - 1; const hw = r.w / 2 + 0.35, hd = r.d / 2 + 0.35;
        const [lx, lz] = side === 0 ? [f * hw, -hd] : side === 1 ? [hw, f * hd] : side === 2 ? [f * hw, hd] : [-hw, f * hd];
        spots.push([r.x + lx * cs + lz * sn, r.z - lx * sn + lz * cs, 0.6 + rnd() * 1.2, 0.25 + rnd() * 0.35, rnd() * 6.28]); } };
    const all = [...o.roofs, ...(o.footprints ?? [])]; const per = Math.max(1, Math.min(3, Math.floor(maxD * 0.8 / Math.max(1, all.length))));
    for (const r of all) edge(r, per);
    for (const dc of o.decor) { const sc = dc.scale ?? 1; for (let k = 0; k < 5; k++) { const a = rnd() * 6.28, rr = (2.2 + rnd() * 1.6) * sc; spots.push([dc.x + Math.cos(a) * rr, dc.z + Math.sin(a) * rr, (0.9 + rnd()) * sc, (0.3 + rnd() * 0.3) * sc, a]); } }
    const n = Math.min(spots.length, maxD);
    const g = new THREE.IcosahedronGeometry(1, low ? 0 : 1); g.translate(0, -0.35, 0); disposables.push(g);
    const dm = new THREE.InstancedMesh(g, snowMat, n); const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) { const [x, z, w, h, a] = spots[i]; d.position.set(x, 0, z); d.rotation.set(0, a, 0); d.scale.set(w * 1.6, h, w); d.updateMatrix(); dm.setMatrixAt(i, d.matrix); }
    root.add(dm);
    // glints: tiny white points that flash briefly, scattered over the snow and on the drifts
    const gn = low ? 250 : o.tier === 'mid' ? 900 : 1800; const pos: number[] = [], col: number[] = [], ph: number[] = [];
    for (let i = 0; i < gn; i++) { if ((o.frost !== false || o.ground) && i % 3) { pos.push(gb.x0 + rnd() * gw, 0.09, gb.z0 + rnd() * gd); } else { const sp = spots[Math.floor(rnd() * n)]; if (!sp) continue; pos.push(sp[0] + (rnd() - 0.5) * sp[2], sp[3] * 0.6, sp[1] + (rnd() - 0.5) * sp[2]); }
      col.push(0.85, 0.92, 1); ph.push(rnd() * 6.28); }
    if (pos.length) root.add(lightPoints(pos, col, ph, 0.35, 8.0)); }

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

  function lightPoints(pos: number[], col: number[], ph: number[], size: number, sharp = 1) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('ph', new THREE.Float32BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime, uSize: { value: size }, uSharp: { value: sharp } },
      vertexShader: `attribute vec3 color; attribute float ph; uniform float uTime, uSize, uSharp; varying vec3 vC; varying float vB;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vB = pow(0.5 + 0.5 * sin(uTime * 2.2 + ph), uSharp) * (uSharp > 1.5 ? 1.4 : 0.9) + (uSharp > 1.5 ? 0.0 : 0.1); vC = color;
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
    /** Advance snow; with camera + target, the bounded snowfall volume follows the view across the whole map. */
    step(dt: number, cam?: { x: number; z: number }, target?: { x: number; y: number; z: number }) { uTime.value += dt;
      if (cam && target) { const v = snowVolume(cam, target, o.half); uCenter.value.set(v.cx, v.cz); uHalf.value = v.half; } },
    /** Slush decals for road sets built after addXmas (rural, Big Farms, airport, racetrack), same material as city roads. */
    addRoads,
    dispose() { scene.remove(root); disposables.forEach((x) => x.dispose()); },
  };
}
export type Xmas = ReturnType<typeof addXmas>;
/** Snowfall volume for the current view: centred between the camera target and the camera's ground point, sized with zoom
 *  (base half at close range, 0.85 × camera distance when zoomed out) so it reaches past the camera and the visible field.
 *  The particle count never changes; the outer 25% fades out so there is no hard edge. */
export function snowVolume(cam: { x: number; z: number }, t: { x: number; y?: number; z: number }, base: number) {
  const dist = Math.hypot(cam.x - t.x, ((cam as { y?: number }).y ?? 0) - (t.y ?? 0), cam.z - t.z);
  return { cx: t.x + (cam.x - t.x) * 0.35, cz: t.z + (cam.z - t.z) * 0.35, half: Math.max(base, dist * 0.85) };
}
/** Snow-covered ground material for a w×d ground top (UV 0..1): the city swaps its grass tops for this while Christmas is
 *  on, so snow IS the ground (no overlay sheet to z-fight with lanes, water, plots or patches). One shared canvas texture. */
let groundTex: THREE.Texture | null = null;
/** `x0`/`z1` = world min-x / max-z of the box top: the texture is phased to world space so adjacent ground pieces
 *  (plate, outskirts strips, Big Farms, farm apron, venue slabs) continue the same pattern instead of restarting at
 *  each seam (which drew hard lines along every new-section edge). */
export function xmasGround(w: number, d: number, low: boolean, x0 = 0, z1 = 0): THREE.MeshStandardMaterial {
  if (typeof document === 'undefined') return new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.95 });
  if (!groundTex) groundTex = snowTextures(low ? 128 : 256).map;
  const t = groundTex.clone(); t.repeat.set(w / 44, d / 44); t.offset.copy(xmasGroundOffset(x0, z1)); t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: 0xf2f6ff, map: t, roughness: 0.95, metalness: 0, emissive: 0x1a2238, emissiveIntensity: 0.6 });
}

/** BoxGeometry top face: u = (x - x0)/w, v = (z1 - z)/d, so uv·repeat + offset = world/44 when offset = (x0, -z1)/44. */
export function xmasGroundOffset(x0: number, z1: number): THREE.Vector2 { const f = (a: number) => a - Math.floor(a); return new THREE.Vector2(f(x0 / 44), f(-z1 / 44)); }
function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Tileable snow textures drawn once on a canvas: colour (white with blue-grey hollows), and a streaky slush alpha. */
function snowTextures(size: number) {
  const rnd = mulberry(77);
  const mk = (draw: (g: CanvasRenderingContext2D) => void, srgb: boolean) => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!; draw(g);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t; };
  const blobs = (g: CanvasRenderingContext2D, n: number, rMin: number, rMax: number, col: (a: number) => string) => {
    for (let i = 0; i < n; i++) { const x = rnd() * size, y = rnd() * size, r = (rMin + rnd() * (rMax - rMin)) * size; const a = rnd();
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, col(a)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } } };
  const map = mk((g) => { g.fillStyle = '#f4f7ff'; g.fillRect(0, 0, size, size);
    blobs(g, 26, 0.08, 0.22, (a) => `rgba(175,195,230,${0.07 + a * 0.1})`); // blue hollows
    blobs(g, 30, 0.04, 0.12, (a) => `rgba(255,255,255,${0.15 + a * 0.2})`); // bright crests
    const id = g.getImageData(0, 0, size, size); for (let i = 0; i < id.data.length; i += 4) { const n = (rnd() - 0.5) * 14; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n * 0.6; } g.putImageData(id, 0, 0); }, true);
  const rough = map; // brighter crests are glossier enough; reuse to save a texture
  const slush = mk((g) => { g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
    blobs(g, 22, 0.08, 0.2, (a) => `rgba(255,255,255,${0.25 + a * 0.5})`);
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, rnd() * size, size, size * 0.04); } }, false);
  return { map, rough, slush };
}
