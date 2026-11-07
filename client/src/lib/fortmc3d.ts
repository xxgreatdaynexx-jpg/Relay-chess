// Fort McChud 3D map: a boreal oil-sands boomtown at dusk. Spruce forest, muskeg, tailings ponds, ten lease tracts with
// wells and nodding pumpjacks, pipelines into a refinery complex (distillation towers, cracker, flare stack, tank farm),
// the Deep Ore Mine's terraced pit, the Commodity Exchange tower and the airport. Same camera/pan rules as the city.
import { pipeRoute } from '../../../shared/fortmcPipes';
import * as THREE from 'three';
import { asLabel, cityLabel, dimColor, drawLabel, fitLabel, LABEL_LAYER, labelMaterial, renderScene } from './labelSprite';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { detectWorldTier, labelScale, TIER_PIXEL_RATIO } from './worldTier';
import { skyNow, parseTod, mix as mixHex } from '../../../shared/daynight';
import { sg, BOX, SPH, buildOcean, buildBeach } from './ocean3d';
import { buildJet, disposeTree } from './fleetModels';
import type { FleetModel } from '../../../shared/fleet';
import { FORT_SPOTS, FORT_X0, FORT_X1, FORT_Z0, FORT_Z1, TRACTS, tractInfo, type FortState, type UnitKind } from '../../../shared/fortmc';

type Handlers = { onHover: (id: string | null, x: number, y: number) => void; onPick: (id: string) => void };
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
let labelRenderer: THREE.WebGLRenderer | null = null;
function signTexture(text: string, color: string, sub?: string) { return cityLabel(text, color, sub, labelRenderer); } // same look as Chud City
export const clampFortTarget = (x: number, z: number): [number, number] => [Math.min(FORT_X1 - 10, Math.max(FORT_X0 + 10, x)), Math.min(FORT_Z1 - 10, Math.max(FORT_Z0 + 10, z))];
const TW = 30, TD = 26; // tract pad size
// QA#8: pumpjacks read toy-sized next to fat flowlines — jacks up 1.45x (columns re-spaced to fit the pad), flowlines ~1/3 radius.
export const RACK_H = 7, BUND_H = 1.1;
export const JACK_SCALE = 1.45; export const FLOW_R = [0.13, 0.2] as const;
// Reserve the complete 3-package turbine row and access apron (x45–55, z22), including spruce crown radius.
export const TURBINE_CLEAR = { x0: 40, x1: 67, z0: 14, z1: 36 } as const;

