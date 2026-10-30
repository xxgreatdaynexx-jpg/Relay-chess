/**
 * three.js first-person renderer for the Arena. World coords are (x, y) horizontal with z up;
 * three.js uses Y up, so world (x, y, z) maps to three (x, z, y). All textures are procedural (no external assets).
 */
import * as THREE from 'three';
import type { ArenaMap, Material, Ramp } from '../../../shared/arenaMaps';

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

export interface View3D { x: number; y: number; z: number; a: number; p: number; zoom: number }
export interface Soldier3D { id: string; x: number; y: number; z: number; a: number; p: number; color: string; flash: boolean; moving: boolean; dead?: number; t: number }
export interface Fx3D {
  drones: Array<{ x: number; y: number; z: number }>;
  strikes: Array<{ x: number; y: number; z: number; r: number }>;
  booms: Array<{ x: number; y: number; z: number; t: number; big: boolean }>;
  tracers: Array<{ o: [number, number, number]; e: [number, number, number]; t: number }>;
}

export class Arena3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 16 / 10, 0.05, 140);
  private tex = makeTextures();
  private mats = new Map<Material, THREE.MeshLambertMaterial>();
  private mapGroup = new THREE.Group();
  private soldiers = new Map<string, { g: THREE.Group; body: THREE.MeshLambertMaterial; legs: THREE.Object3D[]; seen: boolean }>();
  private pool: Record<'drone' | 'strike' | 'boom' | 'tracer', THREE.Object3D[]> = { drone: [], strike: [], boom: [], tracer: [] };
  mapId = '';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x8a6a3c, 1.25));
    const sun = new THREE.DirectionalLight(0xffe2b0, 1.6);
    sun.position.set(-30, 50, -10);
    this.scene.add(sun);
    this.scene.add(this.mapGroup);
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
      const sx = s.x1 - s.x0, sy = s.z1 - s.z0, sz = s.y1 - s.y0;
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
    const body = new THREE.MeshLambertMaterial({ color });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc89a70 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b2a26 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
      const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o;
    };
    const legs: THREE.Object3D[] = [];
    for (const side of [-0.11, 0.11]) {
      const pivot = new THREE.Group(); pivot.position.set(0, 0.8, side); g.add(pivot);
      add(new THREE.BoxGeometry(0.18, 0.8, 0.17), dark, 0, -0.4, 0, pivot);
      legs.push(pivot);
    }
    add(new THREE.BoxGeometry(0.3, 0.58, 0.48), body, 0, 1.08, 0); // torso
    add(new THREE.BoxGeometry(0.16, 0.12, 0.5), dark, 0.02, 0.86, 0); // belt
    add(new THREE.BoxGeometry(0.26, 0.26, 0.24), skin, 0, 1.53, 0); // head
    add(new THREE.BoxGeometry(0.29, 0.1, 0.27), body, 0, 1.68, 0); // helmet/cap
    add(new THREE.BoxGeometry(0.06, 0.06, 0.2), dark, 0.13, 1.56, 0); // goggles
    add(new THREE.BoxGeometry(0.5, 0.08, 0.08), dark, 0.32, 1.22, 0.12); // gun
    add(new THREE.BoxGeometry(0.4, 0.12, 0.12), body, 0.18, 1.2, 0.2); // arm
    this.scene.add(g);
    s = { g, body, legs, seen: true };
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
    const cam = this.camera;
    const fov = 68 / view.zoom;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.position.copy(W(view.x, view.y, view.z));
    const cp = Math.cos(view.p);
    cam.lookAt(W(view.x + Math.cos(view.a) * cp, view.y + Math.sin(view.a) * cp, view.z + Math.sin(view.p)));
    for (const s of this.soldiers.values()) s.seen = false;
    for (const p of soldiers) {
      const s = this.soldier(p.id, p.color);
      s.seen = true;
      s.g.position.copy(W(p.x, p.y, p.z));
      s.g.rotation.set(0, -p.a, 0);
      if (p.dead !== undefined) s.g.rotation.z = -Math.min(1, p.dead * 3) * Math.PI / 2; // topple backwards
      const swing = p.moving && p.dead === undefined ? Math.sin(p.t / 110) * 0.5 : 0;
      s.legs[0].rotation.z = swing; s.legs[1].rotation.z = -swing;
      s.body.emissive.setHex(p.flash ? 0x992211 : 0x000000);
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
      o.scale.setScalar((b.big ? 3 : 1.6) * (0.3 + b.t));
      const m = o.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, 1 - b.t);
      m.color.setHSL(0.09 - b.t * 0.06, 1, 0.65 - b.t * 0.4);
    });
    fx.tracers.forEach((t, i) => {
      const o = this.take('tracer', i, () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true }));
      }) as THREE.Line;
      const a = W(...t.o), e = W(...t.e);
      const pos = o.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, e.x, e.y, e.z); pos.needsUpdate = true;
      o.geometry.computeBoundingSphere();
      (o.material as THREE.LineBasicMaterial).opacity = Math.max(0, 1 - t.t);
    });
    this.renderer.render(this.scene, cam);
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
