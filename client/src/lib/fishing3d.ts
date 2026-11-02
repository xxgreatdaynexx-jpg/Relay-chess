/**
 * Fishing3D: the lake seen from the end of the dock (pt1220u). Pure view: the React HUD (Fishing3DGame) drives it with
 * the game phase and the live reel state; the server still rolls every fish and replays the reel inputs.
 * Third-person angler on the pier, rod that bends with line tension, cast arc + bobber + splashes, a fish shadow that
 * runs left/right during the fight (jumps for rare+), and a 3D model of the catch (per species; glowing Crystal Koi,
 * Old Chud the lake monster).
 */
import * as THREE from 'three';
import { DOCK, inLake, LAKE, lakeShape } from '../../../shared/outskirts';
import { fishById, RARITY_COLOR, type Rarity } from '../../../shared/fishing';
import { mix, parseTod, skyNow, type Sky } from '../../../shared/daynight';
import { animateFish, buildFishModel } from './fishModels';
import { detectWorldTier, TIER_PIXEL_RATIO } from './worldTier';

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
/** Soft cloudy puff for lake mist (a few overlapping radial blobs). */
function mistTex(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; let sd = 3; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < 14; i++) { const x = 30 + r() * 68, y = 44 + r() * 40, rad = 18 + r() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  return new THREE.CanvasTexture(c);
}
/** Weathered pier planks: per-plank tone, grain streaks, gaps and nail heads. */
function woodTex(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const g = c.getContext('2d')!; let sd = 11; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const W = 256 / 6; for (let i = 0; i < 6; i++) { const l = 30 + r() * 12, h = 26 + r() * 6; g.fillStyle = `hsl(${h},${38 + r() * 10}%,${l}%)`; g.fillRect(i * W, 0, W, 512);
    for (let k = 0; k < 26; k++) { g.strokeStyle = `rgba(${r() < 0.5 ? '40,24,12' : '150,110,70'},${0.12 + r() * 0.18})`; g.lineWidth = 0.6 + r() * 1.4; const x = i * W + 3 + r() * (W - 6); g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y * 0.02 + k) * 2.2, y); g.stroke(); }
    if (r() < 0.6) { const ky = r() * 480; g.fillStyle = 'rgba(40,22,10,.45)'; g.beginPath(); g.ellipse(i * W + W / 2, ky, 4, 7, 0, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(15,8,4,.85)'; g.fillRect(i * W, 0, 2, 512);
    for (const y of [40, 296]) for (const x of [8, W - 8]) { g.fillStyle = 'rgba(70,70,75,.9)'; g.beginPath(); g.arc(i * W + x, y, 2.2, 0, 7); g.fill(); } }
  for (let y = 0; y < 512; y += 256) { g.fillStyle = 'rgba(15,8,4,.7)'; g.fillRect(0, y, 256, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/** Countershaded fish skin: dark back, species colour, pale belly, a lateral line and fine scale texture. */
function fishSkin(back: number, side: number, belly: number, spots?: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null; // headless (tests): plain colour
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d')!; const h = (n: number) => '#' + n.toString(16).padStart(6, '0');
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, h(back)); gr.addColorStop(0.42, h(side)); gr.addColorStop(0.62, h(side)); gr.addColorStop(0.8, h(belly)); gr.addColorStop(1, h(belly)); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,.08)'; for (let y = 0; y < 128; y += 5) for (let x = (y / 5) % 2 ? 0 : 3; x < 128; x += 6) { g.beginPath(); g.arc(x, y, 3, 0.2, Math.PI - 0.2); g.stroke(); }
  g.strokeStyle = 'rgba(20,20,20,.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 54); g.lineTo(128, 54); g.stroke();
  if (spots != null) { g.fillStyle = h(spots); let sd = 5; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }; for (let i = 0; i < 40; i++) { g.globalAlpha = 0.5 + r() * 0.4; g.beginPath(); g.arc(r() * 128, 10 + r() * 60, 1.5 + r() * 2.5, 0, 7); g.fill(); } g.globalAlpha = 1; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const v3 = (c: number) => new THREE.Vector3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
const RAR_HEX: Record<string, number> = Object.fromEntries(Object.entries(RARITY_COLOR).map(([k, v]) => [k, parseInt(v.slice(1), 16)]));
/** Sway for instanced foliage: bends the top of each instance in the wind (phase from its world position). */
function addSway(m: THREE.Material, uTime: { value: number }, amp: number, height: number) {
  m.onBeforeCompile = (sh) => { sh.uniforms.uTime = uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
    vec2 ip = instanceMatrix[3].xz; float hk = clamp(position.y / ${height.toFixed(2)}, 0.0, 1.0); hk *= hk;
    transformed.x += (sin(uTime * 1.6 + ip.x * 0.7 + ip.y * 0.3) * 0.7 + sin(uTime * 3.1 + ip.y) * 0.3) * ${amp.toFixed(3)} * hk;
    transformed.z += sin(uTime * 1.3 + ip.y * 0.5) * ${(amp * 0.6).toFixed(3)} * hk;
    #endif`); };
}

type Tier = 'low' | 'mid' | 'high';
export class Fishing3D {
  readonly renderer: THREE.WebGLRenderer; readonly scene = new THREE.Scene(); readonly camera: THREE.PerspectiveCamera;
  readonly tier: Tier;
  private disposables: Array<{ dispose(): void }> = [];
  private waterMat: THREE.ShaderMaterial; private t = 0; private uTime = { value: 0 };
  private angler = new THREE.Group(); private rodPts: THREE.Vector3[] = []; private rod: THREE.Mesh; private rodGeo: THREE.BufferGeometry | null = null; private reel = new THREE.Group();
  private line: THREE.Line; private lineGeo = new THREE.BufferGeometry(); private bobber = new THREE.Group();
  private shadow: THREE.Mesh; private splashes: Array<{ ring: THREE.Mesh; ring2: THREE.Mesh; drops: THREE.Points; vel: Float32Array; age: number; life: number }> = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 40); private dropTex = noiseTex();
  private catchGroup = new THREE.Group(); private catchLight = new THREE.PointLight(0x66ccff, 0, 12); private catchGlow: THREE.Sprite; private sparkles: THREE.Points; private revealT = 0;
  private others = new Map<string, OtherAngler>();
  private otherKit: { rodGeo: THREE.CylinderGeometry; rodM: THREE.MeshStandardMaterial; bobGeo: THREE.SphereGeometry; bobM: THREE.MeshStandardMaterial; lineM: THREE.LineBasicMaterial } | null = null;
  // sky / day-night
  private skyMat: THREE.ShaderMaterial; private starM: THREE.PointsMaterial; private moon: THREE.Sprite; private sunSprite: THREE.Sprite;
  private hemi: THREE.HemisphereLight; private key: THREE.DirectionalLight; private lamp: THREE.PointLight; private neon: THREE.PointLight; private bulbM: THREE.MeshBasicMaterial; private signM: THREE.MeshBasicMaterial;
  private mist: THREE.Sprite[] = []; private fireflies: THREE.Points | null = null; private ffMat: THREE.ShaderMaterial | null = null;
  private lampHalo: THREE.Sprite | null = null; private todOverride: number | null = null; private skyT = 99; private ripIdx = 0;
  /** Current sky (Alberta time), exposed for QA. */
  sky: Sky;
  // view state
  phase: View3DPhase = 'idle'; yaw = 0; power = 0; tension = 0; private bob = new THREE.Vector3(); private target = new THREE.Vector3();
  private flight: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  private fishPos = new THREE.Vector3(); private fishVel = new THREE.Vector3(); private jump = { t: -1, h: 0 }; private reelProg = 0; private reelC = 0.5;
  private rare = false; private nibbleAt = 0; private nibble = 0; private dip = 0; private camShake = 0;
  onSplash: ((big: boolean, other: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.tier = detectWorldTier(); const tier = this.tier; canvas.dataset.tier = tier;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIER_PIXEL_RATIO[tier] + (tier === 'high' ? 0.25 : 0)));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    try { this.todOverride = parseTod(new URLSearchParams(location.search).get('tod')); } catch { /* no location */ }
    this.sky = skyNow(new Date(), this.todOverride);
    const s = this.scene; s.fog = new THREE.FogExp2(0x0b0f2a, 0.0105);
    // sky dome: zenith → horizon gradient from the real Alberta time sky, sun glow + warm band near the horizon
    this.skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uWarm: { value: 0 }, uDay: { value: 1 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop, uHor, uSunDir, uSunCol; uniform float uWarm, uDay; varying vec3 vD;
        void main(){ float h = clamp(vD.y, -0.3, 1.0); vec3 c = mix(uHor, uTop, smoothstep(-0.02, 0.55, h));
          float sd = max(dot(normalize(vD), normalize(uSunDir)), 0.0);
          c += uSunCol * (pow(sd, 8.0) * (0.25 + 0.6 * uWarm) + pow(sd, 400.0) * 1.5 * step(-0.05, uSunDir.y)) * (0.3 + 0.7 * uDay + uWarm);
          c += uSunCol * uWarm * 0.35 * exp(-abs(h) * 9.0) * (0.4 + 0.6 * pow(sd, 1.5));
          c = mix(c, uHor * 0.7, smoothstep(0.0, -0.25, h));
          gl_FragColor = vec4(c, 1.0); }` });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.skyMat); sky.position.copy(STAND); sky.renderOrder = -10; s.add(sky); this.track(this.skyMat, sky.geometry);
    const starG = new THREE.BufferGeometry(); const sp: number[] = [];
    for (let i = 0; i < (tier === 'low' ? 400 : 900); i++) { const a = Math.random() * Math.PI * 2, e = 0.06 + Math.random() * 1.3; sp.push(Math.cos(a) * Math.cos(e) * 380, Math.sin(e) * 380, Math.sin(a) * Math.cos(e) * 380); }
    starG.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); this.starM = new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false });
    const stars = new THREE.Points(starG, this.starM); stars.position.copy(STAND); s.add(stars); this.track(starG, this.starM);
    // moon: a shaded disc (craters + halo) kept low over the far shore so the HUD bar never hides it
    const mc = document.createElement('canvas'); mc.width = mc.height = 256; { const g = mc.getContext('2d')!; const hg = g.createRadialGradient(128, 128, 40, 128, 128, 128); hg.addColorStop(0, 'rgba(200,215,255,.35)'); hg.addColorStop(1, 'rgba(200,215,255,0)'); g.fillStyle = hg; g.fillRect(0, 0, 256, 256);
      const dg = g.createRadialGradient(112, 112, 6, 128, 128, 46); dg.addColorStop(0, '#fffdf2'); dg.addColorStop(1, '#d9d6c8'); g.fillStyle = dg; g.beginPath(); g.arc(128, 128, 46, 0, 7); g.fill();
      g.fillStyle = 'rgba(150,145,135,.35)'; for (const [x, y, r] of [[110, 112, 9], [146, 120, 6], [128, 150, 11], [100, 140, 5], [150, 146, 4], [122, 96, 4]] as const) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }
    const moonTex = new THREE.CanvasTexture(mc); moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, transparent: true })); this.moon.scale.setScalar(20); this.moon.renderOrder = -9; s.add(this.moon); this.track(moonTex, this.moon.material);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dropTex, color: 0xfff1d0, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending })); this.sunSprite.scale.setScalar(60); this.sunSprite.renderOrder = -9; s.add(this.sunSprite); this.track(this.sunSprite.material);
    // lights (driven by the sky every second)
    this.hemi = new THREE.HemisphereLight(0x8a7cff, 0x10220f, 0.75); s.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xcfd8ff, 1.1); s.add(this.key); s.add(this.key.target); this.key.target.position.copy(STAND);
    this.lamp = new THREE.PointLight(0xffc477, 18, 16, 1.6); this.lamp.position.set(DOCK.x + 1.6, 3.6, DOCK.pierZ0 + 1.2); s.add(this.lamp);
    this.neon = new THREE.PointLight(0x4fc3d9, 25, 22, 1.6); this.neon.position.set(DOCK.x, 4, DOCK.z - 4); s.add(this.neon);
    const lampPos = new THREE.Vector3(DOCK.x - 3.2, 3.55, DOCK.pierZ0 + 0.4);
    // water: depth colour from distance to shore, sky reflection (fresnel), sun/moon glitter, lamp streak, caustics in the shallows, shore foam, splash ripples
    const ripples = Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -100, 0));
    this.waterMat = new THREE.ShaderMaterial({ fog: true, defines: { CAUSTICS: tier === 'low' ? 0 : 1 },
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uRip: { value: ripples }, uLake: { value: new THREE.Vector4(LAKE.x, LAKE.z, LAKE.rx, LAKE.rz) },
        uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: new THREE.Color() }, uSkyTop: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() },
        uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uDay: { value: 1 }, uLamp: { value: lampPos }, uLampI: { value: 1 } }]),
      vertexShader: `varying vec2 vP; varying vec3 vW; #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(/#include <[^>]+>/g, (m) => `\n${m}\n`),
      fragmentShader: `uniform float uTime, uDay, uLampI; uniform vec4 uRip[4]; uniform vec4 uLake; uniform vec3 uLightDir, uLightCol, uSkyTop, uSkyHor, uDeep, uShallow, uLamp; varying vec2 vP; varying vec3 vW; #include <fog_pars_fragment>
        float rip(vec2 p){ float r = 0.0; for (int i = 0; i < 4; i++){ vec4 u = uRip[i]; float rd = distance(p, u.xy); float age = uTime - u.z; r += u.w * sin(rd*7.0 - age*9.0) * exp(-rd*0.6 - age*0.8) * step(rd, age*3.0+0.5); } return r; }
        float hgt(vec2 p){ float t = uTime; return sin(p.x*0.55+t*0.9)*0.5 + sin(p.x*1.3-p.y*0.8+t*1.6)*0.3 + sin(p.y*2.1+t*1.1)*0.2 + sin((p.x+p.y)*3.7-t*2.4)*0.09 + sin((p.x*0.7-p.y)*5.3+t*3.1)*0.05 + rip(p)*1.6; }
        float lakeK(float a){ return 0.87 + 0.06*sin(2.0*a+0.9) + 0.04*sin(3.0*a+2.4) - 0.025*cos(5.0*a+0.3); }
        float caus(vec2 p){ vec2 q = p*0.9; float c = 0.0; for (int i = 0; i < 3; i++){ q = vec2(q.x + sin(q.y*1.3 + uTime*0.7), q.y + cos(q.x*1.1 - uTime*0.6)); c += 0.5/length(fract(q)-0.5); } return pow(c/3.0, 3.0)*0.02; }
        void main(){
          float e = 0.08; float h0 = hgt(vP); vec3 N = normalize(vec3(-(hgt(vP+vec2(e,0.0))-h0)/e*0.11, 1.0, -(hgt(vP+vec2(0.0,e))-h0)/e*0.11));
          vec2 q = (vP - uLake.xy) / uLake.zw; float a = atan(q.y, q.x); float sr = length(q) / lakeK(a); float shoreD = (1.0 - sr) * length(vec2(cos(a)*uLake.z, sin(a)*uLake.w));
          float depth = smoothstep(0.0, 9.0, shoreD);
          vec3 V = normalize(cameraPosition - vW); vec3 R = reflect(-V, N);
          vec3 body = mix(uShallow, uDeep, depth);
          #if CAUSTICS
          body += caus(vP) * (1.0 - depth) * uShallow * (0.4 + 0.8 * uDay);
          #endif
          vec3 refl = mix(uSkyHor, uSkyTop, smoothstep(0.0, 0.6, R.y));
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 c = mix(body, refl, clamp(fres * 1.15, 0.0, 0.9));
          vec3 L = normalize(uLightDir); vec3 H = normalize(L + V); float spec = pow(max(dot(N,H),0.0), mix(180.0, 600.0, uDay)) * step(0.0, L.y + 0.02);
          c += spec * uLightCol * mix(2.6, 6.0, uDay);
          vec3 Lp = normalize(uLamp - vW); float ls = pow(max(dot(N, normalize(Lp + V)), 0.0), 90.0) * uLampI / (1.0 + 0.02*dot(uLamp-vW, uLamp-vW));
          c += ls * vec3(1.0, 0.75, 0.45) * 5.0;
          float foam = smoothstep(1.4, 0.0, shoreD + h0*0.25) * (0.55 + 0.45*sin(shoreD*6.0 - uTime*1.8));
          c = mix(c, vec3(0.86, 0.92, 0.95) * (0.35 + 0.65*uDay), clamp(foam, 0.0, 1.0) * 0.55);
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }`.replace(/#include <[^>]+>/g, (m) => `\n${m}\n`) });
    const shape = new THREE.Shape(lakeShape().map(([x, z]) => new THREE.Vector2(x, -z)));
    const wg = new THREE.ShapeGeometry(shape, 8); wg.rotateX(-Math.PI / 2); const water = new THREE.Mesh(wg, this.waterMat); water.position.y = 0.05; s.add(water); this.track(wg, this.waterMat);
    // lake mist: soft billboards drifting low over the water (more at night and dawn)
    if (tier !== 'low') { const mt = mistTex(); this.track(mt); let sd = 9; const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      for (let i = 0; i < (tier === 'high' ? 22 : 12); i++) { const a = rr() * Math.PI * 2, r = rr() * 0.8; const m = new THREE.SpriteMaterial({ map: mt, transparent: true, depthWrite: false, opacity: 0.3, color: 0xdfe8ff });
        const sp2 = new THREE.Sprite(m); sp2.position.set(LAKE.x + Math.cos(a) * LAKE.rx * r, 0.9 + rr() * 0.8, LAKE.z + Math.sin(a) * LAKE.rz * r); sp2.scale.set(14 + rr() * 10, 3.5 + rr() * 2, 1); sp2.userData.ph = rr() * 6; s.add(sp2); this.mist.push(sp2); this.track(m); } }
    // fireflies at night: additive points that drift and blink around the shore
    { const N = tier === 'low' ? 40 : tier === 'mid' ? 110 : 180; const pos = new Float32Array(N * 3), ph = new Float32Array(N); let sd = 21; const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      for (let i = 0; i < N; i++) { const a = rr() * Math.PI * 2, r = 0.85 + rr() * 0.45; pos.set([LAKE.x + Math.cos(a) * LAKE.rx * r, 0.5 + rr() * 2.5, LAKE.z + Math.sin(a) * LAKE.rz * r], i * 3); ph[i] = rr() * 100; }
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fg.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
      this.ffMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: this.uTime, uOn: { value: 0 }, uMap: { value: this.dropTex }, uPx: { value: this.renderer.getPixelRatio() } },
        vertexShader: `uniform float uTime, uOn, uPx; attribute float ph; varying float vA; void main(){ vec3 p = position + vec3(sin(uTime*0.4+ph)*1.2, sin(uTime*0.7+ph*1.3)*0.5, cos(uTime*0.35+ph*0.7)*1.2);
          vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv; vA = uOn * smoothstep(0.2, 1.0, sin(uTime*1.7 + ph*2.1)*0.5+0.5); gl_PointSize = 9.0 * uPx * (20.0 / -mv.z); }`,
        fragmentShader: 'uniform sampler2D uMap; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.85,1.0,0.35) * t.a * vA * 1.6, t.a * vA); }' });
      this.fireflies = new THREE.Points(fg, this.ffMat); this.fireflies.frustumCulled = false; s.add(this.fireflies); this.track(fg, this.ffMat); }
    // ground + bank ring
    const groundM = new THREE.MeshLambertMaterial({ color: 0x1f5a2a }); const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), groundM); ground.rotation.x = -Math.PI / 2; ground.position.set(LAKE.x, -0.02, LAKE.z); s.add(ground); this.track(groundM, ground.geometry);
    const ring = lakeShape(); const bp: number[] = [], bc: number[] = [], bi: number[] = []; const cols = [[0.36, 0.3, 0.2], [0.62, 0.55, 0.38], [0.55, 0.5, 0.32], [0.14, 0.36, 0.17]]; const offs = [-1.2, 1, 2.6, 4.2], ys = [-0.15, 0.03, 0.06, 0.0];
    ring.forEach(([x, z]) => { const dx = x - LAKE.x, dz = z - LAKE.z, d = Math.hypot(dx, dz); offs.forEach((o, k) => { bp.push(x + dx / d * o, ys[k]!, z + dz / d * o); bc.push(...cols[k]!); }); });
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = j * 4 + k; bi.push(a, b, a + 1, b, b + 1, a + 1); } }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3)); bg.setIndex(bi); bg.computeVertexNormals();
    const bm = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }); s.add(new THREE.Mesh(bg, bm)); this.track(bg, bm);
    // trees, reeds, rocks, lilies around the shore (deterministic)
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const trunkG = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6), leafG = new THREE.IcosahedronGeometry(1.5, 0), trunkM = new THREE.MeshLambertMaterial({ color: 0x4a3423 }), leafM = new THREE.MeshLambertMaterial({ color: 0x24683a, flatShading: true }); addSway(leafM, this.uTime, 0.25, 1.5);
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, 90), leaves = new THREE.InstancedMesh(leafG, leafM, 90); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < 400 && n < 90; i++) { const a = rnd() * Math.PI * 2, r = 1.15 + rnd() * 0.9; const x = LAKE.x + Math.cos(a) * LAKE.rx * r, z = LAKE.z + Math.sin(a) * LAKE.rz * r * 1.6;
      if (inLake(x, z, 5) || (Math.abs(x - DOCK.x) < 9 && z > DOCK.pierZ0 - 2)) continue; const k = 0.8 + rnd() * 0.9;
      m4.compose(v.set(x, 0.8 * k, z), q.identity(), sc.set(k, k, k)); trunks.setMatrixAt(n, m4); m4.compose(v.set(x, 2.4 * k, z), q.setFromEuler(new THREE.Euler(rnd(), rnd(), 0)), sc.set(k, k * 1.2, k)); leaves.setMatrixAt(n, m4); n++; }
    trunks.count = leaves.count = n; s.add(trunks, leaves); this.track(trunkG, leafG, trunkM, leafM);
    const reedG = new THREE.CylinderGeometry(0.03, 0.05, 1.6, 4); reedG.translate(0, 0.8, 0); const reedM = new THREE.MeshLambertMaterial({ color: 0x6a8a3a }); addSway(reedM, this.uTime, 0.22, 1.6); const reeds = new THREE.InstancedMesh(reedG, reedM, tier === 'low' ? 120 : 260);
    const headG = new THREE.CapsuleGeometry(0.07, 0.25, 2, 6); const headM = new THREE.MeshLambertMaterial({ color: 0x5a3a1e }); headM.onBeforeCompile = (sh) => { sh.uniforms.uTime = this.uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
    vec2 ip = instanceMatrix[3].xz; transformed.x += (sin(uTime * 1.6 + ip.x * 0.7 + ip.y * 0.3) * 0.7 + sin(uTime * 3.1 + ip.y) * 0.3) * 0.22; transformed.z += sin(uTime * 1.3 + ip.y * 0.5) * 0.13;
    #endif`); }; const heads = new THREE.InstancedMesh(headG, headM, tier === 'low' ? 120 : 260); n = 0;
    for (let i = 0; i < 1200 && n < reeds.count; i++) { const [px, pz] = ring[Math.floor(rnd() * ring.length)]!; const x = px + (rnd() - 0.5) * 3, z = pz + (rnd() - 0.5) * 3;
      if (Math.abs(x - DOCK.x) < 5 && z > DOCK.pierZ0 - 3) continue; const k = 0.7 + rnd() * 0.7; const tilt = new THREE.Euler((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3);
      m4.compose(v.set(x, -0.1, z), q.setFromEuler(tilt), sc.set(1, k, 1)); reeds.setMatrixAt(n, m4); const top = new THREE.Vector3(0, 1.5 * k, 0).applyEuler(tilt); m4.compose(v.set(x + top.x, top.y - 0.1, z + top.z), q, sc.set(1, 1, 1)); heads.setMatrixAt(n, m4); n++; }
    reeds.count = heads.count = n; s.add(reeds, heads); this.track(reedG, reedM, headG, headM);
    const lilyG = new THREE.CircleGeometry(0.45, 10, 0.3, Math.PI * 1.8); lilyG.rotateX(-Math.PI / 2); const lilyM = new THREE.MeshLambertMaterial({ color: 0x2f7d3a }); const lilies = new THREE.InstancedMesh(lilyG, lilyM, 40); n = 0;
    for (let i = 0; i < 300 && n < 40; i++) { const a = rnd() * Math.PI * 2, r = 0.55 + rnd() * 0.35; const x = LAKE.x + Math.cos(a) * LAKE.rx * r, z = LAKE.z + Math.sin(a) * LAKE.rz * r; if (!inLake(x, z, -1) || Math.abs(x - DOCK.x) < 6) continue; m4.compose(v.set(x, 0.08, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), sc.set(1, 1, 1)); lilies.setMatrixAt(n++, m4); }
    lilies.count = n; s.add(lilies); this.track(lilyG, lilyM);
    // pier + boathouse
    const wood = woodTex(); const wood2 = wood.clone(); wood2.needsUpdate = true; wood2.repeat.set(1, 2.4); this.track(wood, wood2);
    const plankM = new THREE.MeshStandardMaterial({ map: wood2, color: 0xc9a27a, roughness: 0.85, metalness: 0 }); const postM = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.9 });
    const platM = new THREE.MeshStandardMaterial({ map: wood, color: 0xc9a27a, roughness: 0.85 }); this.track(platM);
    const pierLen = DOCK.pierZ1 - DOCK.pierZ0; const pier = new THREE.Mesh(new THREE.BoxGeometry(DOCK.pierW, 0.2, pierLen + 6), plankM); pier.position.set(DOCK.x, 0.55, (DOCK.pierZ0 + DOCK.pierZ1) / 2 + 3); s.add(pier);
    const plat = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 4), platM); plat.position.set(DOCK.x, 0.55, DOCK.pierZ0 + 1.6); s.add(plat); this.track(plankM, postM, pier.geometry, plat.geometry);
    const postG = new THREE.CylinderGeometry(0.14, 0.14, 1.8, 6); this.track(postG);
    for (let z = DOCK.pierZ0; z <= DOCK.pierZ1 + 4; z += 2.5) for (const sx of [-1, 1]) { const p = new THREE.Mesh(postG, postM); p.position.set(DOCK.x + sx * (DOCK.pierW / 2), -0.2, z); s.add(p); }
    for (const sx of [-1, 1]) for (const sz of [0, 1]) { const p = new THREE.Mesh(postG, postM); p.position.set(DOCK.x + sx * 3.4, -0.2, DOCK.pierZ0 + sz * 3.2); s.add(p); }
    const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3, 6), postM); lampPole.position.set(DOCK.x - 3.2, 2, DOCK.pierZ0 + 0.4); s.add(lampPole); this.track(lampPole.geometry);
    this.bulbM = new THREE.MeshBasicMaterial({ color: 0xffd9a0 }); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.bulbM); bulb.position.copy(lampPos); s.add(bulb); this.lamp.position.copy(bulb.position); this.track(this.bulbM, bulb.geometry);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dropTex, color: 0xffc477, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 })); halo.scale.setScalar(2.2); halo.position.copy(lampPos); halo.userData.lampHalo = true; s.add(halo); this.track(halo.material); this.lampHalo = halo;
    const wallM = new THREE.MeshLambertMaterial({ color: 0x2a2730 }), roofM = new THREE.MeshLambertMaterial({ color: 0x5a1f2c }); this.track(wallM, roofM);
    const house = new THREE.Mesh(new THREE.BoxGeometry(7, 3.6, 6), wallM); house.position.set(DOCK.x, 1.8, DOCK.z - 1); s.add(house); this.track(house.geometry);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.2, 4), roofM); roof.rotation.y = Math.PI / 4; roof.position.set(DOCK.x, 4.7, DOCK.z - 1); s.add(roof); this.track(roof.geometry);
    this.signM = new THREE.MeshBasicMaterial({ color: 0x4fc3d9 }); const signM = this.signM; const sign = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 0.1), signM); sign.position.set(DOCK.x, 3.0, DOCK.z - 4.05); s.add(sign); this.track(signM, sign.geometry);
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
    const rodM = new THREE.MeshStandardMaterial({ color: 0x1d2633, roughness: 0.3, metalness: 0.4 }); this.rod = new THREE.Mesh(new THREE.BufferGeometry(), rodM); s.add(this.rod); this.track(rodM);
    // reel + cork handle at the grip (follows the rod butt every frame)
    { const cork = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.95 }), metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x20252c, roughness: 0.4, metalness: 0.6 }); this.track(cork, metal, dark);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.5, 8), cork); handle.rotation.x = Math.PI / 2; handle.position.z = 0.1;
      const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14), metal); spool.rotation.z = Math.PI / 2; spool.position.set(0, -0.12, -0.05);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), dark); body.position.set(0, -0.06, -0.05);
      const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 5), metal); crank.position.set(0.07, -0.12, -0.05); crank.userData.crank = true;
      for (const m of [handle, spool, body, crank]) { this.track(m.geometry); this.reel.add(m); } s.add(this.reel); }
    for (let i = 0; i <= 8; i++) this.rodPts.push(new THREE.Vector3());
    const lineM = new THREE.LineBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.9 }); this.line = new THREE.Line(this.lineGeo, lineM); this.line.frustumCulled = false; s.add(this.line); this.track(this.lineGeo, lineM);
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
    // bobber
    const redM = new THREE.MeshLambertMaterial({ color: 0xff3048, emissive: 0x330008 }), whiteM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), redM); const bot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), whiteM);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), redM); stick.position.y = 0.2; this.bobber.add(top, bot, stick); this.bobber.visible = false; s.add(this.bobber); this.track(redM, whiteM, top.geometry, bot.geometry, stick.geometry);
    // fish shadow under the water during the fight
    const shM = new THREE.MeshBasicMaterial({ color: 0x000814, transparent: true, opacity: 0.55, depthWrite: false }); const shG = new THREE.CircleGeometry(1, 20); shG.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(shG, shM); this.shadow.visible = false; this.shadow.renderOrder = 2; s.add(this.shadow); this.track(shM, shG, this.ringGeo, this.dropTex);
    this.catchGroup.visible = false; s.add(this.catchGroup); this.catchLight.position.set(0, 0.5, 1.5); this.catchGroup.add(this.catchLight);
    // catch reveal: a rarity-coloured glow behind the fish and rising sparkles
    this.catchGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dropTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); this.catchGlow.scale.setScalar(4); this.catchGlow.visible = false; s.add(this.catchGlow); this.track(this.catchGlow.material);
    { const N = tier === 'low' ? 24 : 60; const sg = new THREE.BufferGeometry(); const sp3 = new Float32Array(N * 3); for (let i = 0; i < N; i++) sp3.set([(Math.random() - 0.5) * 2.4, Math.random() * 2, (Math.random() - 0.5) * 2.4], i * 3); sg.setAttribute('position', new THREE.BufferAttribute(sp3, 3));
      const sm = new THREE.PointsMaterial({ map: this.dropTex, size: 0.18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }); this.sparkles = new THREE.Points(sg, sm); this.sparkles.visible = false; s.add(this.sparkles); this.track(sg, sm); }
    this.applySky();
    this.resize();
  }
  private track(...d: Array<{ dispose(): void }>) { this.disposables.push(...d); }
  /** Real Alberta time sky (shared with the city): sky dome, sun or moon light, water colours, lamp + neon on at dusk, mist, fireflies. */
  private applySky() {
    const k = skyNow(new Date(), this.todOverride); this.sky = k; const d2r = Math.PI / 180;
    const e = k.elev * d2r, a = k.az * d2r; const sunDir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    const top = mix(mix(0x050817, 0x1c2350, Math.max(0, 1 - k.stars)), 0x3f86d8, k.day), hor = k.horizon;
    const u = this.skyMat.uniforms; (u.uTop!.value as THREE.Color).setHex(top); (u.uHor!.value as THREE.Color).setHex(hor); (u.uSunDir!.value as THREE.Vector3).copy(sunDir); (u.uSunCol!.value as THREE.Color).setHex(k.sunColor); u.uWarm!.value = k.warm; u.uDay!.value = k.day;
    (this.scene.fog as THREE.FogExp2).color.setHex(k.fog); (this.scene.fog as THREE.FogExp2).density = 0.0068 - 0.0025 * k.day;
    this.hemi.color.setHex(k.hemiSky); this.hemi.groundColor.setHex(k.hemiGround); this.hemi.intensity = 0.55 + 0.75 * k.day + 0.2 * k.warm;
    // moon: opposite the sun but always shown low over the far shore (~6° up, above the treeline), in front of the angler, so the top bar never covers it
    const mAz = Math.atan2(-0.35, -1); const mEl = 6.5 * d2r; const moonDir = new THREE.Vector3(Math.cos(mEl) * Math.sin(-0.35), Math.sin(mEl), -Math.cos(mEl)); void mAz;
    this.moon.position.copy(STAND).addScaledVector(moonDir, 200); (this.moon.material as THREE.SpriteMaterial).opacity = Math.min(1, k.stars * 1.2 + 0.08 * (1 - k.day)); this.moon.visible = k.stars > 0.03;
    this.sunSprite.position.copy(STAND).addScaledVector(sunDir, 370); this.sunSprite.visible = k.elev > -4; (this.sunSprite.material as THREE.SpriteMaterial).color.setHex(mix(0xfff6dd, 0xff9a50, k.warm)); this.sunSprite.scale.setScalar(40 + 40 * k.warm);
    const useSun = k.sunI > 0.05; const L = useSun ? sunDir : moonDir;
    this.key.position.copy(STAND).addScaledVector(L, 120); this.key.color.setHex(useSun ? k.sunColor : 0xbcc8ff); this.key.intensity = useSun ? 0.4 + k.sunI * 0.9 : 0.25 + k.moonI * 0.7;
    this.starM.opacity = 0.9 * k.stars; this.renderer.toneMappingExposure = k.exposure;
    const lit = k.lights; this.lamp.intensity = 2 + 18 * lit; this.neon.intensity = 4 + 24 * lit; this.bulbM.color.setHex(mix(0x8a7a60, 0xffd9a0, lit)); this.signM.color.setHex(mix(0x2a5a66, 0x4fc3d9, 0.4 + 0.6 * lit));
    if (this.lampHalo) { (this.lampHalo.material as THREE.SpriteMaterial).opacity = 0.75 * lit; this.lampHalo.visible = lit > 0.02; }
    const w = this.waterMat.uniforms; (w.uLightDir!.value as THREE.Vector3).copy(L); (w.uLightCol!.value as THREE.Color).setHex(useSun ? k.sunColor : 0xdfe6ff).multiplyScalar(useSun ? 1 : 0.6 + k.moonI * 0.4);
    (w.uSkyTop!.value as THREE.Color).setHex(top); (w.uSkyHor!.value as THREE.Color).setHex(hor);
    (w.uDeep!.value as THREE.Color).setHex(mix(0x020a1c, 0x0b3a5c, k.day)); (w.uShallow!.value as THREE.Color).setHex(mix(mix(0x06213a, 0x2f8f8a, k.day), 0x8a6a40, k.warm * 0.25)); w.uDay!.value = k.day; w.uLampI!.value = lit;
    for (const m of this.mist) (m.material as THREE.SpriteMaterial).color.setHex(mix(mix(0x8a96c8, 0xf2f6ff, k.day), 0xffc8a0, k.warm * 0.6));
    if (this.ffMat) this.ffMat.uniforms.uOn!.value = lit;
  }
  resize() { const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  /** Where a cast with this aim (radians, 0 = straight out) and power (0..1) lands, kept inside the water. */
  landing(yaw: number, power: number): THREE.Vector3 {
    let d = 4 + power * 15; const dir = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const p = new THREE.Vector3(); for (; d > 3; d -= 0.5) { p.set(STAND.x + dir.x * d, 0.1, STAND.z + dir.z * d); if (inLake(p.x, p.z, -1.5)) break; }
    return p;
  }
  cast(power: number) { const to = this.landing(this.yaw, power); this.target.copy(to); this.flight = { from: this.tipPos(), to, t: 0, dur: 0.55 + power * 0.5 }; this.phase = 'flying'; this.bobber.visible = true; this.hideCatch(); }
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
    const f = fishById(fishId); const model = buildFish(fishId, grams, this.tier); g.add(model); this.catchModel = model;
    const rc = fishId === 'oldchud' ? 0x66ff44 : fishId === 'goldcarp' ? 0xffb21e : fishId === 'koi' ? 0x66ccff : RAR_HEX[f?.rarity ?? 'common'] ?? 0xd8dde8; const big = f ? RARE.includes(f.rarity) || fishId === 'oldchud' : false;
    this.catchLight.intensity = fishId === 'koi' ? 30 : fishId === 'goldcarp' ? 16 : fishId === 'oldchud' ? 22 : big ? 14 : 6; this.catchLight.color.setHex(rc);
    (this.catchGlow.material as THREE.SpriteMaterial).color.setHex(rc); (this.sparkles.material as THREE.PointsMaterial).color.setHex(rc); this.catchGlow.userData.big = big; this.sparkles.visible = f?.rarity !== 'junk'; this.catchGlow.visible = f?.rarity !== 'junk'; this.revealT = 0;
    g.position.set(STAND.x + Math.cos(this.yaw) * 1.6 + Math.sin(this.yaw) * 0.6, 2.3, STAND.z + Math.sin(this.yaw) * 1.6 - Math.cos(this.yaw) * 0.6); g.visible = true; this.shadow.visible = false; this.bobber.visible = false; this.phase = 'show'; this.splash(new THREE.Vector3(STAND.x, 0.1, STAND.z - 3), true);
    void f;
  }
  hideCatch() { this.catchGroup.visible = false; this.catchGlow.visible = false; this.sparkles.visible = false; }
  /** Other anglers on the dock (pt242u): a figure + name tag, plus their own rod, line and bobber animated from the
   *  pose the server broadcasts (cast arc → floating bobber, bent rod + thrashing line while reeling, catch held up). */
  setOthers(list: Array<{ name: string; pose?: OtherPose; yaw?: number; power?: number; fish?: string }>) {
    const kit = (this.otherKit ??= (() => { const k = { rodGeo: new THREE.CylinderGeometry(0.012, 0.03, 2.4, 5), rodM: new THREE.MeshStandardMaterial({ color: 0x1d2633, roughness: 0.3, metalness: 0.4 }),
      bobGeo: new THREE.SphereGeometry(0.09, 10, 8), bobM: new THREE.MeshStandardMaterial({ color: 0xff3b30, roughness: 0.4 }), lineM: new THREE.LineBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.7 }) };
      k.rodGeo.translate(0, 1.2, 0); this.track(k.rodGeo, k.rodM, k.bobGeo, k.bobM, k.lineM); return k; })());
    const keep = new Set(list.map((o) => o.name));
    for (const [k, o] of this.others) if (!keep.has(k)) { this.dropOther(o); this.others.delete(k); }
    list.forEach((o, i) => { let e = this.others.get(o.name);
      if (!e) { const g = this.angler.clone(); const tag = makeTag(o.name); tag.position.y = 2.5; g.add(tag);
        const rod = new THREE.Mesh(kit.rodGeo, kit.rodM); rod.position.set(0.25, 1.15, -0.35); g.add(rod);
        const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 3), 3));
        const line = new THREE.Line(lineGeo, kit.lineM); line.frustumCulled = false; line.visible = false;
        const bob = new THREE.Mesh(kit.bobGeo, kit.bobM); bob.visible = false;
        this.scene.add(g, line, bob); e = { g, tag, rod, line, bob, pose: 'idle', at: this.t, yaw: 0, power: 0.5, fish: null, fishModel: null, target: new THREE.Vector3(), splashed: false }; this.others.set(o.name, e); }
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2); e.g.position.set(DOCK.x + side * (2.2 + (row % 2) * 0.6), 0.65, DOCK.pierZ0 + 1.2 + row * 2.6);
      const pose = o.pose ?? 'idle'; const fish = pose === 'catch' ? o.fish ?? null : null;
      if (pose !== e.pose || fish !== e.fish) { e.pose = pose; e.at = this.t; e.splashed = false; e.yaw = side * -0.4 + (o.yaw ?? 0) * 0.5; e.power = o.power ?? 0.5;
        const dir = new THREE.Vector3(Math.sin(e.yaw), 0, -Math.cos(e.yaw)); let d = 3 + e.power * 9; const p = new THREE.Vector3();
        for (; d > 2; d -= 0.5) { p.set(e.g.position.x + dir.x * d, 0.1, e.g.position.z + dir.z * d); if (inLake(p.x, p.z, -1)) break; } e.target.copy(p);
        if (e.fishModel) { e.g.remove(e.fishModel); disposeTree(e.fishModel); e.fishModel = null; } e.fish = fish;
        if (fish) { e.fishModel = buildFish(fish, 900, 'low'); e.fishModel.scale.multiplyScalar(0.6); e.fishModel.position.set(0.5, 1.9, -0.6); e.g.add(e.fishModel); } }
      e.g.rotation.y = -e.yaw; });
  }
  private dropOther(o: OtherAngler) { this.scene.remove(o.g, o.line, o.bob); (o.tag.material as THREE.SpriteMaterial).map?.dispose(); o.tag.material.dispose(); o.line.geometry.dispose(); if (o.fishModel) disposeTree(o.fishModel); }
  /** Per-frame animation of the other anglers' rods, lines and bobbers. */
  private stepOthers() {
    const t = this.t; const tip = new THREE.Vector3();
    for (const e of this.others.values()) {
      const age = t - e.at; let tilt = -0.35, shake = 0; let bobVis = false; const bobAt = e.target.clone();
      if (e.pose === 'cast') { const k = Math.min(1, age / 0.7); tilt = age < 0.25 ? -1.4 + age * 2 : -0.9 + k * 0.4; bobVis = true;
        if (k < 1) { bobAt.lerpVectors(tip.copy(e.rod.position).applyMatrix4(e.g.matrixWorld).setY(2.6), e.target, k); bobAt.y = 2.6 * (1 - k) + Math.sin(k * Math.PI) * 1.5 + 0.1 * k; }
        else { if (!e.splashed) { e.splashed = true; this.splash(e.target, false, true); } bobAt.y = 0.1 + Math.sin(t * 2.2 + e.at) * 0.03; } }
      else if (e.pose === 'reel') { tilt = -0.15; shake = Math.sin(t * 23) * 0.08 + Math.sin(t * 9) * 0.05; bobVis = true; bobAt.y = 0.02;
        bobAt.lerp(e.g.position.clone().setY(0), Math.min(0.75, age / 8)); bobAt.x += Math.sin(t * 3 + e.at) * 0.6; bobAt.z += Math.cos(t * 2.3) * 0.3;
        if (!e.splashed) { e.splashed = true; this.splash(bobAt, true, true); } }
      else if (e.pose === 'catch') { tilt = age < 4 ? 0.2 : -0.35; if (e.fishModel) { e.fishModel.visible = age < 4; e.fishModel.rotation.y = Math.PI / 2 + Math.sin(t * 6) * 0.3; } }
      e.rod.rotation.set(tilt + shake, 0, shake * 0.5); e.g.updateMatrixWorld(true);
      tip.set(0, 2.4, 0).applyMatrix4(e.rod.matrixWorld);
      e.bob.visible = bobVis; e.line.visible = bobVis; if (bobVis) e.bob.position.copy(bobAt);
      if (bobVis) { const pa = e.line.geometry.getAttribute('position') as THREE.BufferAttribute; const sag = e.pose === 'reel' ? 0.05 : 0.6;
        for (let i = 0; i <= 8; i++) { const u = i / 8; pa.setXYZ(i, tip.x + (bobAt.x - tip.x) * u, tip.y + (bobAt.y - tip.y) * u - Math.sin(u * Math.PI) * sag, tip.z + (bobAt.z - tip.z) * u); } pa.needsUpdate = true; }
    }
  }
  private tipPos(): THREE.Vector3 { return this.rodPts[this.rodPts.length - 1]!.clone(); }
  private splash(at: THREE.Vector3, big: boolean, other = false) {
    const rm = new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this.ringGeo, rm); ring.rotation.x = -Math.PI / 2; ring.position.set(at.x, 0.09, at.z); this.scene.add(ring);
    const ring2 = new THREE.Mesh(this.ringGeo, rm.clone()); ring2.rotation.x = -Math.PI / 2; ring2.position.set(at.x, 0.085, at.z); this.scene.add(ring2);
    const N = Math.round((big ? 70 : 30) * (this.tier === 'low' ? 0.5 : 1)); const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos.set([at.x, 0.12, at.z], i * 3); const a = Math.random() * Math.PI * 2, sp = (big ? 2.2 : 1.2) * (0.4 + Math.random()); vel.set([Math.cos(a) * sp, (big ? 4.5 : 2.6) * (0.5 + Math.random()), Math.sin(a) * sp], i * 3); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dm = new THREE.PointsMaterial({ map: this.dropTex, size: big ? 0.32 : 0.2, transparent: true, depthWrite: false, color: 0xeefaff, blending: THREE.AdditiveBlending });
    const drops = new THREE.Points(dg, dm); this.scene.add(drops); this.splashes.push({ ring, ring2, drops, vel, age: 0, life: big ? 1.5 : 1.0 });
    const u = (this.waterMat.uniforms.uRip!.value as THREE.Vector4[])[this.ripIdx++ % 4]!; u.set(at.x, at.z, this.t, big ? 0.6 : 0.35); this.onSplash?.(big, other);
  }

  step(dt: number) {
    this.t += dt; const t = this.t; this.waterMat.uniforms.uTime!.value = t; this.uTime.value = t;
    this.skyT += dt; if (this.skyT > 1) { this.skyT = 0; this.applySky(); }
    if (this.others.size) this.stepOthers();
    for (const m of this.mist) { const ph = m.userData.ph as number; m.position.x += Math.sin(t * 0.05 + ph) * dt * 0.4; (m.material as THREE.SpriteMaterial).opacity = (0.1 + 0.16 * (1 - this.sky.day) + 0.12 * this.sky.warm) * (0.75 + 0.25 * Math.sin(t * 0.3 + ph)); }
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
    this.rodGeo?.dispose(); this.rodGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(this.rodPts), 16, 0.032, 6, false); // 17 rings × 7 verts
    { const pa = this.rodGeo.getAttribute('position') as THREE.BufferAttribute; const segs = 17, rs = 7; // taper: thick butt → thin tip
      const curve = new THREE.CatmullRomCurve3(this.rodPts); for (let i = 0; i < segs; i++) { const u = i / 16; const c = curve.getPointAt(u); const k = 1.25 - u * 0.95; for (let j = 0; j < rs; j++) { const idx = i * rs + j; if (idx >= pa.count) break; pa.setXYZ(idx, c.x + (pa.getX(idx) - c.x) * k, c.y + (pa.getY(idx) - c.y) * k, c.z + (pa.getZ(idx) - c.z) * k); } } pa.needsUpdate = true; }
    this.rod.geometry = this.rodGeo;
    this.reel.position.copy(this.rodPts[0]!); this.reel.lookAt(this.rodPts[2]!); this.reel.rotateY(Math.PI);
    for (const ch of this.reel.children) if (ch.userData.crank) ch.rotation.x = this.phase === 'reel' && this.tension > 0.4 ? t * 14 : 0;
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
      const u2 = Math.max(0, u - 0.18); s.ring2.scale.setScalar(0.2 + u2 * 1.7); (s.ring2.material as THREE.MeshBasicMaterial).opacity = u2 > 0 ? 0.55 * (1 - u) : 0;
      const p = s.drops.geometry.getAttribute('position') as THREE.BufferAttribute; for (let k = 0; k < p.count; k++) { s.vel[k * 3 + 1]! -= 9.8 * dt; p.setXYZ(k, p.getX(k) + s.vel[k * 3]! * dt, Math.max(0.05, p.getY(k) + s.vel[k * 3 + 1]! * dt), p.getZ(k) + s.vel[k * 3 + 2]! * dt); } p.needsUpdate = true;
      (s.drops.material as THREE.PointsMaterial).opacity = 1 - u;
      if (u >= 1) { this.scene.remove(s.ring, s.ring2, s.drops); (s.ring.material as THREE.Material).dispose(); (s.ring2.material as THREE.Material).dispose(); s.drops.geometry.dispose(); (s.drops.material as THREE.Material).dispose(); this.splashes.splice(i, 1); } }
    // caught fish: dangles and turns in front of the camera
    if (this.catchGroup.visible) { this.revealT += dt; if (this.catchModel) animateFish(this.catchModel, t); const pop = Math.min(1, this.revealT / 0.5); const ease = 1 - Math.pow(1 - pop, 3) + Math.sin(pop * Math.PI) * 0.12;
      this.catchGroup.rotation.y += dt * 0.9; this.catchGroup.rotation.z = Math.sin(t * 3) * 0.12; this.catchGroup.position.y = 2.3 + Math.sin(t * 2) * 0.08 - (1 - ease) * 1.6; this.catchGroup.scale.setScalar(0.4 + 0.6 * ease);
      const big = !!this.catchGlow.userData.big; this.catchGlow.position.copy(this.catchGroup.position); this.catchGlow.scale.setScalar((big ? 5 : 3.4) * (0.9 + 0.1 * Math.sin(t * 3)) * ease);
      (this.catchGlow.material as THREE.SpriteMaterial).opacity = (big ? 0.85 : 0.5) * Math.min(1, this.revealT * 2);
      this.sparkles.position.copy(this.catchGroup.position).setY(this.catchGroup.position.y - 1); this.sparkles.rotation.y = t * 0.6; const sp = this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < sp.count; k++) { let y = sp.getY(k) + dt * (0.5 + (k % 5) * 0.12); if (y > 2.2) y = 0; sp.setY(k, y); } sp.needsUpdate = true; (this.sparkles.material as THREE.PointsMaterial).opacity = Math.min(1, this.revealT) * (big ? 1 : 0.7); }
    // camera: over the shoulder, looking where you aim (and toward the fish during the fight)
    const look = this.phase === 'reel' ? this.fishPos.clone().setY(0) : this.phase === 'show' ? this.catchGroup.position.clone() : new THREE.Vector3(STAND.x, 0, STAND.z).addScaledVector(fwd, 12);
    const orbit = this.phase === 'show' ? Math.min(1, this.revealT / 1.6) : 0; const oe = orbit * orbit * (3 - 2 * orbit);
    const camPos = this.phase === 'show' ? this.catchGroup.position.clone().addScaledVector(fwd, -(4.6 - 1.6 * oe)).addScaledVector(right, -1.6 + 1.2 * oe + Math.sin(t * 0.4) * 0.15).setY(3.6 - 0.7 * oe)
      : new THREE.Vector3(STAND.x, this.phase === 'reel' ? 5.2 : 4.6, STAND.z).addScaledVector(fwd, -6).addScaledVector(right, 2.1);
    this.camShake = Math.max(0, this.camShake - dt); if (this.camShake > 0) camPos.add(new THREE.Vector3((Math.random() - 0.5) * this.camShake * 0.3, (Math.random() - 0.5) * this.camShake * 0.3, 0));
    this.camera.position.lerp(camPos, Math.min(1, dt * 4)); const cur = this.camLook ?? look.clone(); cur.lerp(look, Math.min(1, dt * 3)); this.camLook = cur; this.camera.lookAt(cur);
    this.renderer.render(this.scene, this.camera);
  }
  private camLook: THREE.Vector3 | null = null;
  private catchModel: THREE.Group | null = null;
  dispose() {
    this.rodGeo?.dispose(); for (const d of this.disposables) d.dispose();
    for (const s of this.splashes) { (s.ring.material as THREE.Material).dispose(); (s.ring2.material as THREE.Material).dispose(); s.drops.geometry.dispose(); (s.drops.material as THREE.Material).dispose(); }
    this.catchGroup.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    for (const o of this.others.values()) this.dropOther(o); this.others.clear();
    this.renderer.dispose();
  }
}

