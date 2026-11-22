// Chudbai 3D map: a Gulf oil-boom city. Sand dunes and a desert oilfield to the north, a glass-and-gold skyline downtown
// (Burj Chudifa, the twisted Mercantile Exchange tower), a marina, the palm-shaped Palm Chudeirah island and offshore
// platforms in the Gulf to the south. Same camera / pan / pick / label rules as Fort McChud and Chud City.
import * as THREE from 'three';
import { asLabel, cityLabel, fitLabel, labelMaterial, renderScene, LABEL_LAYER } from './labelSprite';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { detectWorldTier, labelScale, TIER_PIXEL_RATIO } from './worldTier';
import { skyNow, parseTod, mix as mixHex } from '../../../shared/daynight';
import { sg, BOX, SPH, buildOcean, buildBeach } from './ocean3d';
import { ownerColor } from '../../../shared/fortmc';
import { GULF_SPOTS, GULF_X0, GULF_X1, GULF_Z0, GULF_Z1, GULF_SHORE_Z, G_TRACTS, gTractInfo, type GulfSite, type GulfState, type GUnitKind } from '../../../shared/chudbai';

type Handlers = { onHover: (id: string | null, x: number, y: number) => void; onPick: (id: string) => void };
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
export const clampGulfTarget = (x: number, z: number): [number, number] => [Math.min(GULF_X1 - 10, Math.max(GULF_X0 + 10, x)), Math.min(GULF_Z1 - 10, Math.max(GULF_Z0 + 10, z))];
const TW = 30, TD = 26;
/** Asphalt roads (x, z, w, d). */
export const GULF_ROADS: Array<[number, number, number, number]> = [
  [0, -45, 400, 12],            // Sheikh Chud Road (highway)
  [60, -100, 8, 110],           // north avenue to the plant / airport
  [20, 50, 360, 7],             // Corniche along the beach
  [20, -15, 300, 6], [20, 28, 300, 6],
  ...([-80, -20, 30, 100, 150] as const).map((x): [number, number, number, number] => [x, 3, 6, 96]),
  [140, -78, 8, 56],            // airport spur
];
const inRoad = (x: number, z: number, pad = 0) => GULF_ROADS.some(([rx, rz, w, d]) => Math.abs(x - rx) < w / 2 + pad && Math.abs(z - rz) < d / 2 + pad);
const inSpot = (x: number, z: number, pad = 0) => GULF_SPOTS.some((s) => Math.abs(x - s.x) < s.w / 2 + pad && Math.abs(z - s.z) < s.d / 2 + pad);

