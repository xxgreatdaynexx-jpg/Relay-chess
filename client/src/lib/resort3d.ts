// Chud Resort 3D map: a golden-hour beachfront town. Ocean, sand, palms, boardwalk, hotels, condos, villas, pool,
// marina with superyachts, an airfield, the Paradise Plantation and the Coral Grotto. Same camera/pan rules as the city.
import * as THREE from 'three';
import { asLabel, dimColor, drawLabel, LABEL_LAYER, labelMaterial, renderScene } from './labelSprite';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { addXmas } from './worldXmas';
import { xmasOn } from '../../../shared/holiday';
import { detectWorldTier, labelScale, TIER_PIXEL_RATIO } from './worldTier';
import { RESORT_SPOTS, resortLots, resortPlots, resortPlotId, rfTileXZ, RF_TILE, clampResortTarget, SHORE_Z, BOARDWALK_Z, RESORT_X0, RESORT_X1, RESORT_Z0 } from '../../../shared/resort';
import { cropById } from '../../../shared/farm';

type Handlers = { onHover: (id: string | null, x: number, y: number) => void; onPick: (id: string) => void; onProperty?: (id: string) => void };
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function signTexture(text: string, color: string, sub?: string) {
  return drawLabel(text, { bg: (g, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(226,220,208,.94)'); gr.addColorStop(1, 'rgba(214,204,184,.94)'); return gr; }, border: dimColor(color, 0.75), text: '#2a2016', sub: '#7d6020', font: 'Outfit Variable, Georgia, serif', radius: 30 }, sub, labelRenderer);
}
let labelRenderer: THREE.WebGLRenderer | null = null;
function facadeTexture(seed: number, balconies: boolean) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d')!; const r = rng(seed);
  g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 10) { for (let x = 4; x < 60; x += 10) { const lit = r() > 0.55; g.fillStyle = lit ? '#ffd79a' : '#5f8fa8'; g.fillRect(x, y, 7, 6); } if (balconies) { g.fillStyle = '#c9b48a'; g.fillRect(0, y + 7, 64, 1.5); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export type Resort = ReturnType<typeof createResort>;
export function createResort(canvas: HTMLCanvasElement, h: Handlers) {
  const tier = detectWorldTier(); const r = rng(20261101);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' }); labelRenderer = renderer;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIER_PIXEL_RATIO[tier])); canvas.dataset.tier = tier;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = tier !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); const disposables: Array<{ dispose(): void }> = [];
  const mat = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(p); disposables.push(m); return m; };
  const geo = <G extends THREE.BufferGeometry>(g: G) => { disposables.push(g); return g; };

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
  disposables.push(skyM); scene.add(new THREE.Mesh(geo(new THREE.SphereGeometry(800, 32, 16)), skyM));
  scene.fog = new THREE.Fog(0xd8743e, 420, 1100); // warm haze, far enough that the town keeps its colour
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1700);
  const home = new THREE.Vector3(-40, 72, 240); const homeT = new THREE.Vector3(0, 10, -30); camera.position.copy(home); // low golden-hour angle so the sunset sky shows above the town
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(homeT); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 30; controls.maxDistance = 360; controls.maxPolarAngle = 1.36; controls.minPolarAngle = 0.35;
  controls.enablePan = true; controls.screenSpacePanning = false; controls.panSpeed = 1.1; controls.autoRotate = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const clampPan = () => { const t = controls.target; const [x, z] = clampResortTarget(t.x, t.z); if (x !== t.x || z !== t.z) { camera.position.x += x - t.x; camera.position.z += z - t.z; t.x = x; t.z = z; } };

  scene.add(new THREE.HemisphereLight(0xffc49a, 0x3a4a5a, 0.9));
  const sun = new THREE.DirectionalLight(0xff9a50, 3.2); sun.position.set(-40, 60, 160); sun.castShadow = renderer.shadowMap.enabled;
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 120, bottom: -120, near: 10, far: 400 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; scene.add(sun);

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
  const water = new THREE.Mesh(geo(new THREE.PlaneGeometry(1400, 700, 140, 70)), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(0, -0.15, SHORE_Z + 350); scene.add(water);

  // Boardwalk + promenade to the casino.
  const wood = mat({ color: 0xa8784a, roughness: 0.8 });
  const bw = new THREE.Mesh(geo(new THREE.BoxGeometry(RESORT_X1 - RESORT_X0 - 20, 0.3, 4)), wood); bw.position.set(0, 0.15, BOARDWALK_Z); bw.receiveShadow = true; scene.add(bw);
  const stone = mat({ color: 0xeadfca, roughness: 0.9 });
  const prom = new THREE.Mesh(geo(new THREE.BoxGeometry(10, 0.2, 30)), stone); prom.position.set(0, 0.1, 4); prom.receiveShadow = true; scene.add(prom);
  const road = new THREE.Mesh(geo(new THREE.BoxGeometry(RESORT_X1 - RESORT_X0 - 20, 0.12, 5)), mat({ color: 0x8a8070, roughness: 1 })); road.position.set(0, 0.06, -32); scene.add(road);
  // Lamp posts with warm globes along the boardwalk.
  const glowMat = mat({ color: 0xffe2a8, emissive: 0xffb050, emissiveIntensity: 4 });
  const lampN = 24; const posts = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.12, 0.15, 4, 6)), mat({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4 }), lampN);
  const globes = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(0.4, 10, 8)), glowMat, lampN); const d = new THREE.Object3D();
  for (let i = 0; i < lampN; i++) { const x = RESORT_X0 + 20 + i * ((RESORT_X1 - RESORT_X0 - 40) / (lampN - 1)); d.position.set(x, 2, BOARDWALK_Z - 2.4); d.scale.set(1, 1, 1); d.updateMatrix(); posts.setMatrixAt(i, d.matrix); d.position.y = 4.2; d.updateMatrix(); globes.setMatrixAt(i, d.matrix); }
  scene.add(posts, globes);

  // Palms (instanced, curved trunks + fronds).
  const palmSpots: [number, number][] = [];
  for (let x = RESORT_X0 + 14; x < RESORT_X1 - 10; x += 7 + r() * 4) { palmSpots.push([x, BOARDWALK_Z + 3 + r() * 1.5]); if (r() > 0.45) palmSpots.push([x + 2, SHORE_Z - 3 - r() * 3]); }
  for (let z = -20; z <= 12; z += 6) palmSpots.push([-7, z], [7, z]);
  for (let i = 0; i < 40; i++) palmSpots.push([RESORT_X0 + 10 + r() * (RESORT_X1 - RESORT_X0 - 20), -62 - r() * 30]);
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
  const umbN = 26; const umb = new THREE.InstancedMesh(geo(new THREE.ConeGeometry(1.6, 0.7, 10)), mat({ color: 0xffffff, roughness: 0.7 }), umbN);
  const pole = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5)), mat({ color: 0xeeeeee }), umbN);
  const lounger = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.8, 0.25, 2)), mat({ color: 0xffffff, roughness: 0.6 }), umbN * 2);
  const umbCols = [0xf26b5b, 0x2fb5b0, 0xf6c445, 0xffffff]; const cc = new THREE.Color();
  for (let i = 0; i < umbN; i++) { const x = RESORT_X0 + 20 + i * 8.6 + r() * 2, z = SHORE_Z - 1.5 - r() * 2.5; if (Math.abs(x) < 6 || (x > 76 && x < 110)) { d.scale.set(0, 0, 0); } else d.scale.set(1, 1, 1);
    d.position.set(x, 2.4, z); d.rotation.set(0, 0, 0); d.updateMatrix(); umb.setMatrixAt(i, d.matrix); umb.setColorAt(i, cc.setHex(umbCols[i % umbCols.length]!));
    d.position.y = 1.1; d.updateMatrix(); pole.setMatrixAt(i, d.matrix);
    for (const k of [0, 1]) { d.position.set(x - 0.7 + k * 1.4, 0.2, z - 1.4); d.updateMatrix(); lounger.setMatrixAt(i * 2 + k, d.matrix); } }
  scene.add(umb, pole, lounger);

  // Labels.
  const signs: THREE.Sprite[] = [];
  const label = (text: string, sub: string | undefined, color: string, x: number, y: number, z: number, k = 1) => {
    const tex = signTexture(text, color, sub); disposables.push(tex); const m = labelMaterial(tex, { fog: false }); disposables.push(m);
    const s = asLabel(new THREE.Sprite(m)); s.position.set(x, y, z); s.userData.k = k; s.scale.set(8, 2, 1); scene.add(s); signs.push(s); return s;
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
      const plane = new THREE.Group(); plane.position.set(18, 1.6, 6); g.add(plane); plane.userData.plane = true;
      box(14, 1.6, 1.6, white, 0, 0, 0, plane); box(3, 0.25, 14, white, 0.5, 0, 0, plane); box(2, 2.4, 0.25, mat({ color: 0xd8b25a, metalness: 0.6 }), -6.4, 1.4, 0, plane);
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
    } else if (s.id === 'r-pier') { // Reef Pier (pt1304u): a plank walkway out over the reef, a tiki shack and rod holders, lanterns at the end
      box(4, 0.4, 26, wood, 0, 0.5, 0, g); for (let z = -12; z <= 12; z += 4) for (const x of [-1.8, 1.8]) box(0.35, 2.2, 0.35, wood, x, -0.3, z, g);
      for (let z = -11; z <= 12; z += 1.5) box(4.1, 0.05, 0.12, mat({ color: 0x6a4a2a }), 0, 0.72, z, g);
      box(7, 0.4, 5, wood, 0, 0.5, 11.5, g); for (const x of [-3.3, 3.3]) box(0.15, 1, 5, wood, x, 1.2, 11.5, g);
      const thatch = mat({ color: 0xc8a050, roughness: 1 }); box(2.6, 2, 2.4, mat({ color: 0xf2e6cc }), 0, 1.7, -9, g); const hut = new THREE.Mesh(geo(new THREE.ConeGeometry(2.4, 1.6, 4)), thatch); hut.rotation.y = Math.PI / 4; hut.position.set(0, 3.5, -9); hut.castShadow = true; g.add(hut);
      for (const x of [-3, -1, 1, 3]) { const rod = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.03, 0.05, 3, 5)), mat({ color: 0x1d2633 })); rod.position.set(x, 1.9, 13.6); rod.rotation.x = 0.55; g.add(rod); }
      for (const x of [-3.3, 3.3]) { box(0.12, 2, 0.12, wood, x, 1.7, 13.8, g); const l = new THREE.Mesh(geo(new THREE.SphereGeometry(0.25, 10, 8)), mat({ color: 0xffb060, emissive: 0xff8a30, emissiveIntensity: 2 })); l.position.set(x, 2.8, 13.8); g.add(l); }
      label('🎣 Reef Pier', 'Tropical fishing', '#3ad8c8', s.x, 9, s.z);
    } else if (s.id === 'r-marina') {
      box(30, 0.5, 3, wood, 0, 0.3, -6, g); for (const x of [-10, 0, 10]) box(2, 0.5, 12, wood, x, 0.3, 1, g);
      label('🛥 Marina', 'Boats · yachts · deep sea', '#ffffff', s.x, 12, s.z);
    }
  }
  // Superyachts bobbing at the marina.
  const yachts: THREE.Group[] = [];
  for (const [x, z, len] of [[87, 51, 16], [97, 51, 12], [107, 49, 20], [70, 60, 24]] as const) {
    const y = new THREE.Group(); y.position.set(x, 0.3, z); scene.add(y); yachts.push(y);
    const hull = box(3.4, 1.4, len, white, 0, 0.6, 0, y); hull.scale.set(1, 1, 1); box(2.6, 1.2, len * 0.55, white, 0, 1.8, -len * 0.05, y); box(2.65, 0.5, len * 0.5, glass, 0, 1.9, -len * 0.05, y); box(1.8, 0.9, len * 0.3, white, 0, 2.9, -len * 0.08, y);
    box(3.45, 0.15, len, mat({ color: 0x1a3a6a }), 0, 0.05, 0, y);
  }
  // Resort pool + cabanas between the casino and the boardwalk.
  box(16, 0.3, 8, stone, 0, 0.15, -3.5); const pw = box(14, 0.12, 6, pool, 0, 0.33, -3.5); pw.castShadow = false;
  for (const x of [-10, 10]) { box(3, 0.2, 3, white, x, 2.6, -3.5); for (const dx of [-1.3, 1.3]) for (const dz of [-1.3, 1.3]) box(0.15, 2.6, 0.15, wood, x + dx, 1.3, -3.5 + dz); }

  // Properties.
  const lotIds: string[] = []; const propTop = new Map<string, [number, number, number]>();
  const facades = [facadeTexture(3, false), facadeTexture(7, true)]; facades.forEach((t) => disposables.push(t));
  const condoM = mat({ map: facades[1], roughness: 0.5 }); const hotelM = mat({ map: facades[1], roughness: 0.4 }); const houseM = mat({ color: 0xfaf3e6, roughness: 0.7 });
  const roofCols = [0x2fb5b0, 0xe07a5a, 0x3a6ab0, 0xd8b25a];
  for (const l of resortLots()) {
    const g = new THREE.Group(); g.position.set(l.x, 0, l.z); g.rotation.y = -l.rot; scene.add(g);
    const hit = box(l.w, l.h, l.d, new THREE.MeshBasicMaterial({ visible: false }), 0, l.h / 2, 0, g); hit.userData.lot = l.id; pickables.push(hit); lotIds.push(l.id);
    if (l.type === 'beachhouse') { box(l.w - 2, l.h, l.d - 2, houseM, 0, l.h / 2, 0, g); const roof = new THREE.Mesh(geo(new THREE.ConeGeometry((l.w - 1) * 0.72, 2.4, 4)), mat({ color: roofCols[l.n % 4]! })); roof.rotation.y = Math.PI / 4; roof.position.y = l.h + 1.2; roof.castShadow = true; g.add(roof); box(l.w - 2, 0.2, 2, wood, 0, 0.1, l.d / 2 - 0.6, g); }
    else if (l.type === 'condo') { box(l.w - 1, l.h, l.d - 1, condoM, 0, l.h / 2, 0, g); box(l.w - 0.6, 0.4, l.d - 0.6, gold, 0, l.h + 0.2, 0, g); }
    else if (l.type === 'hotel') { box(l.w - 1, l.h, l.d - 3, hotelM, 0, l.h / 2, -1, g); box(l.w - 1, 2, 3, glass, 0, 1, l.d / 2 - 1.5, g); box(l.w * 0.5, 3, l.d * 0.5, gold, 0, l.h + 1.5, -1, g); box(l.w - 4, 0.12, 2.6, pool, 0, 0.12, l.d / 2 + 1, g); }
    else { box(l.w - 3, l.h * 0.5, l.d - 3, white, -1, l.h * 0.25, -1, g); box(l.w * 0.5, l.h * 0.5, l.d * 0.5, white, 1.5, l.h * 0.75, -1.5, g); box(l.w - 5, 0.4, l.d - 5, glass, -1, l.h * 0.5 + 0.2, -1, g); box(l.w * 0.6, 0.12, 2.4, pool, 0, 0.12, l.d / 2 - 1.4, g); }
    propTop.set(l.id, [l.x, l.h + 3, l.z]);
  }
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

  // Christmas theme (request #17): snow and a decorated tree by the resort casino; no frost layer on the beach.
  const xmas = xmasOn() ? addXmas(scene, { tier, half: 130, roofs: [], frost: false, footprints: RESORT_SPOTS.filter((s) => s.id !== 'r-pier' && s.id !== 'r-marina').map((s) => ({ x: s.x, z: s.z, w: s.w, d: s.d, rot: 0, top: 0 })), decor: [{ x: -20, z: -4, scale: 1.1, big: true }, { x: 20, z: -4, scale: 1.1 }, { x: 108, z: -58, scale: 0.8 }] }) : null;
  const clock = new THREE.Clock(); let raf = 0; let running = true; let time = 0; const tmp = new THREE.Vector3();
  const frame = () => {
    raf = requestAnimationFrame(frame); if (!running) return; const dt = Math.min(clock.getDelta(), 0.05); time += dt;
    xmas?.step(dt); waterMat.uniforms.uTime!.value = time; yachts.forEach((y, i) => { y.position.y = 0.3 + Math.sin(time * 1.1 + i) * 0.12; y.rotation.z = Math.sin(time * 0.9 + i * 2) * 0.02; });
    controls.update(); clampPan();
    const portrait = (canvas.clientWidth || 1) < (canvas.clientHeight || 1);
    for (const s of signs) { const k = labelScale(camera.position.distanceTo(s.getWorldPosition(tmp)), portrait) * (s.userData.k as number); s.scale.set(k, k / 4 * ((s.material.map!.image as { height: number }).height / 128), 1); }
    renderScene(renderer, composer, scene, camera);
  };
  const vis = () => { running = !document.hidden; clock.getDelta(); }; document.addEventListener('visibilitychange', vis); frame();
  return {
    setFarm, setOwned, lotIds,
    setRunning(v: boolean) { running = v; clock.getDelta(); },
    reset() { camera.position.copy(home); controls.target.copy(homeT); },
    dispose() { xmas?.dispose(); cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave); controls.dispose(); disposables.forEach((x) => x.dispose()); composer?.dispose(); renderer.dispose(); },
  };
}
