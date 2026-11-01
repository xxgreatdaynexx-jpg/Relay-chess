import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { detectWorldTier, labelScale, TIER_PIXEL_RATIO } from './worldTier';
import { farmPlots, FARM_X0, FARM_X1, FARM_Z0, FARM_Z1, FARM_LANES, FARM_LANE_W, BARNS, SILOS, plotId, tileXZ, cropById, TILE, clampMapTarget } from '../../../shared/farm';
import { buildVenues } from './worldVenues';
import { PLATE, shoreZ, ROADS, CUL_R, JUNCTIONS, CUL_ENDS, LANDMARK_IDS, landmarks, cityFill, roadClearance, obbHit, CAR_ROUTES, CAR_COUNT, LANE, routePoint, parkLayout, PARK_AREA, PARK_SIGN, MINE_SITES, MINE_APRON, OUTSKIRTS } from './worldLayout';
import { outskirts, countryHomes, countryBusinesses, businessType, lakeShape, RURAL_ROADS, RURAL_ROAD_W, LAKE, DOCK } from '../../../shared/outskirts';

import { WORLD_SPOTS } from './worldSpots';
import { buildCar } from './carModels';
import { CAR_BY_ID } from '../../../shared/cars';
import { HOUSING_TYPES, type HousingType } from './housing';
import { buildingId, patchId } from '../../../shared/realEstate';

type Handlers = { onHover: (id: string | null, x: number, y: number) => void; onPick: (id: string) => void; onProperty?: (id: string) => void };

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function windowsTexture(seed: number, warm: string, cool: string) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d')!; const r = rng(seed);
  g.fillStyle = '#0b0f1e'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) for (let x = 4; x < 60; x += 8) {
    const v = r(); g.fillStyle = v > 0.55 ? (v > 0.85 ? cool : warm) : '#141a2e'; g.fillRect(x, y, 5, 5);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}

/** Wall map (grey wall so the instance tint reads, dark + lit windows) and a matching emissive map (lit windows only). */
function housingTextures(seed: number, ht: HousingType) {
  const mk = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; return c; };
  const a = mk(), b = mk(); const g = a.getContext('2d')!, e = b.getContext('2d')!; const r = rng(seed);
  g.fillStyle = '#6a6a74'; g.fillRect(0, 0, 64, 128); e.fillStyle = '#000'; e.fillRect(0, 0, 64, 128);
  const { cols, rows, chance, lit } = ht.windows; const ww = Math.max(2, Math.round(cols * 0.55)), wh = Math.max(2, Math.round(rows * 0.5));
  for (let y = 3; y + wh < 126; y += rows) for (let x = 3; x + ww < 62; x += cols) {
    const on = r() < chance; const col = lit[Math.floor(r() * lit.length)];
    g.fillStyle = on ? col : '#151a2c'; g.fillRect(x, y, ww, wh); if (on) { e.fillStyle = col; e.fillRect(x, y, ww, wh); }
  }
  return [a, b].map((c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t; });
}

function signTexture(text: string, color: string, sub?: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = sub ? 192 : 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,6,20,0.88)'; g.beginPath(); g.roundRect(6, 6, 500, c.height - 12, 26); g.fill();
  g.strokeStyle = color; g.lineWidth = 6; g.shadowColor = color; g.shadowBlur = 24; g.stroke();
  g.font = '800 64px Outfit Variable, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; g.fillText(text, 256, sub ? 74 : 66); g.shadowBlur = 0;
  if (sub) { g.font = '600 34px Outfit Variable, system-ui, sans-serif'; g.fillStyle = color; g.fillText(sub, 256, 142); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}

/** Neon/glow dimmer for signs, landmark trim, windows and fountains (Dayne: 'a bit bright'). */
const NEON = 0.65;