export type GulfWorld = ReturnType<typeof createChudbai>;
export function createChudbai(canvas: HTMLCanvasElement, h: Handlers) {
  const tier = detectWorldTier(); const r = rng(20261122);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: /[?&]shot=1/.test(location.search) });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIER_PIXEL_RATIO[tier])); canvas.dataset.tier = tier;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = tier !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); const disposables: Array<{ dispose(): void }> = [];
  // soft studio reflections so gold and glass read as metal (no env map = black metal)
  { const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = env; scene.environmentIntensity = 0.3; disposables.push(env, pm); }
  const mat = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(p); disposables.push(m); return m; };
  const geo = <G extends THREE.BufferGeometry>(g: G) => { disposables.push(g); return g; };
  const HAZE = 0xe6cfa0;

  // Sky: the shared real-time clock (?tod=HH:MM overrides) with a dusty desert haze on the horizon.
  const skyU = { uSky: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uWarm: { value: 0 }, uStars: { value: 0 } };
  const skyM = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uSky; uniform vec3 uHor; uniform float uWarm; uniform float uStars; varying vec3 vp; void main(){ float y = vp.y;
      vec3 sand = vec3(0.93,0.78,0.55);
      vec3 c = mix(uHor, uSky, smoothstep(0.0,0.5,y)); c = mix(c, sand, (1.0 - smoothstep(0.0,0.1,y)) * (0.35 + 0.4*uWarm));
      float st = step(0.9975, fract(sin(dot(floor(vp*420.0), vec3(12.9898,78.233,37.719))) * 43758.5453)) * uStars * smoothstep(0.05,0.3,y);
      c += vec3(st); if (y < 0.0) c = uHor*0.75; gl_FragColor = vec4(c,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
  disposables.push(skyM); scene.add(new THREE.Mesh(geo(new THREE.SphereGeometry(900, 32, 16)), skyM));
  scene.fog = new THREE.Fog(HAZE, 420, 1300);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
  const home = new THREE.Vector3(150, 190, 300); const homeT = new THREE.Vector3(0, 0, 20); camera.position.copy(home);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(homeT); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 30; controls.maxDistance = 480; controls.maxPolarAngle = 1.4; controls.minPolarAngle = 0.3;
  controls.enablePan = true; controls.screenSpacePanning = false; controls.panSpeed = 1.1;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const clampPan = () => { const t = controls.target; const [x, z] = clampGulfTarget(t.x, t.z); if (x !== t.x || z !== t.z) { camera.position.x += x - t.x; camera.position.z += z - t.z; t.x = x; t.z = z; } };

  const hemi = new THREE.HemisphereLight(0xcfe0f5, 0x9a7a50, 1.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 3); sun.position.set(-120, 160, 80); sun.castShadow = renderer.shadowMap.enabled;
  Object.assign(sun.shadow.camera, { left: -230, right: 230, top: 230, bottom: -230, near: 10, far: 700 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; scene.add(sun);

  // Ground: sand with dunes outside the built-up areas (pads, plant, city stay flat).
  const flatAt = (x: number, z: number) => {
    if (z > GULF_SHORE_Z - 6) return 1;
    for (let n = 1; n <= G_TRACTS; n++) { const t = gTractInfo(n); if (!t.offshore && Math.abs(x - t.x) < TW / 2 + 8 && Math.abs(z - t.z) < TD / 2 + 8) return 1; }
    if (inSpot(x, z, 10) || inRoad(x, z, 6)) return 1;
    if (x > -125 && x < 185 && z > -55 && z < GULF_SHORE_Z) return 1; // downtown
    return 0;
  };
  const dune = (x: number, z: number) => Math.max(0, Math.sin(x * 0.035 + z * 0.012) * 3.2 + Math.sin(x * 0.011 - z * 0.04 + 1.7) * 2.6 + Math.sin(x * 0.09 + z * 0.07) * 0.6);
  const groundG = geo(new THREE.PlaneGeometry(GULF_X1 - GULF_X0 + 500, (GULF_SHORE_Z + 4) - (GULF_Z0 - 300), 150, 110)); {
    groundG.translate(0, -((GULF_SHORE_Z + 4) + (GULF_Z0 - 300)) / 2, 0); // plane y = -z after the rotation
    const pa = groundG.attributes.position as THREE.BufferAttribute; const col: number[] = []; const c = new THREE.Color(), c2 = new THREE.Color();
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), z = -pa.getY(i); const edge = x < GULF_X0 - 20 || x > GULF_X1 + 20 || z < GULF_Z0 - 10 ? 1 : 0;
      const f = flatAt(x, z); const hgt = f ? 0 : dune(x, z) * (edge ? 3.2 : 0.55);
      pa.setZ(i, hgt);
      const n = Math.sin(x * 0.05 + 1.3) * Math.cos(z * 0.06) + 0.4 * Math.sin(x * 0.17 - z * 0.13);
      c.setHex(0xdcb47a); c2.setHex(n > 0.4 ? 0xe8c890 : n < -0.5 ? 0xc49a62 : 0xd8b07a); c.lerp(c2, 0.6); if (hgt > 2) c.lerp(new THREE.Color(0xf0d29a), Math.min(1, hgt / 12));
      if (x > -125 && x < 185 && z > -55 && z < GULF_SHORE_Z - 4) c.lerp(new THREE.Color(0xcab89a), 0.55); // paved downtown
      col.push(c.r, c.g, c.b);
    }
    groundG.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); groundG.computeVertexNormals(); }
  const ground = new THREE.Mesh(groundG, mat({ color: 0xffffff, vertexColors: true, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const gulf = buildOcean({ x0: GULF_X0 - 400, x1: GULF_X1 + 400, z0: GULF_SHORE_Z - 2, z1: 1000, coast: () => GULF_SHORE_Z + 2, segX: tier === 'low' ? 50 : 90, segZ: tier === 'low' ? 30 : 50 }, [0.6, 11, 0.4, 5, GULF_SHORE_Z + 2]);
  gulf.mesh.position.y = -0.3; scene.add(gulf.mesh); disposables.push(gulf.geo, gulf.mat);
  { const b = buildBeach(GULF_X0 - 300, GULF_X1 + 300, GULF_SHORE_Z - 6, (x) => GULF_SHORE_Z + 2 + 0.6 * Math.sin(x / 11 + 0.7), 160); disposables.push(b.geometry, b.material as THREE.Material); scene.add(b); }

  // Materials
  const glowMats: THREE.MeshStandardMaterial[] = [];
  const glowM = (c: number, e: number, ei: number) => { const m = mat({ color: c, emissive: e, emissiveIntensity: ei, roughness: 0.4 }); m.userData.ei = ei; glowMats.push(m); return m; };
  const gold = mat({ color: 0xd8a83a, metalness: 0.95, roughness: 0.22, emissive: 0x3a2400, emissiveIntensity: 0.25 });
  const goldGlow = glowM(0xf2c860, 0xe8a020, 0.9);
  const white = mat({ color: 0xf2eee6, roughness: 0.6 }); const cream = mat({ color: 0xe8dcc4, roughness: 0.8 });
  const steel = mat({ color: 0xa8b0b8, metalness: 0.7, roughness: 0.35 }); const dark = mat({ color: 0x2c3036, metalness: 0.5, roughness: 0.6 });
  const conc = mat({ color: 0xb8ae9c, roughness: 0.95 }); const asphalt = mat({ color: 0x3a3a3e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const red = mat({ color: 0xb0302a, roughness: 0.6 }); const blue = mat({ color: 0x1f3d6a, metalness: 0.5, roughness: 0.25 });
  const flameM = mat({ color: 0xffa040, emissive: 0xff7a20, emissiveIntensity: 4 });
  const navRed = glowM(0xff3030, 0xff2020, 2.2); const lampHead = glowM(0xfff1c8, 0xffcc66, 2.6);
  const palmTrunk = mat({ color: 0x8a6a44, roughness: 0.9 }); const palmLeaf = mat({ color: 0x3f7a3a, roughness: 0.8, side: THREE.DoubleSide });
  const sandM = mat({ color: 0xe9d3a0, roughness: 1 }); const lawn = mat({ color: 0x5f9a4a, roughness: 1 }); const pool = mat({ color: 0x3fc4e0, roughness: 0.15, metalness: 0.1, emissive: 0x0a4050, emissiveIntensity: 0.4 });
  const winTex = (tint: string, lit: string) => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d')!; x.fillStyle = tint; x.fillRect(0, 0, 64, 128);
    for (let rr = 0; rr < 32; rr++) for (let q = 0; q < 8; q++) { const on = Math.abs(Math.sin(rr * 12.9 + q * 78.2) * 43758 % 1); x.fillStyle = on > 0.55 ? lit : 'rgba(255,255,255,0.10)'; x.fillRect(q * 8 + 1, rr * 4 + 1, 6, 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; disposables.push(t); return t; };
  const TINTS = [['#6f9cc0', '#ffe0a0'], ['#8fb4bc', '#fff0c0'], ['#4f7a9e', '#ffd890'], ['#b8c6d0', '#fff4d0'], ['#c9b48c', '#ffe6b0']];
  const glassCache = new Map<string, THREE.MeshStandardMaterial>();
  /** Glass curtain wall for a tower of height `hgt`: the window texture repeats every ~16 m so panes keep their size. */
  const glassFor = (style: number, hgt: number) => { const i = style % TINTS.length; const rep = Math.max(1, Math.round(hgt / 16)); const key = `${i}:${rep}`; let m = glassCache.get(key);
    if (!m) { const t = winTex(TINTS[i]![0]!, TINTS[i]![1]!); t.repeat.set(1, rep); m = mat({ color: 0xffffff, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.5, metalness: 0.55, roughness: 0.18, envMapIntensity: 1 }); m.userData.ei = 0.5; glowMats.push(m); glassCache.set(key, m); }
    return m; };
  const glassMats = TINTS.map((_, i) => glassFor(i, 32));

  const box = (w: number, hh: number, dd: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(BOX(), m); o.scale.set(w, hh, dd); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
  const cyl = (rt: number, hh: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene, rb = rt, seg = 16) => { const k = Math.round((rb / rt) * 20) / 20; const o = new THREE.Mesh(sg(`gcyl${k}:${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5 * k, 1, seg)), m); o.scale.set(rt * 2, hh, rt * 2); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const sph = (rad: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(SPH(), m); o.scale.setScalar(rad * 2); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const dome = (rad: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(sg('gdome', () => new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), m); o.scale.setScalar(rad * 2); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };

  // Roads + lamps
  const posts: THREE.Matrix4[] = [], heads: THREE.Matrix4[] = []; const q0 = new THREE.Quaternion();
  for (const [x, z, w, d] of GULF_ROADS) {
    const o = new THREE.Mesh(sg('gplane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), asphalt); o.scale.set(w, 1, d); o.position.set(x, 0.05, z); o.receiveShadow = true; scene.add(o);
    const long = w > d; const len = long ? w : d; const off = (long ? d : w) / 2 + 1.2;
    for (let s = -len / 2 + 8; s < len / 2; s += 22) for (const side of [-1, 1]) { const px = long ? x + s : x + side * off, pz = long ? z + side * off : z + s; if (inSpot(px, pz, 1)) continue; posts.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 3, pz), q0, new THREE.Vector3(0.25, 6, 0.25))); heads.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 6.1, pz), q0, new THREE.Vector3(0.8, 0.3, 0.8))); }
  }
  { const pm = new THREE.InstancedMesh(BOX(), steel, posts.length); posts.forEach((m, i) => pm.setMatrixAt(i, m)); scene.add(pm); const hm = new THREE.InstancedMesh(BOX(), lampHead, heads.length); heads.forEach((m, i) => hm.setMatrixAt(i, m)); scene.add(hm); }
  // highway median: gold-lit date palms
  const palms: THREE.Matrix4[] = [], fronds: THREE.Matrix4[] = [];
  const palm = (x: number, z: number, s = 1) => { palms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 3.5 * s, z), q0, new THREE.Vector3(0.35 * s, 7 * s, 0.35 * s))); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + r(); const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, a, 0, 'YXZ')); fronds.push(new THREE.Matrix4().compose(new THREE.Vector3(x + Math.sin(a) * 1.4 * s, 7 * s, z + Math.cos(a) * 1.4 * s), qq, new THREE.Vector3(0.9 * s, 0.08 * s, 3.4 * s))); } };
  for (let x = -190; x <= 190; x += 14) if (!inSpot(x, -45, 2)) palm(x, -45, 0.9);
  for (let x = -180; x <= 200; x += 12) if (!inSpot(x, 56, 1)) palm(x + r() * 3, 56, 0.8 + r() * 0.3);

  const signs: THREE.Sprite[] = []; let labelRenderer = renderer;
  const label = (text: string, sub: string | undefined, color: string, x: number, y: number, z: number, k = 1) => {
    const tex = cityLabel(text, color, sub, labelRenderer); disposables.push(tex); const m = labelMaterial(tex, { fog: false }); disposables.push(m);
    const s = asLabel(new THREE.Sprite(m)); s.position.set(x, y, z); s.userData.k = k; fitLabel(s, 8 * k); scene.add(s); signs.push(s); return s;
  };
  const pickables: THREE.Object3D[] = []; const flames: THREE.Mesh[] = []; const yachts: THREE.Group[] = [];

  // ---- skyline: glass towers with gold crowns, kept off roads and landmarks
  const tower = (x: number, z: number, w: number, d: number, hgt: number, style: number) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); const m = glassFor(style, hgt);
    box(w, hgt, d, m, 0, hgt / 2, 0, g);
    box(w + 0.6, 2, d + 0.6, cream, 0, 1, 0, g);
    if (style % 3 === 0) { box(w * 0.7, hgt * 0.18, d * 0.7, glassFor(style, hgt * 0.18), 0, hgt + hgt * 0.09, 0, g); box(w * 0.72, 0.6, d * 0.72, gold, 0, hgt + hgt * 0.18, 0, g); cyl(0.25, hgt * 0.12, steel, 0, hgt * 1.24, 0, g); }
    else if (style % 3 === 1) { cyl(Math.min(w, d) * 0.4, hgt * 0.1, gold, 0, hgt + hgt * 0.05, 0, g, Math.min(w, d) * 0.55, 6); }
    else { box(w + 0.3, 0.8, d + 0.3, gold, 0, hgt * 0.5, 0, g); box(w + 0.3, 0.8, d + 0.3, gold, 0, hgt, 0, g); }
    box(0.5, 0.5, 0.5, navRed, 0, hgt * (style % 3 === 0 ? 1.31 : 1.12) + 0.3, 0, g);
  };
  let towers = 0;
  for (let i = 0; i < 1400 && towers < 52; i++) {
    const x = -118 + r() * 300, z = -36 + r() * 84; const w = 8 + r() * 7, d = 8 + r() * 7;
    if (inRoad(x, z, Math.max(w, d) / 2 + 1) || inSpot(x, z, Math.max(w, d) / 2 + 2) || z > 42) continue;
    if (scene.children.some((o) => o.userData.tw && Math.abs(o.position.x - x) < (w + (o.userData.tw as number)) / 2 + 6 && Math.abs(o.position.z - z) < (d + (o.userData.td as number)) / 2 + 6)) continue;
    const nearCore = Math.hypot(x + 20, z - 10) < 70; const hgt = (nearCore ? 36 : 16) + r() * (nearCore ? 64 : 38); towers++;
    tower(x, z, w, d, hgt, Math.floor(r() * 9)); const g = scene.children[scene.children.length - 1]!; g.userData.tw = w; g.userData.td = d;
  }

  // ---- landmarks
  for (const s of GULF_SPOTS) {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z); scene.add(g);
    const hit = box(s.w, s.h, s.d, new THREE.MeshBasicMaterial({ visible: false }), 0, s.h / 2, 0, g); hit.userData.spot = s.id; hit.castShadow = false; pickables.push(hit);
    let ly = s.h + 8;
    if (s.id === 'g-burj') {
      // Burj Chudifa: a Y-plan of stepped, tapering wings around a core and a gold-tipped spire
      const m = glassFor(3, 13); const tiers = 13;
      for (let i = 0; i < tiers; i++) { const k = 1 - i / tiers; const y0 = i * 13; for (let wv = 0; wv < 3; wv++) { const a = wv * Math.PI * 2 / 3; const wing = box(4.2 * k + 1.4, 13, 9 * k + 2, m, Math.sin(a) * 3.2 * k, y0 + 6.5, Math.cos(a) * 3.2 * k, g); wing.rotation.y = a; } box(0.3, 0.6, 0.3, gold, 0, y0 + 13, 0, g); }
      cyl(2.2, 12, m, 0, tiers * 13 + 6, 0, g, 3); cyl(0.6, 30, steel, 0, tiers * 13 + 27, 0, g, 1.6); cyl(0.25, 8, gold, 0, tiers * 13 + 46, 0, g, 0.6); box(0.6, 0.6, 0.6, navRed, 0, tiers * 13 + 50.5, 0, g);
      for (let i = 0; i < 4; i++) cyl(14 - i * 2, 0.3, pool, 0, 0.2 + i * 0.02, 18, g); // fountain lake
      ly = tiers * 13 + 60;
    } else if (s.id === 'g-exchange') {
      // twisted tower (each floor slab rotates a little) with gold bands
      const m = glassFor(0, 3); const floors = 30;
      for (let i = 0; i < floors; i++) { const sl = box(11, 3, 11, m, 0, 1.5 + i * 3, 0, g); sl.rotation.y = i * 0.045; if (i % 5 === 4) { const b = box(11.6, 0.4, 11.6, gold, 0, 3 + i * 3, 0, g); b.rotation.y = i * 0.045; } }
      cyl(3, 4, gold, 0, floors * 3 + 2, 0, g, 5, 8); box(14, 6, 14, cream, 0, 3, 12, g); box(14.4, 0.6, 14.4, gold, 0, 6.2, 12, g);
      ly = 104;
    } else if (s.id === 'g-souk') {
      for (let i = 0; i < 5; i++) { const x = -12 + i * 6; box(5, 6, 16, cream, x, 3, 0, g); dome(2.4, gold, x, 6, 0, g); for (let a = 0; a < 3; a++) box(1.2, 3, 0.3, goldGlow, x, 1.6, -7.6 + a * 0.01, g); }
      box(32, 0.4, 20, mat({ color: 0xc8a878, roughness: 1 }), 0, 0.2, 0, g); cyl(1.2, 14, cream, 14, 7, 8, g); dome(1.4, gold, 14, 14, 8, g);
    } else if (s.id === 'g-airport') {
      box(70, 0.15, 10, mat({ color: 0x3a3a3e, roughness: 1 }), 0, 0.08, 4, g); for (let i = 0; i < 9; i++) box(4, 0.17, 0.5, white, -32 + i * 8, 0.1, 4, g);
      // terminal: long glass hall under a curved gold roof
      box(30, 7, 9, glassMats[1]!, -10, 3.5, -6, g); { const roof = new THREE.Mesh(sg('groof', () => new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)), gold); roof.scale.set(32, 3, 6); roof.position.set(-10, 7, -6); roof.rotation.y = Math.PI / 2; roof.castShadow = true; g.add(roof); }
      cyl(1, 14, cream, 20, 7, -6, g); cyl(2.6, 3, glassMats[2]!, 20, 15, -6, g, 1.8); cyl(2.8, 0.5, gold, 20, 16.7, -6, g); box(0.6, 0.6, 0.6, navRed, 20, 18, -6, g);
      for (let i = 0; i < 18; i++) for (const ez of [-0.6, 8.6]) box(0.35, 0.35, 0.35, i % 6 === 0 ? navRed : lampHead, -34 + i * 4, 0.25, ez, g);
      // a parked airliner in Chudbai Air livery
      { const p = new THREE.Group(); p.position.set(14, 0, -15); g.add(p); cyl(1.6, 22, white, 0, 2.6, 0, p).rotation.x = Math.PI / 2; box(26, 0.4, 4, white, 0, 2.2, 1, p); box(0.4, 5, 3, gold, 0, 5, 10, p); box(8, 0.3, 2, white, 0, 3.6, 10, p); }
      ly = 22;
    } else if (s.id === 'g-plant') {
      box(s.w, 0.3, s.d, conc, 0, 0.15, 0, g);
      box(s.w - 6, 0.6, 2, steel, 0, 7, 0, g); for (let x = -s.w / 2 + 4; x < s.w / 2 - 2; x += 6) box(0.4, 7, 2, dark, x, 3.5, 0, g); // pipe rack spine
      cyl(0.8, 30, steel, s.w / 2 - 4, 15, -s.d / 2 + 4, g); box(0.5, 0.5, 0.5, navRed, s.w / 2 - 4, 30.4, -s.d / 2 + 4, g);
      const fl = new THREE.Mesh(sg('gcone', () => new THREE.ConeGeometry(0.6, 1, 10)), flameM); fl.scale.set(1.4, 4, 1.4); fl.position.set(s.w / 2 - 4, 32.4, -s.d / 2 + 4); g.add(fl); flames.push(fl);
      ly = 40;
    } else if (s.id === 'g-marina') {
      for (let i = 0; i < 5; i++) box(2, 0.5, 22, white, -20 + i * 10, 0.4, 2, g);
      box(s.w, 0.6, 3, cream, 0, 0.4, -10, g);
      for (let i = 0; i < 9; i++) { const yacht = new THREE.Group(); const L = 6 + r() * 8; yacht.position.set(-24 + i * 5.6, 0.3, 6 + (i % 2) * 7); yacht.rotation.y = Math.PI / 2; g.add(yacht); box(L, 1.4, 2.2, white, 0, 0.7, 0, yacht); box(L * 0.55, 1.1, 1.8, white, -L * 0.1, 1.9, 0, yacht); box(L * 0.5, 0.15, 1.9, blue, -L * 0.1, 1.5, 0, yacht); if (i % 3 === 0) box(L * 0.3, 0.8, 1.4, white, -L * 0.15, 2.9, 0, yacht); yachts.push(yacht); }
      // marina towers behind the quay
      for (let i = 0; i < 4; i++) tower(s.x - 24 + i * 14, s.z - 26, 8, 8, 60 + i * 12, i + 1);
      ly = 16;
    } else if (s.id === 'g-palm') {
      // Palm Chudeirah: trunk from the beach, 16 fronds, a crescent breakwater, villas, palms and the gold-arched hotel
      const top = 0.25; const pg = g;
      box(10, 0.5, 34, sandM, 0, top, -18, pg); box(4, 0.6, 34, asphalt, 0, top + 0.1, -18, pg);
      const spineZ0 = -2, spineZ1 = 26; box(14, 0.5, spineZ1 - spineZ0 + 6, sandM, 0, top, (spineZ0 + spineZ1) / 2, pg);
      for (let i = 0; i < 8; i++) for (const side of [-1, 1]) {
        const zf = spineZ0 + i * ((spineZ1 - spineZ0) / 7); const L = 40 - Math.abs(i - 3.5) * 3.4; const ang = side * (0.25 + i * 0.09);
        const fr = new THREE.Group(); fr.position.set(side * 6, 0, zf); fr.rotation.y = side * (Math.PI / 2 - 0.22 - ang * 0.05); pg.add(fr);
        box(2.6, 0.5, L, sandM, 0, top, L / 2, fr); box(1.2, 0.3, L - 2, lawn, 0, top + 0.2, L / 2, fr);
        for (let v = 6; v < L - 2; v += 7) { const vs = (v % 14 === 6 ? 1 : -1); box(1.8, 2, 1.8, white, vs * 0.9, top + 1.2, v, fr); box(0.8, 0.1, 1.2, pool, -vs * 0.9, top + 0.3, v, fr); }
      }
      const cr = new THREE.Mesh(geo(new THREE.TorusGeometry(56, 2.2, 6, 72, Math.PI * 1.15)), sandM); cr.position.set(0, 0.2, 12); cr.scale.z = 0.25; cr.receiveShadow = true; pg.add(cr);
      cr.rotation.set(-Math.PI / 2, 0, Math.PI * 1.5 - Math.PI * 1.15 / 2); // arc centred on the south side, open towards the beach
      // golden arch hotel at the crescent apex
      { const hg = new THREE.Group(); hg.position.set(0, 0, 68); hg.scale.setScalar(0.6); pg.add(hg); for (const sx of [-1, 1]) box(7, 34, 9, glassMats[4]!, sx * 7, 17, 0, hg); box(21, 6, 9, gold, 0, 31, 0, hg); box(8, 10, 9, cream, 0, 3, 0, hg); dome(3, gold, 0, 34, 0, hg); }
      for (let i = 0; i < 40; i++) { const a = Math.PI * (0.05 + i / 40 * 0.9); const px = Math.cos(a) * 56, pz = 12 + Math.sin(a) * 56; if (i % 4 === 0) palm(s.x + px, s.z + pz, 0.8); }
      ly = 14;
    }
    const lab = label(`${s.icon} ${s.label}`, undefined, s.id === 'g-exchange' ? '#f2c84a' : '#e8c46a', s.x, ly, s.z); lab.userData.spot = s.id;
  }
  // Burj al Chud: sail-shaped hotel on its own islet off the Corniche
  { const sailM = mat({ color: 0xf6f4ee, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide, emissive: 0x302820, emissiveIntensity: 0.3 }); const g = new THREE.Group(); g.position.set(55, 0, 92); scene.add(g); cyl(9, 1, sandM, 0, 0.2, 0, g); const sail = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.4, 10, 48, 24, 1, false, 0, Math.PI)), sailM); sail.position.set(0, 24, 0); sail.rotation.y = Math.PI * 0.25; sail.scale.z = 0.7; sail.castShadow = true; g.add(sail); cyl(0.6, 52, white, -3, 26, -3, g); box(9, 0.6, 9, gold, -2, 40, -2, g); box(10, 2, 8, white, 0, 1, 4, g); box(2.5, 0.4, 16, cream, 0, 0.6, -14, g); label('⛵ Burj al Chud', 'seven-and-a-half stars', '#e8c46a', 55, 58, 92, 0.8); }

  // ---- oil blocks
  const padM = mat({ color: 0xc8a878, roughness: 1 }); const offPadM = mat({ color: 0x1a6a8a, transparent: true, opacity: 0.22, depthWrite: false }); const buoyM = mat({ color: 0xf2c84a, roughness: 0.5 }); const pads = new Map<number, THREE.Mesh>();
  const blockLabels = new Map<number, THREE.Sprite>();
  for (let n = 1; n <= G_TRACTS; n++) {
    const t = gTractInfo(n);
    if (t.offshore) {
      const p = box(TW, 0.4, TD, offPadM, t.x, 0.2, t.z); p.castShadow = false; p.userData.tract = n; pickables.push(p); pads.set(n, p);
      for (const [bx, bz] of [[-TW / 2, -TD / 2], [TW / 2, -TD / 2], [-TW / 2, TD / 2], [TW / 2, TD / 2]] as const) cyl(0.5, 1.6, buoyM, t.x + bx, 0.4, t.z + bz); // corner buoys
    } else {
      const p = box(TW, 0.3, TD, padM, t.x, 0.15, t.z); p.userData.tract = n; pickables.push(p); pads.set(n, p);
    }
    blockLabels.set(n, label(`${t.offshore ? '🌊' : '🏜'} Block ${n}`, t.name, '#d8b070', t.x, t.offshore ? 22 : 16, t.z, 0.75));
  }

  // ---- dynamic: wells, pipelines, plant units
  const dyn = new THREE.Group(); scene.add(dyn); const dynFlames: THREE.Mesh[] = []; const heads2: THREE.Object3D[] = [];
  const mastM = mat({ color: 0xd8d0c0, metalness: 0.4, roughness: 0.6 }), mastBad = mat({ color: 0x7a5a4a, metalness: 0.4, roughness: 0.6 });
  const legM = mat({ color: 0xf2c84a, roughness: 0.6 }), craneM = mat({ color: 0xf2b630 }), heliM = mat({ color: 0x2a6a3a, roughness: 0.8 }), espGlow = glowM(0x60c0ff, 0x2080ff, 2);
  const pipeM = [mat({ color: 0x9aa2aa, metalness: 0.6, roughness: 0.4 }), mat({ color: 0xd8a83a, metalness: 0.6, roughness: 0.4 })];
  const ownerMats = new Map<string, THREE.MeshStandardMaterial>(); const ownerM = (c: string) => { let m = ownerMats.get(c); if (!m) { m = mat({ color: new THREE.Color(c), emissive: new THREE.Color(c), emissiveIntensity: 0.4 }); ownerMats.set(c, m); } return m; };
  const lineMats = new Map<string, THREE.LineBasicMaterial>(); const lineM = (c: string) => { let m = lineMats.get(c); if (!m) { m = new THREE.LineBasicMaterial({ color: new THREE.Color(c) }); disposables.push(m); lineMats.set(c, m); } return m; };
  const fenceG = geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(TW, 1.2, TD)));
  const derrick = (g: THREE.Group, x: number, z: number, esp: boolean, cond: number, col: string) => {
    const w = new THREE.Group(); w.position.set(x, 0, z); g.add(w);
    box(3, 0.4, 3, conc, 0, 0.2, 0, w); cyl(0.35, 2.4, red, 0, 1.4, 0, w); for (const y of [0.8, 1.6, 2.2]) cyl(0.6, 0.18, steel, 0, y, 0, w);
    // slim lattice mast (tapered)
    cyl(0.25, 10, cond < 15 ? mastBad : mastM, 1.2, 5, 1.2, w, 1.2, 4);
    if (esp) { box(1.4, 1.8, 0.8, blue, -1.6, 0.9, 0, w); box(0.3, 0.3, 0.3, espGlow, -1.6, 1.9, 0.4, w); }
    box(0.6, 0.6, 0.6, ownerM(col), 1.2, 10.4, 1.2, w);
    heads2.push(w);
  };
  const platform = (g: THREE.Group, x: number, z: number, esp: boolean, col: string) => {
    const p = new THREE.Group(); p.position.set(x, 0, z); g.add(p);
    for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) cyl(0.5, 10, legM, lx, 3, lz, p);
    box(9, 1, 9, steel, 0, 8, 0, p); box(7, 3, 4, white, -1, 10, -2, p); cyl(2.2, 0.3, heliM, 2.2, 9.6, 2.4, p); // helipad
    cyl(0.4, 9, red, 3, 13, -3, p); const fl = new THREE.Mesh(sg('gcone', () => new THREE.ConeGeometry(0.6, 1, 10)), flameM); fl.scale.set(0.9, 2.6, 0.9); fl.position.set(3, 18.6, -3); p.add(fl); dynFlames.push(fl);
    const crane = box(0.4, 0.4, 8, craneM, -3.5, 12, 1, p); crane.rotation.x = -0.5;
    if (esp) box(1.6, 1.6, 1.6, blue, 3, 9.3, -0.5, p);
    box(1, 1, 1, ownerM(col), -3.5, 12.4, -3.5, p);
  };
  const unitModel = (k: GUnitKind, g: THREE.Group) => {
    box(10, 0.3, 9, conc, 0, 0.15, 0, g);
    const col = (x: number, zz: number, r0: number, h0: number, m: THREE.Material = steel) => { cyl(r0, h0, m, x, h0 / 2, zz, g); for (let y = 3; y < h0; y += 4) cyl(r0 + 0.2, 0.2, gold, x, y, zz, g); box(0.3, 0.3, 0.3, navRed, x, h0 + 0.2, zz, g); };
    if (k === 'stabilizer') { for (const x of [-2.5, 0.5]) { const v = cyl(1.1, 6, white, x, 1.6, 0, g); v.rotation.z = Math.PI / 2; } col(3.2, -2, 0.7, 7); box(3, 1.6, 2, steel, 2.5, 0.8, 2.5, g); }
    else if (k === 'lng') { for (const x of [-2.6, 2.6]) { sph(2.6, white, x, 3.4, -1, g); cyl(2.8, 1.2, steel, x, 0.6, -1, g, 2.8, 12); } box(8, 2, 2.4, steel, 0, 1, 3, g); col(0, 3, 0.5, 9, white); }
    else if (k === 'refinery') { col(-2.6, -1.5, 1.3, 16); col(0.4, -2.4, 0.8, 11); col(2.6, -1.2, 0.6, 8); box(4, 3, 3, red, 1.6, 1.5, 2.4, g); cyl(0.3, 5, dark, 1.6, 5.5, 2.4, g); }
    else if (k === 'aromatics') { for (let i = 0; i < 3; i++) col(-3 + i * 3, -1.8, 0.7, 9 + i * 2, white); box(8, 2.6, 2.6, gold, 0, 1.3, 2.5, g); }
    else if (k === 'solar') { g.children[0]!.scale.set(14, 0.3, 11); for (let rr = 0; rr < 4; rr++) for (let c = 0; c < 3; c++) { const pnl = box(4, 0.15, 2, blue, -4.5 + c * 4.5, 1.1, -3.6 + rr * 2.5, g); pnl.rotation.x = -0.45; box(0.15, 1, 0.15, steel, -4.5 + c * 4.5, 0.5, -3.6 + rr * 2.5, g); } }
    else if (k === 'tank') { cyl(3.6, 4.5, white, 0, 2.25, 0, g, 3.6, 20); cyl(3.7, 0.3, gold, 0, 4.6, 0, g, 3.7, 20); }
  };
  const PLANT = GULF_SPOTS.find((x) => x.id === 'g-plant')!;
  const slotPos = (k: GUnitKind, i: number): [number, number] => {
    if (k === 'solar') return [PLANT.x - 62 + (i % 2) * 16, PLANT.z - 14 + Math.floor(i / 2) * 13];
    if (k === 'tank') return [PLANT.x + 46 + (i % 2) * 9, PLANT.z - 16 + Math.floor(i / 2) * 8];
    const row = ({ stabilizer: -12, lng: 12, refinery: -12, aromatics: 12 } as Record<string, number>)[k]!;
    const base = ({ stabilizer: -30, lng: -30, refinery: 6, aromatics: 6 } as Record<string, number>)[k]!;
    return [PLANT.x + base + (i % 3) * 11, PLANT.z + row + Math.floor(i / 3) * (row < 0 ? -0.01 : 0.01)];
  };
  let lastGulf: GulfState | null = null; let lastSite: GulfSite | null = null;
  const redraw = () => {
    for (const c of [...dyn.children]) dyn.remove(c); heads2.length = 0; dynFlames.length = 0;
    const counts = new Map<GUnitKind, number>();
    for (const u of lastGulf?.units ?? []) { const i = counts.get(u.k) ?? 0; counts.set(u.k, i + 1); if ((u.k === 'tank' && i >= 10) || i >= 8) continue; const g = new THREE.Group(); const [x, z] = slotPos(u.k, i); g.position.set(x, 0, z); dyn.add(g); unitModel(u.k, g); if (!u.on) g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = conc; }); }
    for (let n = 1; n <= G_TRACTS; n++) {
      const t = gTractInfo(n); const view = lastSite?.tracts.find((x) => x.n === n); const L = lastSite?.leases[String(n)];
      const mine = lastGulf?.tracts[String(n)]; const wells = view?.wells.length ? view.wells : (mine?.wells ?? []).map((w) => ({ ownerKey: 'me', esp: w.esp, cond: w.cond }));
      const pipe = view?.pipe ?? mine?.pipe ?? 0; const col = L ? ownerColor(L.key) : '#e8c46a';
      const g = new THREE.Group(); g.position.set(t.x, 0, t.z); dyn.add(g);
      if (L) { const fence = new THREE.LineSegments(fenceG, lineM(col)); fence.position.y = 0.8; g.add(fence); }
      wells.forEach((w, i) => { const wx = -TW / 2 + 6 + (i % 2) * (TW - 12), wz = -TD / 2 + 6 + Math.floor(i / 2) * (TD - 12); if (t.offshore) platform(g, wx * 0.7, wz * 0.7, w.esp, col); else derrick(g, wx, wz, w.esp, w.cond, col); });
      if (pipe > 0 && t.offshore) { const riser = cyl(pipe > 1 ? 0.7 : 0.45, 10, pipeM[pipe > 1 ? 1 : 0]!, 0, 2, 0, g); riser.position.y = 3; }
      if (pipe > 0 && !t.offshore) { // gathering pipeline on sleepers to the plant (offshore blocks use subsea lines, not drawn)
        const tx = t.offshore ? t.x * 0.6 : PLANT.x - PLANT.w / 2, tz = t.offshore ? GULF_SHORE_Z - 4 : PLANT.z;
        const dx = tx - t.x, dz = tz - t.z; const len = Math.hypot(dx, dz); const pm = pipeM[pipe > 1 ? 1 : 0]!;
        const p = new THREE.Mesh(sg('gpipe', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2)), pm); p.scale.set(pipe > 1 ? 1.4 : 0.9, pipe > 1 ? 1.4 : 0.9, len); p.position.set(dx / 2, t.offshore ? -0.1 : 0.9, dz / 2); p.rotation.y = Math.atan2(dx, dz); g.add(p);
      }
    }
  };
  const setGulf = (s: GulfState | null) => { lastGulf = s; redraw(); };
  const setSite = (s: GulfSite | null) => { lastSite = s; redraw(); };

  // ---- picking
  const ray = new THREE.Raycaster(); ray.layers.enable(LABEL_LAYER); const ndc = new THREE.Vector2();
  const pick = (cx: number, cy: number) => { const rc = canvas.getBoundingClientRect(); ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, camera); const o = ray.intersectObjects(pickables, false)[0]?.object; return (o?.userData.spot ?? (o?.userData.tract ? `t:${o.userData.tract}` : null)) as string | null; };
  let down: { x: number; y: number; drag?: boolean } | null = null;
  const onMove = (e: PointerEvent) => { if (e.pointerType === 'touch') return; if (down && e.buttons) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down.drag = true; h.onHover(null, 0, 0); } if (down.drag) return; } const id = pick(e.clientX, e.clientY); canvas.style.cursor = id ? 'pointer' : 'grab'; h.onHover(id, e.clientX, e.clientY); };
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; h.onHover(null, 0, 0); };
  const onUp = (e: PointerEvent) => { if (!down) return; const dragged = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || !!down.drag; down = null; if (dragged) return; const id = pick(e.clientX, e.clientY); if (!id) return; h.onHover(null, 0, 0); h.onPick(id); };
  const onLeave = () => h.onHover(null, 0, 0);
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointerleave', onLeave);

  const resize = () => { const w = canvas.clientWidth || 1, hh = canvas.clientHeight || 1; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.fov = w < hh ? 62 : 38; camera.updateProjectionMatrix(); };
  let composer: EffectComposer | null = null;
  if (tier !== 'low') { composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.97)); composer.addPass(new OutputPass()); }
  const ro = new ResizeObserver(() => { resize(); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1); } }); ro.observe(canvas); resize();
  { const pm = new THREE.InstancedMesh(BOX(), palmTrunk, palms.length); palms.forEach((m, i) => pm.setMatrixAt(i, m)); pm.castShadow = true; scene.add(pm); const fm = new THREE.InstancedMesh(BOX(), palmLeaf, fronds.length); fronds.forEach((m, i) => fm.setMatrixAt(i, m)); fm.castShadow = true; scene.add(fm); }
  setGulf(null);
  const todOverride = parseTod(new URLSearchParams(location.search).get('tod')); const dirV = new THREE.Vector3();
  const applySky = () => {
    const k = skyNow(new Date(), todOverride); const fog = scene.fog as THREE.Fog;
    (skyU.uSky.value as THREE.Color).setHex(k.sky); (skyU.uHor.value as THREE.Color).setHex(mixHex(k.horizon, HAZE, 0.35)); skyU.uWarm.value = k.warm; skyU.uStars.value = k.stars;
    fog.color.setHex(mixHex(k.fog, HAZE, 0.35)); fog.near = 380 + 140 * k.day; fog.far = 1000 + 320 * k.day;
    hemi.color.setHex(k.hemiSky); hemi.groundColor.setHex(mixHex(k.hemiGround, 0x9a7a50, 0.5)); hemi.intensity = Math.max(0.4, k.hemiI); renderer.toneMappingExposure = k.exposure;
    const e = Math.max(k.elev, -2) * Math.PI / 180, a = k.az * Math.PI / 180; dirV.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    if (k.sunI > 0.05) { sun.position.copy(dirV).multiplyScalar(300); sun.color.setHex(k.sunColor); sun.intensity = k.sunI * 0.9; } else { sun.position.set(80, 200, 60); sun.color.setHex(0x9fb4ff); sun.intensity = 0.25 + k.moonI; }
    gulf.mat.uniforms.uDay.value = k.day; (gulf.mat.uniforms.uSun.value as THREE.Vector3).copy(dirV);
    const gk = 0.15 + 0.85 * k.lights; for (const m of glowMats) m.emissiveIntensity = (m.userData.ei as number) * gk;
  };
  applySky(); let skyT = 0;
  const clock = new THREE.Clock(); let raf = 0; let running = true; let time = 0; const tmp = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!running) return; const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    skyT += dt; if (skyT > 1) { skyT = 0; applySky(); } gulf.mat.uniforms.uTime.value = time;
    for (const f of [...flames, ...dynFlames]) f.scale.x = f.scale.z = (f.userData.s0 ??= f.scale.x) * (1 + Math.sin(time * 9 + f.id) * 0.12);
    yachts.forEach((y, i) => { y.position.y = 0.3 + Math.sin(time * 1.2 + i) * 0.12; y.rotation.z = Math.sin(time * 0.9 + i) * 0.03; });
    controls.update(); clampPan();
    const portrait = (canvas.clientWidth || 1) < (canvas.clientHeight || 1);
    for (const s of signs) { const k = labelScale(camera.position.distanceTo(s.getWorldPosition(tmp)), portrait) * (s.userData.k as number); fitLabel(s, k); }
    renderScene(renderer, composer, scene, camera);
  };
  const vis = () => { running = !document.hidden; clock.getDelta(); }; document.addEventListener('visibilitychange', vis); frame();
  void labelRenderer; labelRenderer = renderer;
  return {
    scene, camera, controls, setGulf, setSite,
    setRunning(v: boolean) { running = v; clock.getDelta(); },
    reset() { camera.position.copy(home); controls.target.copy(homeT); },
    view(cam: [number, number, number], tgt: [number, number, number]) { camera.position.set(...cam); controls.target.set(...tgt); controls.update(); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave); controls.dispose(); disposables.forEach((x) => x.dispose()); composer?.dispose(); renderer.dispose(); },
  };
}
