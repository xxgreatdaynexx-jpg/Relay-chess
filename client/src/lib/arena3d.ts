/**
 * three.js first-person renderer for the Arena. World coords are (x, y) horizontal with z up;
 * three.js uses Y up, so world (x, y, z) maps to three (x, z, y). All textures are procedural (no external assets).
 */
import { applySkin, tickSkins } from './skinRender';
import * as THREE from 'three';
import type { ArenaMap, Material, Ramp } from '../../../shared/arenaMaps';
import type { WeaponId } from '../../../shared/fps';
import { buildGun, type GunModel } from './arenaGuns';

const W = (x: number, y: number, z: number) => new THREE.Vector3(x, z, y);

function canvasTex(draw: (g: CanvasRenderingContext2D, n: number) => void, n = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  draw(c.getContext('2d')!, n);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; // crunchy, old-school texels
  t.anisotropy = 4;
  return t;
}

function corrugated(g: CanvasRenderingContext2D, n: number, base: string, seed: number) {
  g.fillStyle = base; g.fillRect(0, 0, n, n);
  for (let x = 0; x < n; x += 8) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x, 0, 3, n); g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x + 4, 0, 2, n); }
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, n, 4); g.fillRect(0, n - 4, n, 4);
  grain(g, n, 0.2, seed);
  g.fillStyle = 'rgba(120,70,30,.25)'; for (let i = 0; i < 7; i++) g.fillRect((i * 47) % n, (i * 71) % n, 10, 18);
}

