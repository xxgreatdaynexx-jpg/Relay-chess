// Fort McChud 3D map: a boreal oil-sands boomtown at dusk. Spruce forest, muskeg, tailings ponds, ten lease tracts with
// wells and nodding pumpjacks, pipelines into a refinery complex (distillation towers, cracker, flare stack, tank farm),
// the Deep Ore Mine's terraced pit, the Commodity Exchange tower and the airport. Same camera/pan rules as the city.
import * as THREE from 'three';
import { asLabel, dimColor, drawLabel, LABEL_LAYER, labelMaterial, renderScene } from './labelSprite';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { detectWorldTier, labelScale, TIER_PIXEL_RATIO } from './worldTier';
import { FORT_SPOTS, FORT_X0, FORT_X1, FORT_Z0, FORT_Z1, TRACTS, tractInfo, type FortState, type UnitKind } from '../../../shared/fortmc';

type Handlers = { onHover: (id: string | null, x: number, y: number) => void; onPick: (id: string) => void };
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
let labelRenderer: THREE.WebGLRenderer | null = null;
function signTexture(text: string, color: string, sub?: string) {
  return drawLabel(text, { bg: (g, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(24,28,34,.92)'); gr.addColorStop(1, 'rgba(14,16,20,.92)'); return gr; }, border: dimColor(color, 0.9), text: '#f4f1ea', sub: color, font: 'Outfit Variable, system-ui, sans-serif', radius: 18 }, sub, labelRenderer);
}
export const clampFortTarget = (x: number, z: number): [number, number] => [Math.min(FORT_X1 - 10, Math.max(FORT_X0 + 10, x)), Math.min(FORT_Z1 - 10, Math.max(FORT_Z0 + 10, z))];
const TW = 30, TD = 26; // tract pad size

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

  // Northern dusk sky: steel blue overhead, amber band low on the horizon (flare-lit haze).
  const skyM = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {},
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vp; void main(){ float y = vp.y;
      vec3 amber = vec3(0.95,0.48,0.2); vec3 rose = vec3(0.55,0.32,0.36); vec3 steel = vec3(0.2,0.28,0.42); vec3 night = vec3(0.05,0.07,0.14);
      vec3 c = mix(amber, rose, smoothstep(0.0,0.08,y)); c = mix(c, steel, smoothstep(0.08,0.3,y)); c = mix(c, night, smoothstep(0.3,0.85,y));
      if (y < 0.0) c = amber*0.6; gl_FragColor = vec4(c,1.0);
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

  scene.add(new THREE.HemisphereLight(0xb8c8e0, 0x3a3226, 1.0));
  const sun = new THREE.DirectionalLight(0xffb070, 2.6); sun.position.set(-120, 70, 60); sun.castShadow = renderer.shadowMap.enabled;
  Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 140, bottom: -140, near: 10, far: 500 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; scene.add(sun);

  // Ground: muskeg + snow patches, gravel roads, tailings ponds.
  const ground = new THREE.Mesh(geo(new THREE.PlaneGeometry(FORT_X1 - FORT_X0 + 260, FORT_Z1 - FORT_Z0 + 260)), mat({ color: 0x5a5a3e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const snowM = mat({ color: 0xe8eef2, roughness: 0.9 });
  for (let i = 0; i < 26; i++) { const s = new THREE.Mesh(geo(new THREE.CircleGeometry(6 + r() * 14, 12)), snowM); s.rotation.x = -Math.PI / 2; s.position.set(FORT_X0 + r() * (FORT_X1 - FORT_X0), 0.02, FORT_Z0 + r() * (FORT_Z1 - FORT_Z0)); s.scale.y = 0.6 + r() * 0.6; scene.add(s); }
  const gravel = mat({ color: 0x8a7e6a, roughness: 1 });
  const road = (w: number, d: number, x: number, z: number) => { const o = new THREE.Mesh(geo(new THREE.BoxGeometry(w, 0.1, d)), gravel); o.position.set(x, 0.05, z); o.receiveShadow = true; scene.add(o); };
  road(FORT_X1 - FORT_X0 - 10, 6, 0, -4); road(FORT_X1 - FORT_X0 - 10, 6, 0, 56); road(6, 70, -128, 20); road(6, 70, 128, 20);
  const pond = mat({ color: 0x2a2620, roughness: 0.15, metalness: 0.3, emissive: 0x0a0806 });
  // Logistics (Millionaire Update): the river mouth the Barge Terminal sits on; cargo ships run down it (shared/logistics.ts HUB_MAPS.fortmc).
  { const river = new THREE.Mesh(geo(new THREE.PlaneGeometry(150, 440)), mat({ color: 0x24506e, roughness: 0.2, metalness: 0.25, emissive: 0x061620 })); river.rotation.x = -Math.PI / 2; river.position.set(165, 0.03, 320); river.receiveShadow = true; scene.add(river);
    const bay = new THREE.Mesh(geo(new THREE.PlaneGeometry(90, 40)), river.material); bay.rotation.x = -Math.PI / 2; bay.position.set(120, 0.03, 118); scene.add(bay); }
  for (const [x, z, w, d] of [[-60, 90, 50, 18], [40, 92, 40, 14]] as const) { const p = new THREE.Mesh(geo(new THREE.PlaneGeometry(w, d)), pond); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.04, z); scene.add(p); }

  // Spruce forest (instanced), kept off the pads, plant, mine and roads.
  const d = new THREE.Object3D(); const spots: Array<[number, number]> = [];
  const clear = (x: number, z: number) => {
    if (Math.abs(z + 4) < 6 || Math.abs(z - 56) < 6) return false;
    for (let n = 1; n <= TRACTS; n++) { const t = tractInfo(n); if (Math.abs(x - t.x) < TW / 2 + 3 && Math.abs(z - t.z) < TD / 2 + 3) return false; }
    for (const s of FORT_SPOTS) if (Math.abs(x - s.x) < s.w / 2 + 5 && Math.abs(z - s.z) < s.d / 2 + 5) return false;
    if (Math.abs(z - 90) < 14 && x > -90 && x < 64) return false; return true;
  };
  for (let i = 0; i < 1400 && spots.length < (tier === 'low' ? 260 : 620); i++) { const x = FORT_X0 - 60 + r() * (FORT_X1 - FORT_X0 + 120), z = FORT_Z0 - 60 + r() * (FORT_Z1 - FORT_Z0 + 120); if (clear(x, z)) spots.push([x, z]); }
  const spruce = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(1.6, 7, 7)), mat({ color: 0x1f3a2a, roughness: 0.9, flatShading: true }), spots.length);
  spruce.castShadow = true; spots.forEach(([x, z], i) => { const s = 0.7 + r() * 0.7; d.position.set(x, 3.5 * s, z); d.scale.set(s, s, s); d.rotation.set(0, r() * 6, 0); d.updateMatrix(); spruce.setMatrixAt(i, d.matrix); }); scene.add(spruce);

  const signs: THREE.Sprite[] = [];
  const label = (text: string, sub: string | undefined, color: string, x: number, y: number, z: number, k = 1) => {
    const tex = signTexture(text, color, sub); disposables.push(tex); const m = labelMaterial(tex, { fog: false }); disposables.push(m);
    const s = asLabel(new THREE.Sprite(m)); s.position.set(x, y, z); s.userData.k = k; s.scale.set(8, 2, 1); scene.add(s); signs.push(s); return s;
  };
  const pickables: THREE.Object3D[] = [];
  const steel = mat({ color: 0x9aa2aa, metalness: 0.7, roughness: 0.35 }); const dark = mat({ color: 0x2c3036, metalness: 0.5, roughness: 0.6 });
  const yellow = mat({ color: 0xf2b630, roughness: 0.6 }); const white = mat({ color: 0xe8e4dc, roughness: 0.7 }); const red = mat({ color: 0xb0302a, roughness: 0.6 });
  const glass = mat({ color: 0x7ab0d0, metalness: 0.6, roughness: 0.1, emissive: 0x1a3a50, emissiveIntensity: 0.6 });
  const flameM = mat({ color: 0xffa040, emissive: 0xff7a20, emissiveIntensity: 4 });
  const box = (w: number, hh: number, dd: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(geo(new THREE.BoxGeometry(w, hh, dd)), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
  const cyl = (rt: number, hh: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene, rb = rt) => { const o = new THREE.Mesh(geo(new THREE.CylinderGeometry(rt, rb, hh, 14)), m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const flames: THREE.Mesh[] = [];

  for (const s of FORT_SPOTS) {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z); scene.add(g);
    const hit = box(s.w, s.h, s.d, new THREE.MeshBasicMaterial({ visible: false }), 0, s.h / 2, 0, g); hit.userData.spot = s.id; hit.castShadow = false; pickables.push(hit);
    if (s.id === 'f-airport') {
      box(56, 0.15, 9, mat({ color: 0x3a3a3e, roughness: 1 }), 8, 0.08, 6, g); for (let i = 0; i < 7; i++) box(4, 0.17, 0.5, white, -16 + i * 8, 0.1, 6, g);
      box(16, 6, 8, white, -12, 3, -4, g); box(16, 2, 8.2, glass, -12, 5, -4, g); box(1.2, 10, 1.2, red, 2, 5, -6, g); box(3, 2, 3, glass, 2, 11, -6, g);
      const plane = new THREE.Group(); plane.position.set(14, 1.6, 6); g.add(plane); box(14, 1.6, 1.6, white, 0, 0, 0, plane); box(3, 0.25, 14, white, 0.5, 0, 0, plane); box(2, 2.4, 0.25, red, -6.4, 1.4, 0, plane);
      label('✈ YMC Airport', 'Fly home to Chud Hub', '#5aa8e8', s.x, 16, s.z);
    } else if (s.id === 'f-plant') {
      // Distillation towers, cracker furnace, cooling towers, pipe racks, flare.
      for (const [x, z, hh, rr] of [[-18, -8, 22, 1.6], [-13, -8, 16, 1.3], [-8, -8, 26, 1.8]] as const) { cyl(rr, hh, steel, x, hh / 2, z, g); for (let y = 3; y < hh; y += 4) cyl(rr + 0.25, 0.3, yellow, x, y, z, g); }
      box(14, 8, 6, dark, 8, 4, -10, g); for (let i = 0; i < 4; i++) cyl(0.5, 14, dark, 2 + i * 4, 15, -10, g);
      for (const x of [-20, -10]) cyl(4.5, 10, white, x, 5, 10, g, 6);
      box(50, 0.6, 1.2, yellow, 0, 4, 0, g); for (let x = -24; x <= 24; x += 6) box(0.4, 4, 0.4, yellow, x, 2, 0, g);
      for (let i = 0; i < 3; i++) cyl(0.35, 50, steel, -24 + i * 0.9, 4.8, 0, g).rotation.z = Math.PI / 2;
      for (const [x, z] of [[14, 8], [21, 8], [14, 14], [21, 14]] as const) cyl(2.8, 5, white, x, 2.5, z, g);
      cyl(0.5, 34, dark, 27, 17, -14, g); const fl = new THREE.Mesh(geo(new THREE.ConeGeometry(1.4, 5, 10)), flameM); fl.position.set(27, 36.5, -14); g.add(fl); flames.push(fl);
      label('🏭 Upgrader & Refinery', 'Build · run · repair', '#f2b630', s.x, 34, s.z, 1.3);
    } else if (s.id === 'f-exchange') {
      box(14, 26, 12, glass, 0, 13, 0, g); box(15, 1, 13, dark, 0, 26.5, 0, g); box(18, 3, 14, dark, 0, 1.5, 0, g);
      label('💹 Commodity Exchange', 'Sell · ship to factory', '#5ad89a', s.x, 32, s.z);
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
    const g = new THREE.Group(); g.position.set(x, 0.3, z); parent.add(g);
    box(1.2, 0.6, 1.2, dark, 0, 0.3, 0, g); // wellhead
    if (!jack) { box(0.5, 2.4, 0.5, red, 0, 1.4, 0, g); return; }
    box(3, 0.5, 1.4, dark, -1.2, 0.25, 0, g); box(0.3, 3.6, 0.3, yellow, -1.2, 1.8, -0.4, g); box(0.3, 3.6, 0.3, yellow, -1.2, 1.8, 0.4, g);
    const beam = new THREE.Group(); beam.position.set(-1.2, 3.6, 0); g.add(beam); box(5, 0.45, 0.45, broken ? dark : yellow, 0, 0, 0, beam);
    const head = box(0.6, 1.6, 0.6, dark, 2.5, -0.4, 0, beam); head.rotation.z = 0.2; box(1, 1, 0.6, dark, -2.4, -0.6, 0, beam);
    if (!broken) jacks.push(beam);
  };
  const setFort = (s: FortState | null) => {
    jacks.length = 0;
    for (const [n, g] of tractGroups) {
      while (g.children.length) g.remove(g.children[0]!);
      const t = s?.tracts[String(n)]; pads.get(n)!.material = t?.leased ? padOwnM : padM;
      if (!t?.leased) { if (s?.surveyed.includes(n)) box(1.4, 1, 1.4, yellow, 0, 0.8, 0, g); continue; }
      t.wells.forEach((w, i) => pumpjack(g, -9 + (i % 2) * 14, -5 + Math.floor(i / 2) * 9, w.jack, w.cond < 15));
      if (t.pipe > 0) { const pipe = cyl(t.pipe > 1 ? 0.55 : 0.35, Math.hypot(10 - tractInfo(n).x, 35 - tractInfo(n).z), t.pipe > 1 ? yellow : steel, 0, 0.6, 0, g); const dx = 10 - tractInfo(n).x, dz = 35 - tractInfo(n).z; pipe.position.set(dx / 2, 0.6, dz / 2); pipe.rotation.set(Math.PI / 2, 0, 0); pipe.rotation.order = 'YXZ'; pipe.rotation.y = Math.atan2(dx, dz); }
    }
    // tank farm and extra units around the plant
    while (unitsG.children.length) unitsG.remove(unitsG.children[0]!);
    const count = (k: UnitKind) => s?.units.filter((u) => u.k === k).length ?? 0;
    for (let i = 0; i < count('tank'); i++) cyl(3, 4, white, -45 + (i % 5) * 7.5, 2, 22 + Math.floor(i / 5) * 7.5, unitsG);
    for (let i = 0; i < count('turbine'); i++) { box(4, 3, 7, steel, 45 + (i % 4) * 5, 1.5, 22 + Math.floor(i / 4) * 9, unitsG); cyl(0.5, 6, dark, 45 + (i % 4) * 5, 5, 25 + Math.floor(i / 4) * 9, unitsG); }
    for (let i = 0; i < count('separator'); i++) { const o = cyl(1.4, 6, steel, -32 + i * 3.6, 0.9, 42, unitsG); o.rotation.z = Math.PI / 2; }
    mineRig.visible = !!s?.mine; mineDig = !!s?.mine?.on;
  };
  const unitsG = new THREE.Group(); scene.add(unitsG);
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
  const clock = new THREE.Clock(); let raf = 0; let running = true; let time = 0; const tmp = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!running) return; const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    jacks.forEach((b, i) => { b.rotation.z = Math.sin(time * 1.6 + i * 0.7) * 0.28; });
    flames.forEach((f) => { f.scale.set(1 + Math.sin(time * 9) * 0.12, 1 + Math.sin(time * 6.3) * 0.25, 1); });
    if (mineDig) (mineRig.userData.wheel as THREE.Object3D).rotation.z += dt * 2;
    controls.update(); clampPan();
    const portrait = (canvas.clientWidth || 1) < (canvas.clientHeight || 1);
    for (const s of signs) { const k = labelScale(camera.position.distanceTo(s.getWorldPosition(tmp)), portrait) * (s.userData.k as number); s.scale.set(k, k / 4 * ((s.material.map!.image as { height: number }).height / 128), 1); }
    renderScene(renderer, composer, scene, camera);
  };
  const vis = () => { running = !document.hidden; clock.getDelta(); }; document.addEventListener('visibilitychange', vis); frame();
  return {
    scene,
    setFort,
    setRunning(v: boolean) { running = v; clock.getDelta(); },
    reset() { camera.position.copy(home); controls.target.copy(homeT); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave); controls.dispose(); disposables.forEach((x) => x.dispose()); composer?.dispose(); renderer.dispose(); },
  };
}
