/**
 * Fishing3D: the lake seen from the end of the dock (pt1220u). Pure view: the React HUD (Fishing3DGame) drives it with
 * the game phase and the live reel state; the server still rolls every fish and replays the reel inputs.
 * Third-person angler on the pier, rod that bends with line tension, cast arc + bobber + splashes, a fish shadow that
 * runs left/right during the fight (jumps for rare+), and a 3D model of the catch (per species; glowing Crystal Koi,
 * Old Chud the lake monster).
 */
import * as THREE from 'three';
import { DOCK, inLake, LAKE, lakeShape } from '../../../shared/outskirts';
import { fishById, type Rarity } from '../../../shared/fishing';

export type View3DPhase = 'idle' | 'charge' | 'flying' | 'wait' | 'bite' | 'reel' | 'show';
const TIP_LEN = 3.2;
/** The angler stands at the pier end, facing the open water (-z). */
export const STAND = new THREE.Vector3(DOCK.x, 1.15, DOCK.pierZ0 + 1.6);
const RARE: Rarity[] = ['rare', 'epic', 'legendary'];

const FISH_LOOK: Record<string, { color: number; belly: number; len: number; fat: number; spots?: number; glow?: number }> = {
  bluegill: { color: 0x3f6f9a, belly: 0xf2c14e, len: 0.9, fat: 0.55 }, perch: { color: 0x8a9a2c, belly: 0xf4e3a1, len: 1, fat: 0.4, spots: 0x2d3a10 },
  sunfish: { color: 0x2f8f78, belly: 0xff9a3c, len: 0.8, fat: 0.6 }, bass: { color: 0x4b6b2a, belly: 0xdfe8c0, len: 1.2, fat: 0.42 },
  trout: { color: 0x7c8f9c, belly: 0xff8fb0, len: 1.15, fat: 0.33, spots: 0x223 }, catfish: { color: 0x575049, belly: 0xc9c0b0, len: 1.4, fat: 0.36 },
  walleye: { color: 0xb59a3b, belly: 0xf0ead0, len: 1.25, fat: 0.32 }, pike: { color: 0x3d6b3a, belly: 0xe9f0c8, len: 1.7, fat: 0.24, spots: 0xd8e6a0 },
  salmon: { color: 0x8aa0b4, belly: 0xf3d4cf, len: 1.5, fat: 0.34, spots: 0x223 }, sturgeon: { color: 0x5a5f66, belly: 0xb9b6ad, len: 2.2, fat: 0.26 },
  goldcarp: { color: 0xffb21e, belly: 0xffe08a, len: 1.3, fat: 0.48, glow: 0x553300 }, koi: { color: 0xe8f6ff, belly: 0xff5f3c, len: 1.4, fat: 0.42, glow: 0x66ccff },
};

