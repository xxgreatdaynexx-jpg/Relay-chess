// Private Island 3D map: a jungle island with white beaches, a ridge with a waterfall, four luxury estates on their own
// pads, the dock with a moored megayacht and a jet pad, the Pearl Lagoon fishing pier and the Sunset Lounge.
// Same camera/pan rules as the city and the resort (drag pans, right-drag rotates, wheel/pinch zooms, click picks).
// The shoreline comes from shared/island.ts (ISLAND_CENTER, ISLAND_GRASS_R, ISLAND_LAND_R, ISLAND_BEACH_R), so the 2D map agrees.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { asLabel, cityLabel, fitLabel, LABEL_LAYER, labelMaterial, renderScene } from './labelSprite';
import { detectWorldTier, labelScale, TIER_PIXEL_RATIO } from './worldTier';
import { buildBoat, buildJet, disposeTree } from './fleetModels';
import { FLEET_BY_ID } from '../../../shared/fleet';
import {
  ISLAND_BEACH_R, ISLAND_CENTER, ISLAND_DOCK, ISLAND_GRASS_R, ISLAND_LAGOON, ISLAND_LAND_R, ISLAND_LOTS, ISLAND_LOUNGE, ISLAND_PLACES,
  clampIslandTarget, type IslandLot,
} from '../../../shared/island';