export type FortWorld = ReturnType<typeof createFortMc>;
export function createFortMc(canvas: HTMLCanvasElement, h: Handlers) {
  const tier = detectWorldTier(); const r = rng(20261103);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' }); labelRenderer = renderer;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIER_PIXEL_RATIO[tier])); canvas.dataset.tier = tier;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = tier !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); const disposables: Array<{ dispose(): void }> = [];
  const mat = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(p); disposables.push(m); return m; };
  const geo = <G extends THREE.BufferGeometry>(g: G) => { disposables.push(g); return g; };

  // Real-time northern sky (mu-visuals): the same skyNow() clock as Chud City (?tod=HH:MM overrides), with the old amber
  // flare-lit band kept low on the horizon at dusk/night.
  const skyU = { uSky: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uWarm: { value: 0 }, uStars: { value: 0 } };
  const skyM = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uSky; uniform vec3 uHor; uniform float uWarm; uniform float uStars; varying vec3 vp; void main(){ float y = vp.y;
      vec3 amber = vec3(0.95,0.48,0.2);
      vec3 c = mix(uHor, uSky, smoothstep(0.0,0.45,y)); c = mix(c, amber, (1.0 - smoothstep(0.0,0.12,y)) * max(uWarm, 0.35*uStars));
      float st = step(0.9975, fract(sin(dot(floor(vp*420.0), vec3(12.9898,78.233,37.719))) * 43758.5453)) * uStars * smoothstep(0.05,0.3,y);
      c += vec3(st);
      if (y < 0.0) c = uHor*0.7; gl_FragColor = vec4(c,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
  disposables.push(skyM); scene.add(new THREE.Mesh(geo(new THREE.SphereGeometry(800, 32, 16)), skyM));
  scene.fog = new THREE.Fog(0x8a6a5a, 380, 1100);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1700);
  const home = new THREE.Vector3(-30, 150, 230); const homeT = new THREE.Vector3(0, 0, -5); camera.position.copy(home);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(homeT); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 30; controls.maxDistance = 380; controls.maxPolarAngle = 1.36; controls.minPolarAngle = 0.35;
  controls.enablePan = true; controls.screenSpacePanning = false; controls.panSpeed = 1.1;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const clampPan = () => { const t = controls.target; const [x, z] = clampFortTarget(t.x, t.z); if (x !== t.x || z !== t.z) { camera.position.x += x - t.x; camera.position.z += z - t.z; t.x = x; t.z = z; } };

  const hemi = new THREE.HemisphereLight(0xb8c8e0, 0x3a3226, 1.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb070, 2.6); sun.position.set(-120, 70, 60); sun.castShadow = renderer.shadowMap.enabled;
  Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 140, bottom: -140, near: 10, far: 500 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; scene.add(sun);

  // Ground: muskeg + snow patches, gravel roads, tailings ponds.
  const groundG = geo(new THREE.PlaneGeometry(FORT_X1 - FORT_X0 + 260, FORT_Z1 - FORT_Z0 + 260, 64, 56)); { const pa = groundG.attributes.position as THREE.BufferAttribute; const col: number[] = []; const c = new THREE.Color(), c2 = new THREE.Color();
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i); const n = Math.sin(x * 0.045 + 1.3) * Math.cos(y * 0.05) + 0.5 * Math.sin(x * 0.13 - y * 0.11) + 0.25 * Math.sin(x * 0.31 + y * 0.27); c.setHex(0x5a5a3e); c2.setHex(n > 0.4 ? 0x3e4630 : n < -0.5 ? 0x77684c : 0x5f5c40); c.lerp(c2, 0.7); col.push(c.r, c.g, c.b); if (x > 74 && -y > 99) pa.setZ(i, -3); } groundG.computeVertexNormals(); // dips under the bay/river water
    groundG.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); }
  const ground = new THREE.Mesh(groundG, mat({ color: 0xffffff, vertexColors: true, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const snowM = mat({ color: 0xe8eef2, roughness: 0.9 });
  for (let i = 0; i < 26; i++) { const s = new THREE.Mesh(geo(new THREE.CircleGeometry(6 + r() * 14, 12)), snowM); s.rotation.x = -Math.PI / 2; s.position.set(FORT_X0 + r() * (FORT_X1 - FORT_X0), 0.02, FORT_Z0 + r() * (FORT_Z1 - FORT_Z0)); s.scale.y = 0.6 + r() * 0.6; if (!(s.position.x > 55 && s.position.z > 85)) scene.add(s); }
  // Haul roads (mu-visuals): packed-gravel ribbons with darker wheel ruts, instanced amber lane markers, and lamp posts
  // whose heads glow at night (glowMats, driven by the real-time sky like Chud City).
  const gravel = mat({ color: 0x8a7e6a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const rut = mat({ color: 0x5e5446, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const glowMats: THREE.MeshStandardMaterial[] = [];
  const glowM = (c: number, e: number, ei: number) => { const m = mat({ color: c, emissive: e, emissiveIntensity: ei, roughness: 0.4 }); m.userData.ei = ei; glowMats.push(m); return m; };
  const dashM = glowM(0xe0b040, 0xd09020, 0.5); const lampHead = glowM(0xfff1c8, 0xffcc66, 2.6);
  const dashes: THREE.Matrix4[] = [], posts: THREE.Matrix4[] = [], heads: THREE.Matrix4[] = []; const q0 = new THREE.Quaternion();
  const road = (w: number, d: number, x: number, z: number) => {
    const o = new THREE.Mesh(sg('fplane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), gravel); o.scale.set(w, 1, d); o.position.set(x, 0.04, z); o.receiveShadow = true; scene.add(o);
    const along = w > d; const L = along ? w : d, W = along ? d : w;
    for (const off of [-W * 0.22, W * 0.22]) { const r2 = new THREE.Mesh(o.geometry, rut); r2.scale.set(along ? L : 0.7, 1, along ? 0.7 : L); r2.position.set(x + (along ? 0 : off), 0.05, z + (along ? off : 0)); scene.add(r2); }
    for (let t = -L / 2 + 3; t < L / 2 - 2; t += 7) { dashes.push(new THREE.Matrix4().compose(new THREE.Vector3(x + (along ? t : 0), 0.07, z + (along ? 0 : t)), q0, new THREE.Vector3(along ? 2.4 : 0.25, 0.02, along ? 0.25 : 2.4))); }
    for (let t = -L / 2 + 8; t < L / 2 - 4; t += 26) { const px = x + (along ? t : W / 2 + 1), pz = z + (along ? W / 2 + 1 : t); posts.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 3, pz), q0, new THREE.Vector3(0.22, 6, 0.22))); heads.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 6.1, pz), q0, new THREE.Vector3(0.9, 0.3, 0.9))); }
  };
  road(FORT_X1 - FORT_X0 - 10, 6, 0, -4); road(FORT_X1 - FORT_X0 - 10, 6, 0, 56); road(6, 70, -128, 20); road(6, 170, 128, -28); // east haul road runs to the north map edge (truck exit)
  const inst = (g: THREE.BufferGeometry, m: THREE.Material, list: THREE.Matrix4[]) => { const im = new THREE.InstancedMesh(g, m, list.length); list.forEach((x, i) => im.setMatrixAt(i, x)); scene.add(im); return im; };
  inst(BOX(), dashM, dashes); inst(sg('fcyl1', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 14)), mat({ color: 0x4b5563, metalness: 0.5, roughness: 0.5 }), posts); inst(BOX(), lampHead, heads);
  // Ground variation: muskeg vertex colours (wet dark patches, dry tan, moss) so the plain isn't one flat colour.
  const pond = mat({ color: 0x3a342a, roughness: 0.12, metalness: 0.25, emissive: 0x0a0806 });
  // Logistics (Millionaire Update): the river mouth the Barge Terminal sits on; cargo ships run down it (shared/logistics.ts HUB_MAPS.fortmc).
  // Animated water (mu-visuals): one wave plane for the bay + river mouth (same shader as the city ocean), a gravel/sand
  // bank along the north shore, and the barge terminal from worldFreight.port on the bay.
  const fortWater = buildOcean({ x0: 72, x1: 420, z0: 96, z1: 760, coast: () => 100, segX: tier === 'low' ? 40 : 70, segZ: tier === 'low' ? 30 : 50 }, [0.9, 9, 0.5, 4, 100]);
  fortWater.mesh.position.y = -0.3; scene.add(fortWater.mesh); disposables.push(fortWater.geo, fortWater.mat);
  { const bank = buildBeach(60, 420, 94, (x) => 100 + 0.9 * Math.sin(x / 9 + 0.7) + 0.5 * Math.sin(x / 4 + 2.1), 120); disposables.push(bank.geometry, bank.material as THREE.Material); scene.add(bank);
    const wb = new THREE.Mesh(geo(new THREE.PlaneGeometry(6, 680)), mat({ color: 0x8a7e6a, roughness: 1 })); wb.rotation.x = -Math.PI / 2; wb.position.set(70, 0.03, 430); scene.add(wb); }
  for (const [x, z, w, d] of [[-60, 90, 50, 18], [40, 92, 40, 14]] as const) { const p = new THREE.Mesh(geo(new THREE.PlaneGeometry(w, d)), pond); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.04, z); scene.add(p); }

  // Spruce forest (instanced), kept off the pads, plant, mine and roads.
  const d = new THREE.Object3D(); const spots: Array<[number, number]> = [];
  const clear = (x: number, z: number) => {
    if (Math.abs(z + 4) < 6 || Math.abs(z - 56) < 6) return false;
    for (let n = 1; n <= TRACTS; n++) { const t = tractInfo(n); if (Math.abs(x - t.x) < TW / 2 + 3 && Math.abs(z - t.z) < TD / 2 + 3) return false; }
    for (const s of FORT_SPOTS) if (Math.abs(x - s.x) < s.w / 2 + 5 && Math.abs(z - s.z) < s.d / 2 + 5) return false;
    if (x > TURBINE_CLEAR.x0 && x < TURBINE_CLEAR.x1 && z > TURBINE_CLEAR.z0 && z < TURBINE_CLEAR.z1) return false;
    if (Math.abs(z - 90) < 14 && x > -90 && x < 64) return false; if (z > 59 && z < 82 && x > -82 && x < 62) return false; // process-unit row
    if (x > 70 && z > 94) return false; if (Math.abs(x - 128) < 7 || Math.abs(x + 128) < 7) return false; return true; // river/bay, haul roads
  };
  for (let i = 0; i < 1400 && spots.length < (tier === 'low' ? 260 : 620); i++) { const x = FORT_X0 - 60 + r() * (FORT_X1 - FORT_X0 + 120), z = FORT_Z0 - 60 + r() * (FORT_Z1 - FORT_Z0 + 120); if (clear(x, z)) spots.push([x, z]); }
  const spruce = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(1.6, 7, 7)), mat({ color: 0x1f3a2a, roughness: 0.9, flatShading: true }), spots.length);
  spruce.castShadow = true; spots.forEach(([x, z], i) => { const s = 0.7 + r() * 0.7; d.position.set(x, 3.5 * s, z); d.scale.set(s, s, s); d.rotation.set(0, r() * 6, 0); d.updateMatrix(); spruce.setMatrixAt(i, d.matrix); }); scene.add(spruce);

  const signs: THREE.Sprite[] = [];
  const label = (text: string, sub: string | undefined, color: string, x: number, y: number, z: number, k = 1) => {
    const tex = signTexture(text, color, sub); disposables.push(tex); const m = labelMaterial(tex, { fog: false }); disposables.push(m);
    const s = asLabel(new THREE.Sprite(m)); s.position.set(x, y, z); s.userData.k = k; fitLabel(s, 8 * k); scene.add(s); signs.push(s); return s;
  };
  const pickables: THREE.Object3D[] = [];
  const steel = mat({ color: 0x9aa2aa, metalness: 0.7, roughness: 0.35 }); const dark = mat({ color: 0x2c3036, metalness: 0.5, roughness: 0.6 });
  const yellow = mat({ color: 0xf2b630, roughness: 0.6 }); const white = mat({ color: 0xe8e4dc, roughness: 0.7 }); const red = mat({ color: 0xb0302a, roughness: 0.6 });
  const glass = mat({ color: 0x7ab0d0, metalness: 0.6, roughness: 0.1, emissive: 0x1a3a50, emissiveIntensity: 0.6 });
  const flameM = mat({ color: 0xffa040, emissive: 0xff7a20, emissiveIntensity: 4 });
  const conc = mat({ color: 0xa8a49a, roughness: 0.95 }); const green = mat({ color: 0x3f6b4a, roughness: 0.6 }); const blue = mat({ color: 0x2f5f9a, roughness: 0.55, metalness: 0.2 });
  const navRed = glowM(0xff3030, 0xff2020, 2.2); const warmWin = glowM(0xffe2a0, 0xffb040, 1.6);
  // Office-window texture (lit panes glow at night through glowMats, like Chud City's towers).
  const winTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d')!; x.fillStyle = '#1b2a36'; x.fillRect(0, 0, 64, 128);
    for (let r = 0; r < 16; r++) for (let q = 0; q < 8; q++) { const on = Math.sin(r * 12.9 + q * 78.2) * 43758 % 1; x.fillStyle = Math.abs(on) > 0.45 ? '#ffd890' : '#33485a'; x.fillRect(q * 8 + 1, r * 8 + 2, 6, 5); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; disposables.push(t); return t; })();
  const towerWin = (() => { const m = mat({ color: 0xffffff, map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.3 }); m.userData.ei = 0.9; glowMats.push(m); return m; })();
  // Shared unit geometries scaled per use (the old helpers built a new BufferGeometry for every box/cylinder).
  const box = (w: number, hh: number, dd: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(BOX(), m); o.scale.set(w, hh, dd); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
  const cyl = (rt: number, hh: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene, rb = rt) => { const k = Math.round((rb / rt) * 20) / 20; const o = new THREE.Mesh(sg(`fcyl${k}`, () => new THREE.CylinderGeometry(0.5, 0.5 * k, 1, 14)), m); o.scale.set(rt * 2, hh, rt * 2); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  // QA#13: tank bund (low concrete containment wall) and column access (grated platforms every ~6 m + caged ladder).
  const bund = (parent: THREE.Object3D, x0: number, x1: number, z0: number, z1: number) => { const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (const [bw, bd, bx, bz] of [[w, 0.4, cx, z0], [w, 0.4, cx, z1], [0.4, d, x0, cz], [0.4, d, x1, cz]] as const) box(bw, BUND_H, bd, conc, bx, BUND_H / 2, bz, parent).userData.part = 'bund'; };
  const towerAccess = (parent: THREE.Object3D, x: number, z: number, r: number, h: number) => { for (let y = 6; y < h - 1; y += 6) cyl(r + 0.7, 0.12, dark, x, y, z, parent).userData.part = 'platform';
    cyl(r + 0.7, 0.12, dark, x, h - 0.3, z, parent).userData.part = 'platform'; box(0.4, h - 0.6, 0.08, yellow, x + r + 0.35, (h - 0.6) / 2, z, parent).userData.part = 'ladder'; };
  const flames: THREE.Mesh[] = [];

  for (const s of FORT_SPOTS) {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z); scene.add(g);
    const hit = box(s.w, s.h, s.d, new THREE.MeshBasicMaterial({ visible: false }), 0, s.h / 2, 0, g); hit.userData.spot = s.id; hit.castShadow = false; pickables.push(hit);
    if (s.id === 'f-airport') {
      box(56, 0.15, 9, mat({ color: 0x3a3a3e, roughness: 1 }), 8, 0.08, 6, g); for (let i = 0; i < 7; i++) box(4, 0.17, 0.5, white, -16 + i * 8, 0.1, 6, g);
      box(16, 6, 8, white, -12, 3, -4, g); box(16.2, 2, 8.2, towerWin, -12, 4.6, -4, g); box(17, 0.5, 9, dark, -12, 6.2, -4, g); // terminal
      { const hg = new THREE.Mesh(sg('fort-hangar', () => new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)), mat({ color: 0x8c96a0, metalness: 0.6, roughness: 0.45 })); hg.scale.set(9, 6, 7); hg.rotation.y = Math.PI / 2; hg.position.set(-26, 0, -4); hg.castShadow = true; g.add(hg); box(0.3, 5, 9, dark, -26, 2.5, -0.6, g); }
      cyl(0.9, 11, conc, 2, 5.5, -6, g); cyl(2.2, 2.4, towerWin, 2, 12, -6, g, 1.6); cyl(2.4, 0.5, dark, 2, 13.4, -6, g); box(0.2, 2, 0.2, steel, 2, 14.6, -6, g); box(0.5, 0.5, 0.5, navRed, 2, 15.7, -6, g); // control tower + beacon
      for (let i = 0; i < 15; i++) for (const ez of [1.6, 10.4]) box(0.35, 0.35, 0.35, i % 7 === 0 ? navRed : lampHead, -20 + i * 4, 0.25, ez, g); // runway edge lights
      // No parked decorative airliner: only planes players are actually using are drawn.
      label('✈ YMC Airport', 'Fly home to Chud Hub', '#5aa8e8', s.x, 16, s.z);
      // Private-jet apron (mu-jet-mcchud): painted stand + windsock beside the terminal, where an owner's jet parks.
      box(12, 0.16, 7, mat({ color: 0x4a4a50, roughness: 1 }), 6, 0.09, -1.2, g); for (const [lx, lz, lw, ld] of [[0.2, -4.6, 11.6, 0.2], [0.2, 2.2, 11.6, 0.2], [0.2, -1.2, 0.2, 6.6]] as const) box(lw, 0.18, ld, yellow, 6 + lx - 0.2, 0.1, lz, g);
      cyl(0.1, 5, steel, 12.5, 2.5, -4.4, g); { const sock = cyl(0.35, 1.8, mat({ color: 0xff7a1a }), 13.3, 4.7, -4.4, g, 0.18); sock.rotation.z = Math.PI / 2; }
    } else if (s.id === 'f-plant') {
      // Distillation towers, cracker furnace, cooling towers, pipe racks, flare.
      for (const [x, z, hh, rr] of [[-18, -8, 22, 1.6], [-13, -8, 16, 1.3], [-8, -8, 26, 1.8]] as const) { cyl(rr, hh, steel, x, hh / 2, z, g); for (let y = 3; y < hh; y += 4) cyl(rr + 0.25, 0.3, yellow, x, y, z, g); towerAccess(g, x, z, rr, hh); }
      box(14, 8, 6, dark, 8, 4, -10, g); for (let i = 0; i < 4; i++) cyl(0.5, 14, dark, 2 + i * 4, 15, -10, g);
      for (const x of [-20, -10]) cyl(4.5, 10, white, x, 5, 10, g, 6);
      // QA#13: pipe rack lifted to road clearance on portal bents (two legs + cross-beam), two pipe tiers.
      box(50, 0.5, 2.6, dark, 0, RACK_H, 0, g); for (let x = -24; x <= 24; x += 6) { for (const dz of [-1.2, 1.2]) box(0.4, RACK_H, 0.4, yellow, x, RACK_H / 2, dz, g); box(0.4, 0.4, 2.8, yellow, x, RACK_H - 2.2, 0, g); }
      for (let i = 0; i < 3; i++) { cyl(0.35, 50, steel, 0, RACK_H + 0.6, -0.9 + i * 0.9, g).rotation.z = Math.PI / 2; } cyl(0.25, 50, white, 0, RACK_H - 1.8, 0.6, g).rotation.z = Math.PI / 2;
      for (const [x, z] of [[14, 8], [21, 8], [14, 14], [21, 14]] as const) cyl(2.8, 5, white, x, 2.5, z, g); bund(g, 10.4, 24.6, 4.4, 17.6);
      cyl(0.5, 34, dark, 27, 17, -14, g); const fl = new THREE.Mesh(geo(new THREE.ConeGeometry(1.4, 5, 10)), flameM); fl.position.set(27, 36.5, -14); g.add(fl); flames.push(fl);
      for (const [x, z, hh] of [[-18, -8, 22], [-13, -8, 16], [-8, -8, 26]] as const) { box(0.5, 0.5, 0.5, navRed, x, hh + 0.4, z, g); for (let y = 5; y < hh; y += 8) box(0.35, 0.35, 0.35, warmWin, x + 1.9, y, z, g); }
      box(0.6, 0.6, 0.6, navRed, 27, 34.4, -14, g);
      label('🏭 Upgrader & Refinery', 'Build · run · repair', '#f2b630', s.x, 34, s.z, 1.3);
    } else if (s.id === 'f-exchange') {
      { const t = box(14, 26, 12, towerWin, 0, 13, 0, g); void t; } box(15, 1, 13, dark, 0, 26.5, 0, g); box(18, 3, 14, dark, 0, 1.5, 0, g); box(10, 2.2, 0.3, warmWin, 0, 1.6, 7.1, g);
      for (const cx of [-6.8, 6.8]) for (const cz of [-5.8, 5.8]) box(0.5, 26, 0.5, dark, cx, 13, cz, g); // corner mullions
      box(8, 1.2, 0.3, mat({ color: 0x0a1410, emissive: 0x5ad89a, emissiveIntensity: 1.2 }), 0, 24.4, 6.2, g); box(0.3, 4, 0.3, steel, 3, 29, 0, g); box(0.4, 0.4, 0.4, navRed, 3, 31.2, 0, g);
      label('💹 Commodity Exchange', 'Sell · ship to factory', '#5ad89a', s.x, 32, s.z);
    } else if (s.id === 'f-shaft') {
      // Walk-in mine: steel headframe with sheave wheels over a braced adit portal, ore carts on rails, work lamps.
      const rock = mat({ color: 0x5a4a3a, roughness: 1, flatShading: true });
      box(22, 7, 6, rock, 0, 3.5, -6, g); box(8, 5.4, 1, dark, 0, 2.7, -2.6, g); // hillside + dark portal
      for (const x of [-4.4, 4.4]) box(0.8, 6, 0.8, yellow, x, 3, -2.2, g); box(9.6, 0.9, 0.9, yellow, 0, 6.2, -2.2, g); // braced portal frame
      box(6, 0.8, 0.2, mat({ color: 0x1a1a1a, emissive: 0xffc040, emissiveIntensity: 0.9 }), 0, 7.2, -2.1, g); // MINE sign glow
      for (const [x, z] of [[-7, -3], [7, -3]] as const) { box(0.5, 14, 0.5, red, x - 1.2, 7, z, g); box(0.5, 14, 0.5, red, x + 1.2, 7, z, g); box(3, 0.5, 0.5, red, x, 14, z, g); const w = cyl(1.2, 0.3, steel, x, 14.8, z, g); w.rotation.x = Math.PI / 2; } // headframes + sheaves
      for (const dx of [-0.8, 0.8]) box(0.15, 0.1, 14, steel, dx, 0.1, 4, g); // rails
      for (const z of [3, 7]) { box(2.2, 1.2, 1.6, dark, 0, 0.9, z, g); box(2, 0.4, 1.4, mat({ color: 0x1c1714, roughness: 0.2 }), 0, 1.6, z, g); } // carts of oil sand
      box(0.4, 0.4, 0.4, lampHead, -4.4, 6.9, -1.6, g); box(0.4, 0.4, 0.4, lampHead, 4.4, 6.9, -1.6, g);
      label('🪨 Fort McChud Mine', 'Walk in · 40 floors', '#ffc040', s.x, 18, s.z);
    } else if (s.id === 'f-mine') {
      const pit = mat({ color: 0x7a5a3a, roughness: 1, flatShading: true });
      for (let i = 0; i < 4; i++) { const ring = new THREE.Mesh(geo(new THREE.CylinderGeometry(16 - i * 3.4, 16 - i * 3.4, 0.8, 18, 1, true)), pit); ring.position.set(0, -i * 1.6 + 0.4, 0); g.add(ring); const fl = new THREE.Mesh(geo(new THREE.CircleGeometry(16 - i * 3.4, 18)), pit); fl.rotation.x = -Math.PI / 2; fl.position.y = -i * 1.6; g.add(fl); }
      box(2, 18, 2, red, -12, 9, -12, g); box(8, 1, 1, red, -9, 18, -12, g); box(5, 4, 5, dark, -12, 2, -16, g);
      label('⛏ Deep Ore Mine', 'Very expensive · 400 ore/h', '#e0a060', s.x, 24, s.z);
    }
  }

  // Lease tracts: pads with a sign; wells/pumpjacks/pipelines drawn from the player's state.
  const padM = mat({ color: 0x7a6e5a, roughness: 1 }); const padOwnM = mat({ color: 0x9a8a62, roughness: 1, emissive: 0x2a1e00, emissiveIntensity: 0.4 });
  const pads = new Map<number, THREE.Mesh>(); const tractGroups = new Map<number, THREE.Group>();
  for (let n = 1; n <= TRACTS; n++) {
    const t = tractInfo(n); const p = box(TW, 0.3, TD, padM, t.x, 0.15, t.z); p.userData.tract = n; pickables.push(p); pads.set(n, p);
    const g = new THREE.Group(); g.position.set(t.x, 0, t.z); scene.add(g); tractGroups.set(n, g);
    label(`${n}. ${t.name}`, undefined, '#c8a060', t.x, 7, t.z - TD / 2 + 2, 0.7);
  }
  const jacks: THREE.Object3D[] = [];
  const pumpjack = (parent: THREE.Object3D, x: number, z: number, jack: boolean, broken: boolean) => {
    const g = new THREE.Group(); g.position.set(x, 0.3, z); g.scale.setScalar(JACK_SCALE); g.userData.part = 'pumpjack'; parent.add(g);
    // mu-visuals pumpjack: skid + gearbox/motor, A-frame samson post, walking beam with a curved horsehead, crank arms with
    // counterweights, polished rod down to a wellhead with a flow-line tee. All parts share cached unit geometries.
    box(2.2, 0.4, 2.2, conc, 0, 0.2, 0, g); box(1, 0.9, 1, dark, 0, 0.85, 0, g); cyl(0.12, 0.6, steel, 0.6, 1.0, 0, g).rotation.z = Math.PI / 2;
    if (!jack) { cyl(0.18, 2.2, red, 0, 2.2, 0, g); box(0.9, 0.18, 0.9, red, 0, 2.6, 0, g); box(0.9, 0.18, 0.9, red, 0, 1.9, 0, g); return; }
    box(5.6, 0.4, 1.8, dark, -2.2, 0.2, 0, g); box(1.4, 1, 1.2, steel, -4.4, 0.9, 0, g); box(0.9, 0.8, 0.9, green, -4.4, 1.8, 0, g); // skid, gearbox, motor
    for (const sz of [-0.55, 0.55]) { const l = box(0.22, 4, 0.22, yellow, -1.6, 2, sz, g); l.rotation.z = 0.12; const l2 = box(0.22, 4, 0.22, yellow, -0.9, 2, sz, g); l2.rotation.z = -0.12; }
    for (const sz of [-0.75, 0.75]) { const cr = box(0.25, 2.1, 0.5, dark, -4.4, 1.6, sz, g); cr.rotation.z = 0.5; box(1.3, 1.1, 0.3, red, -4.9, 0.9, sz, g); }
    const beam = new THREE.Group(); beam.position.set(-1.25, 4, 0); g.add(beam); box(5.4, 0.42, 0.42, broken ? dark : yellow, 0, 0, 0, beam);
    const hh = new THREE.Mesh(horseG, broken ? dark : yellow); hh.position.set(2.65, 0, 0); beam.add(hh); box(0.7, 0.5, 0.5, dark, -2.6, -0.2, 0, beam);
    box(0.06, 3.6, 0.06, steel, 1.25 + 2.65 + 0.5, 1.95, 0, g); // polished rod / bridle
    if (!broken) jacks.push(beam);
  };
  const horseG = sg('fort-horsehead', () => { const sh = new THREE.Shape(); sh.moveTo(0, 0.3); sh.absarc(0, -0.9, 1.2, Math.PI / 2, -Math.PI / 2 + 0.3, true); sh.lineTo(-0.4, -1.4); sh.lineTo(-0.4, 0.3); const e = new THREE.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: false, curveSegments: 8 }); e.translate(0, 0, -0.35); return e; });
  const tPkg = mat({ color: 0xc9cdd1, roughness: 0.6, metalness: 0.1 }), tIntake = mat({ color: 0xd8ccb0, roughness: 0.7 }), tTrim = mat({ color: 0x6b7178, roughness: 0.6 });
  const pipesG = new THREE.Group(); scene.add(pipesG);
  const setFort = (s: FortState | null) => {
    jacks.length = 0; while (pipesG.children.length) pipesG.remove(pipesG.children[0]!);
    for (const [n, g] of tractGroups) {
      while (g.children.length) g.remove(g.children[0]!);
      const t = s?.tracts[String(n)]; pads.get(n)!.material = t?.leased ? padOwnM : padM;
      if (!t?.leased) { if (s?.surveyed.includes(n)) box(1.4, 1, 1.4, yellow, 0, 0.8, 0, g); continue; }
      t.wells.forEach((w, i) => pumpjack(g, -6.5 + (i % 2) * 14.6, -5 + Math.floor(i / 2) * 9, w.jack, w.cond < 15));
      if (t.pipe > 0) { // mu-visuals: orthogonal flow line on H-frame sleepers (shared/fortmcPipes.ts), elbows at each 90° corner
        const rr = t.pipe > 1 ? FLOW_R[1] : FLOW_R[0], pm = t.pipe > 1 ? yellow : steel, R = pipeRoute(n), H = 1.2;
        for (let i = 1; i < R.length; i++) { const [ax, az] = R[i - 1]!, [bx, bz] = R[i]!, L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue; const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
          const c = cyl(rr, L, pm, (ax + bx) / 2, H, (az + bz) / 2, pipesG); if (alongX) c.rotation.z = Math.PI / 2; else c.rotation.x = Math.PI / 2;
          for (let d = 4; d < L - 2; d += 8) { const sx = ax + ((bx - ax) * d) / L, sz = az + ((bz - az) * d) / L; const sp = box(alongX ? 0.25 : 1.8, 0.2, alongX ? 1.8 : 0.25, dark, sx, 0.75, sz, pipesG); sp.castShadow = false;
            for (const o of [-0.8, 0.8]) box(0.18, 0.8, 0.18, dark, sx + (alongX ? 0 : o), 0.4, sz + (alongX ? o : 0), pipesG).castShadow = false; } }
        for (let i = 1; i < R.length - 1; i++) { const [x, z] = R[i]!; const e = new THREE.Mesh(SPH(), pm); e.scale.setScalar(rr * 2.7); e.position.set(x, H, z); pipesG.add(e);
          for (const [px, pz] of [R[i - 1]!, R[i + 1]!]) { const ux = Math.sign(px - x), uz = Math.sign(pz - z); const f = cyl(rr * 1.3, 0.2, dark, x + ux * rr * 1.6, H, z + uz * rr * 1.6, pipesG); if (ux) f.rotation.z = Math.PI / 2; else f.rotation.x = Math.PI / 2; } }
        const [lx, lz] = R[0]!; cyl(rr * 1.8, 2.4, pm, lx - tractInfo(n).x - 1.5, 1.3, lz - tractInfo(n).z, g).rotation.z = Math.PI / 2; box(0.8, 1.4, 0.8, red, lx - tractInfo(n).x - 3.2, 0.7, lz - tractInfo(n).z, g); }
    }
    // tank farm and extra units around the plant
    while (unitsG.children.length) unitsG.remove(unitsG.children[0]!);
    const count = (k: UnitKind) => s?.units.filter((u) => u.k === k).length ?? 0;
    for (let i = 0; i < count('tank'); i++) { const x = -45 + (i % 5) * 7.5, z = 22 + Math.floor(i / 5) * 7.5; cyl(3, 4.2, white, x, 2.1, z, unitsG); cyl(3.05, 0.25, red, x, 3.2, z, unitsG); cyl(0.15, 0.9, white, x, 4.65, z, unitsG, 3); box(0.4, 4.4, 0.6, dark, x + 3.1, 2.2, z, unitsG); }
    { const nt = count('tank'); if (nt) { const cols = Math.min(5, nt), rows = Math.ceil(nt / 5); bund(unitsG, -48.7, -45 + (cols - 1) * 7.5 + 3.7, 22 - 3.7, 22 + (rows - 1) * 7.5 + 3.7); } }
    // QA#7: aeroderivative gas-turbine packages (LM6000-style): light-grey enclosure, beige air-intake filter house with louvres,
    // tall exhaust stack with a lit warning lamp, access doors. Matte (non-metal) paints so they read at night.
    for (let i = 0; i < count('turbine'); i++) { const x = 45 + (i % 4) * 5, z = 22 + Math.floor(i / 4) * 9; const pk = box(4, 3.4, 7, tPkg, x, 1.7, z, unitsG); pk.userData.part = 'turbinePkg'; box(4.2, 0.3, 7.2, tTrim, x, 3.5, z, unitsG);
      box(3.4, 2.6, 2.6, tIntake, x, 4.95, z - 2.0, unitsG); for (let k = 0; k < 4; k++) box(3.45, 0.12, 2.65, tTrim, x, 4.0 + k * 0.6, z - 2.0, unitsG);
      for (const dz of [-1.2, 1.4]) box(0.06, 2.2, 1.1, tTrim, x + 2.02, 1.4, z + dz, unitsG);
      const st = cyl(0.75, 9, tPkg, x, 7.4, z + 2.4, unitsG); st.userData.part = 'turbineStack'; cyl(0.82, 0.35, tTrim, x, 11.7, z + 2.4, unitsG); box(0.35, 0.35, 0.35, navRed, x + 0.8, 11.4, z + 2.4, unitsG); }
    for (let i = 0; i < count('separator'); i++) { const o = cyl(1.4, 6, steel, -32 + i * 3.6, 2.1, 42, unitsG); o.rotation.x = Math.PI / 2; for (const dz of [-2, 2]) box(1.6, 1.4, 0.5, dark, -32 + i * 3.6, 0.7, 42 + dz, unitsG); cyl(0.25, 1.6, yellow, -32 + i * 3.6, 3.6, 42 - 1, unitsG); }
    // Process units on the row north of the ponds: a slot per kind, up to four copies in a 2x2 grid (mu-visuals).
    const PROC: UnitKind[] = ['gas_plant', 'refinery', 'reformer', 'coker', 'cracker', 'polymer'];
    PROC.forEach((k, si) => { const n = Math.min(4, count(k)); for (let i = 0; i < n; i++) { const g = new THREE.Group(); g.position.set(-70 + si * 20 + (i % 2) * 9 - 4.5, 0, 70 + Math.floor(i / 2) * 8.5 - 4.25); unitsG.add(g); procUnit(k, g); } });
    mineRig.visible = !!s?.mine; mineDig = !!s?.mine?.on;
  };
  const unitsG = new THREE.Group(); scene.add(unitsG);
  function procUnit(k: UnitKind, g: THREE.Group) {
    box(8, 0.3, 7.5, conc, 0, 0.15, 0, g);
    const col = (x: number, z: number, r0: number, h0: number, m: THREE.Material = steel) => { cyl(r0, h0, m, x, h0 / 2, z, g); for (let y = 2.5; y < h0; y += 3) cyl(r0 + 0.18, 0.18, yellow, x, y, z, g); box(0.3, 0.3, 0.3, navRed, x, h0 + 0.2, z, g); towerAccess(g, x, z, r0, h0); };
    if (k === 'gas_plant') { col(-2.4, -2, 0.8, 9); col(-0.4, -2, 0.7, 7); box(4, 2.6, 3, blue, 1.8, 1.4, 1.6, g); for (let i = 0; i < 3; i++) cyl(0.25, 3, dark, 0.6 + i * 1.2, 3.5, 2.4, g); cyl(0.6, 3, white, -2.6, 1.5, 2, g); }
    else if (k === 'refinery') { col(-2, -1, 1.1, 13); col(0.6, -2, 0.7, 8); box(3, 3.2, 2.6, red, 2.2, 1.6, 1.8, g); cyl(0.3, 4, dark, 2.2, 5.2, 1.8, g); for (const z of [1.2, 2.6]) { const d = cyl(0.5, 3.6, white, -1.8, 0.9, z, g); d.rotation.z = Math.PI / 2; } }
    else if (k === 'reformer') { for (let i = 0; i < 3; i++) { const sp = new THREE.Mesh(SPH(), steel); sp.scale.setScalar(2.6); sp.position.set(-2.6 + i * 2.6, 2.6, -1.4); sp.castShadow = true; g.add(sp); for (const o of [-0.7, 0.7]) box(0.2, 1.4, 0.2, dark, -2.6 + i * 2.6 + o, 0.7, -1.4, g); } box(6, 2.4, 2, red, 0, 1.2, 2, g); for (let i = 0; i < 3; i++) cyl(0.22, 3.4, dark, -2 + i * 2, 4, 2, g); }
    else if (k === 'coker') { for (const x of [-1.4, 1.4]) { cyl(1.2, 5, dark, x, 6.5, -0.5, g); cyl(1.2, 1.2, dark, x, 3.4, -0.5, g, 0.2); } for (const [x, z] of [[-3, -2.5], [3, -2.5], [-3, 1.5], [3, 1.5]] as const) box(0.3, 9, 0.3, yellow, x, 4.5, z, g); box(6.4, 0.25, 4.4, yellow, 0, 4.2, -0.5, g); box(6.4, 0.25, 4.4, yellow, 0, 9.1, -0.5, g); box(0.8, 4.5, 0.8, yellow, 0, 11.4, -0.5, g); box(5, 0.8, 1.8, mat({ color: 0x1a1a1a, roughness: 1 }), 0, 0.6, 2.6, g); }
    else if (k === 'cracker') { box(7, 3.6, 2.2, red, 0, 1.8, -1.8, g); for (let i = 0; i < 5; i++) cyl(0.22, 5, dark, -2.8 + i * 1.4, 6, -1.8, g); col(2.6, 2.2, 0.9, 10); box(3.6, 0.6, 0.6, steel, 0, 4, 0.6, g); const fl = new THREE.Mesh(sg('fcone', () => new THREE.ConeGeometry(0.5, 1, 10)), flameM); fl.scale.set(0.8, 1.6, 0.8); fl.position.set(-2.8, 9.1, -1.8); g.add(fl); }
    else if (k === 'polymer') { for (const x of [-2.8, -1.2, 0.4]) { cyl(0.7, 6, white, x, 3, -2, g); cyl(0.07, 0.8, white, x, 6.4, -2, g, 0.7); } box(4.2, 3, 3.4, mat({ color: 0xd8d2c4, roughness: 0.8 }), 1.6, 1.5, 1.6, g); box(4.3, 0.3, 3.5, blue, 1.6, 3.1, 1.6, g); const loop = new THREE.Mesh(sg('ftorus', () => new THREE.TorusGeometry(1, 0.12, 6, 18)), steel); loop.scale.setScalar(1.4); loop.position.set(-2, 1.6, 1.8); g.add(loop); }
  }
  const mineRig = new THREE.Group(); mineRig.visible = false; scene.add(mineRig); let mineDig = false;
  { const m = FORT_SPOTS.find((s) => s.id === 'f-mine')!; mineRig.position.set(m.x, 0, m.z); box(4, 2.4, 6, yellow, 4, -3.6, 2, mineRig); box(3, 1.4, 2.2, yellow, -3, -3.2, -3, mineRig); const wheel = new THREE.Mesh(geo(new THREE.TorusGeometry(1.8, 0.25, 8, 16)), dark); wheel.position.set(-12, 16.5, -11.4); mineRig.add(wheel); mineRig.userData.wheel = wheel; }

  // Interaction (same rules as the city).
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
  if (tier !== 'low') { composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.6, 0.8)); composer.addPass(new OutputPass()); }
  const ro = new ResizeObserver(() => { resize(); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1); } }); ro.observe(canvas); resize();
  setFort(null);
  const todOverride = parseTod(new URLSearchParams(location.search).get('tod')); const dirV = new THREE.Vector3();
  const applySky = () => {
    const k = skyNow(new Date(), todOverride); const fog = scene.fog as THREE.Fog;
    (skyU.uSky.value as THREE.Color).setHex(k.sky); (skyU.uHor.value as THREE.Color).setHex(mixHex(k.horizon, 0x8a6a5a, 0.25)); skyU.uWarm.value = k.warm; skyU.uStars.value = k.stars;
    fog.color.setHex(mixHex(k.fog, 0x8a6a5a, 0.2)); fog.near = 300 + 120 * k.day; fog.far = 900 + 260 * k.day;
    hemi.color.setHex(k.hemiSky); hemi.groundColor.setHex(k.hemiGround); hemi.intensity = Math.max(0.35, k.hemiI); renderer.toneMappingExposure = k.exposure;
    const e = Math.max(k.elev, -2) * Math.PI / 180, a = k.az * Math.PI / 180; dirV.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    // below the horizon keep a dim, high "moon" key light so shadows stay readable
    if (k.sunI > 0.05) { sun.position.copy(dirV).multiplyScalar(220); sun.color.setHex(k.sunColor); sun.intensity = k.sunI; } else { sun.position.set(80, 160, 60); sun.color.setHex(0x9fb4ff); sun.intensity = 0.25 + k.moonI; }
    fortWater.mat.uniforms.uDay.value = k.day; (fortWater.mat.uniforms.uSun.value as THREE.Vector3).copy(dirV);
    const gk = 0.12 + 0.88 * k.lights; for (const m of glowMats) m.emissiveIntensity = (m.userData.ei as number) * gk;
  };

  // Private jet (mu-jet-mcchud): owners' jets land on / take off from the YMC runway. Runway local x -20..36 at z 6, airport group at the f-airport spot.
  const ap = FORT_SPOTS.find((x) => x.id === 'f-airport')!; const AX = ap.x, AZ = ap.z;
  let jet: THREE.Group | null = null; let jetAnim: { mode: 'land' | 'takeoff'; t: number; dur: number; done?: () => void } | null = null;
  const PARK = { x: 6, z: -1.2 }; const RWY = 6;
  const jetPose = (j: THREE.Group, x: number, y: number, z: number, yaw: number, pitch: number) => { j.position.set(AX + x, y, AZ + z); j.rotation.set(pitch, yaw, 0, 'YXZ'); };
  const ease = (u: number) => u * u * (3 - 2 * u);
  const poseAt = (mode: 'land' | 'takeoff', u: number): [number, number, number, number, number] => {
    const E = Math.PI / 2; // nose (+z) pointing +x along the runway
    if (mode === 'land') {
      if (u < 0.5) { const k = u / 0.5; return [-90 + 72 * k, 24 * (1 - k) ** 1.4, RWY, E, -0.12 * (1 - k) - 0.05]; } // approach + flare to touchdown at x=-18
      if (u < 0.78) { const k = (u - 0.5) / 0.28; return [-18 + 20 * (1 - (1 - k) ** 2), 0, RWY, E, 0]; } // roll-out to x=2
      const k = ease((u - 0.78) / 0.22); return [2 + (PARK.x - 2) * k, 0, RWY + (PARK.z - RWY) * k, E + Math.PI * k, 0]; // taxi onto the apron, nose back to the runway
    }
    if (u < 0.2) { const k = ease(u / 0.2); const turn = ease(Math.max(0, (k - 0.6) / 0.4)); return [PARK.x + (-16 - PARK.x) * k, 0, PARK.z + (RWY - PARK.z) * k, -E + Math.PI * turn, 0]; } // taxi to the threshold, line up
    if (u < 0.6) { const k = (u - 0.2) / 0.4; return [-16 + 46 * k * k, 0, RWY, E, k > 0.8 ? -0.18 * (k - 0.8) / 0.2 : 0]; } // take-off roll, rotate at the end
    const k = (u - 0.6) / 0.4; return [30 + 90 * k, 26 * k ** 1.3, RWY, E, -0.18]; // climb-out
  };
  const frameAirport = () => { controls.target.set(AX + 4, 0, AZ + 4); camera.position.set(AX + 34, 34, AZ + 62); controls.update(); };
  const stepJet = (dt: number) => {
    if (!jet || !jetAnim) return; jetAnim.t += dt; const u = Math.min(1, jetAnim.t / jetAnim.dur); const [x, y, z, yaw, pitch] = poseAt(jetAnim.mode, u); jetPose(jet, x, y, z, yaw, pitch);
    if (u >= 1) { const a = jetAnim; jetAnim = null; if (a.mode === 'takeoff') jet.visible = false; a.done?.(); }
  };
  const jetApi = {
    /** Show `model` at YMC: 'park' on the apron, 'land' (approach, touchdown, taxi in) or 'takeoff' (taxi out, roll, climb); `done` fires when it finishes. */
    jetShow(model: FleetModel, mode: 'park' | 'land' | 'takeoff', done?: () => void) {
      if (jet) { scene.remove(jet); disposeTree(jet); }
      jet = buildJet(model); jet.userData.part = 'privateJet'; jet.name = 'privateJet'; if (model.id === 'chudone') jet.scale.setScalar(0.55); else if (model.id === 'g700') jet.scale.setScalar(0.8); scene.add(jet);
      if (mode === 'park') { jetPose(jet, PARK.x, 0, PARK.z, -Math.PI / 2, 0); jetAnim = null; done?.(); return; }
      frameAirport(); jetAnim = { mode, t: 0, dur: mode === 'land' ? 9 : 7, done }; stepJet(0);
    },
    /** Remove the jet once its flight is over (only planes in actual use are drawn). */
    jetHide() { if (jet) { scene.remove(jet); disposeTree(jet); jet = null; } jetAnim = null; },
    jetBusy: () => !!jetAnim,
  };
  applySky(); let skyT = 0;
  const clock = new THREE.Clock(); let raf = 0; let running = true; let time = 0; const tmp = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!running) return; const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    skyT += dt; if (skyT > 1) { skyT = 0; applySky(); } fortWater.mat.uniforms.uTime.value = time;
    jacks.forEach((b, i) => { b.rotation.z = Math.sin(time * 1.6 + i * 0.7) * 0.28; });
    flames.forEach((f) => { f.scale.set(1 + Math.sin(time * 9) * 0.12, 1 + Math.sin(time * 6.3) * 0.25, 1); });
    if (mineDig) (mineRig.userData.wheel as THREE.Object3D).rotation.z += dt * 2;
    stepJet(dt);
    controls.update(); clampPan();
    const portrait = (canvas.clientWidth || 1) < (canvas.clientHeight || 1);
    for (const s of signs) { const k = labelScale(camera.position.distanceTo(s.getWorldPosition(tmp)), portrait) * (s.userData.k as number); fitLabel(s, k); }
    renderScene(renderer, composer, scene, camera);
  };
  const vis = () => { running = !document.hidden; clock.getDelta(); }; document.addEventListener('visibilitychange', vis); frame();
  return {
    scene, camera, controls,
    setFort, ...jetApi,
    setRunning(v: boolean) { running = v; clock.getDelta(); },
    reset() { camera.position.copy(home); controls.target.copy(homeT); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave); if (jet) disposeTree(jet); controls.dispose(); disposables.forEach((x) => x.dispose()); composer?.dispose(); renderer.dispose(); },
  };
}