export function createWorld(canvas: HTMLCanvasElement, h: Handlers) {
  const tier = detectWorldTier();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIER_PIXEL_RATIO[tier]));
  canvas.dataset.tier = tier;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a1c); scene.fog = new THREE.Fog(0x070a1c, 260, 640);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
  const home = new THREE.Vector3(132, 132, 156).multiplyScalar(PLATE / 96); camera.position.copy(home); // framing scales with the plate
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 30; controls.maxDistance = 360; controls.maxPolarAngle = 1.2; controls.minPolarAngle = 0.35;
  // Panning (pt1200u): left-drag / one-finger drag pans across the ground, right-drag / two fingers orbit + zoom, wheel zooms.
  controls.enablePan = true; controls.screenSpacePanning = false; controls.panSpeed = 1.1; controls.autoRotate = true; controls.autoRotateSpeed = 0.25;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const panKeys = new Set<string>();
  const typing = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
  const PAN_KEYS: Record<string, [number, number]> = { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  const onKey = (e: KeyboardEvent) => { if (!(e.code in PAN_KEYS)) return; if (e.type === 'keyup') { panKeys.delete(e.code); return; }
    if (typing() || !controls.enabled || e.metaKey || e.ctrlKey || e.altKey) return; panKeys.add(e.code); controls.autoRotate = false; if (e.code.startsWith('Arrow')) e.preventDefault(); };
  const onBlur = () => panKeys.clear();
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', onBlur);
  const panStep = (dt: number) => {
    if (!panKeys.size || !controls.enabled) return; let fx = 0, fz = 0; for (const k of panKeys) { fx += PAN_KEYS[k][0]; fz += PAN_KEYS[k][1]; } if (!fx && !fz) return;
    const fwd = controls.target.clone().sub(camera.position).setY(0).normalize(); const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const v = fwd.multiplyScalar(fz).add(right.multiplyScalar(fx)).normalize().multiplyScalar(dt * Math.max(40, camera.position.distanceTo(controls.target) * 0.8));
    controls.target.add(v); camera.position.add(v);
  };
  const clampPan = () => { const t = controls.target; const [x, z] = clampMapTarget(t.x, t.z); if (x !== t.x || z !== t.z) { const dx = x - t.x, dz = z - t.z; t.x = x; t.z = z; camera.position.x += dx; camera.position.z += dz; } };

  scene.add(new THREE.HemisphereLight(0x7a8cff, 0x2a4a30, 1.3));
  const moon = new THREE.DirectionalLight(0xaabbff, 1.1); moon.position.set(-30, 60, 20); scene.add(moon);
  const glowTex = glowTexture();
  const disposables: { dispose(): void }[] = [glowTex];
  const mat = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(o); disposables.push(m); return m; };
  const geo = <T extends THREE.BufferGeometry>(g: T) => { disposables.push(g); return g; };

  // Plate: grass slab with dirt edge, water strip along the front. Layout lives in worldLayout.ts.
  const S = PLATE;
  const slab = new THREE.Mesh(geo(new THREE.BoxGeometry(S * 2, 3, S * 2)), [mat({ color: 0x4a3322 }), mat({ color: 0x4a3322 }), mat({ color: 0x3f9a45, roughness: 1, emissive: 0x0f3a14, emissiveIntensity: 0.6 }), mat({ color: 0x2a1c12 }), mat({ color: 0x4a3322 }), mat({ color: 0x4a3322 })]);
  slab.position.y = -1.5; scene.add(slab);
  // Animated water: scrolling ripples + moonlight glints, fogged like the rest of the scene.
  const waterMat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `varying vec2 vP; #include <fog_pars_vertex>
      void main() { vP = (modelMatrix * vec4(position, 1.0)).xz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(/#include <[^>]+>/g, (m) => `\n${m}\n`),
    fragmentShader: `uniform float uTime; varying vec2 vP; #include <fog_pars_fragment>
      void main() {
        float w = sin(vP.x * 0.55 + uTime * 0.9) * 0.5 + sin(vP.x * 1.3 - vP.y * 0.8 + uTime * 1.6) * 0.3 + sin(vP.y * 2.1 + uTime * 1.1) * 0.2;
        vec3 deep = vec3(0.02, 0.06, 0.16), shallow = vec3(0.05, 0.16, 0.34);
        vec3 c = mix(deep, shallow, w * 0.5 + 0.5);
        float glint = pow(max(0.0, sin(vP.x * 2.7 + uTime * 2.3) * sin(vP.y * 3.1 - uTime * 1.7)), 40.0);
        gl_FragColor = vec4(c + glint * vec3(0.35, 0.42, 0.55), 1.0);
        #include <fog_fragment>
      }`.replace(/#include <[^>]+>/g, (m) => `\n${m}\n`),
  });
  disposables.push(waterMat);
  waterMat.side = THREE.DoubleSide;
  // Waterfront: the shoreline curves (worldLayout.shoreZ); water fills from the shore to the plate's south edge.
  { const sh = new THREE.Shape(); sh.moveTo(-S - 0.1, S + 0.1); for (let x = -S - 0.1; x <= S + 0.1; x += 2) sh.lineTo(x, shoreZ(x)); sh.lineTo(S + 0.1, S + 0.1); sh.closePath();
    const wg = new THREE.ShapeGeometry(sh); wg.rotateX(Math.PI / 2); const water = new THREE.Mesh(geo(wg), waterMat); water.position.y = 0.06; scene.add(water);
    // sandy bank along the shore
    const bank: number[] = []; const bi: number[] = []; let k = 0; for (let x = -S; x <= S; x += 2, k++) { const z = shoreZ(x); bank.push(x, 0.03, z - 1.6, x, 0.03, z + 0.4); if (k) { const o = (k - 1) * 2; bi.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); } }
    const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.Float32BufferAttribute(bank, 3)); bgeo.setIndex(bi); bgeo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo(bgeo), mat({ color: 0xb8a27a, roughness: 1, side: THREE.DoubleSide }))); }
  // Roads: ONE merged mesh at ONE height: ribbons along each curved centreline + filled junction caps + cul-de-sac circles.
  // Overlaps are the same surface (no per-road height steps to z-fight); polygonOffset keeps it above the grass at every zoom.
  const ROAD_Y = 0.08;
  const roadMat = mat({ color: 0x23252c, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  { const pos: number[] = []; const idx: number[] = []; let base = 0; const y = ROAD_Y;
    const disc = (cx: number, cz: number, r: number) => { const c0 = base; pos.push(cx, y, cz); for (let j = 0; j <= 24; j++) { const a = j / 24 * Math.PI * 2; pos.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); if (j) idx.push(c0, c0 + j, c0 + j + 1); } base += 26; };
    ROADS.forEach((rd) => { const p = rd.closed ? [...rd.pts, rd.pts[0], rd.pts[1]] : rd.pts; const hw = rd.width / 2;
      for (let i = 0; i < p.length; i++) { const a0 = p[Math.max(0, i - 1)], a1 = p[Math.min(p.length - 1, i + 1)]; const ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]); const nx = -Math.sin(ang) * hw, nz = Math.cos(ang) * hw;
        pos.push(p[i][0] + nx, y, p[i][1] + nz, p[i][0] - nx, y, p[i][1] - nz); if (i) { const o = base + (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); } }
      base += p.length * 2; });
    for (const j of JUNCTIONS) disc(j.x, j.z, j.r);
    for (const [cx, cz] of CUL_ENDS) disc(cx, cz, CUL_R);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setIndex(idx); rg.computeVertexNormals();
    const roadMesh = new THREE.Mesh(geo(rg), roadMat); roadMesh.renderOrder = 1; scene.add(roadMesh); }
  // Lane dashes: flat, a layer above the asphalt (own polygonOffset), and not painted across junctions.
  const dashSpots: [number, number, number][] = [];
  const inJunction = (x: number, z: number) => JUNCTIONS.some((j) => Math.hypot(j.x - x, j.z - z) < j.r + 0.6);
  for (const rd of ROADS) { if (rd.kind === 'street' || rd.kind === 'lane') continue; const p = rd.pts; for (let i = 1; i < p.length - 1; i += 3) if (!inJunction(p[i][0], p[i][1])) dashSpots.push([p[i][0], p[i][1], Math.atan2(p[i + 1][1] - p[i - 1][1], p[i + 1][0] - p[i - 1][0])]); }
  const dash = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1.2, 0.02, 0.18)), mat({ color: 0xffe08a, emissive: 0xffd060, emissiveIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), dashSpots.length);
  { const d = new THREE.Object3D(); dashSpots.forEach(([x, z, a], i) => { d.position.set(x, ROAD_Y + 0.03, z); d.rotation.set(0, -a, 0); d.updateMatrix(); dash.setMatrixAt(i, d.matrix); }); }
  dash.renderOrder = 2; scene.add(dash);

  // Landmarks.
  type LM = { id: string; root: THREE.Group; hit: THREE.Object3D[]; emissive: THREE.MeshStandardMaterial[]; sign: THREE.Sprite; pos: THREE.Vector3; height: number };
  const lms: LM[] = [];
  const pickables: THREE.Object3D[] = [];
  const lmIds = [...LANDMARK_IDS, ...WORLD_SPOTS.map((sp) => sp.id).filter((id) => !LANDMARK_IDS.includes(id))];
  const lmBoxes = landmarks(lmIds);
  const box = (w: number, hgt: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo(new THREE.BoxGeometry(w, hgt, d)), m); o.position.set(x, y + hgt / 2, z); return o; };
  const cyl = (rt: number, rb: number, hgt: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 10) => { const o = new THREE.Mesh(geo(new THREE.CylinderGeometry(rt, rb, hgt, seg)), m); o.position.set(x, y + hgt / 2, z); return o; };

  for (const spot of WORLD_SPOTS) {
    const lb = lmBoxes[spot.id]; if (!lb) continue;
    const g = new THREE.Group(); g.position.set(lb.x, 0, lb.z); g.rotation.y = lb.rot; // pad turned to face its street
    const hex = '#' + spot.color.toString(16).padStart(6, '0');
    const neon = mat({ color: spot.color, emissive: spot.color, emissiveIntensity: 1.6 * NEON });
    const ems: THREE.MeshStandardMaterial[] = [neon];
    const win = (seed: number) => { const t = windowsTexture(seed, '#ffd27a', '#9fe8ff'); disposables.push(t); const m = mat({ color: 0x9aa3c0, map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.9 * NEON, roughness: 0.6 }); ems.push(m); return m; };
    const dark = mat({ color: 0x4a5070, roughness: 0.7 });
    const pad = box(12, 0.15, 12, mat({ color: 0x55596a })); g.add(pad);
    let height = 8;
    switch (spot.id) {
      case 'casino': {
        g.add(box(11, 6, 8, win(3)), box(11.6, 0.6, 8.6, neon, 0, 6), cyl(2.6, 3.2, 9, win(5), 0, 6.6, 0, 12));
        const dome = new THREE.Mesh(geo(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), neon); dome.position.y = 15.6; g.add(dome);
        g.add(box(6, 0.3, 2.5, neon, 0, 2.6, 4.6)); height = 19; break; }
      case 'chess': {
        // Checkerboard plaza so the Chess Club reads at a glance.
        { const c = document.createElement('canvas'); c.width = c.height = 128; const x2 = c.getContext('2d')!; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x2.fillStyle = (i + j) % 2 ? '#2b2f3a' : '#e9e2cc'; x2.fillRect(i * 16, j * 16, 16, 16); }
          const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; disposables.push(t);
          g.add(box(11.4, 0.18, 11.4, mat({ color: 0xffffff, map: t, roughness: 0.5 }))); }
        g.add(box(9, 5, 9, win(11)));
        for (let i = 0; i < 4; i++) { const t = cyl(0.9, 1.1, 8, dark, i % 2 ? 4 : -4, 0, i < 2 ? 4 : -4, 8); g.add(t); g.add(cyl(1.3, 0.2, 1.4, neon, t.position.x, 8, t.position.z, 8)); }
        const ivory = mat({ color: 0xf1ead6, emissive: 0xf1ead6, emissiveIntensity: 0.25 * NEON }); ems.push(ivory);
        g.add(cyl(2.4, 2.8, 0.8, ivory, 0, 5, 0, 16), cyl(1.2, 2, 4.2, ivory, 0, 5.8, 0, 16), cyl(1.7, 1.2, 0.7, ivory, 0, 10, 0, 16), box(0.6, 2.4, 0.6, neon, 0, 10.7, 0), box(1.8, 0.6, 0.6, neon, 0, 11.6, 0)); height = 14; break; }
      case 'mine': case 'mine-frost': case 'mine-magma': {
        const hillC = spot.id === 'mine-frost' ? 0xd8ecf8 : spot.id === 'mine-magma' ? 0x3a2622 : 0x6b5a48;
        const hill = new THREE.Mesh(geo(new THREE.ConeGeometry(6.5, 7, 7)), mat({ color: hillC, flatShading: true, ...(spot.id === 'mine-magma' ? { emissive: 0xff4a00, emissiveIntensity: 0.12 } : {}) }));
        if (spot.id === 'mine-magma') { const lava = cyl(1.2, 0.6, 0.6, mat({ color: 0xff6a20, emissive: 0xff4a00, emissiveIntensity: 1.4 * NEON }), 0, 6.6, 0, 8); g.add(lava); }
        if (spot.id === 'mine-frost') for (let i = 0; i < 5; i++) { const a = i * 1.3; const ic = new THREE.Mesh(geo(new THREE.ConeGeometry(0.5, 2.6, 5)), mat({ color: 0xbfe8ff, emissive: 0x5ab8ff, emissiveIntensity: 0.6 * NEON })); ic.position.set(Math.cos(a) * 4.2, 1.3, Math.sin(a) * 4.2 - 1); g.add(ic); } hill.position.y = 3.5; g.add(hill);
        const tun = box(3, 3, 2, mat({ color: 0x0a0806 }), 0, 0, 5.4); g.add(tun, box(3.8, 0.5, 2.2, neon, 0, 3, 5.4));
        g.add(box(0.4, 6, 0.4, dark, -3, 0, 5.6), box(0.4, 6, 0.4, dark, 3, 0, 5.6), box(6.8, 0.4, 0.4, dark, 0, 6, 5.6));
        const cart = box(1.6, 1, 1, mat({ color: 0x8a5a2b }), 4, 0.2, 3); g.add(cart, box(1.2, 0.5, 0.7, mat({ color: 0xffb347, emissive: 0xff8a00, emissiveIntensity: 0.8 * NEON }), 4, 1.2, 3)); height = 9; break; }
      case 'arena': {
        g.add(cyl(6, 6.4, 4, win(21), 0, 0, 0, 20));
        const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(6.1, 0.35, 6, 28)), neon); ring.rotation.x = Math.PI / 2; ring.position.y = 4.2; g.add(ring);
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.add(box(0.5, 9, 0.5, dark, Math.cos(a) * 6.6, 0, Math.sin(a) * 6.6), box(1.4, 0.6, 1.4, mat({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 * NEON }), Math.cos(a) * 6.6, 9, Math.sin(a) * 6.6)); }
        height = 11; break; }
      case 'factory': {
        g.add(box(10, 5, 7, win(31)));
        for (let i = 0; i < 3; i++) g.add(box(3.3, 1.6, 7, dark, -3.3 + i * 3.3, 5, 0));
        g.add(cyl(0.9, 1.1, 10, mat({ color: 0x7a3b2e }), 3.5, 0, -2, 10), box(2, 0.5, 2, neon, 3.5, 10, -2)); height = 12; break; }
      case 'warehouse': {
        g.add(box(11, 5, 8, mat({ color: 0x5b6b7a })));
        const roof = new THREE.Mesh(geo(new THREE.CylinderGeometry(4, 4, 11, 12, 1, false, 0, Math.PI)), mat({ color: 0x8395a6 })); roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2; roof.position.y = 5; g.add(roof);
        g.add(box(4, 3, 0.2, neon, 0, 0, 4.05));
        for (let i = 0; i < 3; i++) g.add(box(1.4, 1.4, 1.4, mat({ color: 0xb08350 }), -4.5 + i * 1.6, 0, 5.2)); height = 10; break; }
      case 'bank': {
        g.add(box(10, 1, 8, mat({ color: 0xd8d2c0 })), box(8.8, 5, 6.5, mat({ color: 0xe8e2d0 }), 0, 1));
        for (let i = 0; i < 5; i++) g.add(cyl(0.4, 0.45, 5, mat({ color: 0xffffff }), -3.6 + i * 1.8, 1, 3.7, 8));
        const ped = new THREE.Mesh(geo(new THREE.ConeGeometry(6.4, 2.2, 4)), mat({ color: 0xd8d2c0, flatShading: true })); ped.rotation.y = Math.PI / 4; ped.scale.z = 0.7; ped.position.y = 7.1; g.add(ped);
        g.add(box(9, 0.3, 0.3, neon, 0, 6, 4)); height = 10; break; }
      case 'market': {
        const cols = [0xff5a5a, 0x5affc8, 0xffd35a, 0x8a7aff];
        for (let i = 0; i < 4; i++) { const sx = (i % 2 ? 3 : -3), sz = (i < 2 ? 2.6 : -2.6);
          g.add(box(4, 2.4, 3.4, mat({ color: 0x705038 }), sx, 0, sz));
          const aw = new THREE.Mesh(geo(new THREE.ConeGeometry(3.3, 1.6, 4)), mat({ color: cols[i], emissive: cols[i], emissiveIntensity: 0.4 * NEON })); aw.rotation.y = Math.PI / 4; aw.position.set(sx, 3.2, sz); g.add(aw); }
        g.add(cyl(0.3, 0.3, 7, dark, 0, 0, 0, 6), box(2.4, 0.5, 0.5, neon, 0, 7, 0)); height = 9; break; }
      case 'dealer': {
        // Car Dealership: glass showroom, forecourt with three display cars, pylon sign.
        g.add(box(9, 0.3, 6, mat({ color: 0x2b2f3a }), 0, 0, -2.4), box(9, 4.2, 0.3, mat({ color: 0x9fd4ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.4 }), 0, 0.3, 0.6));
        g.add(box(9, 4.2, 0.4, win(61), 0, 0.3, -5.2), box(0.4, 4.2, 6, dark, -4.4, 0.3, -2.4), box(0.4, 4.2, 6, dark, 4.4, 0.3, -2.4), box(9.6, 0.5, 6.6, neon, 0, 4.5, -2.4));
        g.add(cyl(0.25, 0.25, 9, dark, 5.2, 0, 4.8, 6), box(0.4, 2, 2.6, neon, 5.2, 7.4, 4.8));
        ([['chudmobile', 0xff7a1a, -3, 3.4], ['thunderhorse', 0xc8102e, 0, 3.6], ['hypervolt', 0xf2f4f7, 3, 3.4], ['phantom', 0x111111, 0, -2.4]] as const).forEach(([id, col, x, z]) => { const c = buildCar(CAR_BY_ID.get(id)!, col, 'far'); c.position.set(x, 0.15, z); c.rotation.y = Math.PI / 2 + (x ? 0.5 * Math.sign(x) : 0); c.scale.setScalar(0.8); g.add(c); });
        height = 10; break; }
      case 'airport': {
        // Terminal: long glass hall, control tower with a lit cab and rotating beacon, jet bridge onto the apron.
        g.add(box(11, 3.6, 6, win(71), 0, 0, 1.5), box(11.6, 0.4, 6.6, dark, 0, 3.6, 1.5), box(11.4, 0.25, 6.4, neon, 0, 4, 1.5));
        g.add(cyl(1, 1.3, 13, dark, -3.5, 0, -3.5, 10), cyl(2.2, 1.6, 2.2, mat({ color: 0x9fd4ff, emissive: 0x4aa0ff, emissiveIntensity: 0.7 * NEON, transparent: true, opacity: 0.8 }), -3.5, 13, -3.5, 10), cyl(2.4, 2.4, 0.3, neon, -3.5, 15.2, -3.5, 10));
        g.add(box(5, 1.6, 1.4, mat({ color: 0xb8bcc4 }), -7.5, 1.4, -2.5));
        height = 17; break; }
      case 'dock': {
        // Fishing Dock: a timber boathouse with a bait-shop sign, and a plank pier out over the lake (world -z).
        const wood = mat({ color: 0x8a6440, roughness: 0.9 }), plank = mat({ color: 0xa47a4c, roughness: 0.95 }), post = mat({ color: 0x5a4028, roughness: 1 });
        g.add(box(8, 3.6, 6, wood, 0, 0.15, 1), box(0.2, 1.6, 2.6, mat({ color: 0x2a2018 }), 0, 0.15, 4.05));
        const roof = new THREE.Mesh(geo(new THREE.ConeGeometry(6.2, 2.4, 4)), mat({ color: 0x8c3b2e, flatShading: true })); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.78); roof.position.set(0, 4.95, 1); g.add(roof);
        g.add(box(3.4, 1, 0.2, neon, 0, 2.8, 4.1), box(1.6, 0.9, 1, mat({ color: 0x3fa7d6 }), 3, 0.15, -3), box(1.6, 0.9, 1, mat({ color: 0xd8dde8 }), 3, 1.05, -3));
        const P0 = -4.5, P1 = -22; // pier from the pad edge out over the water
        g.add(box(3, 0.25, -P1 + P0, plank, 0, 0.35, (P0 + P1) / 2));
        for (let z = P0 - 1; z >= P1; z -= 3) for (const x of [-1.4, 1.4]) g.add(cyl(0.16, 0.16, 1.6, post, x, -0.9, z, 6));
        g.add(box(6, 0.25, 3, plank, 0, 0.35, P1 + 1.5));
        g.add(cyl(0.08, 0.08, 2.6, dark, 2.7, 0.6, P1 + 0.4, 6), box(0.5, 0.35, 0.5, mat({ color: 0xffe2a0, emissive: 0xffc060, emissiveIntensity: 1.2 * NEON }), 2.7, 3.2, P1 + 0.4));
        const boat = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.9, 0.6, 4.2, 8, 1, false, 0, Math.PI)), mat({ color: 0xe8e2d0, side: THREE.DoubleSide })); boat.rotation.set(Math.PI / 2, 0, Math.PI); boat.scale.set(1, 1, 0.6); boat.position.set(-3, 0.45, -12); g.add(boat);
        height = 8; break; }
      case 'racetrack': {
        // Grandstand in the infield: stepped seating under a cantilevered roof, timing tower with a lap board.
        for (let i = 0; i < 4; i++) g.add(box(10, 0.8 + i * 0.8, 1.4, mat({ color: i % 2 ? 0x6a7090 : 0x8088a8 }), 0, 0, 2.6 - i * 1.4));
        g.add(box(10.6, 0.3, 6.2, mat({ color: 0xd8dde8 }), 0, 5.2, 0.6), cyl(0.2, 0.2, 5.2, dark, -5, 0, -2, 6), cyl(0.2, 0.2, 5.2, dark, 5, 0, -2, 6));
        g.add(box(1.8, 9, 1.8, dark, -4.8, 0, 4.6), box(2.4, 1.6, 0.3, neon, -4.8, 7.4, 3.6));
        height = 10; break; }
      case 'stocks': {
        // Stock Exchange: columned hall with a scrolling green ticker band and a bull on the steps.
        g.add(box(10, 1, 8, mat({ color: 0xcfd6dc })), box(9, 6, 6.6, win(51), 0, 1), box(9.6, 0.5, 7.2, mat({ color: 0xcfd6dc }), 0, 7));
        for (let i = 0; i < 6; i++) g.add(cyl(0.35, 0.4, 6, mat({ color: 0xffffff }), -3.75 + i * 1.5, 1, 3.8, 8));
        g.add(box(9.2, 0.8, 0.2, mat({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 1.6 * NEON }), 0, 7.6, 3.65));
        for (let i = 0; i < 5; i++) g.add(box(0.8, 1 + i * 0.8, 0.8, neon, -2 + i, 8, 0));
        g.add(box(1.6, 0.9, 0.7, mat({ color: 0x6b4a2b }), 3.6, 0, 5.2)); height = 13; break; }
      case 'leaderboard': {
        // The CHUD HUB tower: tallest thing on the map.
        g.add(box(6, 26, 6, win(41)), box(6.4, 0.5, 6.4, neon, 0, 26), box(4.4, 4, 4.4, win(43), 0, 26.5), box(0.3, 6, 0.3, dark, 0, 30.5));
        const blink = box(0.8, 0.8, 0.8, mat({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 * NEON }), 0, 36.5); g.add(blink); (g.userData as { blink?: THREE.Object3D }).blink = blink;
        const face = new THREE.Mesh(geo(new THREE.PlaneGeometry(5.6, 2.2)), (() => { const t = signTexture('CHUD HUB', '#e8c26a'); disposables.push(t); const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }); disposables.push(m); return m; })());
        face.position.set(0, 22, 3.05); g.add(face); const f2 = face.clone(); f2.rotation.y = Math.PI / 2; f2.position.set(3.05, 22, 0); g.add(f2);
        height = 38; break; }
      case 'chat': {
        g.add(cyl(4, 4.4, 0.4, mat({ color: 0x9aa0aa }), 0, 0, 0, 20));
        const fw = cyl(1.4, 2, 1.2, mat({ color: 0x3fa0ff, emissive: 0x2070ff, emissiveIntensity: 1.2 * NEON }), 0, 0.4, 0, 14); g.add(fw, cyl(0.25, 0.25, 3, neon, 0, 1.6, 0, 8));
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(box(1.6, 0.4, 0.5, mat({ color: 0x8a5a2b }), Math.cos(a) * 5.4, 0.3, Math.sin(a) * 5.4)); }
        height = 7; break; }
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.spot = spot.id; pickables.push(o); } });
    const st = signTexture(`${spot.icon} ${spot.label}`, hex); disposables.push(st);
    const sm = new THREE.SpriteMaterial({ map: st, transparent: true, toneMapped: false, depthWrite: false }); disposables.push(sm);
    const sign = new THREE.Sprite(sm); sign.scale.set(8, 2, 1); sign.userData.base = 8; sign.position.set(0, height + 2.2, 0); sign.userData.spot = spot.id; g.add(sign); pickables.push(sign);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: spot.color, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(16, 16, 1); halo.position.y = 0.6; g.add(halo);
    scene.add(g);
    lms.push({ id: spot.id, root: g, hit: [], emissive: ems, sign, pos: g.position.clone(), height });
  }

  // Filler: housing along every street's frontage (turned to face it), plus parks, plazas and lots (worldLayout.cityFill).
  // Housing is data-driven (housing.ts): one instanced body (+ instanced gable roof) per type, tinted per instance.
  const r = rng(7);
  const { houses: cityHouses, patches } = cityFill(7, lmIds); const fillers = [...cityHouses, ...countryHomes()];
  const roofGeo = (() => { const sh = new THREE.Shape(); sh.moveTo(-0.5, 0); sh.lineTo(0.5, 0); sh.lineTo(0, 1); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); g.rotateY(Math.PI / 2); return geo(g); })();
  const unitBox = geo(new THREE.BoxGeometry(1, 1, 1));
  const housingMeshes: Record<string, THREE.InstancedMesh> = {};
  const propTop = new Map<string, [number, number, number]>();
  HOUSING_TYPES.forEach((ht, ti) => {
    const list = fillers.filter((f) => f.type === ht.id); if (!list.length) return;
    const [map, em] = housingTextures(200 + ti, ht); disposables.push(map, em);
    const body = new THREE.InstancedMesh(unitBox, mat({ color: 0xffffff, map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.9 * NEON, roughness: 0.9 }), list.length);
    const roof = ht.roof === 'gable' ? new THREE.InstancedMesh(roofGeo, mat({ color: 0xffffff, roughness: 0.8, flatShading: true }), list.length) : null;
    const d = new THREE.Object3D(); const c = new THREE.Color();
    list.forEach((f, i) => {
      d.position.set(f.x, f.h / 2, f.z); d.scale.set(f.w, f.h, f.d); d.rotation.set(0, f.rot, 0); d.updateMatrix(); body.setMatrixAt(i, d.matrix); body.setColorAt(i, c.setHex(f.color));
      if (roof) { d.position.set(f.x, f.h, f.z); d.scale.set(f.w + 0.2, Math.min(1.6, f.d * 0.45), f.d + 0.3); d.updateMatrix(); roof.setMatrixAt(i, d.matrix); roof.setColorAt(i, c.setHex([0x6a2e2a, 0x3a3f4a, 0x5a4636, 0x2f4a3a][i % 4])); }
    });
    body.userData.housingType = ht.id; housingMeshes[ht.id] = body; scene.add(body); if (roof) scene.add(roof);
    // Real estate: every building is a property (stable id from type + position, matches shared/realEstate).
    body.userData.props = list.map((f) => buildingId(ht.id, f)); pickables.push(body); if (roof) { roof.userData.props = body.userData.props; pickables.push(roof); }
    list.forEach((f, i) => propTop.set(body.userData.props[i], [f.x, f.h + (roof ? Math.min(1.6, f.d * 0.45) : 0), f.z]));
  });
  // Open-space patches: parks (grass), plazas (paving + fountain glow), lots (dirt) — one instanced slab, tinted, rotated.
  if (patches.length) {
    const gm = new THREE.InstancedMesh(unitBox, mat({ color: 0xffffff, roughness: 1 }), patches.length); const d = new THREE.Object3D(); const c = new THREE.Color();
    patches.forEach((b, i) => { d.position.set(b.x, 0.04, b.z); d.scale.set(b.w, 0.08, b.d); d.rotation.set(0, b.rot, 0); d.updateMatrix(); gm.setMatrixAt(i, d.matrix); gm.setColorAt(i, c.setHex(b.kind === 'park' ? 0x2e7a36 : b.kind === 'plaza' ? 0x77727a : 0x4a3a2c)); });
    scene.add(gm); gm.userData.props = patches.map((b) => patchId(b.kind, b)); pickables.push(gm);
    patches.forEach((b, i) => propTop.set(gm.userData.props[i], [b.x, 0.1, b.z]));
    const plazas = patches.filter((b) => b.kind === 'plaza');
    if (plazas.length) { const fm = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(2.2, 2.4, 0.6, 16)), mat({ color: 0x4aa8ff, emissive: 0x2a78ff, emissiveIntensity: 0.8 * NEON }), plazas.length);
      plazas.forEach((b, i) => { d.position.set(b.x, 0.3, b.z); d.scale.set(1, 1, 1); d.rotation.set(0, 0, 0); d.updateMatrix(); fm.setMatrixAt(i, d.matrix); }); scene.add(fm); }
  }
  const solids = [...Object.values(lmBoxes), ...fillers];
  const blocked = (x: number, z: number, m: number) => obbHit(PARK_AREA, x, z, m) || solids.some((o) => Math.abs(o.x - x) < 12 && Math.abs(o.z - z) < 12 && obbHit(o, x, z, m));
  // Trees + palms (instanced).
  const treeSpots: [number, number, number][] = [];
  for (const b of patches) if (b.kind === 'park') { const c = Math.cos(b.rot), sn = Math.sin(b.rot); for (let i = 0; i < 9; i++) { const u = (r() - 0.5) * (b.w - 2), v = (r() - 0.5) * (b.d - 2); treeSpots.push([b.x + u * c + v * sn, b.z - u * sn + v * c, 0.8 + r() * 0.7]); } }
  for (let i = 0; i < 700; i++) { const x = (r() - 0.5) * S * 2 * 0.96, z = (r() - 0.5) * S * 2 * 0.96; if (z > shoreZ(x) - 2) continue; if (roadClearance(x, z) < 1.4) continue; if (blocked(x, z, 1)) continue; treeSpots.push([x, z, 0.7 + r() * 0.6]); }
  // palms along the curving waterfront
  for (let x = -S + 3; x < S - 2; x += 4.4) { const z = shoreZ(x) - 1.4; if (roadClearance(x, z) > 1.4 && !blocked(x, z, 0.8)) treeSpots.push([x, z, -1]); }
  const trunk = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.15, 0.22, 1, 5)), mat({ color: 0x5a3a22 }), treeSpots.length);
  const crown = new THREE.InstancedMesh(geo(new THREE.IcosahedronGeometry(1, 0)), mat({ color: 0x2f8a3a, flatShading: true, emissive: 0x0a2a10, emissiveIntensity: 0.4 }), treeSpots.length);
  { const d = new THREE.Object3D(); treeSpots.forEach(([x, z, s], i) => {
    const palm = s < 0; const sc = palm ? 1 : s; const th = palm ? 3.6 : 1.4 * sc;
    d.position.set(x, th / 2, z); d.scale.set(sc, th, sc); d.rotation.set(0, 0, palm ? 0.08 : 0); d.updateMatrix(); trunk.setMatrixAt(i, d.matrix);
    d.position.set(x, th + (palm ? 0.2 : 0.7 * sc), z); d.scale.set(palm ? 1.6 : sc * 1.1, palm ? 0.45 : sc * 1.3, palm ? 1.6 : sc * 1.1); d.rotation.set(0, i, 0); d.updateMatrix(); crown.setMatrixAt(i, d.matrix); }); }
  scene.add(trunk, crown);
  // Streetlights along roads (instanced pole + glow sprites as one Points).
  const lightPos: number[] = [];
  for (const rd of ROADS) { if (rd.kind === 'lane') continue; const p = rd.pts; const off = rd.width / 2 + 0.8;
    for (let i = 4, k = 0; i < p.length - 1; i += 11, k++) { const a = Math.atan2(p[i + 1][1] - p[i - 1][1], p[i + 1][0] - p[i - 1][0]); const sd = k % 2 ? 1 : -1; const x = p[i][0] - Math.sin(a) * off * sd, z = p[i][1] + Math.cos(a) * off * sd;
      if (roadClearance(x, z) > 0.3 && !blocked(x, z, 0.3)) lightPos.push(x, 0, z); } }
  const nL = lightPos.length / 3;
  const pole = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 4)), mat({ color: 0x40444f }), nL);
  { const d = new THREE.Object3D(); for (let i = 0; i < nL; i++) { d.position.set(lightPos[i * 3], 1.2, lightPos[i * 3 + 2]); d.updateMatrix(); pole.setMatrixAt(i, d.matrix); } }
  scene.add(pole);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lightPos.map((v, i) => (i % 3 === 1 ? 2.5 : v)), 3)); disposables.push(lg);
  const lpm = new THREE.PointsMaterial({ map: glowTex, color: 0xffd27a, size: 2.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); disposables.push(lpm);
  scene.add(new THREE.Points(lg, lpm));

  // Cars: each follows a curved road's centreline in its own lane (see worldLayout.ts + tests/world-layout.test.ts).
  const NC = CAR_COUNT;
  const carBody = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1.6, 0.6, 0.9)), mat({ color: 0xffffff, roughness: 0.4, metalness: 0.4 }), NC);
  const carCols = [0xe63946, 0xf1faee, 0x1d9bf0, 0xffb703, 0x8338ec, 0x2a9d8f];
  for (let i = 0; i < NC; i++) carBody.setColorAt(i, new THREE.Color(carCols[i % carCols.length]));
  const headG = new THREE.BufferGeometry(); headG.setAttribute('position', new THREE.Float32BufferAttribute(new Array(NC * 6).fill(0), 3)); disposables.push(headG);
  const headM = new THREE.PointsMaterial({ map: glowTex, color: 0xfff2c0, size: 1.3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); disposables.push(headM);
  const heads = new THREE.Points(headG, headM);
  scene.add(carBody, heads);
  const cars = Array.from({ length: NC }, (_, i) => { const route = CAR_ROUTES[i % CAR_ROUTES.length]; return { route, t: r(), sp: (6 + r() * 3) / (route.len * (route.road.closed ? 1 : 2)), lane: LANE }; });

  // Fireworks: one pooled Points burst system.
  const FP = 160; const fwPos = new Float32Array(FP * 3); const fwVel = new Float32Array(FP * 3); const fwCol = new Float32Array(FP * 3);
  const fwG = new THREE.BufferGeometry(); fwG.setAttribute('position', new THREE.BufferAttribute(fwPos, 3)); fwG.setAttribute('color', new THREE.BufferAttribute(fwCol, 3)); disposables.push(fwG);
  const fwM = new THREE.PointsMaterial({ map: glowTex, size: 1.1, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }); disposables.push(fwM);
  scene.add(new THREE.Points(fwG, fwM));
  let fwAge = 99; let nextFw = 2;
  const burst = () => {
    const cx = (r() - 0.5) * 130, cy = 34 + r() * 14, cz = (r() - 0.5) * 110; const c = new THREE.Color().setHSL(r(), 1, 0.6);
    for (let i = 0; i < FP; i++) { fwPos.set([cx, cy, cz], i * 3); const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), v = 5 + r() * 3; fwVel.set([s * Math.cos(a) * v, u * v, s * Math.sin(a) * v], i * 3); fwCol.set([c.r, c.g, c.b], i * 3); }
    fwG.attributes.color.needsUpdate = true; fwAge = 0;
  };

  // Trailer Park (north-west edge): gravel lanes, an entrance sign, and one trailer per player (lots come from /api/trailer-park).
  const gravelMat = mat({ color: 0x8a8276, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const gravel: THREE.Mesh[] = [];
  const laneMesh = (a: [number, number], b: [number, number]) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const m = new THREE.Mesh(geo(new THREE.BoxGeometry(L, 0.04, 4.2)), gravelMat);
    m.position.set((a[0] + b[0]) / 2, 0.05, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); scene.add(m); gravel.push(m); };
  { const sg = new THREE.Group(); const post = mat({ color: 0x5a4a3a }); const panel = signTexture('TRAILER PARK', '#ffb36b', 'Chud Acres'); disposables.push(panel);
    const pm = mat({ color: 0xffffff, map: panel, emissiveMap: panel, emissive: 0xffffff, emissiveIntensity: 0.45 * NEON });
    sg.add(box(0.3, 4, 0.3, post, -2.6, 0, 0), box(0.3, 4, 0.3, post, 2.6, 0, 0)); const pan = new THREE.Mesh(geo(new THREE.BoxGeometry(6, 1.8, 0.2)), pm); pan.position.set(0, 3.6, 0); sg.add(pan);
    sg.position.set(PARK_SIGN[0], 0, PARK_SIGN[1]); sg.rotation.y = 0; scene.add(sg); }
  const TRAILER_TYPES = [
    { len: 1, h: 2.6, body: 0xd9d4c7, trim: 0x4fb3a9 }, // classic white single-wide
    { len: 0.86, h: 2.4, body: 0xc9a36a, trim: 0xe0663f }, // tan with orange stripe
    { len: 1, h: 2.8, body: 0x9fb4c8, trim: 0xf2c94c }, // blue-grey with yellow porch light
  ];
  let trailerMeshes: THREE.InstancedMesh[] = [];
  const addTrailers = (lots: { lot: number; name: string }[]) => {
    const n = lots.reduce((m, l) => Math.max(m, l.lot + 1), 0); if (!n) return;
    const layout = parkLayout(n, solids); for (const ln of layout.lanes) laneMesh(ln[0], ln[1]);
    const unit = geo(new THREE.BoxGeometry(1, 1, 1));
    TRAILER_TYPES.forEach((t, ti) => {
      const mine = lots.filter((l) => layout.lots[l.lot] && l.lot % TRAILER_TYPES.length === ti); if (!mine.length) return;
      const body = new THREE.InstancedMesh(unit, mat({ color: t.body, roughness: 0.8, emissive: t.body, emissiveIntensity: 0.06 }), mine.length);
      const trim = new THREE.InstancedMesh(unit, mat({ color: t.trim, emissive: t.trim, emissiveIntensity: 0.55 * NEON }), mine.length);
      const d = new THREE.Object3D();
      mine.forEach((l, i) => { const b = layout.lots[l.lot]; const long = b.d >= b.w; const L = (long ? b.d : b.w) * t.len, W = long ? b.w : b.d;
        d.position.set(b.x, t.h / 2 + 0.25, b.z); d.rotation.set(0, 0, 0); d.scale.set(long ? W : L, t.h, long ? L : W); d.updateMatrix(); body.setMatrixAt(i, d.matrix);
        d.position.set(b.x, t.h * 0.62, b.z); d.scale.set((long ? W : L) + 0.06, 0.22, (long ? L : W) + 0.06); d.updateMatrix(); trim.setMatrixAt(i, d.matrix); });
      body.userData.trailers = mine.map((l) => l.name); trim.userData.trailers = body.userData.trailers;
      scene.add(body, trim); pickables.push(body, trim); trailerMeshes.push(body, trim);
    });
  };
  let parkDead = false;
  void fetch('/api/trailer-park').then((r) => r.json()).then((j: { lots?: { lot: number; name: string }[] }) => { if (!parkDead && Array.isArray(j?.lots)) addTrailers(j.lots); }).catch(() => {});
  // Outskirts mines (MINE_SITES): a rocky apron under each one and a dirt haul track back to the city's road end.
  for (const site of Object.values(MINE_SITES)) {
    const top = site.cave === 'frost' ? 0xdfeef7 : site.cave === 'magma' ? 0x3a2a24 : 0x5e5040;
    const side = mat({ color: 0x2a2018 });
    const apron = new THREE.Mesh(geo(new THREE.BoxGeometry(MINE_APRON, 3, MINE_APRON)), [side, side, mat({ color: top, roughness: 1, flatShading: true, emissive: site.cave === 'magma' ? 0x5a1a08 : site.cave === 'frost' ? 0x2a3a4a : 0x3a2c1c, emissiveIntensity: 0.7 }), side, side, side]);
    { const fl = new THREE.PointLight(site.cave === 'frost' ? 0xbfe4ff : site.cave === 'magma' ? 0xff8a40 : 0xffc880, 60, 46, 1.2); fl.position.set(site.x, 14, site.z); scene.add(fl); }
    apron.position.set(site.x, -1.51, site.z); scene.add(apron);
    const dirt = mat({ color: site.cave === 'frost' ? 0x9aa8b4 : 0x6a5038, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const pts = [...site.track, [site.x, site.z] as [number, number]];
    for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i]; const L = Math.hypot(bx - ax, bz - az);
      const seg = new THREE.Mesh(geo(new THREE.BoxGeometry(3.6, 3.04, L + 3.6)), dirt); seg.position.set((ax + bx) / 2, -1.5, (az + bz) / 2); seg.rotation.y = Math.atan2(bx - ax, bz - az); scene.add(seg); }
  }
  // Countryside (shared/outskirts.ts), drawn with the city's own materials: plate grass, asphalt + dashes, city trees,
  // streetlight poles + glow, river water. Country homes are city 'house' instances above (buyable); gas stations and
  // warehouses are buyable too. All instanced (~16 draw calls).
  {
    const O = outskirts(); const d = new THREE.Object3D(); const c = new THREE.Color();
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, n: number, f: (i: number) => void, colors?: (i: number) => number) => { if (!n) return null;
      const im = new THREE.InstancedMesh(g, m, n); for (let i = 0; i < n; i++) { d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); f(i); d.updateMatrix(); im.setMatrixAt(i, d.matrix); if (colors) im.setColorAt(i, c.setHex(colors(i))); }
      scene.add(im); return im; };
    const { x0, x1, z0, z1 } = OUTSKIRTS; const P = PLATE;
    // ground: same grass as the plate, a hair under it and under the farm/mine aprons (strips around the plate: no overlap)
    const strips: Array<[number, number, number, number]> = [[x0, x1, z0, -P], [x0, x1, P, z1], [x0, -P, -P, P], [P, x1, -P, P]];
    const grass = mat({ color: 0x3f9a45, roughness: 1, emissive: 0x0f3a14, emissiveIntensity: 0.6 }); const dirtSide = mat({ color: 0x4a3322 });
    for (const [a0, b0, e, f] of strips) { const m = new THREE.Mesh(geo(new THREE.BoxGeometry(b0 - a0, 3, f - e)), [dirtSide, dirtSide, grass, dirtSide, dirtSide, dirtSide]); m.position.set((a0 + b0) / 2, -1.53, (e + f) / 2); scene.add(m); }
    // rural roads: city asphalt at the city road height, centre dashes
    inst(unitBox, roadMat, RURAL_ROADS.length, (i) => { const [a, b] = RURAL_ROADS[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); d.position.set((a[0] + b[0]) / 2, ROAD_Y - 0.01, (a[1] + b[1]) / 2); d.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]); d.scale.set(RURAL_ROAD_W, 0.02, L + RURAL_ROAD_W); })!.renderOrder = 1;
    const rd: Array<[number, number, number]> = []; for (const [a, b] of RURAL_ROADS) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 4; t < L - 3; t += 4) rd.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L, Math.atan2(b[1] - a[1], b[0] - a[0])]); }
    const dm = new THREE.InstancedMesh(dash.geometry, dash.material, rd.length); rd.forEach(([x, z, an], i) => { d.position.set(x, ROAD_Y + 0.03, z); d.rotation.set(0, -an, 0); d.scale.set(1, 1, 1); d.updateMatrix(); dm.setMatrixAt(i, d.matrix); }); dm.renderOrder = 2; scene.add(dm);
    // fields: farm soil with crop rows (same tones as the farm district)
    inst(unitBox, mat({ color: 0xffffff, roughness: 1 }), O.fields.length, (i) => { const f = O.fields[i]; d.position.set(f.x, 0.07, f.z); d.scale.set(f.w, 0.14, f.d); }, () => 0x5a3e28);
    const rows: Array<[number, number, number, number]> = []; for (const f of O.fields) for (let z = f.z - f.d / 2 + 1.5; z < f.z + f.d / 2 - 1; z += 2) rows.push([f.x, z, f.w - 1.2, f.crop]);
    inst(unitBox, mat({ color: 0xffffff, roughness: 1, emissive: 0x0a2a10, emissiveIntensity: 0.4 }), rows.length, (i) => { const [x, z, w] = rows[i]; d.position.set(x, 0.22, z); d.scale.set(w, 0.16, 0.9); }, (i) => [0x3f8a3a, 0x8a7a3a, 0x2f7a36, 0x6a8a34][rows[i][3]]);
    // barns + sheds (farm-district barn red, dark roofs), warehouses + gas stations (buyable)
    const outb = O.buildings.filter((b) => b.kind === 'barn' || b.kind === 'shed'); const biz = countryBusinesses();
    inst(unitBox, mat({ color: 0xffffff, roughness: 0.85 }), outb.length, (i) => { const b = outb[i]; d.position.set(b.x, b.h / 2, b.z); d.rotation.y = b.rot; d.scale.set(b.w, b.h, b.d); }, (i) => (outb[i].kind === 'barn' ? 0x8a2a22 : 0x6a5a48));
    inst(roofGeo, mat({ color: 0x3a3a40, roughness: 0.8, flatShading: true }), outb.length, (i) => { const b = outb[i]; d.position.set(b.x, b.h, b.z); d.rotation.y = b.rot; d.scale.set(b.w + 0.3, 1.8, b.d + 0.3); });
    const bizM = inst(unitBox, mat({ color: 0xffffff, roughness: 0.8 }), biz.length, (i) => { const b = biz[i]; d.position.set(b.x, b.h / 2, b.z); d.rotation.y = b.rot; d.scale.set(b.w, b.h, b.d); }, (i) => (biz[i].kind === 'gas' ? 0xd8d4cc : 0x5a6270));
    if (bizM) { bizM.userData.props = biz.map((b) => buildingId(businessType(b), b)); pickables.push(bizM); biz.forEach((b, i) => propTop.set(bizM.userData.props[i], [b.x, b.h, b.z])); }
    const front = (b: { x: number; z: number; d: number; rot: number }, o: number): [number, number] => [b.x + Math.sin(b.rot) * (b.d / 2 + o), b.z + Math.cos(b.rot) * (b.d / 2 + o)];
    const lit = [...outb, ...biz];
    inst(unitBox, mat({ color: 0xffd08a, emissive: 0xffb050, emissiveIntensity: 0.7 * NEON }), lit.length, (i) => { const b = lit[i]; const [x, z] = front(b, 0.05); d.rotation.y = b.rot; d.position.set(x, b.h * 0.5, z); d.scale.set(Math.min(3, b.w * 0.4), Math.min(1, b.h * 0.25), 0.08); });
    const gas = biz.filter((b) => b.kind === 'gas');
    inst(unitBox, mat({ color: 0xe8e8ee, emissive: 0xff4d6d, emissiveIntensity: 0.45 * NEON }), gas.length, (i) => { const b = gas[i]; const [x, z] = front(b, 2.2); d.rotation.y = b.rot; d.position.set(x, 3.6, z); d.scale.set(b.w, 0.35, 4.4); });
    inst(unitBox, mat({ color: 0xc8c8d0, emissive: 0x4aa8ff, emissiveIntensity: 0.35 * NEON }), gas.length * 2, (i) => { const b = gas[i >> 1]; const [x, z] = front(b, 2.2); const sd = i % 2 ? 2.5 : -2.5; d.rotation.y = b.rot; d.position.set(x + Math.cos(b.rot) * sd, 0.75, z - Math.sin(b.rot) * sd); d.scale.set(0.7, 1.5, 0.7); });
    inst(geo(new THREE.CylinderGeometry(3, 3, 6, 14)), mat({ color: 0xb8bcc4, roughness: 0.5, metalness: 0.4 }), O.tanks.length, (i) => d.position.set(O.tanks[i][0], 3, O.tanks[i][1]));
    // lake: the river's water shader in a smooth organic outline, ringed by a wet-sand → sand → grass bank that slopes
    // under the waterline (no coplanar faces: bank y < water y, polygonOffset on the bank), reeds, lily pads and rocks.
    { const pts = lakeShape(); const sh = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? sh.lineTo(x - LAKE.x, -(z - LAKE.z)) : sh.moveTo(x - LAKE.x, -(z - LAKE.z)))); sh.closePath();
      const wg = new THREE.ShapeGeometry(sh, 6); wg.rotateX(-Math.PI / 2); const lake = new THREE.Mesh(geo(wg), waterMat); lake.position.set(LAKE.x, 0.07, LAKE.z); lake.renderOrder = 1; scene.add(lake);
      const rings: Array<[number, number, number]> = [[-1.6, 0.0, 0x8e7a58], [0.3, 0.04, 0xc9b48a], [2.2, 0.035, 0xb9a77a], [4, -0.02, 0x4f9e4a]]; // [offset, y, colour]
      const pos: number[] = []; const col: number[] = []; const bi: number[] = []; const n = pts.length; const c = new THREE.Color(); const R = rings.length;
      pts.forEach(([x, z], i) => { const [px0, pz0] = pts[(i + n - 1) % n]!, [px1, pz1] = pts[(i + 1) % n]!; let nx = pz1 - pz0, nz = -(px1 - px0); const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
        if (nx * (x - LAKE.x) + nz * (z - LAKE.z) < 0) { nx = -nx; nz = -nz; }
        for (const [o, y, hx] of rings) { pos.push(x + nx * o, y, z + nz * o); c.setHex(hx); col.push(c.r, c.g, c.b); } });
      for (let i = 0; i < n; i++) for (let r = 0; r < R - 1; r++) { const a = i * R + r, b = ((i + 1) % n) * R + r; bi.push(a, b, a + 1, a + 1, b, b + 1); }
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); bg.setIndex(bi); bg.computeVertexNormals();
      scene.add(new THREE.Mesh(geo(bg), mat({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
      const L = O.lake;
      inst(geo(new THREE.CylinderGeometry(0.05, 0.07, 1, 4)), mat({ color: 0x6f8f3a, roughness: 1 }), L.reeds.length * 3, (i) => { const [x, z, s] = L.reeds[(i / 3) | 0]; const k = i % 3; const h = s * (1.4 + k * 0.35); d.position.set(x + (k - 1) * 0.18, h / 2, z + ((k * 7) % 3 - 1) * 0.15); d.rotation.set(((k - 1) * 0.12), 0, ((i % 5) - 2) * 0.05); d.scale.set(1, h, 1); });
      inst(geo(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 6)), mat({ color: 0x5a3a20, roughness: 1 }), L.reeds.length, (i) => { const [x, z, s] = L.reeds[i]; d.position.set(x, s * 1.75, z + 0.15); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); });
      inst(geo(new THREE.CircleGeometry(1, 9, 0.4, Math.PI * 2 - 0.5)), mat({ color: 0x3f8f3a, roughness: 0.8, side: THREE.DoubleSide }), L.lilies.length * 3, (i) => { const [x, z, s] = L.lilies[(i / 3) | 0]; const k = i % 3; d.position.set(x + Math.cos(k * 2.1) * s * 1.6, 0.09, z + Math.sin(k * 2.1) * s * 1.6); d.rotation.set(-Math.PI / 2, 0, i * 1.7); d.scale.set(s * (0.7 + k * 0.2), s * (0.7 + k * 0.2), 1); });
      inst(geo(new THREE.DodecahedronGeometry(1, 0)), mat({ color: 0x7a7670, roughness: 1, flatShading: true }), L.rocks.length, (i) => { const [x, z, s] = L.rocks[i]; d.position.set(x, s * 0.2, z); d.scale.set(s, s * 0.55, s * 0.8); d.rotation.set(0, i * 2.3, 0); });
      // gravel path from the lake road up to the boathouse
      { const [[x0, z0], [x1, z1]] = DOCK.path; const pth = new THREE.Mesh(geo(new THREE.PlaneGeometry(2.6, Math.abs(z1 - z0) + 0.6)), mat({ color: 0xa89a80, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); pth.rotation.x = -Math.PI / 2; pth.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2); scene.add(pth); } }
    // low rolling hills in the grass colour, rocks near the mines
    inst(geo(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), mat({ color: 0x3f9a45, roughness: 1, flatShading: true, emissive: 0x0f3a14, emissiveIntensity: 0.6 }), O.hills.length, (i) => { const [x, z, r, h] = O.hills[i]; d.position.set(x, -0.05, z); d.scale.set(r, h * 0.6, r * 0.8); d.rotation.y = i; });
    inst(geo(new THREE.DodecahedronGeometry(1, 0)), mat({ color: 0x6a6670, roughness: 1, flatShading: true }), O.rocks.length, (i) => { const [x, z, s] = O.rocks[i]; d.position.set(x, s * 0.3, z); d.scale.set(s, s * 0.6, s); d.rotation.set(0, i * 2, 0); });
    // forest: the city's tree (trunk + low-poly crown, same materials)
    const T = O.trees;
    inst(trunk.geometry, trunk.material, T.length, (i) => { const [x, z, s] = T[i]; d.position.set(x, 0.7 * s, z); d.scale.set(s, 1.4 * s, s); });
    inst(crown.geometry, crown.material, T.length, (i) => { const [x, z, s] = T[i]; d.position.set(x, 2.1 * s, z); d.scale.set(s * 1.1, s * 1.3, s * 1.1); d.rotation.y = i; });
    // road lamps: the city's streetlight pole + glow
    inst(pole.geometry, pole.material, O.lamps.length, (i) => d.position.set(O.lamps[i][0], 1.2, O.lamps[i][1]));
    inst(geo(new THREE.SphereGeometry(0.22, 8, 6)), mat({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 1 }), O.lamps.length, (i) => d.position.set(O.lamps[i][0], 2.45, O.lamps[i][1]));
  }
  // Farm district (shared/farm.ts): a grass apron east of the plate, dirt lanes, fenced fields (farmland properties),
  // barns and silos. Crops on owned plots come from /api/farm (setFarm). Toned-down night palette, a little warm glow.
  const farmTiles = new Map<string, number>(); // plot id -> first index into the crop instanced mesh
  const crops = (() => {
    const apron = new THREE.Mesh(geo(new THREE.BoxGeometry(FARM_X1 - FARM_X0, 3, FARM_Z1 - FARM_Z0)), [mat({ color: 0x3a2a1c }), mat({ color: 0x3a2a1c }), mat({ color: 0x3a8a40, roughness: 1, emissive: 0x0d3412, emissiveIntensity: 0.6 }), mat({ color: 0x2a1c12 }), mat({ color: 0x3a2a1c }), mat({ color: 0x3a2a1c })]);
    apron.position.set((FARM_X0 + FARM_X1) / 2 + 0.01, -1.51, (FARM_Z0 + FARM_Z1) / 2); scene.add(apron);
    const dirt = mat({ color: 0x6a5038, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const ln of FARM_LANES) { const [a, b] = [ln[0], ln[ln.length - 1]]; const m = new THREE.Mesh(geo(new THREE.BoxGeometry(FARM_LANE_W, 0.05, Math.abs(b[1] - a[1]))), dirt); m.position.set(a[0], 0.05, (a[1] + b[1]) / 2); scene.add(m); }
    const plots = farmPlots(); const d = new THREE.Object3D();
    const soil = new THREE.InstancedMesh(unitBox, mat({ color: 0x5a3e28, roughness: 1 }), plots.length);
    plots.forEach((p, i) => { d.position.set(p.x, 0.07, p.z); d.scale.set(p.w - 0.8, 0.14, p.d - 0.8); d.rotation.set(0, 0, 0); d.updateMatrix(); soil.setMatrixAt(i, d.matrix); });
    soil.userData.props = plots.map((p) => plotId(p.n)); pickables.push(soil); scene.add(soil);
    plots.forEach((p) => propTop.set(plotId(p.n), [p.x, 0.6, p.z]));
    // furrows: a faint darker stripe per tile row
    const nf = plots.reduce((a, p) => a + p.rows, 0); const fur = new THREE.InstancedMesh(unitBox, mat({ color: 0x3e2a1a, roughness: 1 }), nf); let k = 0;
    for (const p of plots) for (let r = 0; r < p.rows; r++) { d.position.set(p.x, 0.15, p.z - (p.rows * TILE) / 2 + TILE * (r + 0.5)); d.scale.set(p.cols * TILE - 0.3, 0.03, 0.7); d.updateMatrix(); fur.setMatrixAt(k++, d.matrix); }
    scene.add(fur);
    // fences: two rails per side + corner posts
    const rails = new THREE.InstancedMesh(unitBox, mat({ color: 0x8a6a48, roughness: 0.9 }), plots.length * 8); const posts = new THREE.InstancedMesh(unitBox, mat({ color: 0x6a4e34 }), plots.length * 4); k = 0; let q = 0;
    for (const p of plots) { const hw = p.w / 2 - 0.2, hd = p.d / 2 - 0.2;
      for (const y of [0.35, 0.75]) for (const [x, z, w, dd] of [[p.x, p.z - hd, p.w - 0.4, 0.08], [p.x, p.z + hd, p.w - 0.4, 0.08], [p.x - hw, p.z, 0.08, p.d - 0.4], [p.x + hw, p.z, 0.08, p.d - 0.4]] as const) { d.position.set(x, y, z); d.scale.set(w, 0.08, dd); d.updateMatrix(); rails.setMatrixAt(k++, d.matrix); }
      for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) { d.position.set(p.x + x, 0.5, p.z + z); d.scale.set(0.2, 1, 0.2); d.updateMatrix(); posts.setMatrixAt(q++, d.matrix); } }
    scene.add(rails, posts);
    // barns (red, white trim, warm window glow) and silos
    for (const b of BARNS) { const g = new THREE.Group();
      g.add(box(b.w, 4.2, b.d, mat({ color: 0x8a2a22, roughness: 0.85 })));
      const roof = new THREE.Mesh(roofGeo, mat({ color: 0x3a3a40, roughness: 0.8, flatShading: true })); roof.scale.set(b.w + 0.4, 2.2, b.d + 0.4); roof.position.y = 4.2; roof.rotation.y = Math.PI / 2; g.add(roof);
      g.add(box(3, 2.8, 0.1, mat({ color: 0xe8e0d0, emissive: 0xffc070, emissiveIntensity: 0.25 * NEON }), 0, 0, -b.d / 2 - 0.05));
      g.add(box(1.2, 0.8, 0.1, mat({ color: 0xffd08a, emissive: 0xffb050, emissiveIntensity: 0.7 * NEON }), 0, 3.1, -b.d / 2 - 0.05));
      g.position.set(b.x, 0, b.z); scene.add(g); }
    const siloMat = mat({ color: 0xb8bcc4, roughness: 0.5, metalness: 0.4 });
    for (const [x, z] of SILOS) { const c = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.5, 1.5, 7, 16)), siloMat); c.position.set(x, 3.5, z); const dome = new THREE.Mesh(geo(new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), siloMat); dome.position.set(x, 7, z); scene.add(c, dome); }
    { const sg = new THREE.Group(); const post = mat({ color: 0x5a4a3a }); const panel = signTexture('FARMLAND', '#9be07a', 'Chud Acres Farms'); disposables.push(panel);
      const pm = mat({ color: 0xffffff, map: panel, emissiveMap: panel, emissive: 0xffffff, emissiveIntensity: 0.45 * NEON });
      sg.add(box(0.3, 4, 0.3, post, -2.6, 0, 0), box(0.3, 4, 0.3, post, 2.6, 0, 0)); const pan = new THREE.Mesh(geo(new THREE.BoxGeometry(6, 1.8, 0.2)), pm); pan.position.set(0, 3.6, 0); sg.add(pan);
      sg.position.set(FARM_X0 + 1.6, 0, 0); sg.rotation.y = Math.PI / 2; scene.add(sg); }
    // crops: one instance per tile (hidden until /api/farm says something grows there)
    let total = 0; for (const p of plots) { farmTiles.set(plotId(p.n), total); total += p.cols * p.rows; }
    const cm = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(0.55, 1, 6)), mat({ color: 0xffffff, roughness: 0.8, emissive: 0x101808, emissiveIntensity: 0.4 }), total);
    cm.count = 0; cm.frustumCulled = false; scene.add(cm); return cm;
  })();
  const setFarm = (tiles: Array<[string, number, string, string]>) => {
    const d = new THREE.Object3D(); const c = new THREE.Color(); let n = 0; const plots = new Map(farmPlots().map((p) => [plotId(p.n), p]));
    for (const [pid, t, crop, stage] of tiles) {
      const p = plots.get(pid); const cr = cropById(crop); if (!p || !cr || n >= crops.instanceMatrix.count) continue; const [x, z] = tileXZ(p, t);
      const hgt = stage === 'ready' ? 1.3 : stage === 'withered' ? 0.45 : 0.7;
      d.position.set(x, 0.14 + hgt / 2, z); d.scale.set(stage === 'ready' ? 1 : 0.7, hgt, stage === 'ready' ? 1 : 0.7); d.rotation.set(0, 0, 0); d.updateMatrix();
      crops.setMatrixAt(n, d.matrix); crops.setColorAt(n, c.setHex(stage === 'ready' ? cr.color : stage === 'withered' ? 0x5a4a30 : 0x3f8a3a)); n++;
    }
    crops.count = n; crops.instanceMatrix.needsUpdate = true; if (crops.instanceColor) crops.instanceColor.needsUpdate = true;
  };
  // Stars
  const stG = new THREE.BufferGeometry(); const sp: number[] = []; for (let i = 0; i < 400; i++) { const a = r() * Math.PI * 2, e = 0.15 + r() * 1.2, R = 420; sp.push(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R); }
  stG.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); disposables.push(stG);
  const stM = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: false, fog: false }); disposables.push(stM); scene.add(new THREE.Points(stG, stM));

  // Interaction.
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  let hovered: string | null = null; let fly: { from: THREE.Vector3; to: THREE.Vector3; tf: THREE.Vector3; tt: THREE.Vector3; t: number; id: string } | null = null;
  const pick = (cx: number, cy: number) => { const rc = canvas.getBoundingClientRect(); ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(pickables, false)[0]; const tr = hit?.object.userData.trailers as string[] | undefined; if (tr && hit?.instanceId != null) return `trailer:${tr[hit.instanceId]}`; const pr = hit?.object.userData.props as string[] | undefined; if (pr && hit?.instanceId != null) return pr[hit.instanceId] ?? null; return (hit?.object.userData.spot as string | undefined) ?? null; };
  const setHover = (id: string | null) => {
    if (id === hovered) return; hovered = id; canvas.style.cursor = id ? 'pointer' : 'grab';
    for (const l of lms) { const on = l.id === id; l.root.scale.setScalar(on ? 1.06 : 1); l.sign.userData.hover = on; for (const m of l.emissive) m.emissiveIntensity = on ? (m.map ? 1.6 : 3) * NEON : (m.map ? 0.9 : 1.6) * NEON; }
  };
  const clearTip = () => { setHover(null); h.onHover(null, 0, 0); };
  // Drag-panning: no hover highlight or tooltip while the pointer is held and moving (it used to linger after the pan).
  const onMove = (e: PointerEvent) => { if (fly || e.pointerType === 'touch') return; if (down && e.buttons) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down.drag = true; clearTip(); } if (down.drag) return; } const id = pick(e.clientX, e.clientY); setHover(id); h.onHover(id, e.clientX, e.clientY); };
  let down: { x: number; y: number; t: number; drag?: boolean } | null = null;
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; controls.autoRotate = false; h.onHover(null, 0, 0); };
  const onUp = (e: PointerEvent) => {
    if (!down || fly) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const dragged = moved > 8 || !!down.drag; down = null; if (dragged) { clearTip(); return; }
    const id = pick(e.clientX, e.clientY); if (!id) { setHover(null); h.onHover(null, 0, 0); return; }
    if (id.startsWith('trailer:')) { h.onHover(id, e.clientX, e.clientY); return; } // trailers: just the label, no interiors
    if (id.startsWith('b:') || id.startsWith('p:') || id.startsWith('f:')) { h.onHover(null, 0, 0); h.onProperty?.(id); return; } // real estate: deed panel
    flyTo(id);
  };
  const flyTo = (id: string) => {
    const l = lms.find((x) => x.id === id); if (!l) return; setHover(id); h.onHover(null, 0, 0);
    const tgt = new THREE.Vector3(l.pos.x, Math.min(l.height * 0.5, 10), l.pos.z);
    const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
    // Land at controls.minDistance (24,18 → 30) so OrbitControls takes over without a jump.
    const to = tgt.clone().add(dir.multiplyScalar(24)).setY(tgt.y + 18);
    fly = { from: camera.position.clone(), to, tf: controls.target.clone(), tt: tgt, t: 0, id }; controls.enabled = false;
  };
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
  const onLeave = () => { setHover(null); h.onHover(null, 0, 0); }; canvas.addEventListener('pointerleave', onLeave);

  const resize = () => { const w = canvas.clientWidth || 1, hh = canvas.clientHeight || 1; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.fov = w < hh ? 62 : 38; camera.updateProjectionMatrix(); };
  // Bloom on high-tier devices only (neon + windows glow); everyone else renders straight to the canvas.
  let composer: EffectComposer | null = null;
  if (tier === 'high') {
    composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.36, 0.45, 0.88)); composer.addPass(new OutputPass());
  }
  const resizeComposer = () => { if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1); } };
  const ro = new ResizeObserver(() => { resize(); resizeComposer(); }); ro.observe(canvas); resize(); resizeComposer();

  const venues = buildVenues(scene, { mat, geo });
  const tmpV = new THREE.Vector3(); const clock = new THREE.Clock(); let raf = 0; let running = true; let time = 0;
  const d = new THREE.Object3D(); const hp = headG.attributes.position as THREE.BufferAttribute;
  const blink = (lms.find((l) => l.id === 'leaderboard')!.root.userData as { blink?: THREE.Object3D }).blink;
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    cars.forEach((c, i) => { c.t += c.sp * dt; const [x, z, a] = routePoint(c.route, c.t, c.lane); d.position.set(x, 0.45, z); d.rotation.set(0, -a, 0); d.updateMatrix(); carBody.setMatrixAt(i, d.matrix); hp.setXYZ(i * 2, x + Math.cos(a) * 0.9 - Math.sin(a) * 0.3, 0.5, z + Math.sin(a) * 0.9 + Math.cos(a) * 0.3); hp.setXYZ(i * 2 + 1, x + Math.cos(a) * 0.9 + Math.sin(a) * 0.3, 0.5, z + Math.sin(a) * 0.9 - Math.cos(a) * 0.3); });
    carBody.instanceMatrix.needsUpdate = true; hp.needsUpdate = true;
    if (blink) blink.visible = Math.sin(time * 4) > 0;
    nextFw -= dt; if (nextFw <= 0) { burst(); nextFw = 3 + r() * 4; }
    if (fwAge < 2.2) { fwAge += dt; for (let i = 0; i < FP; i++) { fwVel[i * 3 + 1] -= 4 * dt; fwPos[i * 3] += fwVel[i * 3] * dt; fwPos[i * 3 + 1] += fwVel[i * 3 + 1] * dt; fwPos[i * 3 + 2] += fwVel[i * 3 + 2] * dt; } fwG.attributes.position.needsUpdate = true; fwM.opacity = Math.max(0, 1 - fwAge / 2.2); }
    if (fly) { fly.t = Math.min(1, fly.t + dt / 0.75); const e = 1 - Math.pow(1 - fly.t, 3); camera.position.lerpVectors(fly.from, fly.to, e); controls.target.lerpVectors(fly.tf, fly.tt, e); camera.lookAt(controls.target);
      if (fly.t >= 1) { const id = fly.id; fly = null; controls.enabled = true; h.onPick(id); } } // the city stays mounted now (0dc4f99): hand zoom/orbit back
    else if (!tick?.(dt)) { panStep(dt); controls.update(); clampPan(); }
    waterMat.uniforms.uTime.value = time; venues.step(dt, time, camera.position);
    const portrait = (canvas.clientWidth || 1) < (canvas.clientHeight || 1);
    for (const l of lms) { const k = labelScale(camera.position.distanceTo(l.sign.getWorldPosition(tmpV)), portrait) * (l.sign.userData.hover ? 1.2 : 1); l.sign.scale.set(k, k / 4, 1); }
    if (composer) composer.render(); else renderer.render(scene, camera);
  };
  let tick: ((dt: number) => boolean) | null = null;
  const vis = () => { running = !document.hidden; clock.getDelta(); }; document.addEventListener('visibilitychange', vis);
  frame();
  // Owned-property markers: a small muted-gold diamond over each owned building/lot (no glow, no bloom).
  const MAX_MARK = propTop.size + lms.length;
  const marks = new THREE.InstancedMesh(geo(new THREE.OctahedronGeometry(0.45, 0)), mat({ color: 0xc9a24a, emissive: 0x2a1e06, roughness: 0.5, metalness: 0.4, flatShading: true }), MAX_MARK);
  marks.count = 0; marks.frustumCulled = false; scene.add(marks);
  const setOwned = (ids: string[]) => {
    const d = new THREE.Object3D(); let n = 0;
    for (const id of ids) {
      const l = id.startsWith('lm:') ? lms.find((x) => x.id === id.slice(3)) : undefined;
      const t: [number, number, number] | undefined = l ? [l.pos.x, l.height + 4.2, l.pos.z] : propTop.get(id);
      if (!t || n >= MAX_MARK) continue; d.position.set(t[0], t[1] + 1.1, t[2]); d.scale.set(1, 1.5, 1); d.updateMatrix(); marks.setMatrixAt(n++, d.matrix);
    }
    marks.count = n; marks.instanceMatrix.needsUpdate = true;
  };
  return {
    flyTo, setOwned, setFarm,
    // Driving (worldDrive.ts) hooks: the tick runs every frame; returning true means it owns the camera.
    scene, camera, controls, solids, lmBoxes, setTick(f: ((dt: number) => boolean) | null) { tick = f; },
    reset() { fly = null; controls.enabled = true; camera.position.copy(home); controls.target.set(0, 0, 0); setHover(null); },
    setRunning(v: boolean) { running = v && !document.hidden; clock.getDelta(); },
    project(id: string) { const l = lms.find((x) => x.id === id); if (!l) return null; const v = l.pos.clone().setY(l.height + 2.2).project(camera); const rc = canvas.getBoundingClientRect(); return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height }; },
    hover(id: string | null) { setHover(id); },
    dispose() { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', onBlur); parkDead = true; trailerMeshes = []; cancelAnimationFrame(raf); venues.dispose(); ro.disconnect(); document.removeEventListener('visibilitychange', vis); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave); controls.dispose(); scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.Points).isPoints) { m.geometry?.dispose?.(); } }); disposables.forEach((x) => x.dispose()); composer?.dispose(); renderer.dispose(); },
  };
}
export type World = ReturnType<typeof createWorld>;