export interface IslandWorld {
  focusXZ(x: number, z: number): void;
  /** Point the camera at (x, z) from an offset (QA screenshots). */
  view(x: number, z: number, dx?: number, dy?: number, dz?: number): void;
  reset(): void;
  setOwners(owners: Map<string, string>, me: string | null): void;
  setRunning(v: boolean): void;
  dispose(): void;
}
type Handlers = { onHover: (id: string, x: number, y: number) => void; onPick: (id: string) => void };

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const CX = ISLAND_CENTER.x, CZ = ISLAND_CENTER.z;
const rOf = (x: number, z: number) => Math.hypot(x - CX, z - CZ);
/** Gentle wobble so the beach is not a perfect circle (kept small so the 2D map still matches). */
const wobble = (x: number, z: number) => { const a = Math.atan2(z - CZ, x - CX); return Math.sin(a * 5) * 1.1 + Math.sin(a * 11 + 1.3) * 0.6; };
const fmtShort = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`);

/** Ground height before the estate pads: grass hills and The Ridge inland, beach sloping to the waterline, sea floor beyond. */
function rawHeight(x: number, z: number): number {
  const r = rOf(x, z) + wobble(x, z);
  const ridge = 12 * Math.exp(-((x / 30) ** 2 + ((z + 47) / 11) ** 2));
  const hills = Math.max(0, Math.sin(x * 0.11 + 0.4) * Math.cos(z * 0.09) * 1.3 + Math.sin((x + z) * 0.19) * 0.5);
  const inland = 1.3 + ridge + hills;
  const beach = r <= ISLAND_BEACH_R ? lerp(0.9, 0.05, smooth(ISLAND_GRASS_R, ISLAND_BEACH_R, r)) : 0.05 - (r - ISLAND_BEACH_R) * 0.45;
  return lerp(inland, beach, smooth(ISLAND_GRASS_R - 7, ISLAND_GRASS_R + 1, r));
}
const padOf = (l: IslandLot) => ({ x: l.x, z: l.z, r: Math.max(l.w, l.d) * 0.72, y: rawHeight(l.x, l.z) + 0.15 });
const PADS = ISLAND_LOTS.map(padOf);
export function islandHeight(x: number, z: number): number {
  let h = rawHeight(x, z);
  for (const p of PADS) { const d = Math.hypot(x - p.x, z - p.z); h = lerp(h, p.y, smooth(p.r + 5, p.r, d)); }
  return h;
}

/** Walking paths (polylines): dock up to the plaza, the plaza out to each estate, along the beach to the lagoon and the lounge. */
const PLAZA = { x: CX, z: CZ + 4, r: 6 };
const PATHS: Array<Array<[number, number]>> = [
  [[ISLAND_DOCK.x, ISLAND_DOCK.z - 4], [0, 16], [0, PLAZA.z + PLAZA.r]],
  ...ISLAND_LOTS.map((l): Array<[number, number]> => { const dx = l.x - PLAZA.x, dz = l.z - PLAZA.z, d = Math.hypot(dx, dz); const k = (padOf(l).r + 1) / d; return [[PLAZA.x + (dx / d) * PLAZA.r, PLAZA.z + (dz / d) * PLAZA.r], [l.x - dx * k, l.z - dz * k]]; }),
  [[-5, 25], [-22, 30], [-33, 30]],
  [[5, 25], [22, 29], [33, 28]],
];
const nearPath = (x: number, z: number, pad = 2) => PATHS.some((pl) => pl.some((p, i) => {
  const q = pl[i + 1]; if (!q) return false; const vx = q[0] - p[0], vz = q[1] - p[1]; const L2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - p[0]) * vx + (z - p[1]) * vz) / L2)); return Math.hypot(x - (p[0] + vx * t), z - (p[1] + vz * t)) < pad;
}));

export function createIsland(canvas: HTMLCanvasElement, h: Handlers): IslandWorld {
  const tier = detectWorldTier(); const r = rng(20261122);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIER_PIXEL_RATIO[tier])); canvas.dataset.tier = tier;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = tier !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); const disposables: Array<{ dispose(): void }> = []; const models: THREE.Object3D[] = [];
  const mat = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.7, ...p }); disposables.push(m); return m; };
  const geo = <G extends THREE.BufferGeometry>(g: G) => { disposables.push(g); return g; };
  const anims: Array<(t: number, dt: number) => void> = [];

  // Sky: tropical afternoon, deep blue overhead to a pale turquoise horizon, with the sun over the open sea.
  const skyM = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {},
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vp; void main(){ float y = vp.y;
      vec3 hor = vec3(0.72,0.9,0.95); vec3 mid = vec3(0.32,0.62,0.9); vec3 top = vec3(0.08,0.3,0.72);
      vec3 c = mix(hor, mid, smoothstep(0.0,0.18,y)); c = mix(c, top, smoothstep(0.18,0.8,y));
      vec3 sd = normalize(vec3(0.55,0.32,0.75)); float s = clamp(dot(vp, sd), 1e-4, 1.0);
      c += vec3(1.0,0.92,0.75)*pow(s,700.0)*5.0 + vec3(1.0,0.85,0.6)*pow(s,18.0)*0.25;
      if (y < 0.0) c = hor; gl_FragColor = vec4(c,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
  disposables.push(skyM); scene.add(new THREE.Mesh(geo(new THREE.SphereGeometry(900, 32, 16)), skyM));
  scene.fog = new THREE.Fog(0xbfe6ee, 380, 1000);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1900);
  const home = new THREE.Vector3(78, 74, 132); const homeT = new THREE.Vector3(0, 2, -10); camera.position.copy(home);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(homeT); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 18; controls.maxDistance = 300; controls.maxPolarAngle = 1.38; controls.minPolarAngle = 0.25;
  controls.enablePan = true; controls.screenSpacePanning = false; controls.panSpeed = 1.1;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const clampPan = () => { const t = controls.target; const [x, z] = clampIslandTarget(t.x, t.z); if (x !== t.x || z !== t.z) { camera.position.x += x - t.x; camera.position.z += z - t.z; t.x = x; t.z = z; } };

  scene.add(new THREE.HemisphereLight(0xdff4ff, 0x3a5a3a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(90, 120, 110); sun.castShadow = renderer.shadowMap.enabled;
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; scene.add(sun);

  // ---- Terrain: one displaced, vertex-coloured disc (grass, jungle floor, rock on the ridge, sand, wet sand, sea floor).
  const SIZE = (ISLAND_BEACH_R + 18) * 2, SEG = tier === 'low' ? 110 : 170;
  const tg = geo(new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG)); tg.rotateX(-Math.PI / 2); tg.translate(CX, 0, CZ);
  const pos = tg.attributes.position as THREE.BufferAttribute; const cols = new Float32Array(pos.count * 3); const c = new THREE.Color();
  const sand = new THREE.Color(0xf1dfb0), wet = new THREE.Color(0xc9b48a), grass = new THREE.Color(0x4f9a46), jungle = new THREE.Color(0x2f6a34), rock = new THREE.Color(0x8a8576), floor = new THREE.Color(0x2fa6a0), abyss = new THREE.Color(0x03284a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i); const y = islandHeight(x, z); pos.setY(i, y);
    const rr = rOf(x, z) + wobble(x, z); const n = Math.sin(x * 0.31) * Math.cos(z * 0.27) * 0.5 + 0.5;
    c.copy(grass).lerp(jungle, n * 0.8 * (1 - smooth(ISLAND_GRASS_R - 14, ISLAND_GRASS_R - 4, rr)));
    if (y > 8) c.lerp(rock, smooth(8, 11, y));
    c.lerp(sand, smooth(ISLAND_GRASS_R - 3, ISLAND_GRASS_R + 1, rr));
    c.lerp(wet, smooth(ISLAND_BEACH_R - 3, ISLAND_BEACH_R, rr));
    c.lerp(floor, smooth(ISLAND_BEACH_R + 0.5, ISLAND_BEACH_R + 6, rr)); c.lerp(abyss, smooth(ISLAND_BEACH_R + 8, ISLAND_BEACH_R + 16, rr));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(cols, 3)); tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, mat({ vertexColors: true, roughness: 0.95 })); terrain.receiveShadow = true; scene.add(terrain);
  // Island land mass footprint for reference: ISLAND_LAND_R is where the grass meets the dunes on the 2D map.
  void ISLAND_LAND_R;

  // ---- Ocean: turquoise shallows around the island and the Pearl Lagoon, deep sapphire offshore, waves, sun glints, foam.
  const LAGOON_C = new THREE.Vector2(ISLAND_LAGOON.x - 6, ISLAND_LAGOON.z + 6);
  const waterMat = new THREE.ShaderMaterial({ transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uC: { value: new THREE.Vector2(CX, CZ) }, uR: { value: ISLAND_BEACH_R }, uL: { value: LAGOON_C }, uSun: { value: new THREE.Vector3(0.55, 0.32, 0.75).normalize() } }]),
    vertexShader: `uniform float uTime; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_vertex>
      float h(vec2 p){ return sin(p.x*0.09+uTime*1.1)*0.12 + sin(p.y*0.12-uTime*0.8)*0.1 + sin((p.x+p.y)*0.23+uTime*1.6)*0.05; }
      void main(){ vec3 p = position; vec4 w0 = modelMatrix*vec4(p,1.0); p.z += h(w0.xz);
        float e = 0.5; float dx = h(w0.xz+vec2(e,0.0)) - h(w0.xz-vec2(e,0.0)); float dy = h(w0.xz+vec2(0.0,e)) - h(w0.xz-vec2(0.0,e));
        vN = normalize(vec3(-dx/(2.0*e), 1.0, -dy/(2.0*e)));
        vec4 wp = modelMatrix*vec4(p,1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec2 uC; uniform float uR; uniform vec2 uL; uniform vec3 uSun; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_fragment>
      void main(){ float d = length(vW.xz - uC) - uR; float lg = length(vW.xz - uL);
        vec3 lagoon = vec3(0.25,0.88,0.82); vec3 shallow = vec3(0.06,0.66,0.7); vec3 mid = vec3(0.02,0.36,0.56); vec3 deep = vec3(0.01,0.12,0.32);
        vec3 c = mix(shallow, mid, smoothstep(2.0,22.0,d)); c = mix(c, deep, smoothstep(22.0,90.0,d));
        c = mix(lagoon, c, smoothstep(6.0,17.0,lg));
        vec3 n = normalize(vN + vec3(sin(vW.x*1.3+uTime*2.0), 0.0, cos(vW.z*1.5-uTime*1.5))*0.05);
        vec3 v = normalize(cameraPosition - vW); float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        c = mix(c, vec3(0.75,0.9,0.98), fr*0.45);
        vec3 hv = normalize(uSun + v); c += vec3(1.0,0.95,0.8)*(pow(max(dot(n, hv), 0.0), 240.0)*2.5 + pow(max(dot(n, hv), 0.0), 40.0)*0.15);
        float a = atan(vW.z - uC.y, vW.x - uC.x); float edge = d + sin(a*40.0 + uTime*1.2)*0.35 + sin(a*17.0 - uTime*0.7)*0.25;
        float foam = (1.0 - smoothstep(0.0, 1.4, abs(edge - 0.6))) * 0.9 + (1.0 - smoothstep(0.0, 0.5, abs(edge - 3.2 - sin(uTime*0.9)*0.6))) * 0.35;
        c = mix(c, vec3(0.97,0.97,0.94), clamp(foam,0.0,1.0));
        float al = mix(0.8, 1.0, smoothstep(0.0, 14.0, d));
        gl_FragColor = vec4(c, al);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }` });
  disposables.push(waterMat);
  const water = new THREE.Mesh(geo(new THREE.PlaneGeometry(1800, 1800, 180, 180)), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(CX, 0, CZ); scene.add(water);

  // ---- Shared helpers.
  const d = new THREE.Object3D();
  const box = (w: number, hh: number, dd: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
    const o = new THREE.Mesh(geo(new THREE.BoxGeometry(w, hh, dd)), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o;
  };
  const cyl = (rt: number, rb: number, hh: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, seg = 10) => {
    const o = new THREE.Mesh(geo(new THREE.CylinderGeometry(rt, rb, hh, seg)), m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
  };
  /** Hip roof (4-sided pyramid), turned square to the walls. */
  const hip = (w: number, dd: number, hh: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
    const o = new THREE.Mesh(geo(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4)), m); o.rotation.y = Math.PI / 4; o.scale.set(w, hh, dd); o.position.set(x, y + hh / 2, z); o.castShadow = true; parent.add(o); return o;
  };
  const white = mat({ color: 0xf8f4ec, roughness: 0.55 }); const cream = mat({ color: 0xf0e2c6 }); const stone = mat({ color: 0xe8dcc4, roughness: 0.9 });
  const glass = mat({ color: 0x8fd0e8, metalness: 0.6, roughness: 0.08, emissive: 0x1a3a48, emissiveIntensity: 0.45 });
  const pool = mat({ color: 0x46d3e6, roughness: 0.05, metalness: 0.2, emissive: 0x0a6a78, emissiveIntensity: 0.7 });
  const gold = mat({ color: 0xd8b25a, metalness: 0.85, roughness: 0.3, emissive: 0x3a2808 });
  const thatch = mat({ color: 0x9a7444, roughness: 1, flatShading: true }); const terracotta = mat({ color: 0xc0603a, roughness: 0.85 });
  const wood = mat({ color: 0xa8784a, roughness: 0.8 }); const darkWood = mat({ color: 0x5a3a22, roughness: 0.85 }); const slate = mat({ color: 0x3a4248, roughness: 0.6 });
  const flame = mat({ color: 0xffc060, emissive: 0xff8a20, emissiveIntensity: 5 }); const bulb = mat({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 3 });
  const towelCols = [0xf26b5b, 0x2fb5b0, 0xf6c445, 0xffffff];

  // Labels.
  const signs: THREE.Sprite[] = [];
  const label = (text: string, sub: string | undefined, color: string, x: number, y: number, z: number, k = 1) => {
    const tex = cityLabel(text, color, sub, renderer); const m = labelMaterial(tex, { fog: false }); disposables.push(m);
    const s = asLabel(new THREE.Sprite(m)); s.position.set(x, y, z); s.userData.k = k; s.userData.tex = tex; fitLabel(s, 8 * k); scene.add(s); signs.push(s); return s;
  };
  const relabel = (s: THREE.Sprite, text: string, sub: string | undefined, color: string) => {
    (s.userData.tex as THREE.Texture | undefined)?.dispose(); const tex = cityLabel(text, color, sub, renderer); s.material.map = tex; s.material.needsUpdate = true; s.userData.tex = tex;
  };

  const pickables: THREE.Object3D[] = [];
  const pickable = (g: THREE.Object3D, id: string) => { g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.spot = id; pickables.push(o); } }); };

  // ---- Palms (instanced, curved trunks + fronds) and jungle canopy.
  const palmSpots: Array<[number, number, number]> = []; // x, z, height scale
  const busy = (x: number, z: number, pad = 2.2) => nearPath(x, z, pad) || PADS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 1) || Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 2
    || Math.hypot(x - ISLAND_DOCK.x, z - ISLAND_DOCK.z) < 10 || Math.hypot(x - ISLAND_LOUNGE.x, z - ISLAND_LOUNGE.z) < 9 || Math.hypot(x - ISLAND_LAGOON.x, z - ISLAND_LAGOON.z) < 9 || Math.hypot(x - 18, z - 12) < 9;
  for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2, rr = ISLAND_GRASS_R - 1 + r() * (ISLAND_BEACH_R - ISLAND_GRASS_R - 5); const x = CX + Math.cos(a) * rr, z = CZ + Math.sin(a) * rr; if (!busy(x, z)) palmSpots.push([x, z, 0.85 + r() * 0.5]); }
  for (const l of ISLAND_LOTS) { const p = padOf(l); for (let k = 0; k < 5; k++) { const a = r() * Math.PI * 2; palmSpots.push([l.x + Math.cos(a) * (p.r + 1.5), l.z + Math.sin(a) * (p.r + 1.5), 0.8 + r() * 0.4]); } }
  for (const [x, z] of [[-6, 20], [6, 20], [-6, 10], [6, 10]] as const) palmSpots.push([x, z, 1]);
  { const SEGN = 5, FR = 8; const n = palmSpots.length;
    const trunk = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.26, 0.36, 1.6, 7)), mat({ color: 0x8a6a48, roughness: 1 }), n * SEGN);
    const frond = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(0.75, 4.8, 4, 1)), mat({ color: 0x2f8a3a, roughness: 0.8, flatShading: true }), n * FR);
    const nuts = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.28, 6, 5)), mat({ color: 0x5a3a1a }), n * 3);
    trunk.castShadow = frond.castShadow = true;
    palmSpots.forEach(([x, z, hs], p) => {
      const lean = (r() - 0.5) * 0.6, dir = r() * Math.PI * 2; let px = x, py = islandHeight(x, z) - 0.2, pz = z;
      for (let s = 0; s < SEGN; s++) { const a = lean * (s / SEGN) * 2; d.position.set(px, py + 0.8 * hs, pz); d.rotation.set(Math.cos(dir) * a, 0, Math.sin(dir) * a); d.scale.set(1 - s * 0.08, hs, 1 - s * 0.08); d.updateMatrix(); trunk.setMatrixAt(p * SEGN + s, d.matrix);
        px += Math.sin(dir) * a * -0.8 * hs; pz += Math.cos(dir) * a * 0.8 * hs; py += 1.6 * hs; }
      for (let f = 0; f < FR; f++) { const yaw = (f / FR) * Math.PI * 2 + r() * 0.3; d.position.set(px + Math.cos(yaw) * 1.8, py + 0.2, pz + Math.sin(yaw) * 1.8); d.rotation.set(0, -yaw, 0); d.rotateZ(-Math.PI / 2 - 0.3 - r() * 0.2); d.scale.set(1, 1, 0.25); d.updateMatrix(); frond.setMatrixAt(p * FR + f, d.matrix); }
      for (let k = 0; k < 3; k++) { d.position.set(px + Math.cos(k * 2.1) * 0.4, py - 0.2, pz + Math.sin(k * 2.1) * 0.4); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); nuts.setMatrixAt(p * 3 + k, d.matrix); }
    });
    scene.add(trunk, frond, nuts); }
  { // Jungle: clustered broadleaf canopy on short trunks, denser toward the ridge, plus ferns on the floor.
    const spots: Array<[number, number, number]> = [];
    for (let i = 0; i < 2600 && spots.length < (tier === 'low' ? 220 : 380); i++) {
      const x = CX + (r() - 0.5) * 2 * (ISLAND_GRASS_R - 4), z = CZ + (r() - 0.5) * 2 * (ISLAND_GRASS_R - 4); const rr = rOf(x, z);
      if (rr > ISLAND_GRASS_R - 5 || busy(x, z, 3.2) || PADS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 5)) continue; if (z > 14 && Math.abs(x) < 14) continue; // keep the dock approach open
      spots.push([x, z, 1.6 + r() * 2.2]);
    }
    const n = spots.length; const can = new THREE.InstancedMesh(geo(new THREE.IcosahedronGeometry(1, 0)), mat({ roughness: 0.85, flatShading: true }), n * 2);
    const tr = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.18, 0.28, 1, 6)), mat({ color: 0x5a4430, roughness: 1 }), n); can.castShadow = true; can.receiveShadow = true;
    const greens = [0x2f7a34, 0x3f8a3a, 0x24602c, 0x4f9a3a, 0x2a6e40]; const cc = new THREE.Color();
    spots.forEach(([x, z, s], i) => { const y = islandHeight(x, z);
      d.position.set(x, y + s * 0.6, z); d.rotation.set(0, 0, 0); d.scale.set(0.6, s * 1.2, 0.6); d.updateMatrix(); tr.setMatrixAt(i, d.matrix);
      for (let k = 0; k < 2; k++) { d.position.set(x + (r() - 0.5) * s * 0.8, y + s * 1.25 + k * s * 0.45, z + (r() - 0.5) * s * 0.8); d.rotation.set(r(), r() * 3, r()); d.scale.set(s * (1 - k * 0.25), s * 0.75, s * (1 - k * 0.25)); d.updateMatrix(); can.setMatrixAt(i * 2 + k, d.matrix); can.setColorAt(i * 2 + k, cc.setHex(greens[Math.floor(r() * greens.length)]!)); }
    });
    scene.add(can, tr);
    const fernN = tier === 'low' ? 160 : 320; const fern = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(0.6, 1.2, 5)), mat({ color: 0x3a8a3a, flatShading: true }), fernN); let fn = 0;
    for (let i = 0; i < fernN * 4 && fn < fernN; i++) { const a = r() * Math.PI * 2, rr = r() * (ISLAND_GRASS_R + 2); const x = CX + Math.cos(a) * rr, z = CZ + Math.sin(a) * rr; if (busy(x, z, 1.4)) continue; d.position.set(x, islandHeight(x, z) + 0.4, z); d.rotation.set(0, r() * 3, 0); const s = 0.6 + r() * 0.9; d.scale.set(s, s, s); d.updateMatrix(); fern.setMatrixAt(fn++, d.matrix); }
    fern.count = fn; scene.add(fern);
    // Ridge boulders and the beach rocks.
    const rockN = 90; const rocks = new THREE.InstancedMesh(geo(new THREE.DodecahedronGeometry(1, 0)), mat({ color: 0x8a8576, roughness: 1, flatShading: true }), rockN); let rn = 0;
    for (let i = 0; i < 900 && rn < rockN; i++) { const x = (r() - 0.5) * 70, z = -60 + r() * 26; const y = islandHeight(x, z); if (y < 6 || busy(x, z, 2)) continue; const s = 0.6 + r() * 1.8; d.position.set(x, y + s * 0.3, z); d.rotation.set(r(), r(), r()); d.scale.set(s, s * 0.8, s); d.updateMatrix(); rocks.setMatrixAt(rn++, d.matrix); }
    for (let i = 0; i < 24 && rn < rockN; i++) { const a = Math.PI * (0.1 + r() * 0.8) + Math.PI, rr = ISLAND_BEACH_R + 1 + r() * 3; const x = CX + Math.cos(a) * rr, z = CZ + Math.sin(a) * rr; const s = 0.8 + r() * 1.6; d.position.set(x, 0, z); d.rotation.set(r(), r(), r()); d.scale.set(s, s * 0.7, s); d.updateMatrix(); rocks.setMatrixAt(rn++, d.matrix); }
    rocks.count = rn; rocks.castShadow = true; scene.add(rocks);
  }

  // ---- Paths (sandstone pavers) with tiki torches, and the jungle plaza with a fountain.
  { const tiles: Array<[number, number, number]> = []; const torches: Array<[number, number]> = [];
    for (const pl of PATHS) for (let i = 0; i + 1 < pl.length; i++) { const [ax, az] = pl[i]!, [bx, bz] = pl[i + 1]!; const L = Math.hypot(bx - ax, bz - az); const yaw = Math.atan2(bx - ax, bz - az);
      for (let s = 0; s <= L; s += 1.1) { const t = s / L; tiles.push([ax + (bx - ax) * t, az + (bz - az) * t, yaw]); }
      for (let s = 3; s < L; s += 7) { const t = s / L, nx = Math.cos(yaw) * 2, nz = -Math.sin(yaw) * 2; torches.push([ax + (bx - ax) * t + nx, az + (bz - az) * t + nz], [ax + (bx - ax) * t - nx, az + (bz - az) * t - nz]); } }
    const tm = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(2.6, 0.16, 1.0)), mat({ color: 0xe8d6ac, roughness: 0.95 }), tiles.length); tm.receiveShadow = true;
    tiles.forEach(([x, z, yaw], i) => { d.position.set(x, islandHeight(x, z) + 0.06, z); d.rotation.set(0, yaw, 0); d.scale.set(1, 1, 1); d.updateMatrix(); tm.setMatrixAt(i, d.matrix); }); scene.add(tm);
    const tp = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.08, 0.1, 2, 5)), darkWood, torches.length); const tf = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(0.22, 0.6, 6)), flame, torches.length);
    torches.forEach(([x, z], i) => { const y = islandHeight(x, z); d.position.set(x, y + 1, z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); tp.setMatrixAt(i, d.matrix); d.position.y = y + 2.2; d.updateMatrix(); tf.setMatrixAt(i, d.matrix); });
    scene.add(tp, tf); anims.push((t) => { flame.emissiveIntensity = 4.5 + Math.sin(t * 9) * 0.6 + Math.sin(t * 23) * 0.4; });
    const py = islandHeight(PLAZA.x, PLAZA.z);
    const plaza = new THREE.Mesh(geo(new THREE.CylinderGeometry(PLAZA.r, PLAZA.r + 0.4, 0.4, 32)), stone); plaza.position.set(PLAZA.x, py + 0.05, PLAZA.z); plaza.receiveShadow = true; scene.add(plaza);
    const fpool = new THREE.Mesh(geo(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 24)), pool); fpool.position.set(PLAZA.x, py + 0.35, PLAZA.z); scene.add(fpool);
    cyl(0.35, 0.5, 2, white, PLAZA.x, py + 1.2, PLAZA.z, scene); const bowl = cyl(1.1, 0.3, 0.4, gold, PLAZA.x, py + 2.3, PLAZA.z, scene, 16); void bowl;
  }

  // ---- Ridge Falls: a waterfall down the ridge into a plunge pool.
  { const fx = 24, fz = -44; const top = islandHeight(fx, fz - 6) + 1.5, base = islandHeight(fx, fz) + 0.1;
    const fallMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float s = fract(vUv.y*3.0 + uTime*1.6 + sin(vUv.x*20.0)*0.08); float st = smoothstep(0.0,0.4,s)*0.5 + 0.5;
        float edge = smoothstep(0.0,0.15,vUv.x)*smoothstep(1.0,0.85,vUv.x); gl_FragColor = vec4(mix(vec3(0.55,0.85,0.95), vec3(1.0), st*0.7), 0.85*edge); }` });
    disposables.push(fallMat); const fall = new THREE.Mesh(geo(new THREE.PlaneGeometry(3.4, Math.max(2, top - base), 1, 8)), fallMat); fall.position.set(fx, (top + base) / 2, fz - 3.2); fall.rotation.x = -0.25; scene.add(fall);
    const pp = new THREE.Mesh(geo(new THREE.CircleGeometry(3.6, 24)), pool); pp.rotation.x = -Math.PI / 2; pp.position.set(fx, base + 0.12, fz); scene.add(pp);
    const mist = new THREE.Mesh(geo(new THREE.SphereGeometry(1.6, 10, 8)), mat({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false })); mist.position.set(fx, base + 0.8, fz - 1.8); scene.add(mist);
    anims.push((t) => { fallMat.uniforms.uTime!.value = t; mist.scale.setScalar(1 + Math.sin(t * 3) * 0.08); });
  }

  // ---- The four estates. Each has its own style, a pad, a terrace with a pool and loungers.
  const estateLabels = new Map<string, THREE.Sprite>(); const ownedMarks = new Map<string, THREE.Object3D>();
  const STYLE = ['cove', 'palm', 'ridge', 'crown'] as const;
  ISLAND_LOTS.forEach((l, i) => {
    const p = padOf(l); const g = new THREE.Group(); g.position.set(l.x, p.y, l.z); g.rotation.y = l.rot; scene.add(g);
    const padM = new THREE.Mesh(geo(new THREE.CylinderGeometry(p.r, p.r + 0.6, 0.5, 36)), mat({ color: 0x6fae5a, roughness: 1 })); padM.position.y = -0.2; padM.receiveShadow = true; g.add(padM);
    const W = l.w, D = l.d, H = l.h; const style = STYLE[i] ?? 'cove';
    box(W + 2, 0.35, D + 4, stone, 0, 0.12, 0, g); // terrace
    box(W * 0.62, 0.2, D * 0.26, pool, 0, 0.32, D / 2 - D * 0.1, g); // pool in front (seaward)
    for (let k = 0; k < 4; k++) { const lx = -W * 0.3 + k * W * 0.2; const lm = mat({ color: towelCols[k % towelCols.length]! }); box(0.8, 0.25, 2, lm, lx, 0.45, D / 2 + 1.2, g); }
    if (style === 'cove') { // Balinese pavilions with thatched hip roofs and a teak deck
      box(W * 0.9, 0.3, D * 0.7, wood, 0, 0.45, -D * 0.12, g);
      box(W * 0.5, H * 0.42, D * 0.42, cream, -W * 0.12, 0.6 + H * 0.21, -D * 0.18, g); hip(W * 0.78, D * 0.66, H * 0.5, thatch, -W * 0.12, 0.6 + H * 0.42, -D * 0.18, g);
      box(W * 0.22, H * 0.3, D * 0.22, cream, W * 0.33, 0.6 + H * 0.15, -D * 0.25, g); hip(W * 0.36, D * 0.36, H * 0.36, thatch, W * 0.33, 0.6 + H * 0.3, -D * 0.25, g);
      for (const [x, z] of [[-W * 0.4, D * 0.18], [-W * 0.2, D * 0.18]]) cyl(0.14, 0.14, H * 0.32, darkWood, x!, 0.6 + H * 0.16, z!, g);
      hip(W * 0.34, D * 0.24, H * 0.24, thatch, -W * 0.3, 0.6 + H * 0.32, D * 0.18, g);
      box(W * 0.5, H * 0.4, 0.14, glass, -W * 0.12, 0.6 + H * 0.2, -D * 0.18 + D * 0.21, g);
    } else if (style === 'palm') { // Mediterranean: stacked stucco volumes, terracotta roofs, a tower and arches
      box(W * 0.7, H * 0.45, D * 0.5, cream, 0, H * 0.225 + 0.3, -D * 0.15, g); hip(W * 0.78, D * 0.58, H * 0.22, terracotta, 0, H * 0.45 + 0.3, -D * 0.15, g);
      box(W * 0.4, H * 0.35, D * 0.35, cream, -W * 0.12, H * 0.45 + 0.3 + H * 0.175, -D * 0.2, g); hip(W * 0.48, D * 0.43, H * 0.2, terracotta, -W * 0.12, H * 0.8 + 0.3, -D * 0.2, g);
      box(W * 0.18, H * 1.05, W * 0.18, cream, W * 0.32, H * 0.525 + 0.3, -D * 0.28, g); hip(W * 0.24, W * 0.24, H * 0.25, terracotta, W * 0.32, H * 1.05 + 0.3, -D * 0.28, g);
      for (let k = 0; k < 4; k++) { const ax = -W * 0.27 + k * W * 0.18; box(0.35, H * 0.34, 0.35, white, ax, H * 0.17 + 0.3, D * 0.1 + 0.2, g); }
      box(W * 0.66, 0.3, 1.2, white, 0, H * 0.34 + 0.3, D * 0.1 + 0.2, g);
      box(W * 0.62, H * 0.3, 0.12, glass, 0, H * 0.18 + 0.3, D * 0.1 - 0.2, g);
    } else if (style === 'ridge') { // Modern cantilevered slabs, full glass, an infinity edge over the slope
      box(W * 0.8, H * 0.36, D * 0.48, white, 0, H * 0.18 + 0.3, -D * 0.12, g); box(W * 0.82, H * 0.3, 0.12, glass, 0, H * 0.18 + 0.3, D * 0.12, g);
      box(W * 0.66, H * 0.32, D * 0.5, white, W * 0.14, H * 0.36 + 0.3 + H * 0.16, -D * 0.02, g); box(W * 0.66, H * 0.26, 0.12, glass, W * 0.14, H * 0.52 + 0.3, D * 0.23, g);
      box(W * 0.9, 0.22, D * 0.62, slate, W * 0.05, H * 0.68 + 0.4, -D * 0.02, g); box(W * 0.5, 0.22, D * 0.45, slate, -W * 0.1, H * 0.36 + 0.4, -D * 0.1, g);
      box(W * 0.1, H * 0.72, W * 0.1, stone, -W * 0.38, H * 0.36 + 0.3, -D * 0.3, g);
      box(W * 0.95, 0.24, 0.3, glass, 0, 0.5, D / 2 + 2.2, g); // glass balustrade
    } else { // Crown Villa: a palace with a columned portico, wings and a gold dome
      box(W * 0.56, H * 0.6, D * 0.5, white, 0, H * 0.3 + 0.3, -D * 0.12, g);
      for (const sx of [-1, 1]) { box(W * 0.24, H * 0.42, D * 0.42, white, sx * W * 0.38, H * 0.21 + 0.3, -D * 0.08, g); box(W * 0.26, 0.3, D * 0.44, gold, sx * W * 0.38, H * 0.42 + 0.45, -D * 0.08, g); }
      for (let k = 0; k < 6; k++) cyl(0.32, 0.36, H * 0.5, white, -W * 0.22 + k * W * 0.088, H * 0.25 + 0.3, D * 0.17, g, 12);
      box(W * 0.54, 0.5, 1.6, white, 0, H * 0.5 + 0.55, D * 0.17, g); hip(W * 0.54, 1.8, 1.4, white, 0, H * 0.5 + 0.8, D * 0.17, g);
      const dome = new THREE.Mesh(geo(new THREE.SphereGeometry(W * 0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), gold); dome.position.set(0, H * 0.6 + 0.3, -D * 0.12); dome.castShadow = true; g.add(dome);
      cyl(0.08, 0.08, 3, gold, 0, H * 0.6 + 0.3 + W * 0.17 + 1.4, -D * 0.12, g, 6);
      box(W * 0.5, H * 0.3, 0.12, glass, 0, H * 0.3, -D * 0.12 + D * 0.25 + 0.05, g);
    }
    // Ownership marker: a gold gem floating over the roof when the deed is yours.
    const gem = new THREE.Mesh(geo(new THREE.OctahedronGeometry(0.9, 0)), gold); gem.position.set(0, H + 4.5, 0); gem.visible = false; g.add(gem); ownedMarks.set(l.id, gem);
    pickable(g, l.id);
    const s = label(l.label, `For sale · 🪙 ${fmtShort(l.price)}`, '#f2d48a', l.x, p.y + H + 7, l.z, 0.95); s.userData.spot = l.id; pickables.push(s); estateLabels.set(l.id, s);
  });
  anims.push((t) => { for (const m of ownedMarks.values()) if (m.visible) { m.rotation.y = t * 1.4; m.position.y += Math.sin(t * 2) * 0.004; } });

  // ---- Island Dock: boardwalk deck on the beach, a long jetty on piles, the harbour hut, and the megayacht alongside.
  { const g = new THREE.Group(); g.position.set(ISLAND_DOCK.x, 0, ISLAND_DOCK.z); scene.add(g);
    box(ISLAND_DOCK.w, 0.4, ISLAND_DOCK.d, wood, 0, 0.6, 0, g);
    const J = 34; box(4, 0.35, J, wood, 0, 0.6, ISLAND_DOCK.d / 2 + J / 2, g); box(16, 0.35, 4, wood, 0, 0.6, ISLAND_DOCK.d / 2 + J, g);
    for (let z = ISLAND_DOCK.d / 2 + 2; z <= ISLAND_DOCK.d / 2 + J; z += 4) for (const x of [-1.8, 1.8]) cyl(0.18, 0.18, 3, darkWood, x, -0.6, z, g, 6);
    for (let z = ISLAND_DOCK.d / 2 + 4; z <= ISLAND_DOCK.d / 2 + J; z += 8) { cyl(0.08, 0.08, 2.6, slate, 2.1, 2, z, g, 6); const b = new THREE.Mesh(geo(new THREE.SphereGeometry(0.28, 8, 6)), bulb); b.position.set(2.1, 3.4, z); g.add(b); }
    box(4.5, 3, 3.5, white, -4, 2.3, -0.5, g); hip(5.5, 4.5, 1.6, thatch, -4, 3.8, -0.5, g); box(2.2, 1.4, 0.1, glass, -4, 2.5, 1.3, g);
    pickable(g, ISLAND_DOCK.id);
    const mega = FLEET_BY_ID.get('megayacht');
    if (mega) { const y = buildBoat(mega); const bb = new THREE.Box3().setFromObject(y); const sz = bb.getSize(new THREE.Vector3()); const long = Math.max(sz.x, sz.z) || 1; y.scale.setScalar(26 / long); if (sz.x > sz.z) y.rotation.y = Math.PI / 2;
      y.position.set(ISLAND_DOCK.x + 10, 0.2, ISLAND_DOCK.z + ISLAND_DOCK.d / 2 + J * 0.55); scene.add(y); models.push(y); pickable(y, ISLAND_DOCK.id);
      anims.push((t) => { y.position.y = 0.2 + Math.sin(t * 0.9) * 0.15; y.rotation.z = Math.sin(t * 0.7) * 0.012; }); }
    label(`${ISLAND_DOCK.icon} ${ISLAND_DOCK.label}`, 'Sail or fly home (free)', '#7fd0ff', ISLAND_DOCK.x, 9, ISLAND_DOCK.z + 4, 0.9).userData.spot = ISLAND_DOCK.id;
  }
  // Jet pad beside the dock road (jet owners land here).
  { const jx = 18, jz = 12, jy = islandHeight(jx, jz); const pad = new THREE.Mesh(geo(new THREE.CylinderGeometry(8, 8.4, 0.3, 40)), slate); pad.position.set(jx, jy + 0.1, jz); pad.receiveShadow = true; scene.add(pad);
    const ring = new THREE.Mesh(geo(new THREE.RingGeometry(6.6, 7.1, 40)), mat({ color: 0xf6c445, emissive: 0x5a4010 })); ring.rotation.x = -Math.PI / 2; ring.position.set(jx, jy + 0.27, jz); scene.add(ring);
    const jet = FLEET_BY_ID.get('g700'); if (jet) { const j = buildJet(jet); const bb = new THREE.Box3().setFromObject(j); const sz = bb.getSize(new THREE.Vector3()); j.scale.setScalar(11 / (Math.max(sz.x, sz.z) || 1)); j.rotation.y = -0.6; j.position.set(jx, jy + 0.3 - bb.min.y * (11 / (Math.max(sz.x, sz.z) || 1)), jz); scene.add(j); models.push(j); pickable(j, ISLAND_DOCK.id); }
  }

  // ---- Pearl Lagoon pier: a fishing jetty out over the turquoise lagoon, bait shack, lanterns, an atoll reef arc.
  { const dx = ISLAND_LAGOON.x - CX, dz = ISLAND_LAGOON.z - CZ, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L; const yaw = Math.atan2(ux, uz);
    const g = new THREE.Group(); g.position.set(CX + ux * (ISLAND_BEACH_R - 4), 0, CZ + uz * (ISLAND_BEACH_R - 4)); g.rotation.y = yaw; scene.add(g);
    const PL = ISLAND_LAGOON.d + 4; box(3, 0.3, PL, wood, 0, 0.7, PL / 2, g); box(7, 0.3, 5, wood, 0, 0.7, PL + 2, g);
    for (let z = 2; z <= PL + 3; z += 3) for (const x of [-1.4, 1.4]) cyl(0.16, 0.16, 3, darkWood, x, -0.6, z, g, 6);
    for (const x of [-3, 3]) { cyl(0.06, 0.06, 2.4, darkWood, x, 1.9, PL + 4, g, 5); const lamp = new THREE.Mesh(geo(new THREE.SphereGeometry(0.32, 8, 6)), flame); lamp.position.set(x, 3.2, PL + 4); g.add(lamp); }
    box(1, 0.6, 1, wood, -1.6, 1.15, PL + 1.2, g); box(1, 0.6, 1, wood, 1.6, 1.15, PL + 1.2, g);
    for (const x of [-1.6, 1.6]) { const rod = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.03, 0.05, 4.2, 5)), slate); rod.position.set(x, 2.6, PL + 3.4); rod.rotation.x = 0.8; g.add(rod); }
    box(3.4, 2.4, 3, cream, -3.2, 1.6, 0.5, g); hip(4.4, 4, 1.4, thatch, -3.2, 2.8, 0.5, g);
    pickable(g, ISLAND_LAGOON.id);
    const reefN = 30; const reef = new THREE.InstancedMesh(geo(new THREE.DodecahedronGeometry(1, 0)), mat({ roughness: 1, flatShading: true }), reefN); const cc = new THREE.Color(); const rc = [0xc98a7a, 0xd8b8a0, 0xb8a882, 0x9a7a9a, 0xc8a860];
    for (let k = 0; k < reefN; k++) { const a = yaw - 1.2 + (k / reefN) * 2.4 + (r() - 0.5) * 0.05; const rr = 15 + r() * 2; const x = LAGOON_C.x + Math.sin(a) * rr, z = LAGOON_C.y + Math.cos(a) * rr; const s = 0.5 + r() * 1.1;
      d.position.set(x, -1.1 + r() * 0.2, z); d.rotation.set(r(), r(), r()); d.scale.set(s, s * 0.5, s); d.updateMatrix(); reef.setMatrixAt(k, d.matrix); reef.setColorAt(k, cc.setHex(rc[k % rc.length]!)); }
    scene.add(reef);
    // pearl glints in the lagoon
    const glN = 14; const glints = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.18, 6, 5)), mat({ color: 0xffffff, emissive: 0xfff0e0, emissiveIntensity: 3 }), glN);
    for (let k = 0; k < glN; k++) { const a = r() * Math.PI * 2, rr = r() * 9; d.position.set(LAGOON_C.x + Math.cos(a) * rr, 0.12, LAGOON_C.y + Math.sin(a) * rr); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix(); glints.setMatrixAt(k, d.matrix); }
    scene.add(glints); anims.push((t) => { glints.visible = Math.sin(t * 1.7) > -0.6; });
    label(`${ISLAND_LAGOON.icon} ${ISLAND_LAGOON.label}`, 'Island-only fishing', '#5af0d8', ISLAND_LAGOON.x, 8, ISLAND_LAGOON.z, 0.9).userData.spot = ISLAND_LAGOON.id;
  }

  // ---- Sunset Lounge: a thatched beach bar on a raised deck with stools, string lights, loungers and umbrellas.
  { const dx = ISLAND_LOUNGE.x - CX, dz = ISLAND_LOUNGE.z - CZ; const yaw = Math.atan2(dx, dz);
    const g = new THREE.Group(); g.position.set(ISLAND_LOUNGE.x, islandHeight(ISLAND_LOUNGE.x, ISLAND_LOUNGE.z), ISLAND_LOUNGE.z); g.rotation.y = yaw; scene.add(g);
    const W = ISLAND_LOUNGE.w, D = ISLAND_LOUNGE.d;
    box(W, 0.4, D, wood, 0, 0.8, 0, g); for (const x of [-W / 2 + 0.4, W / 2 - 0.4]) for (const z of [-D / 2 + 0.4, D / 2 - 0.4]) { cyl(0.2, 0.2, 1, darkWood, x, 0.3, z, g, 6); cyl(0.14, 0.14, 3.4, darkWood, x, 2.7, z, g, 6); }
    hip(W + 2.4, D + 2.4, 2.6, thatch, 0, 4.3, 0, g);
    box(W * 0.6, 1.1, 1, darkWood, 0, 1.55, -D * 0.15, g); box(W * 0.62, 0.12, 1.2, gold, 0, 2.15, -D * 0.15, g);
    for (let k = 0; k < 5; k++) { const sx = -W * 0.24 + k * W * 0.12; cyl(0.3, 0.3, 0.1, mat({ color: towelCols[k % 4]! }), sx, 1.85, -D * 0.15 + 1.1, g, 10); cyl(0.05, 0.05, 0.9, slate, sx, 1.4, -D * 0.15 + 1.1, g, 5); }
    for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 6)), mat({ color: [0x3a9a5a, 0xd8a040, 0x8a3a6a][k % 3]!, emissive: 0x221100 })); b.position.set(-W * 0.25 + k * W * 0.1, 2.5, -D * 0.15 - 0.2); g.add(b); }
    const lightsN = 18; const lights = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.14, 6, 5)), bulb, lightsN);
    for (let k = 0; k < lightsN; k++) { const t = k / (lightsN - 1); d.position.set(-W / 2 + t * W, 3.9 - Math.sin(t * Math.PI) * 0.5, D / 2 + 0.9); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix(); lights.setMatrixAt(k, d.matrix); }
    g.add(lights);
    for (let k = 0; k < 4; k++) { const ux = -W * 0.45 + k * W * 0.3, uz = D / 2 + 4.5; const um = new THREE.Mesh(geo(new THREE.ConeGeometry(1.7, 0.7, 10)), mat({ color: towelCols[k % 4]! })); um.position.set(ux, 2.4, uz); um.castShadow = true; g.add(um); cyl(0.05, 0.05, 2.3, white, ux, 1.1, uz, g, 5);
      for (const s of [-0.7, 0.7]) box(0.8, 0.25, 2, white, ux + s, 0.25, uz + 1.2, g); }
    for (const x of [-W / 2 - 1.2, W / 2 + 1.2]) { cyl(0.08, 0.1, 2.4, darkWood, x, 1.2, D / 2 + 1.5, g, 5); const f = new THREE.Mesh(geo(new THREE.ConeGeometry(0.24, 0.7, 6)), flame); f.position.set(x, 2.7, D / 2 + 1.5); g.add(f); }
    pickable(g, ISLAND_LOUNGE.id);
    label(`${ISLAND_LOUNGE.icon} ${ISLAND_LOUNGE.label}`, 'Daily estate retreat', '#ffb070', ISLAND_LOUNGE.x, 10, ISLAND_LOUNGE.z, 0.9).userData.spot = ISLAND_LOUNGE.id;
  }

  // Place names (not clickable).
  for (const p of ISLAND_PLACES) { if (p.id === 'lagoon') continue; label(p.label, undefined, '#e8f6e8', p.x, islandHeight(p.x, p.z) + 6, p.z, 0.7); }

  // Seabirds circling over the island.
  { const birdM = mat({ color: 0xffffff, side: THREE.DoubleSide }); const birds: THREE.Group[] = [];
    for (let k = 0; k < 7; k++) { const b = new THREE.Group(); for (const s of [-1, 1]) { const w = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.4, 0.4)), birdM); w.position.x = s * 0.7; w.userData.s = s; b.add(w); } b.userData.r = 30 + r() * 40; b.userData.a = r() * 6.28; b.userData.y = 22 + r() * 14; b.userData.v = 0.08 + r() * 0.08; scene.add(b); birds.push(b); }
    anims.push((t) => { for (const b of birds) { const a = (b.userData.a as number) + t * (b.userData.v as number); b.position.set(CX + Math.cos(a) * (b.userData.r as number), (b.userData.y as number) + Math.sin(t * 0.7 + a) * 1.5, CZ + Math.sin(a) * (b.userData.r as number)); b.rotation.y = -a; for (const w of b.children) w.rotation.z = Math.sin(t * 6 + a) * 0.5 * (w.userData.s as number); } }); }

  // ---- Interaction (same rules as the city and resort: drag pans, click picks).
  const ray = new THREE.Raycaster(); ray.layers.enable(LABEL_LAYER); const ndc = new THREE.Vector2();
  const pick = (cx: number, cy: number) => { const rc = canvas.getBoundingClientRect(); ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, camera); const o = ray.intersectObjects(pickables, false)[0]?.object; return (o?.userData.spot ?? '') as string; };
  let down: { x: number; y: number; drag?: boolean } | null = null;
  const onMove = (e: PointerEvent) => { if (e.pointerType === 'touch') return; if (down && e.buttons) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down.drag = true; h.onHover('', 0, 0); } if (down.drag) return; } const id = pick(e.clientX, e.clientY); canvas.style.cursor = id ? 'pointer' : 'grab'; h.onHover(id, e.clientX, e.clientY); };
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; h.onHover('', 0, 0); };
  const onUp = (e: PointerEvent) => { if (!down) return; const dragged = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || !!down.drag; down = null; if (dragged) return; const id = pick(e.clientX, e.clientY); if (id) { h.onHover('', 0, 0); h.onPick(id); } };
  const onLeave = () => h.onHover('', 0, 0);
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointerleave', onLeave);

  const resize = () => { const w = canvas.clientWidth || 1, hh = canvas.clientHeight || 1; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.fov = w < hh ? 62 : 40; camera.updateProjectionMatrix(); };
  let composer: EffectComposer | null = null;
  if (tier !== 'low') { composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.88)); composer.addPass(new OutputPass()); }
  const ro = new ResizeObserver(() => { resize(); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1); } }); ro.observe(canvas); resize();

  const clock = new THREE.Clock(); let raf = 0; let running = true; let time = 0; const tmp = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!running) return; const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    waterMat.uniforms.uTime!.value = time; anims.forEach((f) => f(time, dt));
    controls.update(); clampPan();
    const portrait = (canvas.clientWidth || 1) < (canvas.clientHeight || 1);
    for (const s of signs) { const k = labelScale(camera.position.distanceTo(s.getWorldPosition(tmp)), portrait) * (s.userData.k as number); fitLabel(s, k); }
    renderScene(renderer, composer, scene, camera);
  };
  const vis = () => { running = !document.hidden; clock.getDelta(); }; document.addEventListener('visibilitychange', vis); frame();

  return {
    focusXZ(x, z) { const [cx, cz] = clampIslandTarget(x, z); const y = islandHeight(cx, cz); controls.target.set(cx, y, cz); camera.position.set(cx + 26, y + 34, cz + 48); },
    view(x, z, dx = 0, dy = 50, dz = 80) { controls.target.set(x, islandHeight(x, z), z); camera.position.set(x + dx, dy, z + dz); controls.update(); },
    reset() { camera.position.copy(home); controls.target.copy(homeT); },
    setOwners(owners, me) {
      for (const l of ISLAND_LOTS) { const o = owners.get(l.id); const mine = !!o && !!me && o.toLowerCase() === me.toLowerCase(); const s = estateLabels.get(l.id);
        if (s) relabel(s, l.label, o ? (mine ? 'Yours' : `Owned by ${o}`) : `For sale · 🪙 ${fmtShort(l.price)}`, mine ? '#8bdf87' : '#f2d48a');
        const m = ownedMarks.get(l.id); if (m) m.visible = mine; }
    },
    setRunning(v) { running = v; clock.getDelta(); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave);
      controls.dispose(); models.forEach(disposeTree); for (const s of signs) (s.userData.tex as THREE.Texture | undefined)?.dispose(); disposables.forEach((x) => x.dispose()); composer?.dispose(); renderer.dispose(); scene.clear(); },
  };
}
