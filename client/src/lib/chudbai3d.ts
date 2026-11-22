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
import { GULF_SPOTS, GULF_X0, GULF_X1, GULF_Z0, GULF_Z1, GULF_SHORE_Z, G_TRACTS, gTractInfo, gulfSpot, type GulfSite, type GulfSpot, type GulfState, type GUnitKind } from '../../../shared/chudbai';
import {
  BEACH_Z0, CAR_L, CAR_W, CHUDBAI_DEEDS, DISTRICTS, DISTRICT_LABELS, GULF_BLOCKS, GULF_LANES, GULF_LOTS, GULF_PROPS, GULF_ROADS, METRO_GUIDEWAY, METRO_PILLARS, METRO_STATIONS, METRO_X0, METRO_X1, METRO_Y,
  PALM_CRESCENT, PALM_FRONDS, PALM_HOTEL, PALM_SPINE, PALM_VILLAS, PIPE_CORRIDOR, PLANT_FLARE, PLANT_RACK, Z_HWY, carX, carriage, isHorizontal, medianRect, padRect, pipeStub, spotRect, unitSlot, walkSegments, wellSlot,
  type MatKey, type Part, type Rect,
} from '../../../shared/chudbaiCity';

type Handlers = { onHover: (id: string | null, x: number, y: number) => void; onPick: (id: string) => void };
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
export const clampGulfTarget = (x: number, z: number): [number, number] => [Math.min(GULF_X1 - 10, Math.max(GULF_X0 + 10, x)), Math.min(GULF_Z1 - 10, Math.max(GULF_Z0 + 10, z))];
const TW = 30, TD = 26;
const cx = (r: Rect) => (r.x0 + r.x1) / 2, cz = (r: Rect) => (r.z0 + r.z1) / 2, rw = (r: Rect) => r.x1 - r.x0, rd = (r: Rect) => r.z1 - r.z0;
const inRect = (x: number, z: number, r: Rect, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

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
  Object.assign(sun.shadow.camera, { left: -340, right: 340, top: 340, bottom: -340, near: 10, far: 900 }); sun.shadow.mapSize.set(tier === 'high' ? 4096 : 2048, tier === 'high' ? 4096 : 2048); sun.shadow.bias = -0.0005; scene.add(sun);

  // Ground: sand with dunes outside the built-up areas (pads, plant, city stay flat).
  // the whole built-up strip (city, oilfield, plant, airport) is flat; dunes rise beyond it
  const flatAt = (x: number, z: number) => (x > GULF_X0 - 14 && x < GULF_X1 + 14 && z > GULF_Z0 + 4 ? 1 : 0);
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
      if (x > GULF_X0 && x < GULF_X1 && z > Z_HWY - 16 && z < BEACH_Z0) c.lerp(new THREE.Color(0xcdbfa4), 0.7); // paved city south of the highway
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
  const conc = mat({ color: 0xb8ae9c, roughness: 0.95 }); const asphalt = mat({ color: 0x3a3a3e, roughness: 1 });
  const red = mat({ color: 0xb0302a, roughness: 0.6 }); const blue = mat({ color: 0x1f3d6a, metalness: 0.5, roughness: 0.25 });
  const flameM = mat({ color: 0xffa040, emissive: 0xff7a20, emissiveIntensity: 4 });
  const navRed = glowM(0xff3030, 0xff2020, 2.2); const lampHead = glowM(0xfff1c8, 0xffcc66, 2.6);
  const palmTrunk = mat({ color: 0x8a6a44, roughness: 0.9 }); const palmLeaf = mat({ color: 0x3f7a3a, roughness: 0.8, side: THREE.DoubleSide });
  const sandM = mat({ color: 0xe9d3a0, roughness: 1 }); const lawn = mat({ color: 0x5f9a4a, roughness: 1 }); const pool = mat({ color: 0x3fc4e0, roughness: 0.15, metalness: 0.1, emissive: 0x0a4050, emissiveIntensity: 0.4 });
  const paving = mat({ color: 0xd9cdb4, roughness: 0.95 }); const kerb = mat({ color: 0xc9c2b4, roughness: 0.9 }); const stripe = mat({ color: 0xf4f0e0, roughness: 0.8 });
  const wood = mat({ color: 0x7a5232, roughness: 0.85 }); const sailCloth = mat({ color: 0xf4efe2, roughness: 0.7, side: THREE.DoubleSide });
  const winTex = (tint: string, lit: string, off = 'rgba(255,255,255,0.10)', rows = 32, cols = 8, wPx = 6) => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d')!; x.fillStyle = tint; x.fillRect(0, 0, 64, 128);
    const rh = 128 / rows, cw = 64 / cols; for (let rr = 0; rr < rows; rr++) for (let q = 0; q < cols; q++) { const on = Math.abs(Math.sin(rr * 12.9 + q * 78.2) * 43758 % 1); x.fillStyle = on > 0.55 ? lit : off; x.fillRect(q * cw + (cw - wPx) / 2, rr * rh + rh * 0.25, wPx, rh * 0.5); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; disposables.push(t); return t; };
  const TINTS = [['#6f9cc0', '#ffe0a0'], ['#8fb4bc', '#fff0c0'], ['#4f7a9e', '#ffd890'], ['#b8c6d0', '#fff4d0'], ['#c9b48c', '#ffe6b0']];
  const WALLS = ['#e8dcc4', '#d8c8a8', '#f0ebe0', '#c8b490'];
  const glassCache = new Map<string, THREE.MeshStandardMaterial>();
  /** Glass curtain wall of height `hgt`: the window texture repeats every ~16 m so panes keep their size. */
  const glassFor = (style: number, hgt: number) => { const i = style % TINTS.length; const rep = Math.max(1, Math.round(hgt / 16)); const key = `g${i}:${rep}`; let m = glassCache.get(key);
    if (!m) { const t = winTex(TINTS[i]![0]!, TINTS[i]![1]!); t.repeat.set(1, rep); m = mat({ color: 0xffffff, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.5, metalness: 0.55, roughness: 0.18, envMapIntensity: 1 }); m.userData.ei = 0.5; glowMats.push(m); glassCache.set(key, m); }
    return m; };
  /** Stucco wall with punched windows (one row per ~3.5 m floor). */
  const wallFor = (style: number, hgt: number) => { const i = style % WALLS.length; const rep = Math.max(1, Math.round(hgt / 3.5)); const key = `w${i}:${rep}`; let m = glassCache.get(key);
    if (!m) { const t = winTex(WALLS[i]!, '#ffe2a8', '#5a6470', 1, 5, 5); t.repeat.set(1, rep); m = mat({ color: 0xffffff, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12, roughness: 0.85 }); m.userData.ei = 0.12; glowMats.push(m); glassCache.set(key, m); }
    return m; };
  const glassMats = TINTS.map((_, i) => glassFor(i, 32));
  const FLAT: Record<string, THREE.Material> = {
    cream, stone: mat({ color: 0xcdb48a, roughness: 0.9 }), white, gold, goldGlow, dark, steel, conc, paving, lawn, pool, lot: mat({ color: 0x4a4a4e, roughness: 1 }), metal: mat({ color: 0x8a96a0, metalness: 0.6, roughness: 0.45 }),
    awning0: mat({ color: 0xc0392b, roughness: 0.8 }), awning1: mat({ color: 0x2a7a6a, roughness: 0.8 }), awning2: mat({ color: 0xd8a040, roughness: 0.8 }), navRed, door: mat({ color: 0x5a3a24, roughness: 0.7 }), truck: mat({ color: 0xd84a2a, roughness: 0.6 }), teal: mat({ color: 0x2a9a9a, metalness: 0.3, roughness: 0.35 }),
  };
  const matFor = (k: MatKey, hgt: number): THREE.Material => k.startsWith('glass') ? glassFor(Number(k.slice(5)), hgt) : k.startsWith('wall') ? wallFor(Number(k.slice(4)), hgt) : FLAT[k]!;

  const box = (w: number, hh: number, dd: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(BOX(), m); o.scale.set(w, hh, dd); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
  const cyl = (rt: number, hh: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene, rb = rt, seg = 16) => { const k = Math.round((rb / rt) * 20) / 20; const o = new THREE.Mesh(sg(`gcyl${k}:${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5 * k, 1, seg)), m); o.scale.set(rt * 2, hh, rt * 2); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const sph = (rad: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(SPH(), m); o.scale.setScalar(rad * 2); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const DOME_G = () => sg('gdome', () => new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  const CONE_G = () => sg('gcone1', () => new THREE.ConeGeometry(0.5, 1, 12).translate(0, 0.5, 0));
  const CYL_G = () => sg('gcyl1:16', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16));
  const dome = (rad: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(DOME_G(), m); o.scale.setScalar(rad * 2); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const slab = (r: Rect, y0: number, y1: number, m: THREE.Material, parent: THREE.Object3D = scene) => { const o = box(rw(r), y1 - y0, rd(r), m, cx(r), (y0 + y1) / 2, cz(r), parent); o.castShadow = y1 - y0 > 0.6; return o; };

  const signs: THREE.Sprite[] = []; let labelRenderer = renderer;
  const label = (text: string, sub: string | undefined, color: string, x: number, y: number, z: number, k = 1) => {
    const tex = cityLabel(text, color, sub, labelRenderer); disposables.push(tex); const m = labelMaterial(tex, { fog: false }); disposables.push(m);
    const s = asLabel(new THREE.Sprite(m)); s.position.set(x, y, z); s.userData.k = k; fitLabel(s, 8 * k); scene.add(s); signs.push(s); return s;
  };
  // ---- instanced batches: one InstancedMesh per (shape, material)
  type Shape = 'box' | 'cyl' | 'dome' | 'cone';
  const batches = new Map<string, { s: Shape; m: THREE.Material; mats: THREE.Matrix4[] }>(); const q0 = new THREE.Quaternion(); const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const put = (s: Shape, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, q = q0) => {
    const key = `${s}|${m.uuid}`; let b = batches.get(key); if (!b) { b = { s, m, mats: [] }; batches.set(key, b); }
    b.mats.push(new THREE.Matrix4().compose(v1.set(x, y, z), q, v2.set(sx, sy, sz)));
  };
  const putPart = (p: Part) => {
    const m = matFor(p.m, p.h);
    if (p.s === 'box') put('box', m, p.x, p.y0 + p.h / 2, p.z, p.w, p.h, p.d);
    else if (p.s === 'cyl') put('cyl', m, p.x, p.y0 + p.h / 2, p.z, p.w, p.h, p.d);
    else if (p.s === 'dome') put('dome', m, p.x, p.y0, p.z, p.w, p.h * 2, p.d);
    else put('cone', m, p.x, p.y0, p.z, p.w, p.h, p.d);
  };
  const flushBatches = () => { for (const b of batches.values()) { const g = b.s === 'box' ? BOX() : b.s === 'cyl' ? CYL_G() : b.s === 'dome' ? DOME_G() : CONE_G(); const im = new THREE.InstancedMesh(g, b.m, b.mats.length); b.mats.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im); disposables.push({ dispose: () => im.dispose() }); } batches.clear(); };

  // palms (instanced trunks + fronds); deterministic frond angles
  const palms: THREE.Matrix4[] = [], fronds: THREE.Matrix4[] = [];
  const palm = (x: number, z: number, s = 1) => { palms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 3.5 * s, z), q0, new THREE.Vector3(0.35 * s, 7 * s, 0.35 * s))); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + r() * 0.6; const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, a, 0, 'YXZ')); fronds.push(new THREE.Matrix4().compose(new THREE.Vector3(x + Math.sin(a) * 0.9 * s, 7 * s, z + Math.cos(a) * 0.9 * s), qq, new THREE.Vector3(0.7 * s, 0.08 * s, 1.8 * s))); } };

  // ---- ground pads under each city block (subtle district tint), the beach promenade
  for (const b of GULF_BLOCKS) { const c = new THREE.Color(DISTRICTS[b.district].color).lerp(new THREE.Color(0xd9cdb4), 0.6); put('box', FLAT[`blk:${b.district}`] ??= mat({ color: c, roughness: 1 }), cx(b.r), 0.03, cz(b.r), rw(b.r), 0.06, rd(b.r)); }

  /** Perpendicular carriageways crossing a horizontal road at x (medians and lane lines stop there). */
  const crossers = (r0: (typeof GULF_ROADS)[number]) => GULF_ROADS.filter((o) => isHorizontal(o) !== isHorizontal(r0) && (isHorizontal(r0) ? o.z0 <= r0.z0 + r0.w / 2 && o.z1 >= r0.z0 - r0.w / 2 && o.x0 >= r0.x0 && o.x0 <= r0.x1 : o.x0 <= r0.x0 + r0.w / 2 && o.x1 >= r0.x0 - r0.w / 2 && o.z0 >= r0.z0 && o.z0 <= r0.z1)).map(carriage);
  const crossAt = (r0: (typeof GULF_ROADS)[number], x: number, pad: number) => crossers(r0).some((c) => x > c.x0 - pad && x < c.x1 + pad);
  const cutAtCrossings = (r0: (typeof GULF_ROADS)[number], m: Rect): Rect[] => { const hz = isHorizontal(r0); let spans: Array<[number, number]> = [[hz ? m.x0 : m.z0, hz ? m.x1 : m.z1]];
    for (const c of crossers(r0)) { const a = (hz ? c.x0 : c.z0) - 1, b = (hz ? c.x1 : c.z1) + 1; spans = spans.flatMap(([s0, s1]) => (b <= s0 || a >= s1) ? [[s0, s1] as [number, number]] : ([[s0, a], [b, s1]] as Array<[number, number]>).filter(([p, q]) => q - p > 1)); }
    return spans.map(([s0, s1]) => (hz ? { x0: s0, z0: m.z0, x1: s1, z1: m.z1 } : { x0: m.x0, z0: s0, x1: m.x1, z1: s1 })); };
  // ---- roads: carriageway, lane stripes, raised medians with lawn, sidewalks; causeways where a road runs out over the water
  for (const rd0 of GULF_ROADS) {
    const c = carriage(rd0); put('box', asphalt, cx(c), 0.05, cz(c), rw(c), 0.1, rd(c));
    if (c.z1 > BEACH_Z0) { const wet = { ...c, z0: Math.max(c.z0, BEACH_Z0) }; put('box', sandM, cx(wet), -0.9, cz(wet), rw(wet) + 2, 1.9, rd(wet)); }
    const m = medianRect(rd0); if (m) for (const seg of cutAtCrossings(rd0, m)) { put('box', kerb, cx(seg), 0.15, cz(seg), rw(seg), 0.3, rd(seg)); put('box', lawn, cx(seg), 0.31, cz(seg), rw(seg) - 0.4, 0.02, rd(seg) - 0.4); }
    for (const w of walkSegments(rd0)) put('box', paving, cx(w), 0.09, cz(w), rw(w), 0.18, rd(w));
    if (isHorizontal(rd0) && rd0.w >= 10) { // dashed lane lines between same-direction lanes, solid edge lines
      const per = (rd0.w - rd0.median) / 2; const lanes = per >= 7 ? 2 : 1;
      for (const side of [-1, 1]) { if (lanes === 2) for (let x = rd0.x0 + 4; x < rd0.x1 - 4; x += 8) if (!crossAt(rd0, x, 2)) put('box', stripe, x, 0.105, rd0.z0 + side * (rd0.median / 2 + per / 2), 3, 0.01, 0.18); }
    }
  }
  // zebra crossings on the Corniche and Al Wasl where an avenue meets them
  for (const h0 of GULF_ROADS.filter((o) => isHorizontal(o) && (o.id === 'wasl' || o.id === 'cor'))) for (const v of GULF_ROADS.filter((o) => !isHorizontal(o) && o.z0 <= h0.z0 && o.z1 >= h0.z0 && o.x0 > h0.x0 && o.x0 < h0.x1)) {
    for (const side of [-1, 1]) { const x = v.x0 + side * (v.w / 2 + 1.2); for (let z = h0.z0 - h0.w / 2 + 0.6; z < h0.z0 + h0.w / 2 - 0.5; z += 1.2) if (!(h0.median && Math.abs(z - h0.z0) < h0.median / 2)) put('box', stripe, x, 0.106, z + 0.3, 2, 0.01, 0.6); }
  }

  // ---- city lots: every part of every building, exactly as laid out in shared/chudbaiCity.ts
  const pickables: THREE.Object3D[] = []; const flames: THREE.Mesh[] = []; const yachts: THREE.Group[] = [];
  const hitM = new THREE.MeshBasicMaterial({ visible: false }); disposables.push(hitM);
  const hitBox = (r: Rect, y1: number, id: string) => { const o = box(rw(r), y1, rd(r), hitM, cx(r), y1 / 2, cz(r)); o.castShadow = o.receiveShadow = false; o.userData.spot = id; pickables.push(o); return o; };
  for (const l of GULF_LOTS) { for (const p of l.parts) putPart(p); for (const p of l.palms) palm(p.x, p.z, p.s); if (l.deed) hitBox(l.r, l.h, l.deed); }

  // ---- street props
  const benchM = wood, shelterGlass = mat({ color: 0x9fc4d8, transparent: true, opacity: 0.45, roughness: 0.1 });
  for (const p of GULF_PROPS) {
    if (p.k === 'lamp') { put('box', steel, p.x, 3, p.z, 0.22, 6, 0.22); put('box', lampHead, p.x, 6.2, p.z, 0.5, 0.25, 0.5); }
    else if (p.k === 'palm') palm(p.x, p.z, p.s);
    else if (p.k === 'bench') { put('box', benchM, p.x, 0.45, p.z, 1.8, 0.12, 0.6); put('box', steel, p.x, 0.22, p.z, 1.6, 0.44, 0.1); put('box', benchM, p.x, 0.75, p.z + 0.25, 1.8, 0.4, 0.08); }
    else { put('box', steel, p.x - 1.9, 1.3, p.z, 0.12, 2.6, 1.3); put('box', steel, p.x + 1.9, 1.3, p.z, 0.12, 2.6, 1.3); put('box', gold, p.x, 2.62, p.z, 4, 0.16, 1.4); put('box', shelterGlass, p.x, 1.3, p.z - 0.6, 3.7, 2.4, 0.06); put('box', benchM, p.x, 0.45, p.z - 0.2, 3, 0.1, 0.5); }
  }

  // ---- metro: elevated guideway on the highway median, pillars, five stations and a driverless train
  { const gw = METRO_GUIDEWAY; put('box', conc, cx(gw), (gw.y0 + gw.y1) / 2, cz(gw), rw(gw), gw.y1 - gw.y0, rd(gw)); put('box', gold, cx(gw), gw.y1 + 0.02, Z_HWY - 1.15, rw(gw), 0.04, 0.1); put('box', gold, cx(gw), gw.y1 + 0.02, Z_HWY + 1.15, rw(gw), 0.04, 0.1); }
  for (const p of METRO_PILLARS) put('box', conc, p.x, METRO_Y / 2, p.z, 1.6, METRO_Y, 1.6);
  const metroTop = METRO_Y + 1.4;
  for (const s of METRO_STATIONS) {
    for (const side of [-1, 1]) { put('box', paving, s.x, metroTop + 0.3, Z_HWY + side * 3.4, 28, 0.6, 4); put('box', shelterGlass, s.x, metroTop + 2.6, Z_HWY + side * 5.7, 27.6, 4, 0.12); }
    const roof = new THREE.Mesh(sg('groof', () => new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)), gold); roof.scale.set(6, 0.9, 28); roof.rotation.y = Math.PI / 2; roof.position.set(s.x, METRO_Y + 6 - 0.9, Z_HWY); roof.castShadow = true; scene.add(roof);
    label(`Ⓜ ${s.name}`, undefined, '#e05040', s.x, METRO_Y + 11, Z_HWY, 0.55);
  }
  const train = new THREE.Group(); scene.add(train); const trainM = mat({ color: 0xe8ecef, metalness: 0.5, roughness: 0.3 }); const trainWin = glowM(0x2a3a4a, 0x88b8ff, 0.6);
  for (let i = 0; i < 4; i++) { box(11, 2.6, 2.1, trainM, i * 11.6, metroTop + 1.4, 0, train); box(10, 0.8, 2.15, trainWin, i * 11.6, metroTop + 1.9, 0, train); box(11, 0.3, 2.15, FLAT.awning0!, i * 11.6, metroTop + 0.9, 0, train); }
  train.position.z = Z_HWY - 0.45; const TRAIN_LEN = 4 * 11.6;

  // ---- traffic: instanced car bodies + cabins (east-west lanes; positions from the shared lanes)
  const nCars = GULF_LANES.reduce((a, l) => a + l.n, 0);
  const carBody = new THREE.InstancedMesh(BOX(), mat({ color: 0xffffff, metalness: 0.6, roughness: 0.35 }), nCars); const carCab = new THREE.InstancedMesh(BOX(), mat({ color: 0x1a2028, metalness: 0.4, roughness: 0.2 }), nCars);
  { const pal = [0xf4f4f2, 0x111318, 0xd8a83a, 0xb02a2a, 0x8a96a0, 0xf4f4f2, 0x1f3d6a, 0xe8dcc4]; const c = new THREE.Color(); for (let i = 0; i < nCars; i++) carBody.setColorAt(i, c.setHex(pal[i % pal.length]!)); }
  carBody.castShadow = true; scene.add(carBody, carCab); disposables.push({ dispose: () => { carBody.dispose(); carCab.dispose(); } });
  const mm = new THREE.Matrix4(); const carScale = new THREE.Vector3(CAR_L, 0.9, CAR_W), cabScale = new THREE.Vector3(CAR_L * 0.5, 0.7, CAR_W * 0.9);
  const moveCars = (t: number) => { let k = 0; for (const l of GULF_LANES) for (let i = 0; i < l.n; i++, k++) { const x = carX(l, i, t); carBody.setMatrixAt(k, mm.compose(v1.set(x, 0.62, l.z), q0, carScale)); carCab.setMatrixAt(k, mm.compose(v1.set(x - l.dir * 0.3, 1.42, l.z), q0, cabScale)); } carBody.instanceMatrix.needsUpdate = carCab.instanceMatrix.needsUpdate = true; carBody.computeBoundingSphere(); carCab.computeBoundingSphere(); };
  moveCars(0);

  // ---- landmarks: each one drawn inside its own footprint (spot rect × spot height)
  const spotGroups = new Map<string, THREE.Group>(); const fountainJets: THREE.Mesh[] = []; const boats: THREE.Group[] = [];
  const yachtAt = (g: THREE.Group, x: number, z: number, L: number, rot = Math.PI / 2) => { const y = new THREE.Group(); y.position.set(x, 0.3, z); y.rotation.y = rot; g.add(y); box(L, 1.2, 2.2, white, 0, 0.6, 0, y); box(L * 0.55, 1, 1.8, white, -L * 0.1, 1.7, 0, y); box(L * 0.5, 0.15, 1.9, blue, -L * 0.1, 1.3, 0, y); yachts.push(y); return y; };
  const dhowAt = (g: THREE.Group, x: number, z: number, L: number) => { const d = new THREE.Group(); d.position.set(x, 0.2, z); g.add(d); box(L, 1.3, 2.6, wood, 0, 0.5, 0, d); box(L * 0.3, 0.9, 2.4, wood, -L * 0.32, 1.5, 0, d); cyl(0.12, 4.8, wood, L * 0.1, 2.9, 0, d); const s = new THREE.Mesh(sg('gsail', () => new THREE.PlaneGeometry(1, 1)), sailCloth); s.scale.set(L * 0.55, 3.2, 1); s.position.set(L * 0.15, 3.0, 0.05); s.rotation.z = -0.25; d.add(s); boats.push(d); return d; };
  for (const s of GULF_SPOTS) {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z); scene.add(g); spotGroups.set(s.id, g); const W = s.w / 2, D = s.d / 2;
    if (s.id !== 'g-palm') hitBox(spotRect(s), s.h, s.id);
    let ly = s.h + 8;
    if (s.id === 'g-burj') {
      // Burj Chudifa: podium, a Y-plan of stepped wings around a core, a gold-tipped spire. At the Top deck at ~165 m.
      box(24, 4, 24, cream, 0, 2, 0, g); box(24.4, 0.4, 24.4, gold, 0, 4.1, 0, g);
      const m = glassFor(3, 12.5); const tiers = 13;
      for (let i = 0; i < tiers; i++) { const k = 1 - i / tiers; const y0 = 4 + i * 12.5; for (let wv = 0; wv < 3; wv++) { const a = wv * Math.PI * 2 / 3; const wing = box(4.2 * k + 1.4, 12.5, 9 * k + 2, m, Math.sin(a) * 3.2 * k, y0 + 6.25, Math.cos(a) * 3.2 * k, g); wing.rotation.y = a; } box(0.3, 0.6, 0.3, gold, 0, y0 + 12.5, 0, g); }
      const top = 4 + tiers * 12.5; cyl(2.2, 10, m, 0, top + 5, 0, g, 3); box(5, 0.5, 5, goldGlow, 0, top - 2, 0, g);
      cyl(0.6, 28, steel, 0, top + 24, 0, g, 1.6); cyl(0.25, 7, gold, 0, top + 41.5, 0, g, 0.6); box(0.6, 0.6, 0.6, navRed, 0, top + 45.3, 0, g);
      ly = top + 52;
    } else if (s.id === 'g-fountain') {
      box(s.w, 0.5, s.d, paving, 0, 0.25, 0, g); box(s.w - 3, 0.3, s.d - 3, pool, 0, 0.55, 0, g);
      const jetM = glowM(0xe8f8ff, 0x9ad8ff, 1.4); for (let i = 0; i < 9; i++) { const j = cyl(0.18, 1, jetM, -12 + i * 3, 0.7, 0, g); j.castShadow = false; fountainJets.push(j); }
    } else if (s.id === 'g-mall') {
      box(s.w, 12, s.d, wallFor(2, 12), 0, 6, 0, g); box(s.w + 0.01, 1, s.d + 0.01, gold, 0, 12.5, 0, g); box(s.w - 4, 3, s.d - 6, glassMats[1]!, 0, 14.5, 0, g);
      box(0.6, 7, 14, glassMats[3]!, -W + 0.31, 3.5, 0, g); box(1.2, 0.8, 16, goldGlow, -W + 0.6, 7.6, 0, g); // west entrance onto Souk Rd
    } else if (s.id === 'g-exchange') {
      box(22, 5, 18.5, cream, 0, 2.5, 0, g); box(22.4, 0.5, 18.9, gold, 0, 5.2, 0, g);
      const m = glassFor(0, 3); const floors = 28;
      for (let i = 0; i < floors; i++) { const sl = box(11, 3, 11, m, 0, 5.5 + 1.5 + i * 3, 0, g); sl.rotation.y = i * 0.045; if (i % 5 === 4) { const b = box(11.6, 0.4, 11.6, gold, 0, 5.5 + 3 + i * 3, 0, g); b.rotation.y = i * 0.045; } }
      cyl(3, 2.5, gold, 0, 5.5 + floors * 3 + 1.25, 0, g, 5, 8); ly = 100;
    } else if (s.id === 'g-souk') {
      box(s.w, 0.4, s.d, FLAT.stone!, 0, 0.2, 0, g);
      for (let i = 0; i < 5; i++) { const x = -13 + i * 6.5; box(5.6, 6, 14, cream, x, 3.4, 0, g); dome(2.5, gold, x, 6.4, 0, g); for (let a = 0; a < 2; a++) box(1.4, 3, 0.2, goldGlow, x - 1 + a * 2, 1.9, -7.05, g); }
      box(3, 9.2, 3, cream, 15, 5, 8.6, g); box(3, 0.3, 3, gold, 15, 9.75, 8.6, g); // wind tower
    } else if (s.id === 'g-dhow') {
      // timber wharf on the beach and three dhows moored in the creek mouth
      box(s.w, 0.6, 6, wood, 0, 0.6, -D + 3, g); for (let x = -W + 1; x < W; x += 4) cyl(0.25, 2.4, wood, x, -0.3, -D + 5.6, g);
      box(8, 3.2, 4, FLAT.stone!, -W + 5, 2.5, -D + 2.2, g); box(8.4, 0.3, 4.4, wood, -W + 5, 4.2, -D + 2.2, g); // boat-hire hut
      dhowAt(g, -9, 2, 11); dhowAt(g, 4, 6, 12); dhowAt(g, 12, -1, 9);
    } else if (s.id === 'g-airport') {
      box(s.w, 0.12, 6, FLAT.lot!, 0, 0.06, -D + 3, g); for (let i = 0; i < 9; i++) box(4, 0.13, 0.4, white, -W + 4 + i * 8, 0.07, -D + 3, g);
      box(40, 5, 6, glassMats[1]!, -12, 2.5, D - 3, g); { const roof = new THREE.Mesh(sg('groof', () => new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)), gold); roof.scale.set(3, 2.2, 42); roof.position.set(-12, 5, D - 3); roof.rotation.y = Math.PI / 2; roof.castShadow = true; g.add(roof); }
      cyl(1, 13, cream, 30, 6.5, D - 3, g); cyl(2.4, 3, glassMats[2]!, 30, 14.5, D - 3, g, 1.8); cyl(2.6, 0.5, gold, 30, 16.25, D - 3, g); box(0.6, 0.6, 0.6, navRed, 30, 16.9, D - 3, g);
      { const p = new THREE.Group(); p.position.set(18, 0, -1); g.add(p); const f = cyl(1.3, 16, white, 0, 2.4, 0, p); f.rotation.z = Math.PI / 2; box(3.4, 0.35, 15, white, 0.5, 2, 0, p); box(2.4, 4, 0.35, gold, -7, 4.6, 0, p); box(1.6, 0.25, 6, white, -7, 3, 0, p); } // a Chudbai Air jet on the apron
      ly = 26;
    } else if (s.id === 'g-plant') {
      box(s.w, 0.3, s.d, conc, 0, 0.15, 0, g);
      { const rk = PLANT_RACK; box(rw(rk), 0.6, rd(rk), steel, cx(rk) - s.x, 6.7, cz(rk) - s.z, g); for (let x = rk.x0 + 2; x < rk.x1; x += 8) box(0.4, 6.4, rd(rk), dark, x - s.x, 3.2, cz(rk) - s.z, g); }
      { const f = PLANT_FLARE; cyl(0.9, 21, steel, cx(f) - s.x, 10.5, cz(f) - s.z, g); box(0.5, 0.5, 0.5, navRed, cx(f) - s.x, 21.3, cz(f) - s.z, g); const fl = new THREE.Mesh(sg('gcone', () => new THREE.ConeGeometry(0.6, 1, 10)), flameM); fl.scale.set(1.4, 3.6, 1.4); fl.position.set(cx(f) - s.x, 23.4, cz(f) - s.z); g.add(fl); flames.push(fl); }
      ly = 36;
    } else if (s.id === 'g-marina') {
      box(s.w, 0.6, 3, cream, 0, 0.4, -D + 1.5, g);
      for (let i = 0; i < 5; i++) box(1.6, 0.4, 22, white, -W + 6 + i * 12, 0.3, -D + 14, g);
      for (let i = 0; i < 10; i++) yachtAt(g, -W + 3.2 + (i >> 1) * 12 + (i % 2) * 5.6, -D + 12 + (i % 3) * 4, 7 + (i % 4) * 1.5);
    } else if (s.id === 'g-sail') {
      cyl(10.5, 1.2, sandM, 0, 0.1, 0, g, 10.5, 32); box(9, 2.4, 6, white, 0, 1.9, 4, g);
      const sailM = mat({ color: 0xf6f4ee, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide, emissive: 0x302820, emissiveIntensity: 0.3 });
      const sail = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.4, 9, 46, 24, 1, false, 0, Math.PI)), sailM); sail.position.set(0, 23.7, 0); sail.rotation.y = Math.PI * 0.25; sail.scale.z = 0.7; sail.castShadow = true; g.add(sail);
      cyl(0.6, 50, white, -3, 25.7, -3, g); box(8, 0.6, 8, gold, -2, 40, -2, g); ly = 60;
    } else if (s.id === 'g-port') {
      // Jebel Chud container port: apron to the quay wall, stacks, three gantry cranes and a ship at the berth
      const quayZ = GULF_SHORE_Z + 2 - s.z; box(s.w, 0.8, quayZ + D, conc, 0, 0.4, (quayZ - D) / 2, g);
      const cols = [0xc0392b, 0x2a6a9a, 0xd8a040, 0x3a8a4a, 0x8a96a0, 0xe8e4d8]; const cm = cols.map((c) => mat({ color: c, roughness: 0.7 }));
      for (let row = 0; row < 6; row++) for (let c = 0; c < 4; c++) { const n = 1 + ((row * 7 + c * 3) % 3); for (let k = 0; k < n; k++) put('box', cm[(row + c + k) % cm.length]!, s.x - W + 9 + c * 12, 0.8 + 1.3 + k * 2.6, s.z - D + 10 + row * 10, 10, 2.5, 3.4); }
      for (let i = 0; i < 3; i++) { const x = -W + 10 + i * 18; for (const sx of [-3, 3]) box(0.8, 24, 0.8, FLAT.awning0!, x + sx, 12.8, quayZ - 4, g); box(7.6, 1.2, 16, FLAT.awning0!, x, 25, quayZ + 2, g); box(3, 2, 3, white, x, 23, quayZ - 4, g); }
      { const sh = new THREE.Group(); sh.position.set(0, 0, quayZ + 6); g.add(sh); box(50, 3.4, 8, dark, 0, 0.9, 0, sh); box(50, 0.6, 8.1, FLAT.awning0!, 0, 0.2, 0, sh); box(7, 6, 7, white, 20, 5.6, 0, sh); for (let i = 0; i < 6; i++) box(5.6, 2.5, 7, cm[i % cm.length]!, -18 + i * 6.2, 3.85, 0, sh); boats.push(sh); }
      ly = 36;
    } else if (s.id === 'g-palm') {
      // Palm Chudeirah: spine, sixteen fronds, the crescent breakwater, frond villas, two Signature Villas and the crescent hotel
      const top = 0.5; const rel = (rr: Rect) => ({ x0: rr.x0 - s.x, z0: rr.z0 - s.z, x1: rr.x1 - s.x, z1: rr.z1 - s.z });
      const land = (rr: Rect, id: string) => { const o = slab(rel(rr), -1.5, top, sandM, g); o.userData.spot = id; pickables.push(o); slab(rel({ x0: rr.x0 + 0.6, z0: rr.z0 + 0.6, x1: rr.x1 - 0.6, z1: rr.z1 - 0.6 }), top, top + 0.05, lawn, g); };
      land(PALM_SPINE, 'g-palm'); for (const f of PALM_FRONDS) land(f.r, 'g-palm');
      const segs = 36; const C = PALM_CRESCENT;
      for (let i = 0; i < segs; i++) { const a = C.a0 + (C.a1 - C.a0) * (i + 0.5) / segs; const len = C.r * (C.a1 - C.a0) / segs + 0.4; const o = box(len, 2, C.width, sandM, C.x - s.x + Math.cos(a) * C.r, -0.5, C.z - s.z + Math.sin(a) * C.r, g); o.rotation.y = -(a + Math.PI / 2); o.userData.spot = 'g-palm'; pickables.push(o); }
      for (const v of PALM_VILLAS) { const rr = rel(v.r); if (v.deed) { slab(rr, top, top + 4, white, g); slab({ x0: rr.x0 + 0.5, z0: rr.z0 + 0.5, x1: rr.x1 - 0.5, z1: rr.z1 - 0.5 }, top + 4, top + 4.4, gold, g); hitBox(v.r, 8, v.deed); } else { slab(rr, top, top + 2.6, white, g); } }
      { const hr = rel(PALM_HOTEL); slab(hr, top, top + 4, cream, g); for (const sx of [-1, 1]) slab({ x0: cx(hr) + sx * 5.5 - 2, z0: hr.z0 + 0.3, x1: cx(hr) + sx * 5.5 + 2, z1: hr.z1 - 0.3 }, top + 4, 19, glassMats[4]!, g); slab({ x0: hr.x0 + 1, z0: hr.z0 + 0.4, x1: hr.x1 - 1, z1: hr.z1 - 0.4 }, 17, 20, gold, g); dome(1.8, gold, cx(hr), 20, cz(hr), g); }
      for (const f of PALM_FRONDS) for (let x = f.r.x0 + 2.5; x < f.r.x1 - 2; x += 6) if (!PALM_VILLAS.some((v) => inRect(x, cz(f.r), v.r, 1.6))) palm(x, cz(f.r), f.signature ? 0.55 : 0.45);
      ly = 30;
    }
    const lab = label(`${s.icon} ${s.label}`, undefined, s.id === 'g-exchange' ? '#f2c84a' : '#e8c46a', s.x, ly, s.z, s.id === 'g-burj' ? 1.1 : 0.85); lab.userData.spot = s.id;
  }
  // district names, floating over each district
  for (const d of DISTRICT_LABELS) label(DISTRICTS[d.d].label, undefined, '#f4e4c0', d.x, 34, d.z, 1);
  // deed labels (penthouses and villas for sale)
  for (const d of CHUDBAI_DEEDS) { const l = label(`${d.type === 'penthouse' ? '🏙' : '🏡'} ${d.label}`, undefined, '#ffd86a', cx(d.r), d.h + 6, cz(d.r), 0.55); l.userData.spot = d.id; }
  flushBatches();

  // ---- oil blocks
  const padM = mat({ color: 0xc8a878, roughness: 1 }); const offPadM = mat({ color: 0x1a6a8a, transparent: true, opacity: 0.22, depthWrite: false }); const buoyM = mat({ color: 0xf2c84a, roughness: 0.5 }); const pads = new Map<number, THREE.Mesh>();
  const blockLabels = new Map<number, THREE.Sprite>();
  for (let n = 1; n <= G_TRACTS; n++) {
    const t = gTractInfo(n); const pr = padRect(n);
    if (t.offshore) {
      const p = box(TW, 0.4, TD, offPadM, t.x, 0.2, t.z); p.castShadow = false; p.userData.tract = n; pickables.push(p); pads.set(n, p);
      for (const [bx, bz] of [[pr.x0 + 0.5, pr.z0 + 0.5], [pr.x1 - 0.5, pr.z0 + 0.5], [pr.x0 + 0.5, pr.z1 - 0.5], [pr.x1 - 0.5, pr.z1 - 0.5]] as const) cyl(0.5, 1.6, buoyM, bx, 0.4, bz);
    } else { const p = box(TW, 0.3, TD, padM, t.x, 0.15, t.z); p.userData.tract = n; pickables.push(p); pads.set(n, p); }
    blockLabels.set(n, label(`${t.offshore ? '🌊' : '🏜'} Block ${n}`, t.name, '#d8b070', t.x, t.offshore ? 24 : 16, t.z, 0.75));
  }
  // trunk gathering line along its corridor into the plant (on sleepers)
  { const pc = PIPE_CORRIDOR; for (const dz of [-0.9, 0.9]) { const p = new THREE.Mesh(sg('gpipe', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateZ(Math.PI / 2)), steel); p.scale.set(rw(pc), 1.1, 1.1); p.position.set(cx(pc), 0.9, cz(pc) + dz); scene.add(p); } for (let x = pc.x0 + 2; x < pc.x1; x += 6) box(0.4, 0.4, rd(pc) - 0.4, conc, x, 0.2, cz(pc)); }

  // ---- dynamic: wells (in their slots), pipe stubs and risers, plant units (in their slots)
  const dyn = new THREE.Group(); scene.add(dyn); const dynFlames: THREE.Mesh[] = [];
  const mastM = mat({ color: 0xd8d0c0, metalness: 0.4, roughness: 0.6 }), mastBad = mat({ color: 0x7a5a4a, metalness: 0.4, roughness: 0.6 });
  const legM = mat({ color: 0xf2c84a, roughness: 0.6 }), craneM = mat({ color: 0xf2b630 }), heliM = mat({ color: 0x2a6a3a, roughness: 0.8 }), espGlow = glowM(0x60c0ff, 0x2080ff, 2);
  const pipeM = [mat({ color: 0x9aa2aa, metalness: 0.6, roughness: 0.4 }), mat({ color: 0xd8a83a, metalness: 0.6, roughness: 0.4 })];
  const ownerMats = new Map<string, THREE.MeshStandardMaterial>(); const ownerM = (c: string) => { let m = ownerMats.get(c); if (!m) { m = mat({ color: new THREE.Color(c), emissive: new THREE.Color(c), emissiveIntensity: 0.4 }); ownerMats.set(c, m); } return m; };
  const lineMats = new Map<string, THREE.LineBasicMaterial>(); const lineM = (c: string) => { let m = lineMats.get(c); if (!m) { m = new THREE.LineBasicMaterial({ color: new THREE.Color(c) }); disposables.push(m); lineMats.set(c, m); } return m; };
  const fenceG = geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(TW, 1.2, TD)));
  /** Onshore well in its 5 × 3 slot: pad, wellhead, tapered mast, optional ESP skid. */
  const derrick = (g: THREE.Object3D, x: number, z: number, esp: boolean, cond: number, col: string) => {
    const w = new THREE.Group(); w.position.set(x, 0, z); g.add(w);
    box(3, 0.4, 3, conc, 0, 0.2, 0, w); cyl(0.35, 2.4, red, 0, 1.4, 0, w); for (const y of [0.8, 1.6, 2.2]) cyl(0.6, 0.18, steel, 0, y, 0, w);
    cyl(0.25, 10, cond < 15 ? mastBad : mastM, 1.2, 5, 0, w, 1.2, 4);
    if (esp) { box(1.2, 1.8, 0.8, blue, -1.8, 0.9, 0, w); box(0.3, 0.3, 0.3, espGlow, -1.8, 1.9, 0.3, w); }
    box(0.6, 0.6, 0.6, ownerM(col), 1.2, 10.3, 0, w);
  };
  /** Offshore platform in its 9 × 9 slot. */
  const platform = (g: THREE.Object3D, x: number, z: number, esp: boolean, col: string) => {
    const p = new THREE.Group(); p.position.set(x, 0, z); g.add(p);
    for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) cyl(0.5, 10, legM, lx, 3, lz, p);
    box(9, 1, 9, steel, 0, 8, 0, p); box(6, 3, 3.6, white, -1.2, 10, -2, p); cyl(2, 0.3, heliM, 2, 9.6, 2.2, p);
    cyl(0.4, 9, red, 3.4, 13, -3.4, p); const fl = new THREE.Mesh(sg('gcone', () => new THREE.ConeGeometry(0.6, 1, 10)), flameM); fl.scale.set(0.9, 2.6, 0.9); fl.position.set(3.4, 18.6, -3.4); p.add(fl); dynFlames.push(fl);
    const crane = box(0.4, 0.4, 6, craneM, -3.6, 12, 0.6, p); crane.rotation.x = -0.5;
    if (esp) box(1.6, 1.6, 1.6, blue, 3, 9.3, -0.4, p);
    box(1, 1, 1, ownerM(col), -3.6, 12.4, -3.6, p);
  };
  /** A process unit drawn inside its slot (local coords, slot centred). */
  const unitModel = (k: GUnitKind, g: THREE.Group, sw: number, sd: number) => {
    box(sw, 0.3, sd, conc, 0, 0.15, 0, g);
    const col = (x: number, zz: number, r0: number, h0: number, m: THREE.Material = steel) => { cyl(r0, h0, m, x, h0 / 2, zz, g); for (let y = 3; y < h0; y += 4) cyl(r0 + 0.2, 0.2, gold, x, y, zz, g); box(0.3, 0.3, 0.3, navRed, x, h0 + 0.2, zz, g); };
    if (k === 'stabilizer') { for (const zz of [-2.6, 0]) { const v = cyl(1.1, 6, white, -1, 1.6, zz, g); v.rotation.z = Math.PI / 2; } col(3.4, -2.6, 0.7, 7); box(3, 1.6, 2, steel, 2.8, 0.8, 2.8, g); }
    else if (k === 'lng') { for (const x of [-2.6, 2.6]) { sph(2.2, white, x, 3.2, -1.4, g); cyl(2.3, 1.2, steel, x, 0.6, -1.4, g, 2.3, 12); } box(8, 2, 2.4, steel, 0, 1, 3, g); col(4.2, 3.4, 0.4, 9, white); }
    else if (k === 'refinery') { col(-2.6, -1.5, 1.3, 16); col(0.4, -2.4, 0.8, 11); col(2.6, -1.2, 0.6, 8); box(4, 3, 3, red, 1.6, 1.5, 2.4, g); cyl(0.3, 5, dark, 1.6, 5.5, 2.4, g); }
    else if (k === 'aromatics') { for (let i = 0; i < 3; i++) col(-3 + i * 3, -1.8, 0.7, 9 + i * 2, white); box(8, 2.6, 2.6, gold, 0, 1.3, 2.5, g); }
    else if (k === 'solar') { for (let rr = 0; rr < 4; rr++) for (let c = 0; c < 3; c++) { const pnl = box(4, 0.15, 2, blue, -4.5 + c * 4.5, 1.1, -3.6 + rr * 2.5, g); pnl.rotation.x = -0.45; box(0.15, 1, 0.15, steel, -4.5 + c * 4.5, 0.5, -3.6 + rr * 2.5, g); } }
    else if (k === 'tank') { cyl(3.5, 4.5, white, 0, 2.25, 0, g, 3.5, 20); cyl(3.6, 0.3, gold, 0, 4.6, 0, g, 3.6, 20); }
  };
  let lastGulf: GulfState | null = null; let lastSite: GulfSite | null = null;
  const redraw = () => {
    for (const c of [...dyn.children]) dyn.remove(c); dynFlames.length = 0;
    const counts = new Map<GUnitKind, number>();
    for (const u of lastGulf?.units ?? []) {
      const i = counts.get(u.k) ?? 0; counts.set(u.k, i + 1); let sl: Rect; try { sl = unitSlot(u.k, i); } catch { continue; } if (!inRect(cx(sl), cz(sl), spotRect(gulfSpot('g-plant')))) continue;
      const g = new THREE.Group(); g.position.set(cx(sl), 0, cz(sl)); dyn.add(g); unitModel(u.k, g, rw(sl), rd(sl)); if (!u.on) g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = conc; });
    }
    for (let n = 1; n <= G_TRACTS; n++) {
      const t = gTractInfo(n); const view = lastSite?.tracts.find((x) => x.n === n); const L = lastSite?.leases[String(n)];
      const mine = lastGulf?.tracts[String(n)]; const wells = view?.wells.length ? view.wells : (mine?.wells ?? []).map((w) => ({ ownerKey: 'me', esp: w.esp, cond: w.cond }));
      const pipe = view?.pipe ?? mine?.pipe ?? 0; const col = L ? ownerColor(L.key) : '#e8c46a';
      if (L) { const fence = new THREE.LineSegments(fenceG, lineM(col)); fence.position.set(t.x, 0.8, t.z); dyn.add(fence); }
      wells.forEach((w, i) => { const sl = wellSlot(n, i); if (t.offshore) platform(dyn, cx(sl), cz(sl), w.esp, col); else derrick(dyn, cx(sl), cz(sl), w.esp, w.cond, col); });
      if (pipe > 0 && t.offshore) { const riser = cyl(pipe > 1 ? 0.7 : 0.45, 9, pipeM[pipe > 1 ? 1 : 0]!, t.x, 2.5, t.z, dyn); void riser; }
      const stub = pipeStub(n); if (pipe > 0 && stub) { const p = new THREE.Mesh(sg('gpipeZ', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2)), pipeM[pipe > 1 ? 1 : 0]!); p.scale.set(pipe > 1 ? 1.4 : 0.9, pipe > 1 ? 1.4 : 0.9, rd(stub)); p.position.set(cx(stub), 0.9, cz(stub)); dyn.add(p); }
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
  let deckOn = false; const BURJ = gulfSpot('g-burj'); const deckPos = new THREE.Vector3(BURJ.x + 5, 164, BURJ.z + 5); const deckTgt = new THREE.Vector3(BURJ.x + 90, 60, BURJ.z + 160);
  const clock = new THREE.Clock(); let raf = 0; let running = true; let time = 0; const tmp = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!running) return; const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    skyT += dt; if (skyT > 1) { skyT = 0; applySky(); } gulf.mat.uniforms.uTime.value = time;
    for (const f of [...flames, ...dynFlames]) f.scale.x = f.scale.z = (f.userData.s0 ??= f.scale.x) * (1 + Math.sin(time * 9 + f.id) * 0.12);
    yachts.forEach((y, i) => { y.position.y = 0.3 + Math.sin(time * 1.2 + i) * 0.12; y.rotation.z = Math.sin(time * 0.9 + i) * 0.03; });
    boats.forEach((b, i) => { b.position.y = 0.2 + Math.sin(time * 0.8 + i * 2) * 0.1; });
    fountainJets.forEach((j, i) => { const hgt = 1.2 + Math.abs(Math.sin(time * 1.6 + i * 0.7)) * 0.9; j.scale.y = hgt; j.position.y = 0.7 + hgt / 2; });
    moveCars(time);
    { const L = METRO_X1 - METRO_X0 - TRAIN_LEN; const u = (time * 14) % (2 * L); const x = u < L ? METRO_X0 + u : METRO_X0 + 2 * L - u; train.position.x = x; }
    if (deckOn) { camera.position.lerp(deckPos, 0.06); controls.target.lerp(deckTgt, 0.06); }
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
    /** At the Top: glide the camera up to the Burj deck (false = back to the overview). */
    deck(on = true) { deckOn = on; controls.minDistance = on ? 5 : 30; if (!on) { camera.position.copy(home); controls.target.copy(homeT); } },
    /** QA: every landmark group must stay inside its footprint (rect × height). Returns the offenders. */
    qa() { const out: string[] = []; const b = new THREE.Box3(); const bb = new THREE.Box3();
      for (const [id, g] of spotGroups) { const s = GULF_SPOTS.find((x) => x.id === id)!; b.makeEmpty(); g.updateMatrixWorld(true); g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || m.material === hitM || (o as THREE.Sprite).isSprite) return; m.geometry.computeBoundingBox(); bb.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld); b.union(bb); });
        const r = spotRect(s); const e = 0.06; if (b.min.x < r.x0 - e || b.max.x > r.x1 + e || b.min.z < r.z0 - e || b.max.z > r.z1 + e || b.max.y > s.h + e) out.push(`${id}: x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)} (${r.x0}..${r.x1}) z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)} (${r.z0}..${r.z1}) top ${b.max.y.toFixed(2)} (${s.h})`); }
      return out; },
    reset() { camera.position.copy(home); controls.target.copy(homeT); },
    view(cam: [number, number, number], tgt: [number, number, number]) { camera.position.set(...cam); controls.target.set(...tgt); controls.update(); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave); controls.dispose(); disposables.forEach((x) => x.dispose()); composer?.dispose(); renderer.dispose(); },
  };
}