function noiseTex(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(220,240,255,.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}

export class Fishing3D {
  readonly renderer: THREE.WebGLRenderer; readonly scene = new THREE.Scene(); readonly camera: THREE.PerspectiveCamera;
  private disposables: Array<{ dispose(): void }> = [];
  private waterMat: THREE.ShaderMaterial; private t = 0;
  private angler = new THREE.Group(); private rodPts: THREE.Vector3[] = []; private rod: THREE.Mesh; private rodGeo: THREE.BufferGeometry | null = null;
  private line: THREE.Line; private lineGeo = new THREE.BufferGeometry(); private bobber = new THREE.Group();
  private shadow: THREE.Mesh; private splashes: Array<{ ring: THREE.Mesh; drops: THREE.Points; vel: Float32Array; age: number; life: number }> = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 40); private dropTex = noiseTex();
  private catchGroup = new THREE.Group(); private catchLight = new THREE.PointLight(0x66ccff, 0, 12);
  private others = new Map<string, { g: THREE.Group; tag: THREE.Sprite }>();
  // view state
  phase: View3DPhase = 'idle'; yaw = 0; power = 0; tension = 0; private bob = new THREE.Vector3(); private target = new THREE.Vector3();
  private flight: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  private fishPos = new THREE.Vector3(); private fishVel = new THREE.Vector3(); private jump = { t: -1, h: 0 }; private reelProg = 0; private reelC = 0.5;
  private rare = false; private nibbleAt = 0; private nibble = 0; private dip = 0; private camShake = 0;
  onSplash: ((big: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    const s = this.scene; s.fog = new THREE.FogExp2(0x0b0f2a, 0.0125);
    // sky dome: deep indigo → neon magenta horizon, stars, moon
    const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: {}, vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vD; void main(){ float h = clamp(vD.y, -0.2, 1.0); vec3 top = vec3(0.02,0.03,0.10), mid = vec3(0.07,0.06,0.22), hor = vec3(0.42,0.13,0.42); vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.8, h)); gl_FragColor = vec4(c,1.0); }' });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat); sky.position.copy(STAND); s.add(sky); this.track(skyMat, sky.geometry);
    const starG = new THREE.BufferGeometry(); const sp: number[] = [];
    for (let i = 0; i < 700; i++) { const a = Math.random() * Math.PI * 2, e = 0.08 + Math.random() * 1.3; sp.push(Math.cos(a) * Math.cos(e) * 380, Math.sin(e) * 380, Math.sin(a) * Math.cos(e) * 380); }
    starG.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); const starM = new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 });
    const stars = new THREE.Points(starG, starM); stars.position.copy(STAND); s.add(stars); this.track(starG, starM);
    const moonPos = new THREE.Vector3(STAND.x - 70, 38, STAND.z - 260);
    const moonM = new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }); const moon = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 12), moonM); moon.position.copy(moonPos); s.add(moon); this.track(moonM, moon.geometry);
    // lights
    s.add(new THREE.HemisphereLight(0x8a7cff, 0x10220f, 0.75));
    const key = new THREE.DirectionalLight(0xcfd8ff, 1.1); key.position.set(moonPos.x, 80, moonPos.z + 120); s.add(key);
    const lamp = new THREE.PointLight(0xffc477, 18, 16, 1.6); lamp.position.set(DOCK.x + 1.6, 3.6, DOCK.pierZ0 + 1.2); s.add(lamp);
    const neon = new THREE.PointLight(0x4fc3d9, 25, 22, 1.6); neon.position.set(DOCK.x, 4, DOCK.z - 4); s.add(neon);
    // water: the river/lake shader + moon streak reflection and a fresnel sky tint
    this.waterMat = new THREE.ShaderMaterial({ fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uMoon: { value: moonPos }, uRip: { value: new THREE.Vector4(0, 0, -100, 0) } }]),
      vertexShader: `varying vec2 vP; varying vec3 vW; #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(/#include <[^>]+>/g, (m) => `\n${m}\n`),
      fragmentShader: `uniform float uTime; uniform vec3 uMoon; uniform vec4 uRip; varying vec2 vP; varying vec3 vW; #include <fog_pars_fragment>
        void main(){
          float w = sin(vP.x*0.55+uTime*0.9)*0.5 + sin(vP.x*1.3-vP.y*0.8+uTime*1.6)*0.3 + sin(vP.y*2.1+uTime*1.1)*0.2;
          float rd = distance(vP, uRip.xy); float rip = uRip.w * sin(rd*7.0 - (uTime-uRip.z)*9.0) * exp(-rd*0.6) * step(rd, (uTime-uRip.z)*3.0+0.5);
          w += rip*1.6;
          vec3 deep = vec3(0.02,0.06,0.16), shallow = vec3(0.05,0.16,0.34); vec3 c = mix(deep, shallow, w*0.5+0.5);
          vec3 V = normalize(cameraPosition - vW); float fres = pow(1.0 - max(V.y, 0.0), 3.0); c = mix(c, vec3(0.30,0.12,0.38), fres*0.55);
          vec3 N = normalize(vec3(cos(vP.x*1.3+uTime)*0.08 + rip*0.25, 1.0, sin(vP.y*1.7-uTime*1.3)*0.08));
          vec3 L = normalize(uMoon - vW); vec3 H = normalize(L + V); float spec = pow(max(dot(N,H),0.0), 220.0);
          float glint = pow(max(0.0, sin(vP.x*2.7+uTime*2.3)*sin(vP.y*3.1-uTime*1.7)), 40.0);
          gl_FragColor = vec4(c + spec*vec3(1.0,0.95,0.8)*2.2 + glint*vec3(0.35,0.42,0.55), 1.0);
          #include <fog_fragment>
        }`.replace(/#include <[^>]+>/g, (m) => `\n${m}\n`) });
    const shape = new THREE.Shape(lakeShape().map(([x, z]) => new THREE.Vector2(x, -z)));
    const wg = new THREE.ShapeGeometry(shape, 8); wg.rotateX(-Math.PI / 2); const water = new THREE.Mesh(wg, this.waterMat); water.position.y = 0.05; s.add(water); this.track(wg, this.waterMat);
    // ground + bank ring
    const groundM = new THREE.MeshLambertMaterial({ color: 0x1f5a2a }); const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), groundM); ground.rotation.x = -Math.PI / 2; ground.position.set(LAKE.x, -0.02, LAKE.z); s.add(ground); this.track(groundM, ground.geometry);
    const ring = lakeShape(); const bp: number[] = [], bc: number[] = [], bi: number[] = []; const cols = [[0.36, 0.3, 0.2], [0.62, 0.55, 0.38], [0.55, 0.5, 0.32], [0.14, 0.36, 0.17]]; const offs = [-1.2, 1, 2.6, 4.2], ys = [-0.15, 0.03, 0.06, 0.0];
    ring.forEach(([x, z]) => { const dx = x - LAKE.x, dz = z - LAKE.z, d = Math.hypot(dx, dz); offs.forEach((o, k) => { bp.push(x + dx / d * o, ys[k]!, z + dz / d * o); bc.push(...cols[k]!); }); });
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = j * 4 + k; bi.push(a, b, a + 1, b, b + 1, a + 1); } }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3)); bg.setIndex(bi); bg.computeVertexNormals();
    const bm = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }); s.add(new THREE.Mesh(bg, bm)); this.track(bg, bm);
    // trees, reeds, rocks, lilies around the shore (deterministic)
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const trunkG = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6), leafG = new THREE.IcosahedronGeometry(1.5, 0), trunkM = new THREE.MeshLambertMaterial({ color: 0x4a3423 }), leafM = new THREE.MeshLambertMaterial({ color: 0x1d5c2c, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, 90), leaves = new THREE.InstancedMesh(leafG, leafM, 90); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < 400 && n < 90; i++) { const a = rnd() * Math.PI * 2, r = 1.15 + rnd() * 0.9; const x = LAKE.x + Math.cos(a) * LAKE.rx * r, z = LAKE.z + Math.sin(a) * LAKE.rz * r * 1.6;
      if (inLake(x, z, 5) || (Math.abs(x - DOCK.x) < 9 && z > DOCK.pierZ0 - 2)) continue; const k = 0.8 + rnd() * 0.9;
      m4.compose(v.set(x, 0.8 * k, z), q.identity(), sc.set(k, k, k)); trunks.setMatrixAt(n, m4); m4.compose(v.set(x, 2.4 * k, z), q.setFromEuler(new THREE.Euler(rnd(), rnd(), 0)), sc.set(k, k * 1.2, k)); leaves.setMatrixAt(n, m4); n++; }
    trunks.count = leaves.count = n; s.add(trunks, leaves); this.track(trunkG, leafG, trunkM, leafM);
    const reedG = new THREE.CylinderGeometry(0.03, 0.05, 1.6, 4); reedG.translate(0, 0.8, 0); const reedM = new THREE.MeshLambertMaterial({ color: 0x6a8a3a }); const reeds = new THREE.InstancedMesh(reedG, reedM, 220);
    const headG = new THREE.CapsuleGeometry(0.07, 0.25, 2, 6); const headM = new THREE.MeshLambertMaterial({ color: 0x5a3a1e }); const heads = new THREE.InstancedMesh(headG, headM, 220); n = 0;
    for (let i = 0; i < 900 && n < 220; i++) { const [px, pz] = ring[Math.floor(rnd() * ring.length)]!; const x = px + (rnd() - 0.5) * 3, z = pz + (rnd() - 0.5) * 3;
      if (Math.abs(x - DOCK.x) < 5 && z > DOCK.pierZ0 - 3) continue; const k = 0.7 + rnd() * 0.7; const tilt = new THREE.Euler((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3);
      m4.compose(v.set(x, -0.1, z), q.setFromEuler(tilt), sc.set(1, k, 1)); reeds.setMatrixAt(n, m4); const top = new THREE.Vector3(0, 1.5 * k, 0).applyEuler(tilt); m4.compose(v.set(x + top.x, top.y - 0.1, z + top.z), q, sc.set(1, 1, 1)); heads.setMatrixAt(n, m4); n++; }
    reeds.count = heads.count = n; s.add(reeds, heads); this.track(reedG, reedM, headG, headM);
    const lilyG = new THREE.CircleGeometry(0.45, 10, 0.3, Math.PI * 1.8); lilyG.rotateX(-Math.PI / 2); const lilyM = new THREE.MeshLambertMaterial({ color: 0x2f7d3a }); const lilies = new THREE.InstancedMesh(lilyG, lilyM, 40); n = 0;
    for (let i = 0; i < 300 && n < 40; i++) { const a = rnd() * Math.PI * 2, r = 0.55 + rnd() * 0.35; const x = LAKE.x + Math.cos(a) * LAKE.rx * r, z = LAKE.z + Math.sin(a) * LAKE.rz * r; if (!inLake(x, z, -1) || Math.abs(x - DOCK.x) < 6) continue; m4.compose(v.set(x, 0.08, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), sc.set(1, 1, 1)); lilies.setMatrixAt(n++, m4); }
    lilies.count = n; s.add(lilies); this.track(lilyG, lilyM);
    // pier + boathouse
    const plankM = new THREE.MeshLambertMaterial({ color: 0x6b4a2e }); const postM = new THREE.MeshLambertMaterial({ color: 0x3b2a1c });
    const pierLen = DOCK.pierZ1 - DOCK.pierZ0; const pier = new THREE.Mesh(new THREE.BoxGeometry(DOCK.pierW, 0.2, pierLen + 6), plankM); pier.position.set(DOCK.x, 0.55, (DOCK.pierZ0 + DOCK.pierZ1) / 2 + 3); s.add(pier);
    const plat = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 4), plankM); plat.position.set(DOCK.x, 0.55, DOCK.pierZ0 + 1.6); s.add(plat); this.track(plankM, postM, pier.geometry, plat.geometry);
    const postG = new THREE.CylinderGeometry(0.14, 0.14, 1.8, 6); this.track(postG);
    for (let z = DOCK.pierZ0; z <= DOCK.pierZ1 + 4; z += 2.5) for (const sx of [-1, 1]) { const p = new THREE.Mesh(postG, postM); p.position.set(DOCK.x + sx * (DOCK.pierW / 2), -0.2, z); s.add(p); }
    for (const sx of [-1, 1]) for (const sz of [0, 1]) { const p = new THREE.Mesh(postG, postM); p.position.set(DOCK.x + sx * 3.4, -0.2, DOCK.pierZ0 + sz * 3.2); s.add(p); }
    const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3, 6), postM); lampPole.position.set(DOCK.x - 3.2, 2, DOCK.pierZ0 + 0.4); s.add(lampPole); this.track(lampPole.geometry);
    const bulbM = new THREE.MeshBasicMaterial({ color: 0xffd9a0 }); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbM); bulb.position.set(DOCK.x - 3.2, 3.55, DOCK.pierZ0 + 0.4); s.add(bulb); lamp.position.copy(bulb.position); this.track(bulbM, bulb.geometry);
    const wallM = new THREE.MeshLambertMaterial({ color: 0x2a2730 }), roofM = new THREE.MeshLambertMaterial({ color: 0x5a1f2c }); this.track(wallM, roofM);
    const house = new THREE.Mesh(new THREE.BoxGeometry(7, 3.6, 6), wallM); house.position.set(DOCK.x, 1.8, DOCK.z - 1); s.add(house); this.track(house.geometry);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.2, 4), roofM); roof.rotation.y = Math.PI / 4; roof.position.set(DOCK.x, 4.7, DOCK.z - 1); s.add(roof); this.track(roof.geometry);
    const signM = new THREE.MeshBasicMaterial({ color: 0x4fc3d9 }); const sign = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 0.1), signM); sign.position.set(DOCK.x, 3.0, DOCK.z - 4.05); s.add(sign); this.track(signM, sign.geometry);
    // rowboat
    const boatM = new THREE.MeshLambertMaterial({ color: 0x8a3b2b }); const boat = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 2.4, 3, 8), boatM); boat.rotation.z = Math.PI / 2; boat.scale.set(1, 1, 0.5); boat.rotation.y = 0.3; boat.position.set(DOCK.x - 3.6, 0.15, DOCK.pierZ0 + 6); s.add(boat); this.track(boatM, boat.geometry);
    // angler: body, head, cap, arms
    const skinM = new THREE.MeshLambertMaterial({ color: 0xd9a27a }), shirtM = new THREE.MeshLambertMaterial({ color: 0x2f6fb0 }), capM = new THREE.MeshLambertMaterial({ color: 0xff5f8a }), pantsM = new THREE.MeshLambertMaterial({ color: 0x2b2d3a });
    this.track(skinM, shirtM, capM, pantsM);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), pantsM); legs.position.y = 0.4;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 3, 8), shirtM); torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinM); head.position.y = 1.75;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), capM); cap.position.y = 1.8; const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.25), capM); brim.position.set(0, 1.82, -0.25);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.5, 2, 6), shirtM); arm.position.set(0.22, 1.2, -0.3); arm.rotation.x = -1.1;
    const arm2 = arm.clone(); arm2.position.x = -0.18;
    for (const m of [legs, torso, head, cap, brim, arm, arm2]) this.track(m.geometry);
    this.angler.add(legs, torso, head, cap, brim, arm, arm2); this.angler.position.set(STAND.x, 0.65, STAND.z); s.add(this.angler);
    const rodM = new THREE.MeshLambertMaterial({ color: 0x1b1b1b }); this.rod = new THREE.Mesh(new THREE.BufferGeometry(), rodM); s.add(this.rod); this.track(rodM);
    for (let i = 0; i <= 8; i++) this.rodPts.push(new THREE.Vector3());
    const lineM = new THREE.LineBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.85 }); this.line = new THREE.Line(this.lineGeo, lineM); this.line.frustumCulled = false; s.add(this.line); this.track(this.lineGeo, lineM);
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
    // bobber
    const redM = new THREE.MeshLambertMaterial({ color: 0xff3048, emissive: 0x330008 }), whiteM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), redM); const bot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), whiteM);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), redM); stick.position.y = 0.2; this.bobber.add(top, bot, stick); this.bobber.visible = false; s.add(this.bobber); this.track(redM, whiteM, top.geometry, bot.geometry, stick.geometry);
    // fish shadow under the water during the fight
    const shM = new THREE.MeshBasicMaterial({ color: 0x000814, transparent: true, opacity: 0.55, depthWrite: false }); const shG = new THREE.CircleGeometry(1, 20); shG.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(shG, shM); this.shadow.visible = false; this.shadow.renderOrder = 2; s.add(this.shadow); this.track(shM, shG, this.ringGeo, this.dropTex);
    this.catchGroup.visible = false; s.add(this.catchGroup); this.catchLight.position.set(0, 0.5, 1.5); this.catchGroup.add(this.catchLight);
    this.resize();
  }
  private track(...d: Array<{ dispose(): void }>) { this.disposables.push(...d); }
  resize() { const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  /** Where a cast with this aim (radians, 0 = straight out) and power (0..1) lands, kept inside the water. */
  landing(yaw: number, power: number): THREE.Vector3 {
    let d = 4 + power * 15; const dir = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const p = new THREE.Vector3(); for (; d > 3; d -= 0.5) { p.set(STAND.x + dir.x * d, 0.1, STAND.z + dir.z * d); if (inLake(p.x, p.z, -1.5)) break; }
    return p;
  }
  cast(power: number) { const to = this.landing(this.yaw, power); this.target.copy(to); this.flight = { from: this.tipPos(), to, t: 0, dur: 0.55 + power * 0.5 }; this.phase = 'flying'; this.bobber.visible = true; this.catchGroup.visible = false; }
  setPhase(p: View3DPhase) {
    this.phase = p;
    if (p === 'idle' || p === 'charge') { this.bobber.visible = false; this.shadow.visible = false; this.flight = null; this.tension = 0; }
    if (p === 'bite') { this.dip = 1; this.splash(this.bob, false); this.nibbleAt = 1e9; }
    if (p === 'wait') this.nibbleAt = this.t + 0.8 + Math.random() * 1.5;
    if (p === 'reel') { this.fishPos.copy(this.bob).setY(-0.5); this.fishVel.set(0, 0, 0); this.shadow.visible = true; this.bobber.visible = false; this.splash(this.bob, true); }
  }
  /** Live fight state from the reel sim: x = line/hook position (0..1), c = fish's zone centre, h = zone half-width, prog = catch bar. */
  setReel(x: number, c: number, h: number, prog: number, hold: boolean, rare: boolean) {
    this.rare = rare; this.reelProg = prog; this.reelC = c;
    const inZone = Math.abs(x - c) <= h; this.tension = Math.min(1, Math.max(0, (hold ? 0.55 : 0.25) + (x - c) * 0.9 + (inZone ? 0 : 0.2)));
  }
  showCatch(fishId: string, grams: number) {
    const g = this.catchGroup; for (const ch of [...g.children]) if (ch !== this.catchLight) { g.remove(ch); ch.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mt = m.material as THREE.Material | undefined; if (mt) mt.dispose(); }); }
    const f = fishById(fishId); const model = buildFish(fishId, grams); g.add(model);
    this.catchLight.intensity = fishId === 'koi' ? 30 : fishId === 'goldcarp' ? 12 : fishId === 'oldchud' ? 20 : 0; this.catchLight.color.set(fishId === 'oldchud' ? 0x66ff44 : fishId === 'goldcarp' ? 0xffb21e : 0x66ccff);
    g.position.set(STAND.x + Math.cos(this.yaw) * 1.6 + Math.sin(this.yaw) * 0.6, 2.3, STAND.z + Math.sin(this.yaw) * 1.6 - Math.cos(this.yaw) * 0.6); g.visible = true; this.shadow.visible = false; this.bobber.visible = false; this.phase = 'show'; this.splash(new THREE.Vector3(STAND.x, 0.1, STAND.z - 3), true);
    void f;
  }
  hideCatch() { this.catchGroup.visible = false; }
  /** Other anglers on the dock (world presence): name tags floating above simple figures. */
  setOthers(list: Array<{ name: string; slot: number }>) {
    const keep = new Set(list.map((o) => o.name));
    for (const [k, o] of this.others) if (!keep.has(k)) { this.scene.remove(o.g); this.others.delete(k); }
    list.forEach((o, i) => { let e = this.others.get(o.name);
      if (!e) { const g = this.angler.clone(); const tag = makeTag(o.name); tag.position.y = 2.5; g.add(tag); this.scene.add(g); e = { g, tag }; this.others.set(o.name, e); }
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2); e.g.position.set(DOCK.x + side * (2.2 + (row % 2) * 0.6), 0.65, DOCK.pierZ0 + 1.2 + row * 2.6); e.g.rotation.y = side * -0.4; });
  }
  private tipPos(): THREE.Vector3 { return this.rodPts[this.rodPts.length - 1]!.clone(); }
  private splash(at: THREE.Vector3, big: boolean) {
    const rm = new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this.ringGeo, rm); ring.rotation.x = -Math.PI / 2; ring.position.set(at.x, 0.09, at.z); this.scene.add(ring);
    const N = big ? 46 : 22; const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos.set([at.x, 0.12, at.z], i * 3); const a = Math.random() * Math.PI * 2, sp = (big ? 2.2 : 1.2) * (0.4 + Math.random()); vel.set([Math.cos(a) * sp, (big ? 4.5 : 2.6) * (0.5 + Math.random()), Math.sin(a) * sp], i * 3); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dm = new THREE.PointsMaterial({ map: this.dropTex, size: big ? 0.35 : 0.22, transparent: true, depthWrite: false, color: 0xdff4ff });
    const drops = new THREE.Points(dg, dm); this.scene.add(drops); this.splashes.push({ ring, drops, vel, age: 0, life: big ? 1.3 : 0.9 });
    const u = this.waterMat.uniforms.uRip!.value as THREE.Vector4; u.set(at.x, at.z, this.t, big ? 0.6 : 0.35); this.onSplash?.(big);
  }

  step(dt: number) {
    this.t += dt; const t = this.t; this.waterMat.uniforms.uTime!.value = t;
    // angler faces the aim; the rod bends toward the line with tension
    this.angler.rotation.y = -this.yaw;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const grip = new THREE.Vector3(STAND.x, 1.75, STAND.z).addScaledVector(fwd, 0.45).addScaledVector(right, 0.2);
    let lift = 1.05; if (this.phase === 'charge') lift = 1.05 + 0.9 * this.power; if (this.phase === 'flying' && this.flight && this.flight.t < 0.25) lift = 0.3;
    const bend = this.phase === 'reel' ? 0.25 + this.tension * 1.1 : this.phase === 'bite' ? 0.5 : 0.08 + (this.phase === 'charge' ? -0.15 * this.power : 0);
    const pull = this.phase === 'reel' ? this.fishPos.clone().sub(grip).setY(0).normalize() : fwd;
    for (let i = 0; i <= 8; i++) { const u = i / 8; const p = this.rodPts[i]!; const ang = lift * (1 - u * 0.2) - bend * u * u * 1.6;
      p.copy(grip).addScaledVector(fwd, Math.cos(ang) * TIP_LEN * u * (this.phase === 'charge' ? -0.4 * this.power + 1 : 1)).setY(grip.y + Math.sin(ang) * TIP_LEN * u);
      if (this.phase === 'reel') p.addScaledVector(pull.clone().sub(fwd), u * u * this.tension * 0.9); }
    this.rodGeo?.dispose(); this.rodGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(this.rodPts), 16, 0.035, 5, false); this.rod.geometry = this.rodGeo;
    const tip = this.tipPos();
    // bobber flight / bob / nibble / bite dip
    if (this.flight) { const f = this.flight; f.t += dt / f.dur; const u = Math.min(1, f.t); this.bob.lerpVectors(f.from, f.to, u); this.bob.y = THREE.MathUtils.lerp(f.from.y, f.to.y, u) + Math.sin(u * Math.PI) * (2 + f.dur * 3);
      if (u >= 1) { this.flight = null; this.splash(f.to, false); if (this.phase === 'flying') this.phase = 'wait'; } }
    else if (this.phase === 'wait' || this.phase === 'bite') {
      if (this.phase === 'wait' && t > this.nibbleAt) { this.nibble = 1; this.nibbleAt = t + 0.6 + Math.random() * 1.8; }
      this.nibble = Math.max(0, this.nibble - dt * 3); this.dip = Math.max(0, this.dip - dt * 0.6);
      this.bob.set(this.target.x + Math.sin(t * 40) * 0.03 * this.nibble, 0.1 + Math.sin(t * 2.2) * 0.04 - this.nibble * 0.12 - (this.phase === 'bite' ? 0.32 + Math.sin(t * 18) * 0.06 : 0), this.target.z);
    }
    this.bobber.position.copy(this.bob); this.bobber.rotation.z = Math.sin(t * 1.7) * 0.12 + this.nibble * 0.4;
    // fight: the fish runs left/right with the reel zone (c) and comes closer as the catch bar fills
    let end = this.bob;
    if (this.phase === 'reel') {
      const dist = 2.5 + (1 - this.reelProg) * Math.max(3, this.target.distanceTo(new THREE.Vector3(STAND.x, 0.1, STAND.z)) - 2.5);
      const lat = (this.reelC - 0.5) * 2 * Math.min(9, dist * 0.8);
      const want = new THREE.Vector3(STAND.x, -0.4, STAND.z).addScaledVector(fwd, dist).addScaledVector(right, lat);
      if (!inLake(want.x, want.z, -1)) want.lerp(new THREE.Vector3(STAND.x, -0.4, STAND.z).addScaledVector(fwd, dist), 0.7);
      this.fishVel.lerp(want.clone().sub(this.fishPos).multiplyScalar(2.5), Math.min(1, dt * 4)); this.fishPos.addScaledVector(this.fishVel, dt);
      if (this.jump.t < 0 && this.rare && Math.random() < dt * 0.35) { this.jump = { t: 0, h: 1.6 + Math.random() * 1.2 }; this.splash(this.fishPos, true); this.camShake = 0.4; }
      let y = -0.4; if (this.jump.t >= 0) { this.jump.t += dt / 0.9; y = Math.sin(Math.min(1, this.jump.t) * Math.PI) * this.jump.h; if (this.jump.t >= 1) { this.jump.t = -1; this.splash(this.fishPos, true); } }
      else if (Math.random() < dt * 2.2) this.splash(this.fishPos.clone().setY(0), false);
      this.fishPos.y = y; this.shadow.position.set(this.fishPos.x, 0.08, this.fishPos.z); const sp = Math.atan2(this.fishVel.x, this.fishVel.z); this.shadow.rotation.y = sp; this.shadow.scale.set(0.35, 1, 0.9);
      end = this.fishPos.clone().setY(Math.max(0.08, y));
    }
    // line: sagging when slack, straight under tension
    const lp = this.lineGeo.getAttribute('position') as THREE.BufferAttribute; const showLine = this.phase !== 'idle' && this.phase !== 'charge' && this.phase !== 'show';
    this.line.visible = showLine; const sag = this.phase === 'reel' ? 0.3 * (1 - this.tension) : this.phase === 'bite' ? 0.2 : 1.2;
    for (let i = 0; i < 25; i++) { const u = i / 24; lp.setXYZ(i, tip.x + (end.x - tip.x) * u, tip.y + (end.y - tip.y) * u - Math.sin(u * Math.PI) * sag * tip.distanceTo(end) * 0.12, tip.z + (end.z - tip.z) * u); }
    lp.needsUpdate = true; (this.line.material as THREE.LineBasicMaterial).color.setHSL(this.phase === 'reel' ? 0.0 + (1 - this.tension) * 0.55 : 0.55, this.phase === 'reel' ? this.tension : 0.2, 0.9 - this.tension * 0.25);
    // splashes
    for (let i = this.splashes.length - 1; i >= 0; i--) { const s = this.splashes[i]!; s.age += dt; const u = s.age / s.life;
      s.ring.scale.setScalar(0.3 + u * 2.4); (s.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - u);
      const p = s.drops.geometry.getAttribute('position') as THREE.BufferAttribute; for (let k = 0; k < p.count; k++) { s.vel[k * 3 + 1]! -= 9.8 * dt; p.setXYZ(k, p.getX(k) + s.vel[k * 3]! * dt, Math.max(0.05, p.getY(k) + s.vel[k * 3 + 1]! * dt), p.getZ(k) + s.vel[k * 3 + 2]! * dt); } p.needsUpdate = true;
      (s.drops.material as THREE.PointsMaterial).opacity = 1 - u;
      if (u >= 1) { this.scene.remove(s.ring, s.drops); (s.ring.material as THREE.Material).dispose(); s.drops.geometry.dispose(); (s.drops.material as THREE.Material).dispose(); this.splashes.splice(i, 1); } }
    // caught fish: dangles and turns in front of the camera
    if (this.catchGroup.visible) { this.catchGroup.rotation.y += dt * 0.9; this.catchGroup.rotation.z = Math.sin(t * 3) * 0.12; this.catchGroup.position.y = 2.3 + Math.sin(t * 2) * 0.08; }
    // camera: over the shoulder, looking where you aim (and toward the fish during the fight)
    const look = this.phase === 'reel' ? this.fishPos.clone().setY(0) : this.phase === 'show' ? this.catchGroup.position.clone() : new THREE.Vector3(STAND.x, 0, STAND.z).addScaledVector(fwd, 12);
    const camPos = this.phase === 'show' ? this.catchGroup.position.clone().addScaledVector(fwd, -3.4).addScaledVector(right, -0.6).setY(3.0)
      : new THREE.Vector3(STAND.x, this.phase === 'reel' ? 5.2 : 4.6, STAND.z).addScaledVector(fwd, -6).addScaledVector(right, 2.1);
    this.camShake = Math.max(0, this.camShake - dt); if (this.camShake > 0) camPos.add(new THREE.Vector3((Math.random() - 0.5) * this.camShake * 0.3, (Math.random() - 0.5) * this.camShake * 0.3, 0));
    this.camera.position.lerp(camPos, Math.min(1, dt * 4)); const cur = this.camLook ?? look.clone(); cur.lerp(look, Math.min(1, dt * 3)); this.camLook = cur; this.camera.lookAt(cur);
    this.renderer.render(this.scene, this.camera);
  }
  private camLook: THREE.Vector3 | null = null;
  dispose() {
    this.rodGeo?.dispose(); for (const d of this.disposables) d.dispose();
    for (const s of this.splashes) { (s.ring.material as THREE.Material).dispose(); s.drops.geometry.dispose(); (s.drops.material as THREE.Material).dispose(); }
    this.catchGroup.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    for (const o of this.others.values()) { (o.tag.material as THREE.SpriteMaterial).map?.dispose(); o.tag.material.dispose(); }
    this.renderer.dispose();
  }
}

function makeTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,14,40,.75)'; g.beginPath(); g.roundRect(4, 10, 248, 44, 16); g.fill(); g.fillStyle = '#e8f6ff'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillText(name.slice(0, 16), 128, 42);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false })); sp.scale.set(2, 0.5, 1); return sp;
}

/** A 3D model of a catch: species colours and shape, scaled by weight. Junk gets its own props. */
export function buildFish(id: string, grams: number): THREE.Group {
  const g = new THREE.Group(); const f = fishById(id); const kg = grams / 1000;
  if (id === 'boot') { const m = new THREE.MeshLambertMaterial({ color: 0x4a3524 }); const a = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.3), m); const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.7), m); b.position.set(0, -0.2, 0.2); g.add(a, b); return g; }
  if (id === 'can') { const m = new THREE.MeshLambertMaterial({ color: 0x8a5a3a }); g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.45, 14), m)); return g; }
  if (id === 'weeds') { const m = new THREE.MeshLambertMaterial({ color: 0x3f7a2f, side: THREE.DoubleSide }); for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.9), m); s.position.x = (i - 3) * 0.05; s.rotation.z = (i - 3) * 0.12; g.add(s); } return g; }
  if (id === 'oldchud') { // the lake monster: big, dark, spiky, glowing eyes
    const skin = new THREE.MeshStandardMaterial({ color: 0x1f3a22, roughness: 0.6, emissive: 0x0a2a08, flatShading: true }); const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), skin); body.scale.set(0.8, 0.75, 1.9); g.add(body);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0xff2a2a }); for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), eyeM); e.position.set(sx * 0.35, 0.3, 1.45); g.add(e); }
    const spikeM = new THREE.MeshStandardMaterial({ color: 0x86ff4a, emissive: 0x2f7a10 }); for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), spikeM); s.position.set(0, 0.65, 1.1 - i * 0.45); g.add(s); }
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.6, 6), spikeM); jaw.rotation.x = Math.PI / 2; jaw.position.set(0, -0.15, 1.6); g.add(jaw);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1, 4), skin); tail.rotation.x = -Math.PI / 2; tail.scale.set(0.2, 1, 1); tail.position.z = -2; g.add(tail);
    g.scale.setScalar(0.9); g.rotation.y = Math.PI / 2; return g;
  }
  const look = FISH_LOOK[id] ?? FISH_LOOK.bluegill!; const rare = f && RARE.includes(f.rarity);
  const mat = new THREE.MeshStandardMaterial({ color: look.color, roughness: 0.35, metalness: rare ? 0.35 : 0.15, emissive: look.glow ?? 0x000000, emissiveIntensity: look.glow ? 1.2 : 0 });
  const belly = new THREE.MeshStandardMaterial({ color: look.belly, roughness: 0.4, emissive: id === 'koi' ? 0x661100 : 0x000000 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), mat); body.scale.set(look.fat * 0.8, look.fat * 1.4, look.len); g.add(body);
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), belly); under.scale.copy(body.scale).multiplyScalar(1.02); g.add(under);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(look.fat * 0.75, look.len * 0.45, 4), mat); tail.rotation.x = Math.PI / 2; tail.scale.set(0.15, 1, 1); tail.position.z = -look.len * 0.6; g.add(tail);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(look.len * 0.18, look.fat * 0.6, 3), mat); fin.scale.set(0.15, 1, 2); fin.position.set(0, look.fat * 0.75, 0); g.add(fin);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x111111 }); for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeM); e.position.set(sx * look.fat * 0.34, look.fat * 0.12, look.len * 0.36); g.add(e); }
  if (look.spots) { const sm = new THREE.MeshBasicMaterial({ color: look.spots }); for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), sm); const a = (i % 2 ? 1 : -1) * look.fat * 0.4; s.position.set(a, (Math.sin(i * 2.3)) * look.fat * 0.3, (i / 10 - 0.5) * look.len * 0.7); g.add(s); } }
  if (id === 'koi') { const halo = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.18, depthWrite: false })); halo.scale.set(0.6, 0.8, 1.2); g.add(halo); }
  if (id === 'sturgeon') { const sm = new THREE.MeshLambertMaterial({ color: 0xc9c2b0 }); for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), sm); s.position.set(0, look.fat * 0.7, (i / 7 - 0.4) * look.len * 0.9); g.add(s); } }
  // size: a bit bigger for heavier fish (clamped so it fits the frame)
  const k = Math.min(1.6, Math.max(0.55, 0.6 + Math.log10(1 + kg) * 0.9)); g.scale.setScalar(k); g.rotation.y = Math.PI / 2; return g;
}