function grain(g: CanvasRenderingContext2D, n: number, amt: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n * n * 0.35; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${(rnd() * amt).toFixed(3)})`;
    g.fillRect((rnd() * n) | 0, (rnd() * n) | 0, 1 + ((rnd() * 2) | 0), 1);
  }
}

/** Procedural dust-era texture set. Each texture spans TEX_UNITS world units. */
const TEX_UNITS: Record<Material, number> = { sand: 4, plaster: 3, concrete: 3, crate: 1, metal: 2, sandbag: 1.2, wood: 2, container: 2.6, container2: 2.6, tile: 2, carpet: 3, drywall: 3 };
function makeTextures(): Record<Material, THREE.CanvasTexture> {
  return {
    sand: canvasTex((g, n) => { g.fillStyle = '#c9a66b'; g.fillRect(0, 0, n, n); grain(g, n, 0.18, 7); g.fillStyle = 'rgba(120,90,50,.12)'; for (let i = 0; i < 9; i++) g.fillRect((i * 37) % n, (i * 53) % n, 22, 9); }),
    plaster: canvasTex((g, n) => {
      g.fillStyle = '#d8bf8c'; g.fillRect(0, 0, n, n); grain(g, n, 0.14, 3);
      g.fillStyle = 'rgba(140,105,60,.25)'; g.fillRect(0, n - 14, n, 14); // dirty skirting
      g.strokeStyle = 'rgba(110,80,45,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(20, 30); g.lineTo(34, 52); g.lineTo(30, 70); g.stroke();
    }),
    concrete: canvasTex((g, n) => {
      g.fillStyle = '#a39a86'; g.fillRect(0, 0, n, n); grain(g, n, 0.2, 11);
      g.strokeStyle = 'rgba(60,55,45,.45)'; g.lineWidth = 2; g.strokeRect(1, 1, n - 2, n / 2 - 1); g.strokeRect(1, n / 2, n - 2, n / 2 - 2);
    }),
    crate: canvasTex((g, n) => {
      g.fillStyle = '#9a7340'; g.fillRect(0, 0, n, n);
      g.fillStyle = '#7b5a2e'; for (let i = 0; i < 6; i++) g.fillRect(0, i * (n / 6), n, 2);
      grain(g, n, 0.15, 5);
      g.strokeStyle = '#5a3f1c'; g.lineWidth = 10; g.strokeRect(5, 5, n - 10, n - 10);
      g.lineWidth = 9; g.beginPath(); g.moveTo(8, 8); g.lineTo(n - 8, n - 8); g.stroke();
    }),
    metal: canvasTex((g, n) => {
      g.fillStyle = '#6f746d'; g.fillRect(0, 0, n, n);
      for (let x = 0; x < n; x += 16) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, n); }
      grain(g, n, 0.2, 13); g.fillStyle = 'rgba(140,70,30,.25)'; g.fillRect(0, n - 20, n, 20);
    }),
    sandbag: canvasTex((g, n) => {
      g.fillStyle = '#8c7a55'; g.fillRect(0, 0, n, n);
      for (let r = 0; r < 4; r++) for (let c = -1; c < 3; c++) {
        const x = c * (n / 2) + (r % 2 ? n / 4 : 0), y = r * (n / 4);
        g.fillStyle = r % 2 ? '#a08d63' : '#95825a'; g.beginPath(); g.ellipse(x + n / 4, y + n / 8, n / 4 - 2, n / 8 - 2, 0, 0, 7); g.fill();
      }
      grain(g, n, 0.15, 17);
    }),
    // corrugated shipping-container steel, rusty red and faded blue
    container: canvasTex((g, n) => corrugated(g, n, '#8a3b26', 21)),
    container2: canvasTex((g, n) => corrugated(g, n, '#3f5f73', 23)),
    tile: canvasTex((g, n) => {
      g.fillStyle = '#b9ad94'; g.fillRect(0, 0, n, n);
      g.strokeStyle = 'rgba(70,60,45,.4)'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, (i * n) / 4); g.lineTo(n, (i * n) / 4); g.moveTo((i * n) / 4, 0); g.lineTo((i * n) / 4, n); g.stroke(); }
      grain(g, n, 0.12, 29);
    }),
    carpet: canvasTex((g, n) => { g.fillStyle = '#5d6168'; g.fillRect(0, 0, n, n); grain(g, n, 0.3, 31); g.fillStyle = 'rgba(30,30,35,.15)'; for (let i = 0; i < 6; i++) g.fillRect((i * 41) % n, (i * 29) % n, 30, 14); }),
    drywall: canvasTex((g, n) => {
      g.fillStyle = '#c8c0ae'; g.fillRect(0, 0, n, n); grain(g, n, 0.1, 37);
      g.fillStyle = 'rgba(90,80,60,.3)'; g.fillRect(0, n - 10, n, 10);
      g.fillStyle = 'rgba(110,100,80,.18)'; g.fillRect(n / 2, 0, 2, n);
    }),
    wood: canvasTex((g, n) => { g.fillStyle = '#7a5530'; g.fillRect(0, 0, n, n); for (let y = 0; y < n; y += 12) { g.fillStyle = 'rgba(40,25,10,.4)'; g.fillRect(0, y, n, 2); } grain(g, n, 0.15, 19); }),
  };
}

/** Box with UVs scaled so textures keep a constant world size on every face. */
function boxGeo(sx: number, sy: number, sz: number, unit: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Face order: +X, -X, +Y, -Y, +Z, -Z (4 verts each). Dimensions per face (u, v):
  const dims: Array<[number, number]> = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / unit, (uv.getY(k) * dims[f][1]) / unit);
  }
  return g;
}

/** Solid wedge for a ramp, planar-mapped UVs. */
function rampGeo(r: Ramp, unit: number): THREE.BufferGeometry {
  const { x0, y0, x1, y1, zLow: lo, zHigh: hi } = r;
  const h = (x: number, y: number) => {
    const t = r.dir === '+x' ? (x - x0) / (x1 - x0) : r.dir === '-x' ? (x1 - x) / (x1 - x0) : r.dir === '+y' ? (y - y0) / (y1 - y0) : (y1 - y) / (y1 - y0);
    return lo + (hi - lo) * t;
  };
  const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const;
  const top = c.map(([x, y]) => W(x, y, h(x, y)));
  const bot = c.map(([x, y]) => W(x, y, 0));
  const pos: number[] = [];
  const uvs: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, side: boolean) => {
    for (const v of [a, b, d]) { pos.push(v.x, v.y, v.z); uvs.push(side ? (v.x + v.z) / unit : v.x / unit, side ? v.y / unit : v.z / unit); }
  };
  // top (counter-clockwise seen from above in three space)
  tri(top[0], top[2], top[1], false); tri(top[0], top[3], top[2], false);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(bot[i], bot[j], top[j], true); tri(bot[i], top[j], top[i], true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** First-person weapon state: kick 0..1 (just fired), lower 0..1 (switching), reload 0..1 progress or -1, bob walk phase. */
export interface Viewmodel3D { /** aiming down sights: gun pulled to centre, still visible */ ads?: boolean; w: WeaponId; kick: number; lower: number; reload: number; bob: number; muzzle: boolean; /** equipped skin token */ sk?: string | null; /** knife swing 0..1, or -1 */ swing?: number; heavy?: boolean }
export interface View3D { x: number; y: number; z: number; a: number; p: number; zoom: number; vm?: Viewmodel3D | null }
export interface Soldier3D {
  id: string; x: number; y: number; z: number; a: number; p: number; color: string; flash: boolean; moving: boolean; dead?: number; t: number; w?: WeaponId; fire?: boolean;
  /** skin token for the held weapon */ sk?: string | null;
  /** off the ground (jumping / falling) */ air?: boolean;
  /** 0..1 reload progress, or undefined */ reload?: number;
  /** 0..1 weapon-switch lowering */ sw?: number;
  /** 0..1 recoil kick */ recoil?: number;
  /** 0..1 hit flinch */ flinch?: number;
  /** death fall direction (radians, relative to facing) */ fall?: number;
  /** horizontal speed, tiles/s (walk vs run cycle) */ speed?: number;
  /** crouching: hips drop, one knee forward, one back (matches the lowered server hitboxes) */ crouch?: boolean;
  /** sprinting: forward lean, longer stride, gun lowered */ sprint?: boolean;
  /** knife attack progress 0..1 (heavy = stab, else slash) */ melee?: number; heavy?: boolean;
}
export interface Fx3D {
  drones: Array<{ x: number; y: number; z: number }>;
  strikes: Array<{ x: number; y: number; z: number; r: number }>;
  booms: Array<{ x: number; y: number; z: number; t: number; big: boolean }>;
  /** Bullet streaks: t is seconds since the shot. */
  tracers: Array<{ o: [number, number, number]; e: [number, number, number]; t: number; sniper?: boolean }>;
  /** RPG rockets in flight (extrapolated from the server's last snapshot). */
  rockets?: Array<{ id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; seek?: boolean }>;
  /** Dropped guns on the floor: `left` ms until they vanish (blink in the last second). */
  drops?: Array<{ id: number; w: WeaponId; x: number; y: number; z: number; left: number; sk?: string }>;
}

/** How fast a tracer streak flies (tiles/s) and how long its glowing tail is. */
export const TRACER_SPEED = 160;
export const TRACER_LEN = 2.6;
/** Sniper shots leave a lingering vapour trail this long (s). */
export const SNIPER_TRAIL_S = 0.9;

type PKind = 'spark' | 'dust' | 'puff' | 'smoke' | 'fire' | 'debris';
interface Particle { k: PKind; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; r: number; g: number; b: number }

/** Soft round dot, for smoke/dust/puff particles. */
function softDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
/** Bullet hole: dark scorched centre with a ragged lighter ring. */
function holeTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 15);
  rg.addColorStop(0, 'rgba(10,8,6,1)'); rg.addColorStop(0.35, 'rgba(25,20,15,.95)'); rg.addColorStop(0.6, 'rgba(60,50,40,.5)'); rg.addColorStop(1, 'rgba(60,50,40,0)');
  g.fillStyle = rg; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
}

interface Soldier { g: THREE.Group; rig: THREE.Group; body: THREE.MeshLambertMaterial; legs: THREE.Object3D[]; seen: boolean; aim: THREE.Group; guns: Map<WeaponId, GunModel & { flash: THREE.Sprite }>; w: WeaponId | null; mats: THREE.MeshLambertMaterial[] }

/** Soft star-shaped muzzle flash, procedural. */
function flashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  rg.addColorStop(0, 'rgba(255,255,230,1)'); rg.addColorStop(0.25, 'rgba(255,210,110,.9)'); rg.addColorStop(0.6, 'rgba(255,130,30,.35)'); rg.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = rg;
  g.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 11 : 31; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
  g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function easeOutBounce(x: number): number {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

export class Arena3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 16 / 10, 0.05, 140);
  private tex = makeTextures();
  private mats = new Map<Material, THREE.MeshLambertMaterial>();
  private mapGroup = new THREE.Group();
  private soldiers = new Map<string, Soldier>();
  private vmScene = new THREE.Scene();
  private vmCam = new THREE.PerspectiveCamera(62, 16 / 10, 0.01, 5);
  private vmGuns = new Map<WeaponId, GunModel & { flash: THREE.Sprite }>();
  private vmLight = new THREE.PointLight(0xffc070, 0, 3, 1.5);
  private worldFlash = new THREE.PointLight(0xffb060, 0, 7, 1.5);
  private flashMat: THREE.SpriteMaterial;
  private dropObjs = new Map<number, THREE.Group>();
  private sleeveMat = new THREE.MeshLambertMaterial({ color: 0x4d5338 });
  private gloveMat = new THREE.MeshLambertMaterial({ color: 0x1e1f1c });
  private pool: Record<'drone' | 'strike' | 'boom' | 'tracer', THREE.Object3D[]> = { drone: [], strike: [], boom: [], tracer: [] };
  mapId = '';
  /** Reduced motion: no camera-ish wobble, fewer particles, no ragdoll tumble. */
  calm = false;
  private parts: Particle[] = [];
  private readonly MAX_PARTS = 700;
  private small!: THREE.Points;
  private big!: THREE.Points;
  private decals: THREE.Mesh[] = [];
  private decalAt = 0;
  private booms3: Array<{ sp: THREE.Sprite; age: number; size: number }> = [];
  private boomTex: THREE.Texture | null = null;
  private rocketPool: THREE.Object3D[] = [];
  private trails: Array<{ line: THREE.Line; age: number }> = [];
  private shells: Array<{ m: THREE.Mesh; vx: number; vy: number; vz: number; age: number }> = [];
  private lastT = 0;
  private vmAt = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x8a6a3c, 1.25));
    const sun = new THREE.DirectionalLight(0xffe2b0, 1.6);
    sun.position.set(-30, 50, -10);
    this.scene.add(sun);
    this.scene.add(this.mapGroup);
    this.scene.add(this.worldFlash);
    // Viewmodel: its own scene + camera, drawn over the world after a depth clear so guns never clip walls.
    this.vmScene.add(new THREE.HemisphereLight(0xfff1d6, 0x6a5a3c, 2.2));
    const key = new THREE.DirectionalLight(0xffe2b0, 2.6); key.position.set(-1, 2, 1); this.vmScene.add(key);
    this.vmScene.add(this.vmLight);
    this.flashMat = new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.initFx();
  }

  // ------------------------------------------------------------ pooled effects

  private initFx() {
    const mk = (size: number, additive: boolean) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.MAX_PARTS * 3), 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.MAX_PARTS * 3), 3));
      geo.setDrawRange(0, 0);
      const m = new THREE.PointsMaterial({ size, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? 1 : 0.55 });
      const pts = new THREE.Points(geo, m); pts.frustumCulled = false; this.scene.add(pts);
      return pts;
    };
    this.small = mk(0.09, true);
    this.big = mk(0.7, false);
    const holeMat = new THREE.MeshBasicMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const holeGeo = new THREE.PlaneGeometry(0.16, 0.16);
    for (let i = 0; i < 80; i++) { const d = new THREE.Mesh(holeGeo, holeMat); d.visible = false; this.scene.add(d); this.decals.push(d); }
    new THREE.TextureLoader().load('/sprites/explosion.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; this.boomTex = t; });
  }

  private emit(k: PKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, rgb: [number, number, number]) {
    if (this.parts.length >= this.MAX_PARTS) this.parts.shift();
    this.parts.push({ k, x, y, z, vx, vy, vz, age: 0, life, size, r: rgb[0], g: rgb[1], b: rgb[2] });
  }

  /**
   * A bullet hits something: world hits leave a hole decal, sparks (metal/concrete) and a dust puff along the
   * surface normal; player hits show a blood-free grey-white puff. Normals are world (x, y, z-up).
   */
  impact(x: number, y: number, z: number, n: [number, number, number], player: boolean, mat?: string) {
    const R = Math.random, cnt = this.calm ? 0.4 : 1;
    if (player) {
      for (let i = 0; i < 7 * cnt; i++) this.emit('puff', x, y, z, (R() - 0.5) * 1.4, (R() - 0.5) * 1.4, R() * 1.2, 0.35, 0.35, [0.92, 0.9, 0.86]);
      return;
    }
    const d = this.decals[this.decalAt++ % this.decals.length];
    d.visible = true;
    d.position.copy(W(x + n[0] * 0.01, y + n[1] * 0.01, z + n[2] * 0.01));
    d.lookAt(W(x + n[0], y + n[1], z + n[2]));
    d.rotateZ(R() * Math.PI);
    const hard = mat === 'metal' || mat === 'concrete' || mat === 'container' || mat === 'container2' || mat === 'tile';
    const sparks = hard ? 8 : 3;
    for (let i = 0; i < sparks * cnt; i++) {
      const s = 2 + R() * 3;
      this.emit('spark', x, y, z, n[0] * s + (R() - 0.5) * 3, n[1] * s + (R() - 0.5) * 3, n[2] * s + R() * 2, 0.18 + R() * 0.15, 1, [1, 0.8, 0.35]);
    }
    const dust: [number, number, number] = mat === 'sand' || mat === 'sandbag' ? [0.78, 0.66, 0.45] : mat === 'crate' || mat === 'wood' ? [0.55, 0.4, 0.25] : [0.62, 0.6, 0.55];
    for (let i = 0; i < 4 * cnt; i++) this.emit('dust', x, y, z, n[0] * (0.6 + R()) + (R() - 0.5) * 0.4, n[1] * (0.6 + R()) + (R() - 0.5) * 0.4, n[2] * (0.6 + R()) + 0.2, 0.6 + R() * 0.4, 0.45, dust);
  }

  /** Rocket / airstrike blast: Dayne's chess explosion sprite, a fireball, smoke and debris. */
  explode(x: number, y: number, z: number, big: boolean) {
    const R = Math.random, cnt = this.calm ? 0.35 : 1;
    const mat = new THREE.SpriteMaterial({ map: this.boomTex ? this.boomTex.clone() : null, color: this.boomTex ? 0xffffff : 0xffa040, transparent: true, depthWrite: false });
    if (mat.map) { mat.map.repeat.set(0.25, 0.25); mat.map.needsUpdate = true; }
    const sp = new THREE.Sprite(mat);
    const size = big ? 5.5 : 4.2;
    sp.position.copy(W(x, y, z + 0.6)); sp.scale.setScalar(size);
    this.scene.add(sp);
    this.booms3.push({ sp, age: 0, size });
    for (let i = 0; i < 26 * cnt; i++) { const a = R() * 6.283, s = 2 + R() * 6; this.emit('fire', x, y, z + 0.3, Math.cos(a) * s, Math.sin(a) * s, R() * 5, 0.35 + R() * 0.3, 1, [1, 0.55 + R() * 0.3, 0.15]); }
    for (let i = 0; i < 18 * cnt; i++) { const a = R() * 6.283, s = 0.5 + R() * 2; this.emit('smoke', x, y, z + 0.5, Math.cos(a) * s, Math.sin(a) * s, 0.6 + R() * 1.4, 1.4 + R() * 1.2, 1.4, [0.32, 0.3, 0.28]); }
    for (let i = 0; i < 12 * cnt; i++) { const a = R() * 6.283, s = 3 + R() * 4; this.emit('debris', x, y, z + 0.3, Math.cos(a) * s, Math.sin(a) * s, 3 + R() * 4, 0.9, 1, [0.35, 0.28, 0.2]); }
  }

  /** First-person brass: a casing flips out of the ejection port to the right. */
  ejectShell(w: WeaponId) {
    if (w === 'rocket') return;
    let s = this.shells.find((x) => x.age > 0.7);
    if (!s) {
      if (this.shells.length > 14) return;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w === 'shotgun' ? 0.012 : 0.006, w === 'shotgun' ? 0.012 : 0.006, w === 'shotgun' ? 0.05 : 0.025, 6), new THREE.MeshLambertMaterial({ color: w === 'shotgun' ? 0xaa2a20 : 0xd8a840, emissive: 0x221100 }));
      this.vmScene.add(m);
      s = { m, vx: 0, vy: 0, vz: 0, age: 0 };
      this.shells.push(s);
    }
    s.age = 0;
    s.m.visible = true;
    s.m.position.copy(this.vmAt).add(new THREE.Vector3(0.03, 0.04, -0.12));
    s.vx = 0.7 + Math.random() * 0.4; s.vy = 0.9 + Math.random() * 0.4; s.vz = 0.15;
  }

  private stepFx(dt: number, rockets: NonNullable<Fx3D['rockets']>, tracers: Fx3D['tracers']) {
    // particles
    const G = 9;
    const live: Particle[] = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const drag = p.k === 'smoke' || p.k === 'dust' || p.k === 'puff' ? 2.2 : p.k === 'fire' ? 3.5 : 0.3;
      p.vx -= p.vx * drag * dt; p.vy -= p.vy * drag * dt; p.vz -= p.vz * drag * dt;
      if (p.k === 'spark' || p.k === 'debris') p.vz -= G * dt;
      if (p.k === 'smoke') p.vz += 0.6 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; }
      live.push(p);
    }
    this.parts = live;
    const fill = (pts: THREE.Points, small: boolean) => {
      const pos = pts.geometry.attributes.position as THREE.BufferAttribute, col = pts.geometry.attributes.color as THREE.BufferAttribute;
      let n = 0;
      for (const p of this.parts) {
        const isSmall = p.k === 'spark' || p.k === 'fire' || p.k === 'debris';
        if (isSmall !== small) continue;
        const f = 1 - p.age / p.life;
        pos.setXYZ(n, p.x, p.z, p.y);
        const k = small ? f : Math.min(1, f * 1.5);
        col.setXYZ(n, p.r * k, p.g * k, p.b * k);
        n++;
      }
      pos.needsUpdate = col.needsUpdate = true;
      pts.geometry.setDrawRange(0, n);
    };
    fill(this.small, true); fill(this.big, false);
    // explosion sprites: 16 frames of the 4x4 sheet over 0.55 s
    this.booms3 = this.booms3.filter((b) => {
      b.age += dt;
      const fr = Math.floor((b.age / 0.55) * 16);
      if (fr >= 16) { this.scene.remove(b.sp); b.sp.material.map?.dispose(); b.sp.material.dispose(); return false; }
      const m = b.sp.material.map;
      if (m) m.offset.set((fr % 4) * 0.25, 0.75 - Math.floor(fr / 4) * 0.25);
      else b.sp.material.opacity = 1 - b.age / 0.55;
      b.sp.scale.setScalar(b.size * (0.85 + b.age * 0.6));
      return true;
    });
    // rockets: body + glowing exhaust, leaving a smoke trail
    for (const o of this.rocketPool) o.visible = false;
    rockets.forEach((r, i) => {
      let o = this.rocketPool[i];
      if (!o) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), new THREE.MeshLambertMaterial({ color: 0x4a5a3a }));
        body.rotation.z = Math.PI / 2; g.add(body);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), new THREE.MeshLambertMaterial({ color: 0x2a2a26 }));
        tip.rotation.z = -Math.PI / 2; tip.position.x = 0.29; g.add(tip);
        const glow = new THREE.Sprite(this.flashMat); glow.scale.setScalar(0.45); glow.position.x = -0.26; g.add(glow);
        const seeker = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff2020, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
        seeker.scale.setScalar(0.5); seeker.position.x = 0.3; seeker.name = 'seeker'; g.add(seeker);
        this.scene.add(g); this.rocketPool.push(g); o = g;
      }
      o.visible = true;
      const sk = o.getObjectByName('seeker');
      if (sk) { sk.visible = !!r.seek; sk.scale.setScalar(0.4 + 0.15 * Math.sin(performance.now() / 60)); }
      o.position.copy(W(r.x, r.y, r.z));
      o.lookAt(W(r.x + r.vy * 0 + r.vx, r.y + r.vy, r.z + r.vz));
      o.rotateY(-Math.PI / 2);
      const sp = Math.hypot(r.vx, r.vy, r.vz) || 1;
      const n = this.calm ? 1 : 3;
      for (let k = 0; k < n; k++) {
        const b = (k / n) * dt;
        this.emit('smoke', r.x - (r.vx / sp) * 0.3 - r.vx * b, r.y - (r.vy / sp) * 0.3 - r.vy * b, r.z - (r.vz / sp) * 0.3 - r.vz * b, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0.2, 1.2, 0.8, [0.75, 0.73, 0.7]);
      }
      this.emit('fire', r.x - (r.vx / sp) * 0.3, r.y - (r.vy / sp) * 0.3, r.z - (r.vz / sp) * 0.3, -r.vx * 0.1, -r.vy * 0.1, 0, 0.08, 1, [1, 0.7, 0.3]);
    });
    // sniper vapour trails
    for (const t of tracers) if (t.sniper && t.t < dt * 1.01 + 1e-3 && t.t >= 0) {
      const geo = new THREE.BufferGeometry();
      const a = W(...t.o), e = W(...t.e);
      geo.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, e.x, e.y, e.z], 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.7, depthWrite: false }));
      this.scene.add(line); this.trails.push({ line, age: 0 });
    }
    this.trails = this.trails.filter((tr) => {
      tr.age += dt;
      if (tr.age > SNIPER_TRAIL_S) { this.scene.remove(tr.line); tr.line.geometry.dispose(); (tr.line.material as THREE.Material).dispose(); return false; }
      (tr.line.material as THREE.LineBasicMaterial).opacity = 0.7 * (1 - tr.age / SNIPER_TRAIL_S);
      return true;
    });
    // viewmodel brass
    for (const s of this.shells) {
      if (s.age > 0.7) { s.m.visible = false; continue; }
      s.age += dt;
      s.vy -= 6 * dt;
      s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt;
      s.m.rotation.x += 18 * dt; s.m.rotation.z += 11 * dt;
    }
  }

  private flashSprite(size: number, at: [number, number, number]): THREE.Sprite {
    const sp = new THREE.Sprite(this.flashMat);
    sp.scale.setScalar(size); sp.position.set(...at); sp.visible = false; sp.renderOrder = 10;
    return sp;
  }

  /** Forearm box running from a hand point toward an elbow point (both in the parent's space). */
  private arm(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, thick: number, mat: THREE.Material) {
    const len = from.distanceTo(to);
    const geo = new THREE.BoxGeometry(thick, thick, len); geo.translate(0, 0, len / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), to.clone().sub(from).normalize());
    parent.add(m);
    return m;
  }

  /** Floating, spinning pickups with the owner's skin and a soft glow; blink + fade in the last second. */
  private renderDrops(drops: NonNullable<Fx3D['drops']>) {
    const now = performance.now();
    const live = new Set<number>();
    for (const d of drops) {
      live.add(d.id);
      let g = this.dropObjs.get(d.id);
      if (!g) {
        g = new THREE.Group();
        const gun = buildGun(d.w);
        applySkin(gun.root, d.sk ?? null);
        gun.root.scale.setScalar(1.7);
        g.add(gun.root);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashMat.map, color: 0xffd36a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
        glow.scale.setScalar(1.1); glow.name = 'glow'; g.add(glow);
        this.scene.add(g); this.dropObjs.set(d.id, g);
      }
      const blink = d.left < 1000;
      g.visible = !blink || Math.floor(now / 110) % 2 === 0;
      const fade = blink ? Math.max(0.2, d.left / 1000) : 1;
      g.scale.setScalar(fade);
      g.position.copy(W(d.x, d.y, d.z + 0.55 + Math.sin(now / 300 + d.id) * 0.08));
      g.rotation.y = now / 600 + d.id;
    }
    for (const [id, g] of this.dropObjs) if (!live.has(id)) { this.scene.remove(g); this.dropObjs.delete(id); }
  }

  private vmGun(w: WeaponId) {
    let g = this.vmGuns.get(w);
    if (g) return g;
    const m = buildGun(w);
    const s = m.spec;
    // gloved hands + sleeves, in gun space
    const grip = new THREE.Vector3(0, -0.045, 0.012);
    const sup = new THREE.Vector3(...s.support);
    const glove = (at: THREE.Vector3, sx: number) => { const h = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.07, 0.075), this.gloveMat); h.position.copy(at); m.root.add(h); };
    glove(grip, 0.05);
    glove(sup.clone().add(new THREE.Vector3(-0.005, -0.01, 0)), 0.055);
    this.arm(m.root, grip.clone().add(new THREE.Vector3(0.01, -0.02, 0.04)), new THREE.Vector3(0.12, -0.26, 0.38), 0.07, this.sleeveMat);
    this.arm(m.root, sup.clone().add(new THREE.Vector3(-0.01, -0.03, 0.03)), new THREE.Vector3(-0.22, -0.3, sup.z + 0.4), 0.07, this.sleeveMat);
    const flash = this.flashSprite(s.flash * 1.6, s.muzzle);
    m.root.add(flash);
    m.root.visible = false;
    this.vmScene.add(m.root);
    g = { ...m, flash };
    this.vmGuns.set(w, g);
    return g;
  }

  private renderViewmodel(vm: Viewmodel3D | null | undefined) {
    for (const g of this.vmGuns.values()) g.root.visible = false;
    this.vmLight.intensity = 0;
    if (!vm) return;
    const g = this.vmGun(vm.w);
    applySkin(g.root, vm.sk);
    const [vx, vy, vz] = g.spec.view;
    const heavy = vm.w === 'shotgun' || vm.w === 'sniper' || vm.w === 'rocket' ? 1.6 : 1;
    const k = vm.kick * vm.kick;
    const r = vm.reload >= 0 && vm.reload <= 1 ? Math.sin(Math.PI * vm.reload) : 0;
    const sway = Math.sin(vm.bob) * 0.006, dip = Math.abs(Math.cos(vm.bob)) * 0.006;
    g.root.visible = true;
    const ax = vm.ads ? 0 : vx, ay = vm.ads ? vy * 0.55 : vy;
    g.root.position.set(ax + sway * (vm.ads ? 0.3 : 1), ay - dip - vm.lower * 0.28 - r * 0.05, vz + k * 0.045 * heavy);
    this.vmAt.copy(g.root.position);
    g.root.rotation.set(k * 0.12 * heavy - vm.lower * 0.7 + r * 0.3, vm.ads ? 0 : 0.06, -r * 0.55);
    // magazine / warhead: out during the first half of a reload, back in the second
    const rel = vm.reload;
    const out = rel < 0 ? 0 : rel < 0.15 ? rel / 0.15 : rel < 0.55 ? 1 : rel < 0.8 ? 1 - (rel - 0.55) / 0.25 : 0;
    if (vm.w === 'rocket') g.mag.position.set(0, -out * 0.1, -out * 0.2); else g.mag.position.set(0, -out * 0.22, 0);
    g.mag.visible = out < 0.98;
    if (vm.w === 'knife') {
      g.flash.visible = false;
      const t = vm.swing ?? -1;
      if (t >= 0) {
        const e = Math.sin(Math.PI * Math.min(1, t * 1.4)); // out and back
        if (vm.heavy) { g.root.position.z -= e * 0.22; g.root.position.x -= e * 0.06; g.root.rotation.x -= e * 0.25; } // forward stab
        else { g.root.position.x -= e * 0.2; g.root.rotation.y += e * 1.1; g.root.rotation.z += e * 0.5; } // right-to-left slash
      }
      return;
    }
    g.flash.visible = vm.muzzle;
    if (vm.muzzle) {
      g.flash.material.rotation = Math.random() * Math.PI;
      g.flash.scale.setScalar(g.spec.flash * (1.3 + Math.random() * 0.7));
      this.vmLight.position.set(vx + g.spec.muzzle[0], vy + g.spec.muzzle[1], vz + g.spec.muzzle[2]);
      this.vmLight.intensity = 4;
    }
  }

  private mat(m: Material): THREE.MeshLambertMaterial {
    let x = this.mats.get(m);
    if (!x) { x = new THREE.MeshLambertMaterial({ map: this.tex[m] }); this.mats.set(m, x); }
    return x;
  }

  setMap(map: ArenaMap) {
    if (this.mapId === map.id) return;
    this.mapId = map.id;
    this.mapGroup.clear();
    this.scene.background = new THREE.Color(map.sky);
    this.scene.fog = new THREE.Fog(map.fog, 18, 75);
    // Ground: playable area plus a wide apron of sand beyond the walls.
    const gtex = this.tex[map.ground].clone();
    gtex.needsUpdate = true;
    gtex.repeat.set(200 / TEX_UNITS[map.ground], 200 / TEX_UNITS[map.ground]);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ map: gtex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(map.w / 2, 0, map.d / 2);
    this.mapGroup.add(ground);
    for (const s of map.solids) {
      // Inset every box by 2 mm: touching/stacked crates no longer share coplanar faces (z-fighting flicker).
      // Collision stays on the exact shared/arenaMaps numbers.
      const E = 0.002;
      const sx = s.x1 - s.x0 - E * 2, sy = s.z1 - s.z0 - E * 2, sz = s.y1 - s.y0 - E * 2;
      const mesh = new THREE.Mesh(boxGeo(sx, sy, sz, TEX_UNITS[s.mat]), this.mat(s.mat));
      mesh.position.copy(W((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2));
      this.mapGroup.add(mesh);
    }
    for (const r of map.ramps) this.mapGroup.add(new THREE.Mesh(rampGeo(r, TEX_UNITS[r.mat]), new THREE.MeshLambertMaterial({ map: this.tex[r.mat], side: THREE.DoubleSide })));
  }

  resize(w: number, h: number) {
    const c = this.renderer.domElement;
    if (c.width === w && c.height === h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private soldier(id: string, color: string) {
    let s = this.soldiers.get(id);
    if (s) return s;
    const g = new THREE.Group();
    const outer = g;
    const rig = new THREE.Group(); outer.add(rig);
    const body = new THREE.MeshLambertMaterial({ color, transparent: true });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc89a70, transparent: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b2a26, transparent: true });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = rig) => {
      const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o;
    };
    const legs: THREE.Object3D[] = [];
    for (const side of [-0.11, 0.11]) {
      const pivot = new THREE.Group(); pivot.position.set(0, 0.8, side); rig.add(pivot);
      add(new THREE.BoxGeometry(0.18, 0.8, 0.17), dark, 0, -0.4, 0, pivot);
      legs.push(pivot);
    }
    add(new THREE.BoxGeometry(0.3, 0.58, 0.48), body, 0, 1.08, 0); // torso
    add(new THREE.BoxGeometry(0.16, 0.12, 0.5), dark, 0.02, 0.86, 0); // belt
    add(new THREE.BoxGeometry(0.26, 0.26, 0.24), skin, 0, 1.53, 0); // head
    add(new THREE.BoxGeometry(0.29, 0.1, 0.27), body, 0, 1.68, 0); // helmet/cap
    add(new THREE.BoxGeometry(0.06, 0.06, 0.2), dark, 0.13, 1.56, 0); // goggles
    // Arms + gun hang off a shoulder pivot that follows the player's pitch.
    const aim = new THREE.Group(); aim.position.set(0.04, 1.3, 0.05); rig.add(aim);
    this.scene.add(outer);
    s = { g: outer, rig, body, legs, seen: true, aim, guns: new Map(), w: null, mats: [body, skin, dark] };
    this.soldiers.set(id, s);
    return s;
  }

  private take(kind: 'drone' | 'strike' | 'boom' | 'tracer', i: number, make: () => THREE.Object3D): THREE.Object3D {
    const list = this.pool[kind];
    while (list.length <= i) { const o = make(); this.scene.add(o); list.push(o); }
    list[i].visible = true;
    return list[i];
  }

  render(view: View3D, soldiers: Soldier3D[], fx: Fx3D) {
    tickSkins(performance.now());
    const cam = this.camera;
    const fov = 68 / view.zoom;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.position.copy(W(view.x, view.y, view.z));
    const cp = Math.cos(view.p);
    cam.lookAt(W(view.x + Math.cos(view.a) * cp, view.y + Math.sin(view.a) * cp, view.z + Math.sin(view.p)));
    for (const s of this.soldiers.values()) s.seen = false;
    let flashAt: THREE.Vector3 | null = null;
    for (const p of soldiers) {
      const s = this.soldier(p.id, p.color);
      s.seen = true;
      s.g.position.copy(W(p.x, p.y, p.z));
      s.g.rotation.set(0, -p.a, 0);
      this.animate(s, p);
      s.body.emissive.setHex(p.flash ? 0x554433 : 0x000000);
      this.holdGun(s, p.w ?? 'pistol', p.dead === undefined ? p.p : 0);
      this.poseAim(s, p);
      const held = s.guns.get(p.w ?? 'pistol');
      if (held) applySkin(held.root, p.sk);
      if (held) held.flash.visible = !!p.fire && p.dead === undefined;
      if (p.fire && p.dead === undefined) { flashAt = s.g.position; }
    }
    for (const [id, s] of this.soldiers) {
      s.g.visible = s.seen;
      if (!s.seen && !soldiers.some((p) => p.id === id)) { this.scene.remove(s.g); this.soldiers.delete(id); }
    }
    for (const k of Object.keys(this.pool) as Array<keyof typeof this.pool>) for (const o of this.pool[k]) o.visible = false;
    fx.drones.forEach((d, i) => {
      const o = this.take('drone', i, () => {
        const g = new THREE.Group();
        const m = new THREE.MeshLambertMaterial({ color: 0x33373a });
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 2.2), m); g.add(wing);
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.26), m); g.add(body);
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0xff3322 })); light.position.set(0.5, -0.15, 0); g.add(light);
        return g;
      });
      o.position.copy(W(d.x, d.y, d.z));
      o.rotation.y = performance.now() / 700;
    });
    fx.strikes.forEach((s, i) => {
      const o = this.take('strike', i, () => {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff3a22, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        return m;
      }) as THREE.Mesh;
      o.position.copy(W(s.x, s.y, s.z + 0.05));
      o.scale.setScalar(s.r);
      (o.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.4 * Math.sin(performance.now() / 80);
    });
    fx.booms.forEach((b, i) => {
      const o = this.take('boom', i, () => new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false }))) as THREE.Mesh;
      o.position.copy(W(b.x, b.y, b.z + 0.3));
      o.scale.setScalar((b.big ? 1.6 : 1) * (0.3 + b.t * 0.8));
      const m = o.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, 1 - b.t);
      m.color.setHSL(0.09 - b.t * 0.06, 1, 0.65 - b.t * 0.4);
    });
    const tnow = performance.now() / 1000;
    const dt = this.lastT ? Math.min(0.1, tnow - this.lastT) : 0;
    this.lastT = tnow;
    this.stepFx(dt, fx.rockets ?? [], fx.tracers);
    this.renderDrops(fx.drops ?? []);
    fx.tracers.forEach((t, i) => {
      const o = this.take('tracer', i, () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true }));
      }) as THREE.Line;
      // A short glowing streak that flies from the muzzle to the impact point.
      const len = Math.hypot(t.e[0] - t.o[0], t.e[1] - t.o[1], t.e[2] - t.o[2]) || 1;
      const head = Math.min(len, t.t * TRACER_SPEED), tail = Math.max(0, head - (t.sniper ? TRACER_LEN * 2 : TRACER_LEN));
      const at = (d: number) => W(t.o[0] + ((t.e[0] - t.o[0]) * d) / len, t.o[1] + ((t.e[1] - t.o[1]) * d) / len, t.o[2] + ((t.e[2] - t.o[2]) * d) / len);
      const a = at(tail), e = at(head);
      const pos = o.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, e.x, e.y, e.z); pos.needsUpdate = true;
      o.geometry.computeBoundingSphere();
      const mat = o.material as THREE.LineBasicMaterial;
      mat.color.setHex(t.sniper ? 0xe8f0ff : 0xffe7a0);
      mat.opacity = tail >= len ? 0 : 1;
    });
    // One shared world light for muzzle flashes (always in the scene so shaders never recompile).
    if (view.vm?.muzzle) { this.worldFlash.position.copy(cam.position); this.worldFlash.intensity = 3; }
    else if (flashAt) { this.worldFlash.position.set(flashAt.x, flashAt.y + 1.3, flashAt.z); this.worldFlash.intensity = 2; }
    else this.worldFlash.intensity = 0;
    this.renderer.render(this.scene, cam);
    this.renderViewmodel(view.vm);
    if (view.vm) {
      if (Math.abs(this.vmCam.aspect - cam.aspect) > 1e-3) { this.vmCam.aspect = cam.aspect; this.vmCam.updateProjectionMatrix(); }
      const ac = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCam);
      this.renderer.autoClear = ac;
    }
  }

  /** Third-person body: walk/run cycle, jump tuck, hit flinch and a ragdoll-ish death fall. */
  private animate(s: Soldier, p: Soldier3D) {
    const rig = s.rig;
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    for (const m of s.mats) m.opacity = 1;
    if (p.dead !== undefined) {
      // Crumple: knees go, then the body pitches over in the fall direction with a small bounce, then fades.
      const t = p.dead;
      const fall = this.calm ? Math.min(1, t * 2.5) : easeOutBounce(Math.min(1, t / 0.7));
      const dir = p.fall ?? Math.PI;
      const tip = fall * (Math.PI / 2 - 0.08);
      rig.rotation.set(Math.sin(dir) * tip, 0, -Math.cos(dir) * tip, 'YXZ');
      rig.position.y = -Math.min(0.25, t * 0.6) * (1 - fall * 0.6);
      s.legs[0].rotation.z = 0.5 * fall; s.legs[1].rotation.z = -0.2 * fall;
      s.legs[0].rotation.x = 0.25 * fall; s.legs[1].rotation.x = -0.3 * fall;
      const fade = t > 1.5 ? Math.max(0, 1 - (t - 1.5) / 0.5) : 1;
      for (const m of s.mats) m.opacity = fade;
      return;
    }
    const speed = p.speed ?? (p.moving ? 4 : 0);
    const run = Math.min(1, speed / 5);
    s.legs[0].rotation.x = 0; s.legs[1].rotation.x = 0;
    if (p.air) {
      s.legs[0].rotation.z = 0.6; s.legs[1].rotation.z = -0.15;
    } else if (p.moving) {
      const ph = p.t / (150 - run * 50);
      const amp = 0.35 + run * 0.4;
      s.legs[0].rotation.z = Math.sin(ph) * amp; s.legs[1].rotation.z = -Math.sin(ph) * amp;
      rig.position.y = Math.abs(Math.sin(ph)) * 0.05 * (0.5 + run);
      rig.rotation.z = -0.08 * run; // lean into the run
    } else { s.legs[0].rotation.z = 0; s.legs[1].rotation.z = 0; }
    if (p.sprint && p.moving && !p.air && !p.crouch) {
      const ph = p.t / 80;
      s.legs[0].rotation.z = Math.sin(ph) * 0.95; s.legs[1].rotation.z = -Math.sin(ph) * 0.95;
      rig.position.y = Math.abs(Math.sin(ph)) * 0.08;
      rig.rotation.z = -0.22;
    }
    if (p.crouch && !p.air) {
      // Hips at ~0.3 so the head sits at the crouched head hitbox (~1.02). Legs fold to fit under them.
      const shuffle = p.moving ? Math.sin(p.t / 140) * 0.18 : 0;
      rig.position.y = -0.5;
      rig.rotation.z = -0.12;
      s.legs[0].rotation.z = 1.2 + shuffle; s.legs[1].rotation.z = -1.1 - shuffle;
    }
    if (p.flinch) { rig.rotation.z += 0.22 * p.flinch; rig.rotation.x = Math.sin(p.t / 30) * 0.05 * p.flinch; }
  }

  /** Arms/gun on top of the aim pitch: recoil kick, reload tilt, weapon-switch dip. */
  private poseAim(s: Soldier, p: Soldier3D) {
    const aim = s.aim;
    aim.position.set(0.04, 1.3, 0.05);
    aim.rotation.x = 0;
    aim.rotation.y = 0;
    if (p.dead !== undefined) { aim.rotation.z = -0.9 * Math.min(1, p.dead * 2); return; }
    const k = p.recoil ?? 0;
    aim.rotation.z += k * 0.3;
    aim.position.x -= k * 0.06;
    if (p.reload !== undefined) { const r = Math.sin(Math.PI * p.reload); aim.rotation.z -= r * 0.6; aim.rotation.x = r * 0.7; }
    if (p.sw) aim.rotation.z -= p.sw * 1.1;
    if (p.sprint && p.moving) { aim.rotation.z -= 0.55; aim.rotation.x = 0.35; } // gun swung low across the chest
    if (p.melee !== undefined) {
      const e = Math.sin(Math.PI * p.melee);
      if (p.heavy) { aim.position.x += e * 0.35; aim.rotation.z += e * 0.2; } // stab: arm thrusts forward
      else { aim.rotation.y += (0.5 - p.melee) * 1.6 * e; aim.rotation.x += e * 0.4; } // slash: sweeping arc
    }
  }

  private holdGun(s: Soldier, w: WeaponId, pitch: number) {
    s.aim.rotation.z = pitch;
    if (s.w === w) return;
    s.w = w;
    for (const x of s.guns.values()) x.root.visible = false;
    let held = s.guns.get(w);
    if (!held) {
      const m = buildGun(w);
      const grip = new THREE.Vector3(0.24, -0.08, 0.04);
      m.root.position.copy(grip);
      m.root.rotation.y = -Math.PI / 2; // barrel (-Z) → facing (+X)
      const sup = new THREE.Vector3(...m.spec.support).applyEuler(m.root.rotation).add(grip);
      const flash = this.flashSprite(m.spec.flash * 2.2, m.spec.muzzle);
      m.root.add(flash);
      const arms = new THREE.Group();
      this.arm(arms, new THREE.Vector3(0, 0, 0.1), grip.clone().add(new THREE.Vector3(0, -0.03, 0)), 0.1, s.body);
      this.arm(arms, new THREE.Vector3(0, 0, -0.2), sup.clone().add(new THREE.Vector3(0, -0.03, 0)), 0.1, s.body);
      m.root.add(arms); arms.applyMatrix4(m.root.matrix.clone().compose(m.root.position, m.root.quaternion, m.root.scale).invert());
      s.aim.add(m.root);
      held = { ...m, flash };
      s.guns.set(w, held);
    }
    held.root.visible = true;
  }

  /** Projects a world point to overlay pixels (w × h), or null when behind the camera. */
  project(x: number, y: number, z: number, w: number, h: number): { sx: number; sy: number; dist: number } | null {
    const v = W(x, y, z);
    const dist = v.distanceTo(this.camera.position);
    v.project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { sx: ((v.x + 1) / 2) * w, sy: ((1 - v.y) / 2) * h, dist };
  }

  dispose() {
    this.renderer.dispose();
  }
}
