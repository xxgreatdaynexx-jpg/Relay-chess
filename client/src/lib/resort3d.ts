// Chud Resort 3D map: a golden-hour beachfront town. Ocean, sand, palms, boardwalk, hotels, condos, villas, pool,
// marina with superyachts, an airfield, the Paradise Plantation and the Coral Grotto. Same camera/pan rules as the city.
import * as THREE from 'three';
import { asLabel, cityLabel, dimColor, drawLabel, fitLabel, LABEL_LAYER, labelMaterial, renderScene } from './labelSprite';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { detectWorldTier, labelScale, TIER_PIXEL_RATIO } from './worldTier';
import { RESORT_SPOTS, resortLots, resortPlots, resortPlotId, rfTileXZ, RF_TILE, clampResortTarget, SHORE_Z, BOARDWALK_Z, RESORT_X0, RESORT_X1, RESORT_Z0, overlapsResortRoad, resortAabbHit } from '../../../shared/resort';
import { cropById } from '../../../shared/farm';
import { buildBoat, disposeTree } from './fleetModels';
import { BOATS } from '../../../shared/fleet';

type Handlers = { onHover: (id: string | null, x: number, y: number) => void; onPick: (id: string) => void; onProperty?: (id: string) => void };
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function signTexture(text: string, color: string, sub?: string) { return cityLabel(text, color, sub, labelRenderer); } // same look as Chud City
let labelRenderer: THREE.WebGLRenderer | null = null;
function facadeTexture(seed: number, balconies: boolean) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d')!; const r = rng(seed);
  g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 10) { for (let x = 4; x < 60; x += 10) { const lit = r() > 0.55; g.fillStyle = lit ? '#ffd79a' : '#5f8fa8'; g.fillRect(x, y, 7, 6); } if (balconies) { g.fillStyle = '#c9b48a'; g.fillRect(0, y + 7, 64, 1.5); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export type Resort = ReturnType<typeof createResort>;
/** The resort never gets snow (tests). */
export const RESORT_SNOW = false;
export function createResort(canvas: HTMLCanvasElement, h: Handlers) {
  const tier = detectWorldTier(); const r = rng(20261101);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' }); labelRenderer = renderer;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIER_PIXEL_RATIO[tier])); canvas.dataset.tier = tier;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = tier !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); const disposables: Array<{ dispose(): void }> = [];
  const mat = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(p); disposables.push(m); return m; };
  const geo = <G extends THREE.BufferGeometry>(g: G) => { disposables.push(g); return g; };
  /** Bake every static mesh under root into one mesh per material (hundreds of lot/decor boxes -> a few draw calls; mobile). */
  const mergeStatic = (root: THREE.Object3D, into: THREE.Object3D = scene) => {
    root.updateMatrixWorld(true); into.updateMatrixWorld(true); const inv = into.matrixWorld.clone().invert(); const mm = new THREE.Matrix4(); const groups = new Map<string, { m: THREE.Material; cast: boolean; meshes: THREE.Mesh[] }>();
    root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.userData.lot || m.userData.spot || Array.isArray(m.material) || !m.material.visible) return;
      const k = `${m.material.uuid}|${m.castShadow}`; let e = groups.get(k); if (!e) groups.set(k, (e = { m: m.material, cast: m.castShadow, meshes: [] })); e.meshes.push(m); });
    for (const e of groups.values()) {
      if (e.meshes.length < 2) continue;
      const gs = e.meshes.map((m) => { const g = (m.geometry.index ? m.geometry : m.geometry).clone(); for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') g.deleteAttribute(a); g.applyMatrix4(mm.multiplyMatrices(inv, m.matrixWorld)); return g; });
      const merged = gs.every((g) => !!g.index) ? mergeGeometries(gs, false) : null; gs.forEach((g) => g.dispose()); if (!merged) continue;
      disposables.push(merged); const mesh = new THREE.Mesh(merged, e.m); mesh.castShadow = e.cast; mesh.receiveShadow = true; if (into === scene) mesh.matrixAutoUpdate = false; into.add(mesh);
      e.meshes.forEach((m) => m.removeFromParent());
    }
  };

  // Sunset sky dome: deep indigo overhead through magenta and coral to a glowing gold horizon, with a sun disc and halo.
  // Output is linear and goes through the renderer's tone mapping + sRGB conversion like every other material.
  const skyM = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {},
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vp; void main(){ float y = vp.y;
      vec3 gold = vec3(1.2,0.5,0.15); vec3 coral = vec3(1.0,0.28,0.2); vec3 mag = vec3(0.55,0.14,0.38); vec3 indigo = vec3(0.12,0.08,0.32);
      vec3 c = mix(gold, coral, smoothstep(0.0,0.06,y)); c = mix(c, mag, smoothstep(0.06,0.22,y)); c = mix(c, indigo, smoothstep(0.22,0.7,y));
      vec3 sd = normalize(vec3(0.25,0.06,-1.0)); /* sun sets behind the town */ float s = clamp(dot(vp, sd), 1e-4, 1.0); /* pow(0, n) is undefined in GLSL: black sky on some GPUs */
      c += vec3(1.0,0.75,0.4)*pow(s,900.0)*6.0 + vec3(1.0,0.45,0.15)*pow(s,24.0)*0.35 + vec3(0.9,0.3,0.2)*pow(s,4.0)*0.08;
      if (y < 0.0) c = gold*0.9; gl_FragColor = vec4(c,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
  disposables.push(skyM); const sky = new THREE.Mesh(geo(new THREE.SphereGeometry(800, 32, 16)), skyM); sky.frustumCulled = false; scene.add(sky); // follows the camera so the wider map never sees its edge
  scene.fog = new THREE.Fog(0xd8743e, 420, 1100); // warm haze, far enough that the town keeps its colour
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1700);
  const home = new THREE.Vector3(-40, 72, 240); const homeT = new THREE.Vector3(0, 10, -30); camera.position.copy(home); // low golden-hour angle so the sunset sky shows above the town
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(homeT); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 30; controls.maxDistance = 480; controls.maxPolarAngle = 1.36; controls.minPolarAngle = 0.35;
  controls.enablePan = true; controls.screenSpacePanning = false; controls.panSpeed = 1.1; controls.autoRotate = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const clampPan = () => { const t = controls.target; const [x, z] = clampResortTarget(t.x, t.z); if (x !== t.x || z !== t.z) { camera.position.x += x - t.x; camera.position.z += z - t.z; t.x = x; t.z = z; } };

  scene.add(new THREE.HemisphereLight(0xffc49a, 0x3a4a5a, 0.9));
  const sun = new THREE.DirectionalLight(0xff9a50, 3.2); sun.position.set(-40, 60, 160); sun.castShadow = renderer.shadowMap.enabled;
  Object.assign(sun.shadow.camera, { left: -215, right: 215, top: 150, bottom: -150, near: 10, far: 450 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; scene.add(sun, sun.target);
  // The map is 800 wide: the shadow box (430 x 300) follows the view instead of stretching over the whole island (sharper on every tier).
  const SUN_OFF = new THREE.Vector3(-40, 60, 160); const followSun = (x: number, z: number) => { const sx = Math.round(x / 16) * 16, sz = Math.round(z / 16) * 16; sun.position.set(sx + SUN_OFF.x, SUN_OFF.y, sz + SUN_OFF.z); sun.target.position.set(sx, 0, sz); };
  followSun(0, -30);

  // Ground: lush land, sand, ocean.
  const land = new THREE.Mesh(geo(new THREE.PlaneGeometry(RESORT_X1 - RESORT_X0 + 120, SHORE_Z - RESORT_Z0 + 80)), mat({ color: 0x6f9a4a, roughness: 1 }));
  land.rotation.x = -Math.PI / 2; land.position.set(0, -0.02, (RESORT_Z0 - 80 + SHORE_Z) / 2); land.receiveShadow = true; scene.add(land);
  const sand = new THREE.Mesh(geo(new THREE.PlaneGeometry(RESORT_X1 - RESORT_X0 + 120, SHORE_Z - BOARDWALK_Z + 6)), mat({ color: 0xf2dcac, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.01, (BOARDWALK_Z + SHORE_Z + 6) / 2); sand.receiveShadow = true; scene.add(sand);
  // Ocean: turquoise shallows to deep sapphire, wave normals, sun specular + sunset sky reflection (fresnel), shoreline foam.
  const SUN_DIR = new THREE.Vector3(0, 0.12, 1).normalize();
  const waterMat = new THREE.ShaderMaterial({ transparent: true, fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSun: { value: SUN_DIR } }]),
    vertexShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_vertex>
      float h(vec2 p){ return sin(p.x*0.08+uTime*1.2)*0.25 + sin(p.y*0.13-uTime*0.9)*0.2 + sin((p.x+p.y)*0.21+uTime*1.7)*0.08; }
      void main(){ vUv = uv; vec3 p = position; p.z += h(p.xy);
        float e = 0.5; float dx = h(p.xy+vec2(e,0.0)) - h(p.xy-vec2(e,0.0)); float dy = h(p.xy+vec2(0.0,e)) - h(p.xy-vec2(0.0,e));
        vN = normalize((modelMatrix*vec4(-dx/(2.0*e), -dy/(2.0*e), 1.0, 0.0)).xyz);
        vec4 wp = modelMatrix*vec4(p,1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_fragment>
      void main(){ float d = vUv.y; // 1.0 at the shoreline
        vec3 shallow = vec3(0.02,0.42,0.42); vec3 mid = vec3(0.01,0.16,0.26); vec3 deep = vec3(0.005,0.05,0.13);
        vec3 c = mix(mid, shallow, smoothstep(0.90,0.99,d)); c = mix(deep, c, smoothstep(0.55,0.90,d));
        vec3 n = normalize(vN + vec3(sin(vW.x*1.7+uTime*2.1), 0.0, cos(vW.z*1.9-uTime*1.6))*0.06);
        vec3 v = normalize(cameraPosition - vW); float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        c = mix(c, vec3(0.9,0.38,0.2), fr*0.55); // sunset sky reflected at grazing angles
        vec3 hv = normalize(uSun + v); float sp = pow(max(dot(n, hv), 0.0), 220.0); float glint = pow(max(dot(n, hv), 0.0), 40.0);
        c += vec3(1.0,0.72,0.4)*(sp*3.0 + glint*0.25);
        float edge = d + sin(vUv.x*90.0 + uTime*1.3)*0.004 + sin(vUv.x*37.0 - uTime*0.8)*0.003;
        float foam = smoothstep(0.988,0.997,edge) + smoothstep(0.97,0.975,edge)*(1.0-smoothstep(0.975,0.98,edge))*0.5*(0.5+0.5*sin(uTime*1.5));
        c = mix(c, vec3(0.95,0.93,0.88), clamp(foam,0.0,1.0)*0.9);
        gl_FragColor = vec4(c, 0.97);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }` });
  disposables.push(waterMat);
  const water = new THREE.Mesh(geo(new THREE.PlaneGeometry(2600, 700, 200, 70)), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(0, -0.15, SHORE_Z + 350); scene.add(water);

  // Boardwalk + promenade to the casino.
  const wood = mat({ color: 0xa8784a, roughness: 0.8 });
  const bw = new THREE.Mesh(geo(new THREE.BoxGeometry(RESORT_X1 - RESORT_X0 - 20, 0.3, 4)), wood); bw.position.set(0, 0.15, BOARDWALK_Z); bw.receiveShadow = true; scene.add(bw);
  const stone = mat({ color: 0xeadfca, roughness: 0.9 });
  const prom = new THREE.Mesh(geo(new THREE.BoxGeometry(10, 0.2, 30)), stone); prom.position.set(0, 0.1, 4); prom.receiveShadow = true; scene.add(prom);
  const road = new THREE.Mesh(geo(new THREE.BoxGeometry(RESORT_X1 - RESORT_X0 - 20, 0.12, 5)), mat({ color: 0x8a8070, roughness: 1 })); road.position.set(0, 0.06, -32); scene.add(road);
  // Lamp posts with warm globes along the boardwalk.
  const glowMat = mat({ color: 0xffe2a8, emissive: 0xffb050, emissiveIntensity: 4 });
  const lampN = 48; const posts = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.12, 0.15, 4, 6)), mat({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4 }), lampN);
  const globes = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.4, 10, 8)), glowMat, lampN); const d = new THREE.Object3D();
  for (let i = 0; i < lampN; i++) { const x = RESORT_X0 + 20 + i * ((RESORT_X1 - RESORT_X0 - 40) / (lampN - 1)); d.position.set(x, 2, BOARDWALK_Z - 2.4); d.scale.set(1, 1, 1); d.updateMatrix(); posts.setMatrixAt(i, d.matrix); d.position.y = 4.2; d.updateMatrix(); globes.setMatrixAt(i, d.matrix); }
  scene.add(posts, globes);

  // Palms (instanced, curved trunks + fronds).
  const palmSpots: [number, number][] = [];
  const lotBoxes = [...resortLots().map((l) => (l.type === 'overwater' ? { ...l, z: l.z - 6, d: l.d + 14 } : l)), ...resortPlots(), ...RESORT_SPOTS.map((p) => (['r-beachclub', 'r-helipad', 'r-harbour', 'r-cove-pier'].includes(p.id) ? { ...p, w: p.w + 4, d: p.d + 4 } : p)),
    { x: -303, z: -108, w: 32, d: 66 }, { x: 305, z: -95, w: 19, d: 27 }]; // + Sunset Links and the tennis club
  const onLot = (x: number, z: number, pad = 1) => lotBoxes.some((b) => resortAabbHit({ x, z, w: 1.2, d: 1.2 }, b, pad));
  const addPalm = (x: number, z: number) => { if (!overlapsResortRoad({ x, z, w: 1.2, d: 1.2 }, 0.8) && !onLot(x, z, 0.6)) palmSpots.push([x, z]); };
  for (let x = RESORT_X0 + 14; x < RESORT_X1 - 10; x += 7 + r() * 4) { addPalm(x, BOARDWALK_Z + 3 + r() * 1.5); if (r() > 0.45) addPalm(x + 2, SHORE_Z - 3 - r() * 3); }
  for (let z = -20; z <= 12; z += 6) { addPalm(-7, z); addPalm(7, z); }
  for (let i = 0; i < 40; i++) addPalm(RESORT_X0 + 10 + r() * (RESORT_X1 - RESORT_X0 - 20), -62 - r() * 30);
  // Grand expansion palm groves (own seed so the original town keeps its look): hills, district avenues and promenades.
  const r2 = rng(20261122); const tierN = tier === 'low' ? 0.6 : 1;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 110 * tierN; i++) addPalm(sx * (210 + r2() * 182), -70 - r2() * 72);
    for (let i = 0; i < 40 * tierN; i++) addPalm(sx * (210 + r2() * 182), -22 + r2() * 16);
    for (let z = -58; z <= 14; z += 12) { addPalm(sx * 306.5, z); addPalm(sx * 317.5, z + 6); }
  }
  const SEG = 5; const trunk = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.28, 0.36, 1.6, 7)), mat({ color: 0x8a6a48, roughness: 1 }), palmSpots.length * SEG);
  const FR = 7; const frond = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(0.7, 4.6, 4, 1)), mat({ color: 0x2f8a3a, roughness: 0.8, flatShading: true }), palmSpots.length * FR);
  trunk.castShadow = frond.castShadow = true;
  palmSpots.forEach(([x, z], p) => {
    const lean = (r() - 0.5) * 0.5, dir = r() * Math.PI * 2, hgt = 0.8 + r() * 0.5; let px = x, py = 0, pz = z;
    for (let s = 0; s < SEG; s++) { const a = lean * (s / SEG) * 2; d.position.set(px, py + 0.8 * hgt, pz); d.rotation.set(Math.cos(dir) * a, 0, Math.sin(dir) * a); d.scale.set(1 - s * 0.08, hgt, 1 - s * 0.08); d.updateMatrix(); trunk.setMatrixAt(p * SEG + s, d.matrix);
      px += Math.sin(dir) * a * -1.6 * hgt * 0.5; pz += Math.cos(dir) * a * 1.6 * hgt * 0.5; py += 1.6 * hgt; }
    for (let f = 0; f < FR; f++) { const yaw = (f / FR) * Math.PI * 2 + r() * 0.3; d.position.set(px + Math.cos(yaw) * 1.7, py + 0.2, pz + Math.sin(yaw) * 1.7); d.rotation.set(0, -yaw, 0); d.rotateZ(-Math.PI / 2 - 0.35); d.scale.set(1, 1, 0.25); d.updateMatrix(); frond.setMatrixAt(p * FR + f, d.matrix); }
  });
  scene.add(trunk, frond);

  // Beach umbrellas + loungers.
  const umbN = 86; const umb = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(1.6, 0.7, 10)), mat({ color: 0xffffff, roughness: 0.7 }), umbN);
  const pole = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5)), mat({ color: 0xeeeeee }), umbN);
  const lounger = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.8, 0.25, 2)), mat({ color: 0xffffff, roughness: 0.6 }), umbN * 2);
  const umbCols = [0xf26b5b, 0x2fb5b0, 0xf6c445, 0xffffff]; const cc = new THREE.Color();
  for (let i = 0; i < umbN; i++) { const x = RESORT_X0 + 20 + i * 8.6 + r() * 2, z = SHORE_Z - 1.5 - r() * 2.5; if (Math.abs(x) < 6 || (x > 76 && x < 110) || (x > 302 && x < 342) || Math.abs(x + 300) < 7 || Math.abs(x + 356) < 5 || x > RESORT_X1 - 16) { d.scale.set(0, 0, 0); } else d.scale.set(1, 1, 1);
    d.position.set(x, 2.4, z); d.rotation.set(0, 0, 0); d.updateMatrix(); umb.setMatrixAt(i, d.matrix); umb.setColorAt(i, cc.setHex(umbCols[i % umbCols.length]!));
    d.position.y = 1.1; d.updateMatrix(); pole.setMatrixAt(i, d.matrix);
    for (const k of [0, 1]) { d.position.set(x - 0.7 + k * 1.4, 0.2, z - 1.4); d.updateMatrix(); lounger.setMatrixAt(i * 2 + k, d.matrix); } }
  scene.add(umb, pole, lounger);

  // Labels.
  const signs: THREE.Sprite[] = [];
  const label = (text: string, sub: string | undefined, color: string, x: number, y: number, z: number, k = 1) => {
    const tex = signTexture(text, color, sub); disposables.push(tex); const m = labelMaterial(tex, { fog: false }); disposables.push(m);
    const s = asLabel(new THREE.Sprite(m)); s.position.set(x, y, z); s.userData.k = k; fitLabel(s, 8 * k); scene.add(s); signs.push(s); return s;
  };

  const pickables: THREE.Object3D[] = []; const spotRoots = new Map<string, THREE.Object3D>();
  const white = mat({ color: 0xfaf6ee, roughness: 0.6 }); const gold = mat({ color: 0xd8b25a, metalness: 0.85, roughness: 0.3, emissive: 0x3a2808 });
  const glass = mat({ color: 0x8fd0e8, metalness: 0.6, roughness: 0.08, emissive: 0x1a3a48, emissiveIntensity: 0.5 });
  const pool = mat({ color: 0x46d3e6, roughness: 0.05, metalness: 0.2, emissive: 0x0a5a68, emissiveIntensity: 0.6 });
  const box = (w: number, hh: number, dd: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const o = new THREE.Mesh(geo(new THREE.BoxGeometry(w, hh, dd)), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };

  for (const s of RESORT_SPOTS) {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z); scene.add(g); spotRoots.set(s.id, g);
    const hit = box(s.w, s.h, s.d, new THREE.MeshBasicMaterial({ visible: false }), 0, s.h / 2, 0, g); hit.userData.spot = s.id; pickables.push(hit);
    if (s.id === 'r-casino') {
      box(30, 10, 18, white, 0, 5, 0, g); box(18, 6, 12, white, 0, 13, 0, g);
      const domeMat = mat({ color: 0xf0c868, metalness: 0.7, roughness: 0.25, emissive: 0xffa830, emissiveIntensity: 1.4 }); // lit gold dome, picked up by bloom
      const dome = new THREE.Mesh(geo(new THREE.SphereGeometry(6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)), domeMat); dome.position.set(0, 16, 0); dome.castShadow = true; g.add(dome);
      for (let i = -3; i <= 3; i++) { const c = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.5, 0.5, 9, 12)), white); c.position.set(i * 4, 4.5, 9.8); c.castShadow = true; g.add(c); }
      box(30, 0.8, 3, gold, 0, 9.4, 10, g); box(26, 7, 0.2, glass, 0, 4, 9.05, g);
      label('Palms Casino', 'Tiki · Yacht · Pearl', '#d8b25a', s.x, 26, s.z, 1.4);
    } else if (s.id === 'r-airstrip') {
      box(70, 0.15, 10, mat({ color: 0x3a3a3e, roughness: 1 }), 10, 0.08, 6, g); for (let i = 0; i < 9; i++) box(4, 0.17, 0.5, white, -22 + i * 8, 0.1, 6, g);
      box(16, 6, 8, white, -6, 3, -4, g); box(16, 2, 8.2, glass, -6, 5, -4, g);
      // No parked decorative plane: only planes players are actually using are drawn (live traffic, worldFreight.ts).
      label('✈ Airfield', 'Fly home to Chud Hub', '#5aa8e8', s.x, 14, s.z);
    } else if (s.id === 'r-mine') {
      const rock = mat({ color: 0x7a5a4a, roughness: 1, flatShading: true });
      const vol = new THREE.Mesh(geo(new THREE.ConeGeometry(18, 22, 9, 2)), rock); vol.position.set(0, 11, -4); vol.castShadow = true; g.add(vol);
      const mouth = new THREE.Mesh(geo(new THREE.CircleGeometry(3.4, 20, 0, Math.PI)), mat({ color: 0x0a2a38, emissive: 0x2ad0d0, emissiveIntensity: 1.2 })); mouth.position.set(0, 0.1, 8.6); g.add(mouth);
      for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(geo(new THREE.ConeGeometry(0.5 + r() * 0.5, 2 + r() * 2, 6)), mat({ color: [0xff7a6a, 0xff9ac0, 0x48e0d0][i % 3]!, emissive: [0x5a1a10, 0x5a1a3a, 0x0a4a48][i % 3]!, roughness: 0.6 })); c.position.set(-6 + i * 1.5, 1, 9 + r() * 2); g.add(c); }
      label('🐚 Coral Grotto', 'Resort mine', '#ff8a7a', s.x, 26, s.z);
    } else if (s.id === 'r-farm') {
      box(8, 5, 6, mat({ color: 0xf6efe2 }), 0, 2.5, 0, g); const roof = new THREE.Mesh(geo(new THREE.ConeGeometry(6, 3, 4)), mat({ color: 0x3f8a6a })); roof.rotation.y = Math.PI / 4; roof.position.set(0, 6.5, 0); g.add(roof);
      label('🥥 Plantation', 'Tropical crops', '#3fa86a', s.x, 12, s.z);
    } else if (s.id === 'r-pier' || s.id === 'r-cove-pier') { // Reef Pier (pt1304u): a plank walkway out over the reef, a tiki shack and rod holders, lanterns at the end
      box(4, 0.4, 26, wood, 0, 0.5, 0, g); for (let z = -12; z <= 12; z += 4) for (const x of [-1.8, 1.8]) box(0.35, 2.2, 0.35, wood, x, -0.3, z, g);
      for (let z = -11; z <= 12; z += 1.5) box(4.1, 0.05, 0.12, mat({ color: 0x6a4a2a }), 0, 0.72, z, g);
      box(7, 0.4, 5, wood, 0, 0.5, 11.5, g); for (const x of [-3.3, 3.3]) box(0.15, 1, 5, wood, x, 1.2, 11.5, g);
      const thatch = mat({ color: 0xc8a050, roughness: 1 }); box(2.6, 2, 2.4, mat({ color: 0xf2e6cc }), 0, 1.7, -9, g); const hut = new THREE.Mesh(geo(new THREE.ConeGeometry(2.4, 1.6, 4)), thatch); hut.rotation.y = Math.PI / 4; hut.position.set(0, 3.5, -9); hut.castShadow = true; g.add(hut);
      for (const x of [-3, -1, 1, 3]) { const rod = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.03, 0.05, 3, 5)), mat({ color: 0x1d2633 })); rod.position.set(x, 1.9, 13.6); rod.rotation.x = 0.55; g.add(rod); }
      for (const x of [-3.3, 3.3]) { box(0.12, 2, 0.12, wood, x, 1.7, 13.8, g); const l = new THREE.Mesh(geo(new THREE.SphereGeometry(0.25, 10, 8)), mat({ color: 0xffb060, emissive: 0xff8a30, emissiveIntensity: 2 })); l.position.set(x, 2.8, 13.8); g.add(l); }
      if (s.id === 'r-pier') label('🎣 Reef Pier', 'Fish · sell to the fishmonger', '#3ad8c8', s.x, 9, s.z); else label('🐠 Coral Cove Pier', 'Reef fishing · fishmonger', '#3ad8c8', s.x, 9, s.z);
    } else if (s.id === 'r-marina' || s.id === 'r-harbour') {
      box(30, 0.5, 3, wood, 0, 0.3, -6, g); for (const x of [-10, 0, 10]) box(2, 0.5, 12, wood, x, 0.3, 1, g);
      // mu-visuals marina pass: timber piles, cleats, lamp posts with warm glow, life rings and a harbourmaster hut.
      const pileG = geo(new THREE.CylinderGeometry(0.22, 0.26, 2.6, 8)), pileM = mat({ color: 0x5a4632, roughness: 0.9 }), cleatG = geo(new THREE.BoxGeometry(0.5, 0.14, 0.16)), cleatM = mat({ color: 0xb8bcc4, metalness: 0.7, roughness: 0.3 });
      const pile = (x: number, z: number) => { const o = new THREE.Mesh(pileG, pileM); o.position.set(x, 0.4, z); g.add(o); };
      for (let x = -14; x <= 14; x += 4) { pile(x, -7.6); pile(x, -4.4); }
      for (const fx of [-10, 0, 10]) for (const z of [-2, 2, 6]) { pile(fx - 1.1, z); pile(fx + 1.1, z); for (const sx of [-0.8, 0.8]) { const c = new THREE.Mesh(cleatG, cleatM); c.position.set(fx + sx, 0.62, z - 1); c.rotation.y = Math.PI / 2; g.add(c); } }
      const postM = mat({ color: 0x2a2f36, metalness: 0.5, roughness: 0.4 }), lampM = mat({ color: 0xffe0a0, emissive: 0xffb050, emissiveIntensity: 2 }), postG = geo(new THREE.CylinderGeometry(0.07, 0.09, 2.8, 6)), lampG = geo(new THREE.SphereGeometry(0.22, 10, 8));
      for (const [x, z] of [[-14, -6], [-5, -6], [5, -6], [14, -6], [-10, 6.6], [0, 6.6], [10, 6.6]] as const) { const p = new THREE.Mesh(postG, postM); p.position.set(x, 1.95, z); g.add(p); const l = new THREE.Mesh(lampG, lampM); l.position.set(x, 3.4, z); g.add(l); }
      const ringG = geo(new THREE.TorusGeometry(0.38, 0.1, 6, 14)), ringM = mat({ color: 0xff5a2a, roughness: 0.6 });
      for (const x of [-12, 7]) { const r = new THREE.Mesh(ringG, ringM); r.position.set(x, 1.1, -7.45); g.add(r); }
      box(4, 2.4, 2.6, mat({ color: 0xf4efe4, roughness: 0.7 }), -17.5, 1.75, -6, g); box(4.6, 0.25, 3.2, mat({ color: 0x2f6f8f, roughness: 0.6 }), -17.5, 3.05, -6, g);
      box(2.6, 0.9, 0.06, mat({ color: 0x1a2a3a, metalness: 0.6, roughness: 0.1, emissive: 0x2a3a4a, emissiveIntensity: 0.4 }), -17.5, 2.1, -4.68, g);
      if (s.id === 'r-marina') label('🛥 Marina', 'Boats · yachts · deep sea', '#ffffff', s.x, 12, s.z);
      else { box(4, 0.5, 14, wood, 16, 0.3, 1, g); box(3, 0.6, 3, white, 16, 0.6, 9, g); label('⚓ Yacht Harbour', 'Superyacht berths · deep sea', '#9ad0ff', s.x, 12, s.z); }
    } else if (s.id === 'r-beachclub') { // Coral Cove Beach Club: deck, infinity pool, thatched bar, cabanas and a gold-trimmed lounge
      const deck = mat({ color: 0xd9c29a, roughness: 0.8 }); box(26, 0.4, 14, deck, 0, 0.2, 0, g);
      box(14, 5, 6, white, -4, 2.9, -3.5, g); box(14.4, 0.4, 6.4, gold, -4, 5.6, -3.5, g); box(13, 3.4, 0.15, glass, -4, 2.6, -0.4, g);
      const pw = box(12, 0.14, 5, pool, 3, 0.48, 3.6, g); pw.castShadow = false; box(12.4, 0.5, 0.3, stone, 3, 0.45, 6.2, g);
      const thatch = mat({ color: 0xc8a050, roughness: 1 }); box(4, 1.2, 3, wood, 9.5, 1, -3, g); const bar = new THREE.Mesh(geo(new THREE.ConeGeometry(3.6, 2, 6)), thatch); bar.position.set(9.5, 3.6, -3); bar.castShadow = true; g.add(bar);
      for (const x of [-10, -6.5]) { box(2.6, 0.2, 2.6, mat({ color: 0xffffff }), x, 2.6, 4, g); for (const dx of [-1.1, 1.1]) for (const dz of [-1.1, 1.1]) box(0.12, 2.4, 0.12, wood, x + dx, 1.4, 4 + dz, g); }
      label('🍹 Beach Club', 'Cabanas · slots · tables', '#ff9ac0', s.x, 12, s.z);
    } else if (s.id === 'r-helipad') { // Azure Point Helipad: raised pad, H marking, landing lights, a small terminal and a parked helicopter
      box(18, 1.2, 18, mat({ color: 0x5a5e66, roughness: 0.9 }), 0, 0.6, 0, g); const ring = new THREE.Mesh(geo(new THREE.RingGeometry(6, 6.6, 32)), mat({ color: 0xf2d060, emissive: 0x6a5010 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 1.22; g.add(ring);
      for (const [x, w, dd] of [[-2, 0.8, 6], [2, 0.8, 6], [0, 3.2, 0.8]] as const) box(w, 0.05, dd, white, x, 1.23, 0, g);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const l = new THREE.Mesh(geo(new THREE.SphereGeometry(0.22, 8, 6)), glowMat); l.position.set(Math.cos(a) * 8, 1.4, Math.sin(a) * 8); g.add(l); }
      const heli = new THREE.Group(); heli.position.set(3, 1.2, 2); heli.rotation.y = 0.6; g.add(heli); const body = mat({ color: 0x1a2a4a, metalness: 0.5, roughness: 0.35 });
      box(2.2, 1.6, 4, body, 0, 1.2, 0, heli); box(0.5, 0.5, 4, body, 0, 1.5, -3.6, heli); box(1.9, 0.9, 1.2, glass, 0, 1.4, 1.6, heli); box(0.1, 0.06, 9, mat({ color: 0x222222 }), 0, 2.15, 0, heli).rotation.y = 0.8; box(0.1, 0.06, 9, mat({ color: 0x222222 }), 0, 2.15, 0, heli).rotation.y = -0.8; box(0.15, 0.15, 3.2, mat({ color: 0x888888 }), -0.9, 0.2, 0, heli); box(0.15, 0.15, 3.2, mat({ color: 0x888888 }), 0.9, 0.2, 0, heli);
      label('🚁 Helipad', 'Fly home · jet hangar', '#d8b25a', s.x, 12, s.z);
    }
  }
  for (const g of spotRoots.values()) mergeStatic(g);
  label('🌺 Banyan Bay', 'Oceanfront estates · plantations', '#3fa86a', -170, 22, -40, 1.3);
  label('💎 Sapphire Heights', 'Clifftop mansions · skyrises', '#5aa8e8', 168, 30, -40, 1.3);
  label('🐠 Coral Cove', 'Beach villas · overwater bungalows · royal estates', '#ff9ac0', -300, 30, -40, 1.3);
  label('🌊 Azure Point', 'Grand hotels · yacht harbour · helipad', '#7ad0ff', 300, 30, -40, 1.3);
  // Superyachts bobbing at the marina.
  const yachts: THREE.Group[] = []; const boatModels: THREE.Group[] = [];
  // mu-visuals marina pass: the real fleet models (yacht, sportfisher, superyacht) instead of stacked boxes, bows to sea.
  for (const [x, z, id, sc] of [[87, 51, 'yacht', 0.85], [97, 51, 'sportfisher', 1], [107, 50, 'yacht', 1], [70, 60, 'superyacht', 0.8], [312, 53, 'superyacht', 0.85], [328, 52, 'yacht', 1], [352, 58, 'yacht', 0.9]] as const) {
    const y = new THREE.Group(); y.position.set(x, 0.3, z); scene.add(y); yachts.push(y);
    const b = buildBoat(BOATS.find((f) => f.id === id)!); b.scale.setScalar(sc); b.position.y = -0.5; y.add(b); boatModels.push(b); mergeStatic(b, b);
  }
  // Resort pool + cabanas between the casino and the boardwalk.
  box(16, 0.3, 8, stone, 0, 0.15, -3.5); const pw = box(14, 0.12, 6, pool, 0, 0.33, -3.5); pw.castShadow = false;
  for (const x of [-10, 10]) { box(3, 0.2, 3, white, x, 2.6, -3.5); for (const dx of [-1.3, 1.3]) for (const dz of [-1.3, 1.3]) box(0.15, 2.6, 0.15, wood, x + dx, 1.3, -3.5 + dz); }


  // #10a: resort visual overhaul (on par with Chud City): volcanic ridge, avenues + street lamps, live traffic,
  // sailboats and jet skis, a lighthouse, flower hedges and district signs.
  const anims: Array<(t: number, dt: number) => void> = [];
  { // Volcanic ridge behind the town (fog-softened silhouette).
    const ridgeM = mat({ color: 0x4a5a3a, roughness: 1, flatShading: true }); const ridgeTop = mat({ color: 0x6a5040, roughness: 1, flatShading: true });
    for (let i = 0; i < 30; i++) { const x = RESORT_X0 - 40 + i * ((RESORT_X1 - RESORT_X0 + 80) / 29) + (r() - 0.5) * 16; const hh = 40 + r() * 55; const rad = 34 + r() * 26;
      const c = new THREE.Mesh(geo(new THREE.ConeGeometry(rad, hh, 7, 3)), i % 3 ? ridgeM : ridgeTop); c.position.set(x, hh / 2 - 2, RESORT_Z0 - 50 - r() * 40); c.rotation.y = r() * 3; scene.add(c); }
  }
  // Avenues: back road, cross streets out to the new districts, warm street lamps.
  const asphalt = mat({ color: 0x3e3c3a, roughness: 0.95 }); const lineM = mat({ color: 0xf2e2b0, roughness: 0.8 });
  const road2 = new THREE.Mesh(geo(new THREE.BoxGeometry(RESORT_X1 - RESORT_X0 - 20, 0.12, 6)), asphalt); road2.position.set(0, 0.07, -64); road2.receiveShadow = true; scene.add(road2);
  for (const x of [-312, -136, -40, 40, 136, 312]) { const c = new THREE.Mesh(geo(new THREE.BoxGeometry(5, 0.12, 82)), asphalt); c.position.set(x, 0.065, -24); c.receiveShadow = true; scene.add(c); }
  const dashN = 160; const dashes = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(2.2, 0.05, 0.25)), lineM, dashN);
  for (let i = 0; i < dashN; i++) { d.position.set(RESORT_X0 + 14 + (i % 80) * 9.6, 0.15, i < 80 ? -32 : -64); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); dashes.setMatrixAt(i, d.matrix); }
  scene.add(dashes);
  const stN = 70; const sPost = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.14, 0.18, 6, 6)), mat({ color: 0x24221f, metalness: 0.6, roughness: 0.4 }), stN); const sGlobe = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.5, 10, 8)), glowMat, stN);
  for (let i = 0; i < stN; i++) { const x = RESORT_X0 + 18 + (i % 35) * 22.5, z = i < 35 ? -35.6 : -67.6;
    if (overlapsResortRoad({ x, z, w: 1, d: 1 }, 0.5)) { d.scale.set(0, 0, 0); } else d.scale.set(1, 1, 1);
    d.position.set(x, 3, z); d.rotation.set(0, 0, 0); d.updateMatrix(); sPost.setMatrixAt(i, d.matrix); d.position.y = 6.2; d.updateMatrix(); sGlobe.setMatrixAt(i, d.matrix); d.scale.set(1, 1, 1); }
  scene.add(sPost, sGlobe);
  // Traffic: convertibles and shuttles looping both avenues.
  const wheelM = mat({ color: 0x111111 });
  const carCols = [0xf26b5b, 0xffffff, 0x2fb5b0, 0xf6c445, 0x1a1a1a, 0xd8b25a, 0x3a6ab0];
  for (let i = 0; i < 26; i++) {
    const car = new THREE.Group(); const lane = i % 2 ? 1 : -1; const z = (i < 8 || (i >= 14 && i < 20) ? -32 : -64) + lane * 1.4; const big = i % 5 === 0;
    box(big ? 7 : 4, big ? 2.4 : 1, 1.8, mat({ color: carCols[i % carCols.length]!, metalness: 0.5, roughness: 0.35 }), 0, big ? 1.4 : 0.8, 0, car);
    if (!big) box(1.9, 0.6, 1.6, glass, -0.3, 1.5, 0, car); else box(6.8, 0.8, 1.85, glass, 0, 1.9, 0, car);
    for (const [wx, wz] of [[-1.3, 0.9], [1.3, 0.9], [-1.3, -0.9], [1.3, -0.9]] as const) box(0.7, 0.7, 0.3, wheelM, wx * (big ? 2 : 1), 0.35, wz, car);
    box(0.1, 0.3, 1.2, glowMat, (big ? 3.5 : 2) * lane, 0.9, 0, car); mergeStatic(car, car);
    scene.add(car); const span = RESORT_X1 - RESORT_X0 - 30; const off = r() * span; const sp = 9 + r() * 6;
    anims.push((t) => { const u = ((off + t * sp) % span); car.position.set(lane > 0 ? RESORT_X0 + 15 + u : RESORT_X1 - 15 - u, 0.1, z); car.rotation.y = lane > 0 ? 0 : Math.PI; });
  }
  // Sailboats + jet skis on the bay.
  const sailM = mat({ color: 0xfff8ec, roughness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Group(); const R = 70 + r() * 120, cx = (r() - 0.5) * 220, cz = SHORE_Z + 90 + r() * 80, w = (0.02 + r() * 0.03) * (i % 2 ? 1 : -1), ph = r() * 6.28; scene.add(b);
    if (i < 6) { box(1.6, 0.8, 6, white, 0, 0.4, 0, b); box(1.65, 0.12, 6, mat({ color: [0x1a3a6a, 0xd84a3a, 0x2fb5b0][i % 3]! }), 0, 0.05, 0, b);
      const mast = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.08, 0.08, 9, 5)), white); mast.position.set(0, 5, 0.4); b.add(mast);
      const sail = new THREE.Mesh(geo(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.2, 0.5), new THREE.Vector3(0, 9.2, 0.5), new THREE.Vector3(0, 1.2, -2.8)])), sailM); sail.geometry.computeVertexNormals(); b.add(sail); }
    else { box(0.9, 0.6, 2.4, mat({ color: 0xf6c445, metalness: 0.4 }), 0, 0.3, 0, b); box(0.4, 0.8, 0.3, mat({ color: 0x1a1a1a }), 0, 0.9, -0.2, b); }
    anims.push((t) => { const a = ph + t * w * (i < 6 ? 1 : 3.5); b.position.set(cx + Math.cos(a) * R, 0.1 + Math.sin(t * 1.3 + i) * 0.1, cz + Math.sin(a) * R * 0.35); b.rotation.y = -a + (w > 0 ? 0 : Math.PI); b.rotation.z = Math.sin(t + i) * 0.05; });
  }
  // No ambient circling jet: only planes players are actually using are drawn.
  // Lighthouse on the east point with a sweeping beam.
  for (const lx of [RESORT_X1 - 8, RESORT_X0 + 8]) { const lh = new THREE.Group(); lh.position.set(lx, 0, SHORE_Z + 2); scene.add(lh);
    for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(geo(new THREE.CylinderGeometry(2.4 - i * 0.22, 2.6 - i * 0.22, 3, 14)), i % 2 ? white : mat({ color: 0xd84a3a, roughness: 0.6 })); c.position.y = 1.5 + i * 3; c.castShadow = true; lh.add(c); }
    const lamp = new THREE.Mesh(geo(new THREE.SphereGeometry(1.2, 14, 10)), mat({ color: 0xfff0c0, emissive: 0xffd070, emissiveIntensity: 5 })); lamp.position.y = 19.5; lh.add(lamp);
    const beam = new THREE.Mesh(geo(new THREE.ConeGeometry(4, 50, 16, 1, true)), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })); disposables.push(beam.material as THREE.Material);
    beam.rotation.z = Math.PI / 2; beam.position.x = 25; const piv = new THREE.Group(); piv.position.y = 19.5; piv.add(beam); lh.add(piv); const ph = lx > 0 ? 0 : Math.PI; anims.push((t) => { piv.rotation.y = ph + t * 0.6; }); }
  // Flowering hedges along the avenues.
  { const hN = 240; const hedge = new THREE.InstancedMesh(geo(new THREE.IcosahedronGeometry(1, 0)), mat({ roughness: 0.9, flatShading: true }), hN); const fc = [0x2f7a3a, 0x3a8a40, 0xe0508a, 0xf6a040, 0xd84aa0];
    for (let i = 0; i < hN; i++) { const x = RESORT_X0 + 12 + (i % 120) * 6.4 + r() * 2, z = i < 120 ? -28.5 : -60.5;
      if (overlapsResortRoad({ x, z, w: 1.5, d: 1.5 }, 0.5)) { d.scale.set(0, 0, 0); } else { const k = 0.7 + r() * 0.5; d.scale.set(k * 1.3, k, k); }
      d.position.set(x, 0.6, z); d.rotation.set(r(), r(), r()); d.updateMatrix(); hedge.setMatrixAt(i, d.matrix); hedge.setColorAt(i, cc.setHex(fc[i % 5 === 0 ? 2 + (i % 3) : i % 2]!)); }
    hedge.castShadow = true; scene.add(hedge); }

  const stiltM = mat({ color: 0x6a4a2a, roughness: 0.9 }); const thatchM = mat({ color: 0xc8a050, roughness: 1, flatShading: true });
  const terraM = mat({ color: 0xc8643c, roughness: 0.8 }); const lawnM = mat({ color: 0x5f9a3e, roughness: 1 });
  // Grand expansion scenery: Coral Cove lagoon + bungalow boardwalk, Sunset Links golf, Azure Point tennis club, promenade flower beds.
  { const decor = new THREE.Group(); scene.add(decor); const dx = (w: number, hh: number, dd: number, m: THREE.Material, x: number, y: number, z: number) => box(w, hh, dd, m, x, y, z, decor);
    const lagoon = new THREE.Mesh(geo(new THREE.CircleGeometry(34, 40)), mat({ color: 0x5fe6e0, roughness: 0.15, metalness: 0.1, emissive: 0x0a6a6a, emissiveIntensity: 0.55, transparent: true, opacity: 0.72 }));
    lagoon.rotation.x = -Math.PI / 2; lagoon.scale.set(1.3, 0.6, 1); lagoon.position.set(-356, -0.04, 54); lagoon.renderOrder = 1; scene.add(lagoon);
    dx(3, 0.35, 15, wood, -356, 1.75, 43.5); dx(48, 0.35, 2.6, wood, -356, 1.75, 50.2); for (let x = -378; x <= -334; x += 4) { dx(0.3, 2.4, 0.3, stiltM, x, 0.5, 49); dx(0.3, 2.4, 0.3, stiltM, x, 0.5, 51.4); }
    for (const z of [38, 42, 46]) { dx(0.3, 2.4, 0.3, stiltM, -357.3, 0.5, z); dx(0.3, 2.4, 0.3, stiltM, -354.7, 0.5, z); }
    // Sunset Links (Coral Cove hills): fairway, greens, bunkers, flags.
    const fairM = mat({ color: 0x7cc458, roughness: 1 }), greenM = mat({ color: 0x9be070, roughness: 0.9 }), bunkerM = mat({ color: 0xf2e2b4, roughness: 1 }), flagM = mat({ color: 0xff4a3a, emissive: 0x5a1008, side: THREE.DoubleSide });
    dx(30, 0.18, 58, fairM, -303, 0.09, -110); for (const [x, z] of [[-298, -88], [-308, -128]] as const) { const gr = new THREE.Mesh(geo(new THREE.CylinderGeometry(6, 6, 0.24, 24)), greenM); gr.position.set(x, 0.14, z); decor.add(gr); dx(0.12, 3.2, 0.12, white, x, 1.6, z); dx(1.4, 0.8, 0.05, flagM, x + 0.7, 2.8, z); }
    for (const [x, z] of [[-292, -96], [-313, -120], [-296, -134]] as const) { const b = new THREE.Mesh(geo(new THREE.CylinderGeometry(2.6, 2.6, 0.2, 16)), bunkerM); b.position.set(x, 0.12, z); decor.add(b); }
    dx(6, 3, 4, white, -303, 1.5, -78); dx(6.6, 0.4, 4.6, terraM, -303, 3.2, -78); label('⛳ Sunset Links', 'Coral Cove golf club', '#7cc458', -303, 8, -110);
    // Azure Point tennis club.
    const courtM = mat({ color: 0x2f7ab8, roughness: 0.8 }), lineW = mat({ color: 0xffffff, roughness: 0.6 });
    for (const z of [-102, -88]) { dx(17, 0.16, 11, mat({ color: 0x3a8a4a, roughness: 1 }), 305, 0.08, z); dx(14, 0.18, 8, courtM, 305, 0.1, z); dx(0.15, 0.2, 8, lineW, 305, 0.12, z); dx(0.1, 1, 8, mat({ color: 0x222222 }), 305, 0.6, z); }
    label('🎾 Tennis club', 'Azure Point', '#7ad0ff', 305, 7, -95);
    // Low stone walls + flower beds along the district promenades.
    const bedM = mat({ color: 0xe0508a, roughness: 0.9, flatShading: true });
    for (const sx of [-1, 1]) for (let x = 216; x <= 386; x += 10) { if (Math.abs(x - 312) < 6) continue; dx(6, 0.5, 1, stone, sx * x, 0.25, BOARDWALK_Z - 3.4); dx(5.4, 0.5, 0.6, bedM, sx * x, 0.6, BOARDWALK_Z - 3.4); }
    mergeStatic(decor);
  }

  // Properties.
  const lotIds: string[] = []; const propTop = new Map<string, [number, number, number]>();
  const facades = [facadeTexture(3, false), facadeTexture(7, true)]; facades.forEach((t) => disposables.push(t));
  const condoM = mat({ map: facades[1], roughness: 0.5 }); const hotelM = mat({ map: facades[1], roughness: 0.4 }); const houseM = mat({ color: 0xfaf3e6, roughness: 0.7 });
  const roofCols = [0x2fb5b0, 0xe07a5a, 0x3a6ab0, 0xd8b25a];
  const propsRoot = new THREE.Group(); scene.add(propsRoot);
  for (const l of resortLots()) {
    const g = new THREE.Group(); g.position.set(l.x, 0, l.z); g.rotation.y = -l.rot; propsRoot.add(g);
    const hit = box(l.w, l.h, l.d, new THREE.MeshBasicMaterial({ visible: false }), 0, l.h / 2, 0, g); hit.userData.lot = l.id; pickables.push(hit); lotIds.push(l.id);
    if (l.type === 'beachhouse') { box(l.w - 2, l.h, l.d - 2, houseM, 0, l.h / 2, 0, g); const roof = new THREE.Mesh(geo(new THREE.ConeGeometry((l.w - 1) * 0.72, 2.4, 4)), mat({ color: roofCols[l.n % 4]! })); roof.rotation.y = Math.PI / 4; roof.position.y = l.h + 1.2; roof.castShadow = true; g.add(roof); box(l.w - 2, 0.2, 2, wood, 0, 0.1, l.d / 2 - 0.6, g); }
    else if (l.type === 'condo') { box(l.w - 1, l.h, l.d - 1, condoM, 0, l.h / 2, 0, g); box(l.w - 0.6, 0.4, l.d - 0.6, gold, 0, l.h + 0.2, 0, g); }
    else if (l.type === 'hotel') { box(l.w - 1, l.h, l.d - 3, hotelM, 0, l.h / 2, -1, g); box(l.w - 1, 2, 3, glass, 0, 1, l.d / 2 - 1.5, g); box(l.w * 0.5, 3, l.d * 0.5, gold, 0, l.h + 1.5, -1, g); box(l.w - 4, 0.12, 2.6, pool, 0, 0.12, l.d / 2 + 1, g); }
    else if (l.type === 'skyrise') { box(l.w - 3, l.h, l.d - 3, hotelM, 0, l.h / 2, 0, g); box(l.w - 2.6, l.h * 0.35, l.d - 2.6, glass, 0, l.h * 0.825, 0, g); box(l.w - 5, 3, l.d - 5, gold, 0, l.h + 1.5, 0, g); const sp = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.15, 0.3, 8, 6)), gold); sp.position.set(0, l.h + 7, 0); g.add(sp); box(l.w - 1, 0.12, 2.2, pool, 0, 0.12, l.d / 2 - 0.6, g); }
    else if (l.type === 'clifftop') { const plinth = mat({ color: 0x8a7a6a, roughness: 1, flatShading: true }); box(l.w, 2, l.d, plinth, 0, 1, 0, g); box(l.w - 2, l.h * 0.5, l.d - 3, white, 0, 2 + l.h * 0.25, -1, g); box(l.w - 5, l.h * 0.45, l.d - 6, white, 1, 2 + l.h * 0.72, -2, g); box(l.w - 1.6, 0.35, l.d - 2.6, gold, 0, 2 + l.h * 0.5 + 0.17, -1, g); box(l.w - 2.4, l.h * 0.4, 0.2, glass, 0, 2 + l.h * 0.25, l.d / 2 - 2.4, g); box(l.w * 0.7, 0.12, 2.6, pool, 0, 2.06, l.d / 2 - 1.2, g); }
    else if (l.type === 'oceanestate') { box(l.w - 2, l.h * 0.6, l.d - 3, houseM, 0, l.h * 0.3, -1, g); box(l.w * 0.55, l.h * 0.4, l.d * 0.5, houseM, -1.5, l.h * 0.8, -1.5, g); const roof = new THREE.Mesh(geo(new THREE.ConeGeometry(l.w * 0.45, 2.2, 4)), mat({ color: 0x2fb5b0 })); roof.rotation.y = Math.PI / 4; roof.position.set(-1.5, l.h + 1.1, -1.5); roof.castShadow = true; g.add(roof); box(l.w - 3, l.h * 0.5, 0.2, glass, 0, l.h * 0.3, l.d / 2 - 2.4, g); box(l.w - 4, 0.12, 2, pool, 0, 0.12, l.d / 2 - 0.9, g); }
    else if (l.type === 'beachvilla') { // white two-storey villa, glass front, terracotta roof, private plunge pool and deck to the sand
      box(l.w - 2, l.h * 0.5, l.d - 3, houseM, 0, l.h * 0.25, -1, g); box(l.w - 5, l.h * 0.5, l.d - 4, houseM, -1, l.h * 0.75, -1.5, g);
      box(l.w - 4.6, 0.3, l.d - 3.6, terraM, -1, l.h + 0.15, -1.5, g); box(l.w - 2.6, l.h * 0.36, 0.2, glass, 0, l.h * 0.22, l.d / 2 - 2.4, g);
      box(l.w - 2, 0.4, l.d - 2.6, gold, 0, l.h * 0.5 + 0.2, -1, g); const pw = box(5, 0.12, 2, pool, 3, 0.12, l.d / 2 - 0.9, g); pw.castShadow = false; box(4, 0.2, 2, wood, -3, 0.1, l.d / 2 - 0.9, g); }
    else if (l.type === 'overwater') { // thatched bungalow on stilts over the lagoon, with a sun deck and ladder
      for (const dx of [-3.6, 0, 3.6]) for (const dz of [-3, 0, 3]) box(0.35, 3, 0.35, stiltM, dx, 0.3, dz, g);
      box(l.w, 0.4, l.d, wood, 0, 1.9, 0, g); box(l.w - 3, l.h * 0.7, l.d - 3.4, houseM, 0, 2.1 + l.h * 0.35, -0.6, g); box(l.w - 3.2, l.h * 0.4, 0.15, glass, 0, 2.1 + l.h * 0.3, l.d / 2 - 2.3, g);
      const roof = new THREE.Mesh(geo(new THREE.ConeGeometry(l.w * 0.62, 3.4, 4)), thatchM); roof.rotation.y = Math.PI / 4; roof.position.y = 2.1 + l.h * 0.7 + 1.6; roof.castShadow = true; g.add(roof);
      const pw = box(3, 0.1, 1.6, pool, -2.4, 2.15, l.d / 2 - 0.9, g); pw.castShadow = false; box(0.6, 1.8, 0.1, gold, 3.6, 1.1, l.d / 2, g); }
    else if (l.type === 'grandhotel') { // stepped tower with gold crown, glass lobby, pool terrace and cabanas
      box(l.w - 2, l.h * 0.62, l.d - 4, hotelM, 0, l.h * 0.31, -1.5, g); box(l.w - 6, l.h * 0.38, l.d - 6, hotelM, 0, l.h * 0.81, -2, g);
      box(l.w - 5.6, 0.6, l.d - 5.6, gold, 0, l.h * 0.62 + 0.3, -2, g); box(l.w - 8, 2.4, l.d - 9, gold, 0, l.h + 1.2, -2, g); const sp = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.2, 0.4, 6, 6)), gold); sp.position.set(0, l.h + 5.4, -2); g.add(sp);
      box(l.w - 1, 3, 3, glass, 0, 1.5, l.d / 2 - 2.6, g); box(l.w + 1, 0.4, 3.6, gold, 0, 3.2, l.d / 2 - 2.6, g);
      box(l.w - 2, 0.2, 4, stone, 0, 0.1, l.d / 2 + 2, g); const pw = box(l.w - 6, 0.14, 2.6, pool, 0, 0.24, l.d / 2 + 2, g); pw.castShadow = false; }
    else if (l.type === 'royalestate') { // gated hilltop palace: lawn, twin wings, central dome, colonnade, long pool
      box(l.w, 0.3, l.d, lawnM, 0, 0.15, 0, g); for (const x of [-l.w / 2 + 0.3, l.w / 2 - 0.3]) box(0.4, 1.4, l.d, stone, x, 0.7, 0, g); box(l.w, 1.4, 0.4, stone, 0, 0.7, -l.d / 2 + 0.3, g);
      box(l.w * 0.62, l.h * 0.55, l.d * 0.4, white, 0, l.h * 0.275, -2.5, g); for (const x of [-l.w * 0.34, l.w * 0.34]) box(l.w * 0.22, l.h * 0.4, l.d * 0.52, white, x, l.h * 0.2, -1.6, g);
      box(l.w * 0.64, 0.5, l.d * 0.42, gold, 0, l.h * 0.55 + 0.25, -2.5, g); const dome = new THREE.Mesh(geo(new THREE.SphereGeometry(3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)), gold); dome.position.set(0, l.h * 0.55 + 0.5, -2.5); dome.castShadow = true; g.add(dome);
      for (let i = -3; i <= 3; i++) { const c = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.3, 0.3, l.h * 0.5, 8)), white); c.position.set(i * 1.8, l.h * 0.25, l.d * 0.2 - 2.5 + 0.6); c.castShadow = true; g.add(c); }
      const pw = box(l.w * 0.5, 0.14, 2.4, pool, 0, 0.36, l.d / 2 - 2.6, g); pw.castShadow = false; box(l.w * 0.5 + 1, 0.3, 3.2, stone, 0, 0.2, l.d / 2 - 2.6, g); }
    else { box(l.w - 3, l.h * 0.5, l.d - 3, white, -1, l.h * 0.25, -1, g); box(l.w * 0.5, l.h * 0.5, l.d * 0.5, white, 1.5, l.h * 0.75, -1.5, g); box(l.w - 5, 0.4, l.d - 5, glass, -1, l.h * 0.5 + 0.2, -1, g); box(l.w * 0.6, 0.12, 2.4, pool, 0, 0.12, l.d / 2 - 1.4, g); }
    propTop.set(l.id, [l.x, l.h + (l.type === 'overwater' ? 6 : 3), l.z]);
  }
  mergeStatic(propsRoot);
  // Plantation plots.
  const soilM = mat({ color: 0x6a4a2a, roughness: 1 });
  for (const p of resortPlots()) { const id = resortPlotId(p.n); const s = box(p.w, 0.3, p.d, soilM, p.x, 0.15, p.z); s.userData.lot = id; pickables.push(s); lotIds.push(id); propTop.set(id, [p.x, 1, p.z]); }
  const cropMesh = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(0.6, 1, 6)), mat({ roughness: 0.7 }), 400); cropMesh.count = 0; scene.add(cropMesh);
  const setFarm = (tiles: Array<[string, number, string, string]>) => {
    const plots = new Map(resortPlots().map((p) => [resortPlotId(p.n), p])); let n = 0; const c = new THREE.Color();
    for (const [pid, t, crop, stage] of tiles) { const p = plots.get(pid); const cr = cropById(crop); if (!p || !cr || n >= 400) continue; const [x, z] = rfTileXZ(p, t); const hh = stage === 'ready' ? 1.6 : stage === 'withered' ? 0.5 : 0.9;
      d.position.set(x, 0.3 + hh / 2, z); d.rotation.set(0, 0, 0); d.scale.set(RF_TILE * 0.4, hh, RF_TILE * 0.4); d.updateMatrix(); cropMesh.setMatrixAt(n, d.matrix); cropMesh.setColorAt(n, c.setHex(stage === 'ready' ? cr.color : stage === 'withered' ? 0x5a4a30 : 0x3f9a4a)); n++; }
    cropMesh.count = n; cropMesh.instanceMatrix.needsUpdate = true; if (cropMesh.instanceColor) cropMesh.instanceColor.needsUpdate = true;
  };
  const marks = new THREE.InstancedMesh(geo(new THREE.OctahedronGeometry(0.6, 0)), mat({ color: 0xd8b25a, metalness: 0.6, roughness: 0.3 }), 64); marks.count = 0; scene.add(marks);
  const setOwned = (ids: string[]) => { let n = 0; for (const id of ids) { const t = propTop.get(id); if (!t || n >= 64) continue; d.position.set(t[0], t[1] + 1, t[2]); d.rotation.set(0, 0, 0); d.scale.set(1, 1.5, 1); d.updateMatrix(); marks.setMatrixAt(n++, d.matrix); } marks.count = n; marks.instanceMatrix.needsUpdate = true; };

  // Interaction (same rules as the city: drag pans, click picks).
  const ray = new THREE.Raycaster(); ray.layers.enable(LABEL_LAYER); const ndc = new THREE.Vector2();
  const pick = (cx: number, cy: number) => { const rc = canvas.getBoundingClientRect(); ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, camera); const o = ray.intersectObjects(pickables, false)[0]?.object; return (o?.userData.spot ?? o?.userData.lot ?? null) as string | null; };
  let down: { x: number; y: number; drag?: boolean } | null = null;
  const onMove = (e: PointerEvent) => { if (e.pointerType === 'touch') return; if (down && e.buttons) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down.drag = true; h.onHover(null, 0, 0); } if (down.drag) return; } const id = pick(e.clientX, e.clientY); canvas.style.cursor = id ? 'pointer' : 'grab'; h.onHover(id, e.clientX, e.clientY); };
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; h.onHover(null, 0, 0); };
  const onUp = (e: PointerEvent) => { if (!down) return; const dragged = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || !!down.drag; down = null; if (dragged) return; const id = pick(e.clientX, e.clientY); if (!id) return; h.onHover(null, 0, 0); if (id.startsWith('r:') || id.startsWith('rf:')) h.onProperty?.(id); else h.onPick(id); };
  const onLeave = () => h.onHover(null, 0, 0);
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointerleave', onLeave);

  const resize = () => { const w = canvas.clientWidth || 1, hh = canvas.clientHeight || 1; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.fov = w < hh ? 62 : 38; camera.updateProjectionMatrix(); };
  let composer: EffectComposer | null = null;
  if (tier !== 'low') { composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.82)); composer.addPass(new OutputPass()); }
  const ro = new ResizeObserver(() => { resize(); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1); } }); ro.observe(canvas); resize();

  // Tropical all year: no snow, snowfall or frost on the resort (snow stays in Chud City and Fort McChud).
  const xmas = null as { step(dt: number): void; dispose(): void } | null;
  const clock = new THREE.Clock(); let raf = 0; let running = true; let time = 0; const tmp = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!running) return; const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    xmas?.step(dt); waterMat.uniforms.uTime!.value = time; anims.forEach((f) => f(time, dt)); yachts.forEach((y, i) => { y.position.y = 0.3 + Math.sin(time * 1.1 + i) * 0.12; y.rotation.z = Math.sin(time * 0.9 + i * 2) * 0.02; });
    controls.update(); clampPan(); sky.position.copy(camera.position); followSun(controls.target.x, controls.target.z);
    const portrait = (canvas.clientWidth || 1) < (canvas.clientHeight || 1);
    for (const s of signs) { const k = labelScale(camera.position.distanceTo(s.getWorldPosition(tmp)), portrait) * (s.userData.k as number); fitLabel(s, k); }
    renderScene(renderer, composer, scene, camera);
  };
  const vis = () => { running = !document.hidden; clock.getDelta(); }; document.addEventListener('visibilitychange', vis); frame();
  return {
    scene, camera, controls, setFarm, setOwned, lotIds,
    setRunning(v: boolean) { running = v; clock.getDelta(); },
    reset() { camera.position.copy(home); controls.target.copy(homeT); },
    /** Point the camera at (x, z) from an offset (QA screenshots). */
    view(x: number, z: number, dx = 0, dy = 60, dz = 90) { controls.target.set(x, 0, z); camera.position.set(x + dx, dy, z + dz); },
    dispose() { xmas?.dispose(); boatModels.forEach(disposeTree); cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave); controls.dispose(); disposables.forEach((x) => x.dispose()); composer?.dispose(); renderer.dispose(); },
  };
}