export type OtherPose = 'idle' | 'cast' | 'reel' | 'catch';
interface OtherAngler { g: THREE.Group; tag: THREE.Sprite; rod: THREE.Mesh; line: THREE.Line; bob: THREE.Mesh; pose: OtherPose; at: number; yaw: number; power: number; fish: string | null; fishModel: THREE.Group | null; target: THREE.Vector3; splashed: boolean }
function disposeTree(g: THREE.Object3D) { g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.(); }); }
function makeTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,14,40,.75)'; g.beginPath(); g.roundRect(4, 10, 248, 44, 16); g.fill(); g.fillStyle = '#e8f6ff'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillText(name.slice(0, 16), 128, 42);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false })); sp.scale.set(2, 0.5, 1); return sp;
}

/** A 3D model of a catch: species colours and shape, scaled by weight. Junk gets its own props. */
export function buildFish(id: string, grams: number, tier: Tier = 'mid'): THREE.Group {
  const g = new THREE.Group(); const f = fishById(id); const kg = grams / 1000;
  const model = buildFishModel(id, tier);
  if (model) { g.add(model); g.userData.swim = model.userData.swim;
    if (id === 'koi') { const halo = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.14, depthWrite: false })); halo.scale.set(0.55, 0.75, 1.15); g.add(halo); }
    const k = Math.min(1.6, Math.max(0.55, 0.6 + Math.log10(1 + kg) * 0.9)); g.scale.setScalar(k); g.rotation.y = Math.PI / 2; return g; }
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
  // body: a sphere stretched along z and tapered toward the tail, with a countershaded scale texture (dark back, pale belly)
  const skin = fishSkin(mix(look.color, 0x0a0f14, 0.45), look.color, look.belly, look.spots);
  const mat = new THREE.MeshPhysicalMaterial({ map: skin, color: skin ? 0xffffff : look.color, roughness: 0.32, metalness: rare ? 0.3 : 0.12, clearcoat: 0.8, clearcoatRoughness: 0.25, sheen: 0.6, sheenColor: new THREE.Color(rare ? 0xbfe8ff : 0x9fb8c8), emissive: look.glow ?? 0x000000, emissiveIntensity: look.glow ? 0.35 : 0 });
  const bg = new THREE.SphereGeometry(0.5, 28, 18); bg.rotateX(Math.PI / 2); const bp = bg.getAttribute('position') as THREE.BufferAttribute; const uv = bg.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) { const z = bp.getZ(i); const tz = z < 0 ? 1 + z * 1.15 : 1 - z * z * 0.6; bp.setX(i, bp.getX(i) * tz); bp.setY(i, bp.getY(i) * tz + (z > 0.25 ? -(z - 0.25) * 0.12 : 0)); uv.setXY(i, z + 0.5, 0.5 - bp.getY(i) / Math.max(0.05, tz)); }
  bg.computeVertexNormals(); const body = new THREE.Mesh(bg, mat); body.scale.set(look.fat * 0.8, look.fat * 1.4, look.len); g.add(body);
  const finM = new THREE.MeshStandardMaterial({ color: mix(look.color, 0xffffff, 0.15), roughness: 0.5, transparent: true, opacity: 0.82, side: THREE.DoubleSide, emissive: look.glow ?? 0x000000, emissiveIntensity: look.glow ? 0.6 : 0 });
  // forked tail
  const ts = new THREE.Shape(); ts.moveTo(0, 0); ts.quadraticCurveTo(-0.25, 0.25, -0.55, 0.42); ts.quadraticCurveTo(-0.38, 0, -0.55, -0.42); ts.quadraticCurveTo(-0.25, -0.25, 0, 0);
  const tg = new THREE.ShapeGeometry(ts, 6); const tail = new THREE.Mesh(tg, finM); tail.rotation.y = Math.PI / 2; tail.scale.setScalar(look.fat * 1.3); tail.position.z = -look.len * 0.42; g.add(tail);
  // dorsal + pectoral fins
  const ds = new THREE.Shape(); ds.moveTo(-0.5, 0); ds.quadraticCurveTo(-0.1, 0.45, 0.35, 0.25); ds.lineTo(0.4, 0); ds.lineTo(-0.5, 0);
  const dg = new THREE.ShapeGeometry(ds, 5); const fin = new THREE.Mesh(dg, finM); fin.rotation.y = Math.PI / 2; fin.scale.set(look.len * 0.55, look.fat * 0.75, 1); fin.position.set(0, look.fat * 0.62, -look.len * 0.05); g.add(fin);
  const pg = new THREE.CircleGeometry(0.16, 8, 0, Math.PI); for (const sx of [-1, 1]) { const pf = new THREE.Mesh(pg, finM); pf.rotation.set(0.4, sx * 0.9, Math.PI / 2 * sx); pf.position.set(sx * look.fat * 0.36, -look.fat * 0.2, look.len * 0.12); g.add(pf); }
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.05, metalness: 0.2 }); const irisM = new THREE.MeshBasicMaterial({ color: mix(look.belly, 0xffffff, 0.3) });
  for (const sx of [-1, 1]) { const ir = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), irisM); ir.position.set(sx * look.fat * 0.3, look.fat * 0.12, look.len * 0.34); const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), eyeM); e.position.set(sx * (look.fat * 0.3 + 0.03), look.fat * 0.12, look.len * 0.35); g.add(ir, e); }
  if (id === 'koi') { const halo = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.18, depthWrite: false })); halo.scale.set(0.6, 0.8, 1.2); g.add(halo); }
  if (id === 'sturgeon') { const sm = new THREE.MeshLambertMaterial({ color: 0xc9c2b0 }); for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), sm); s.position.set(0, look.fat * 0.7, (i / 7 - 0.4) * look.len * 0.9); g.add(s); } }
  // size: a bit bigger for heavier fish (clamped so it fits the frame)
  const k = Math.min(1.6, Math.max(0.55, 0.6 + Math.log10(1 + kg) * 0.9)); g.scale.setScalar(k); g.rotation.y = Math.PI / 2; return g;
}
