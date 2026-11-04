/**
 * three.js renderer for PvP Hockey. Rink coords (x, y) on the ice with z up map to three (x, z, y).
 * Everything is procedural (no assets). Geometry + materials are built once and shared (skaters reuse one set of
 * geometries per part and one material per team), the crowd is a single InstancedMesh, so it stays light on phones.
 */
import * as THREE from 'three';
import { BLUE_X, CORNER_R, CREASE_R, GOAL_HALF, GOAL_X, HK_TEAM_COLORS, NET_DEPTH, PUCK_R, RINK_HALF_L, RINK_HALF_W, type HkRole, type HkTeam } from '../../../shared/hockey';
import { cityLabel, fitLabel, labelMaterial } from './labelSprite';

export interface HkDrawPlayer { id: string; n: string; t: HkTeam; r: HkRole; x: number; y: number; vx: number; vy: number; a: number; me?: boolean; carry?: boolean }
export interface HkFrame { players: HkDrawPlayer[]; puck: { x: number; y: number; vx: number; vy: number; c: string | null }; focus?: { x: number; y: number } }

const BOARD_H = 1.07;
const GLASS_H = 2.0;

function roundRect(hl: number, hw: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-hl + r, -hw); s.lineTo(hl - r, -hw); s.absarc(hl - r, -hw + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hl, hw - r); s.absarc(hl - r, hw - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hl + r, hw); s.absarc(-hl + r, hw - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hl, -hw + r); s.absarc(-hl + r, -hw + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function ring(hlO: number, hwO: number, rO: number, hlI: number, hwI: number, rI: number, h: number): THREE.ExtrudeGeometry {
  const s = roundRect(hlO, hwO, rO);
  const hole = roundRect(hlI, hwI, rI);
  s.holes.push(new THREE.Path(hole.getPoints(48).reverse()));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(-Math.PI / 2); // extrude up (+y)
  return g;
}

/** Ice markings drawn once to a canvas (red centre line, blue lines, goal lines, circles, creases). */
function iceTexture(): THREE.CanvasTexture {
  const W = 2048, H = Math.round((W * RINK_HALF_W) / RINK_HALF_L);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const sx = W / (RINK_HALF_L * 2), X = (x: number) => (x + RINK_HALF_L) * sx, Y = (y: number) => (RINK_HALF_W - y) * sx;
  const grad = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.6);
  grad.addColorStop(0, '#f6fbff'); grad.addColorStop(1, '#dfeaf3');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // skate scratches
  g.globalAlpha = 0.06; g.strokeStyle = '#8aa'; g.lineWidth = 1;
  for (let i = 0; i < 900; i++) { const x = Math.random() * W, y = Math.random() * H, a = Math.random() * Math.PI; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 40, y + Math.sin(a) * 12); g.stroke(); }
  g.globalAlpha = 1;
  const vline = (x: number, col: string, w: number) => { g.fillStyle = col; g.fillRect(X(x) - (w * sx) / 2, 0, w * sx, H); };
  vline(0, '#c8102e', 0.35); vline(-BLUE_X, '#0b3d91', 0.35); vline(BLUE_X, '#0b3d91', 0.35);
  vline(-GOAL_X, '#c8102e', 0.08); vline(GOAL_X, '#c8102e', 0.08);
  const circle = (x: number, y: number, r: number, col: string, w = 0.08, fill?: string) => { g.beginPath(); g.arc(X(x), Y(y), r * sx, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } g.strokeStyle = col; g.lineWidth = w * sx; g.stroke(); };
  circle(0, 0, 4.2, '#0b3d91'); circle(0, 0, 0.18, '#0b3d91', 0.05, '#0b3d91');
  for (const s of [-1, 1]) for (const yy of [-5.5, 5.5]) { circle(s * (GOAL_X - 6), yy, 4.2, '#c8102e'); circle(s * (GOAL_X - 6), yy, 0.3, '#c8102e', 0.05, '#c8102e'); }
  for (const s of [-1, 1]) for (const yy of [-5.5, 5.5]) circle(s * (BLUE_X - 1.5), yy, 0.3, '#c8102e', 0.05, '#c8102e');
  // creases
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(s * GOAL_X), Y(-GOAL_HALF - 0.3)); g.arc(X(s * GOAL_X), Y(0), CREASE_R * sx, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? -Math.PI / 2 : Math.PI / 2, s < 0); g.closePath(); g.fillStyle = 'rgba(70,140,230,.55)'; g.fill(); g.strokeStyle = '#c8102e'; g.lineWidth = 0.06 * sx; g.stroke(); }
  // centre-ice logo
  g.save(); g.translate(W / 2, H / 2); g.globalAlpha = 0.85;
  g.fillStyle = '#e8c26a'; g.font = `900 ${Math.round(1.6 * sx)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('CHUD', 0, -0.55 * sx); g.font = `800 ${Math.round(0.8 * sx)}px system-ui, sans-serif`; g.fillStyle = '#c8102e'; g.fillText('HOCKEY CLUB', 0, 0.75 * sx);
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function netTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 3);
  return t;
}

interface Rig { root: THREE.Group; body: THREE.Group; legL: THREE.Object3D; legR: THREE.Object3D; stick: THREE.Group; label: THREE.Sprite; ring: THREE.Mesh; phase: number; name: string; role: HkRole; team: HkTeam }

export class Hockey3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  private rigs = new Map<string, Rig>();
  private geo: Record<string, THREE.BufferGeometry> = {};
  private mat: Record<string, THREE.Material> = {};
  private puck: THREE.Mesh;
  private trail: THREE.Mesh;
  private trailPts: THREE.Vector3[] = [];
  private goalLights: THREE.Mesh[] = [];
  /** Hanging rigs/jumbotron: hidden whenever the camera is above them (they would block the ice on phones). */
  private overhead: THREE.Mesh[] = [];
  private goalLamps: THREE.PointLight[] = [];
  private burst: THREE.Points;
  private burstV: Float32Array;
  private burstT = 0;
  private shake = 0;
  private camPos = new THREE.Vector3(0, 30, 26);
  private camLook = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private ice = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private phone = false;
  private goalLit = -1;
  private goalLitT = 0;

  constructor(canvas: HTMLCanvasElement, opts: { low?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.low, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(opts.low ? 1 : 2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !opts.low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const s = this.scene;
    s.background = new THREE.Color('#0b0f1c');
    s.fog = new THREE.Fog('#0b0f1c', 70, 140);
    // ---- lights: arena bowl, overhead rigs
    s.add(new THREE.HemisphereLight('#dfe9ff', '#2a2f3c', 0.9));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(-10, 40, 14); key.castShadow = !opts.low;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -34, right: 34, top: 18, bottom: -18, near: 1, far: 90 });
    key.shadow.bias = -0.0005;
    s.add(key);
    const fill = new THREE.DirectionalLight('#bcd2ff', 0.5); fill.position.set(15, 25, -20); s.add(fill);
    // ---- ice
    const iceGeo = new THREE.ShapeGeometry(roundRect(RINK_HALF_L, RINK_HALF_W, CORNER_R), 32);
    const uv = iceGeo.attributes.uv as THREE.BufferAttribute, pos = iceGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + RINK_HALF_L) / (RINK_HALF_L * 2), (pos.getY(i) + RINK_HALF_W) / (RINK_HALF_W * 2));
    iceGeo.rotateX(-Math.PI / 2);
    const ice = new THREE.Mesh(iceGeo, new THREE.MeshStandardMaterial({ map: iceTexture(), roughness: 0.18, metalness: 0.05 }));
    ice.receiveShadow = true; s.add(ice);
    // ---- boards: white wall, yellow kick plate, red cap, glass
    const T = 0.25;
    const boards = new THREE.Mesh(ring(RINK_HALF_L + T, RINK_HALF_W + T, CORNER_R + T, RINK_HALF_L, RINK_HALF_W, CORNER_R, BOARD_H), new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.5 }));
    boards.castShadow = boards.receiveShadow = true; s.add(boards);
    const kick = new THREE.Mesh(ring(RINK_HALF_L + 0.02, RINK_HALF_W + 0.02, CORNER_R + 0.02, RINK_HALF_L - 0.01, RINK_HALF_W - 0.01, CORNER_R - 0.01, 0.22), new THREE.MeshStandardMaterial({ color: '#f2c12e', roughness: 0.6 }));
    s.add(kick);
    const cap = new THREE.Mesh(ring(RINK_HALF_L + T + 0.08, RINK_HALF_W + T + 0.08, CORNER_R + T + 0.08, RINK_HALF_L - 0.05, RINK_HALF_W - 0.05, CORNER_R - 0.05, 0.08), new THREE.MeshStandardMaterial({ color: '#b3121f', roughness: 0.4 }));
    cap.position.y = BOARD_H; s.add(cap);
    const glass = new THREE.Mesh(ring(RINK_HALF_L + 0.14, RINK_HALF_W + 0.14, CORNER_R + 0.14, RINK_HALF_L + 0.1, RINK_HALF_W + 0.1, CORNER_R + 0.1, GLASS_H), new THREE.MeshPhysicalMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0, depthWrite: false }));
    glass.position.y = BOARD_H + 0.08; s.add(glass);
    // ad panels on the boards (canvas strip around the long sides)
    const ad = document.createElement('canvas'); ad.width = 1024; ad.height = 64; const ag = ad.getContext('2d')!;
    const ads = ['CHUD CITY BANK', 'FORT McCHUD OIL', 'CHUD RESORT', 'FURNITURE STORE', 'CHUD SPEEDWAY', 'THE MINE'];
    ads.forEach((t, i) => { ag.fillStyle = ['#0b3d91', '#b3121f', '#127a5a', '#7a4b12', '#222', '#5a2a8a'][i]; ag.fillRect(i * 171, 0, 171, 64); ag.fillStyle = '#fff'; ag.font = '800 20px system-ui'; ag.textAlign = 'center'; ag.fillText(t, i * 171 + 85, 40); });
    const adTex = new THREE.CanvasTexture(ad); adTex.colorSpace = THREE.SRGBColorSpace; adTex.wrapS = THREE.RepeatWrapping; adTex.repeat.set(3, 1);
    const adMat = new THREE.MeshStandardMaterial({ map: adTex, roughness: 0.55 });
    for (const sy of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry((RINK_HALF_L - CORNER_R) * 2, 0.55), adMat); p.position.set(0, 0.6, sy * (RINK_HALF_W - 0.005)); if (sy < 0) p.rotation.y = 0; else p.rotation.y = Math.PI; s.add(p); }
    // ---- nets
    const netTex = netTexture();
    const netMat = new THREE.MeshStandardMaterial({ map: netTex, alphaMap: netTex, transparent: true, side: THREE.DoubleSide, color: '#ffffff', depthWrite: false });
    const postMat = new THREE.MeshStandardMaterial({ color: '#d0101c', roughness: 0.3, metalness: 0.4 });
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.22, 10);
    for (const sx of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sx * GOAL_X, 0, 0); if (sx < 0) g.rotation.y = Math.PI;
      for (const py of [-GOAL_HALF, GOAL_HALF]) { const p = new THREE.Mesh(postGeo, postMat); p.position.set(0, 0.61, py); p.castShadow = true; g.add(p); }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, GOAL_HALF * 2, 10), postMat); bar.rotation.x = Math.PI / 2; bar.position.set(0, 1.22, 0); g.add(bar);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF * 2, 1.0), netMat); back.rotation.y = Math.PI / 2; back.position.set(NET_DEPTH, 0.5, 0); g.add(back);
      for (const py of [-GOAL_HALF, GOAL_HALF]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, 1.1), netMat); side.position.set(NET_DEPTH / 2, 0.55, py); g.add(side); }
      const top = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, GOAL_HALF * 2), netMat); top.rotation.x = Math.PI / 2; top.rotation.z = 0; top.position.set(NET_DEPTH / 2, 1.1, 0); g.add(top);
      // goal light behind the glass
      const lampMat = new THREE.MeshStandardMaterial({ color: '#550000', emissive: '#ff1a1a', emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), lampMat);
      lamp.position.set(RINK_HALF_L - GOAL_X + 0.4, BOARD_H + GLASS_H + 0.1, 0); g.add(lamp); this.goalLights.push(lamp);
      const pl = new THREE.PointLight('#ff2a1a', 0, 18); pl.position.copy(lamp.position); g.add(pl); this.goalLamps.push(pl);
      s.add(g);
    }
    // ---- stands: tiered seating + crowd (one InstancedMesh)
    const standMat = new THREE.MeshStandardMaterial({ color: '#1d2333', roughness: 0.9 });
    for (let tier = 0; tier < 6; tier++) {
      const o = 1.2 + tier * 1.3;
      const st = new THREE.Mesh(ring(RINK_HALF_L + o + 1.3, RINK_HALF_W + o + 1.3, CORNER_R + o + 1.3, RINK_HALF_L + o, RINK_HALF_W + o, CORNER_R + o, 0.6 + tier * 0.75), standMat);
      s.add(st);
    }
    const crowdGeo = new THREE.CapsuleGeometry(0.22, 0.35, 2, 6);
    const N = opts.low ? 500 : 1400;
    const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), N);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    const shirt = ['#d8202a', '#1f6fd1', '#f2f2f2', '#222', '#e8c26a', '#3a8f4a', '#d8202a', '#1f6fd1'];
    let n = 0;
    for (let tier = 0; tier < 6 && n < N; tier++) {
      const o = 1.2 + tier * 1.3 + 0.65;
      const outline = roundRect(RINK_HALF_L + o, RINK_HALF_W + o, CORNER_R + o).getSpacedPoints(Math.floor(N / 6));
      for (const p of outline) { if (n >= N) break; if (Math.random() < 0.18) continue; m.makeTranslation(p.x, 0.6 + tier * 0.75 + 0.4, -p.y); crowd.setMatrixAt(n, m); crowd.setColorAt(n, col.set(shirt[n % shirt.length])); n++; }
    }
    crowd.count = n; crowd.instanceMatrix.needsUpdate = true; s.add(crowd);
    // overhead light rigs + jumbotron
    const rigMat = new THREE.MeshStandardMaterial({ color: '#333', emissive: '#fff6dd', emissiveIntensity: 1.5 });
    for (const x of [-20, -10, 0, 10, 20]) for (const z of [-8, 8]) { const b = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 0.6), rigMat); b.position.set(x, 22, z); s.add(b); this.overhead.push(b); }
    const jumbo = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 5), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#1b2a55', emissiveIntensity: 0.8 })); jumbo.position.set(0, 16, 0); s.add(jumbo); this.overhead.push(jumbo);
    // ---- shared player parts
    this.geo.torso = new THREE.CapsuleGeometry(0.3, 0.55, 4, 10);
    this.geo.leg = new THREE.CapsuleGeometry(0.11, 0.55, 3, 8);
    this.geo.skate = new THREE.BoxGeometry(0.36, 0.08, 0.12);
    this.geo.helmet = new THREE.SphereGeometry(0.2, 16, 12);
    this.geo.visor = new THREE.BoxGeometry(0.08, 0.07, 0.3);
    this.geo.shaft = new THREE.BoxGeometry(0.04, 1.35, 0.04);
    this.geo.blade = new THREE.BoxGeometry(0.34, 0.07, 0.03);
    this.geo.pad = new THREE.BoxGeometry(0.22, 0.75, 0.24);
    this.geo.blocker = new THREE.BoxGeometry(0.1, 0.32, 0.26);
    this.geo.glove = new THREE.CylinderGeometry(0.18, 0.18, 0.07, 14);
    this.geo.ring = new THREE.RingGeometry(0.55, 0.7, 28);
    this.mat.skin = new THREE.MeshStandardMaterial({ color: '#f0c8a0', roughness: 0.7 });
    this.mat.black = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.6 });
    this.mat.steel = new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 0.9, roughness: 0.25 });
    this.mat.white = new THREE.MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.5 });
    this.mat.visor = new THREE.MeshPhysicalMaterial({ color: '#8fc6ff', transparent: true, opacity: 0.55, roughness: 0.05 });
    this.mat.stick = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.5 });
    this.mat.me = new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    for (const t of [0, 1]) {
      this.mat[`j${t}`] = new THREE.MeshStandardMaterial({ color: HK_TEAM_COLORS[t], roughness: 0.55 });
      this.mat[`h${t}`] = new THREE.MeshStandardMaterial({ color: t ? '#0c2d66' : '#5e0c12', roughness: 0.3, metalness: 0.2 });
      this.mat[`r${t}`] = new THREE.MeshBasicMaterial({ color: HK_TEAM_COLORS[t], transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    }
    // ---- puck + trail + goal burst
    this.puck = new THREE.Mesh(new THREE.CylinderGeometry(PUCK_R, PUCK_R, 0.06, 18), this.mat.black);
    this.puck.castShadow = true; s.add(this.puck);
    this.trail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#9fe0ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, vertexColors: true }));
    this.trail.frustumCulled = false; s.add(this.trail);
    const BN = 220; this.burstV = new Float32Array(BN * 3);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BN * 3), 3)); bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(BN * 3), 3));
    this.burst = new THREE.Points(bg, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false })); this.burst.visible = false; this.burst.frustumCulled = false; s.add(this.burst);
  }

  private rig(p: HkDrawPlayer): Rig {
    let r = this.rigs.get(p.id);
    if (r && (r.role !== p.r || r.team !== p.t || r.name !== p.n)) { this.scene.remove(r.root); this.rigs.delete(p.id); r = undefined; }
    if (r) return r;
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const jm = this.mat[`j${p.t}`], hm = this.mat[`h${p.t}`];
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    const goalie = p.r === 'G';
    const legPivot = (z: number) => { const g = new THREE.Group(); g.position.set(0, 0.9, z); body.add(g); add(this.geo.leg, goalie ? this.mat.white : this.mat.black, 0, -0.42, 0, g); add(this.geo.skate, this.mat.steel, 0.05, -0.86, 0, g); if (goalie) add(this.geo.pad, this.mat.white, 0.08, -0.45, 0, g); return g; };
    const legL = legPivot(-0.14), legR = legPivot(0.14);
    const torso = add(this.geo.torso, jm, 0, 1.38, 0); torso.scale.set(goalie ? 1.35 : 1, 1, goalie ? 1.4 : 1.05);
    add(this.geo.helmet, hm, 0.02, 1.98, 0);
    if (goalie) { const mask = add(this.geo.helmet, this.mat.white, 0.08, 1.96, 0); mask.scale.set(0.9, 1.05, 0.95); add(this.geo.blocker, this.mat.white, 0.15, 1.3, 0.48); const gl = add(this.geo.glove, jm, 0.2, 1.4, -0.5); gl.rotation.x = Math.PI / 2; }
    else add(this.geo.visor, this.mat.visor, 0.18, 1.96, 0);
    const stick = new THREE.Group(); stick.position.set(0.25, 1.3, 0.25); body.add(stick);
    const shaft = add(this.geo.shaft, this.mat.stick, 0, 0, 0, stick); shaft.rotation.z = -0.55;
    const blade = add(this.geo.blade, goalie ? this.mat.white : this.mat.black, 0.5, -0.62, 0, stick); blade.position.set(0.48, -0.58, 0);
    const rmesh = new THREE.Mesh(this.geo.ring, this.mat[`r${p.t}`]); rmesh.rotation.x = -Math.PI / 2; rmesh.position.y = 0.02; root.add(rmesh);
    const label = new THREE.Sprite(labelMaterial(cityLabel(p.n, HK_TEAM_COLORS[p.t], goalie ? 'G' : undefined, this.renderer))); label.position.y = 2.65; fitLabel(label, 3); root.add(label);
    this.scene.add(root);
    r = { root, body, legL, legR, stick, label, ring: rmesh, phase: Math.random() * 6, name: p.n, role: p.r, team: p.t };
    this.rigs.set(p.id, r);
    return r;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.phone = w < 560 || h > w;
    this.camera.fov = h > w ? 58 : 42; this.camera.updateProjectionMatrix();
  }

  /** Screen point -> ice point (rink coords), for mouse aiming. */
  groundPoint(nx: number, ny: number): { x: number; y: number } | null {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const v = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ice, v) ? { x: v.x, y: v.z } : null;
  }

  goal(team: HkTeam, x: number, y: number): void {
    const goalSide = team === 0 ? 1 : 0; // team 0 scores in the +x net (index 1)
    this.goalLit = goalSide; this.goalLitT = 3;
    this.shake = 0.6; this.burstT = 2.2; this.burst.visible = true;
    const pos = this.burst.geometry.attributes.position as THREE.BufferAttribute, colA = this.burst.geometry.attributes.color as THREE.BufferAttribute;
    const c1 = new THREE.Color(HK_TEAM_COLORS[team]), c2 = new THREE.Color('#ffe066');
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, x, 0.5, y);
      const a = Math.random() * Math.PI * 2, up = 3 + Math.random() * 7, sp = 2 + Math.random() * 6;
      this.burstV.set([Math.cos(a) * sp, up, Math.sin(a) * sp], i * 3);
      const c = Math.random() < 0.6 ? c1 : c2; colA.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true; colA.needsUpdate = true;
  }

  render(f: HkFrame, dt: number): void {
    const seen = new Set<string>();
    for (const p of f.players) {
      seen.add(p.id);
      const r = this.rig(p);
      r.root.position.set(p.x, 0, p.y);
      r.root.rotation.y = -p.a;
      const sp = Math.hypot(p.vx, p.vy);
      r.phase += dt * (2 + sp * 1.1);
      const sw = Math.min(0.55, sp * 0.07);
      r.legL.rotation.z = Math.sin(r.phase) * sw; r.legR.rotation.z = -Math.sin(r.phase) * sw;
      r.legL.rotation.x = -0.12 - Math.max(0, Math.sin(r.phase)) * sw * 0.6; r.legR.rotation.x = 0.12 + Math.max(0, -Math.sin(r.phase)) * sw * 0.6;
      r.body.rotation.z = -Math.min(0.35, sp * 0.03) - (p.r === 'G' ? 0.25 : 0); // lean forward when skating, goalie crouch
      r.body.position.y = p.r === 'G' ? -0.18 : -Math.min(0.12, sp * 0.012);
      r.stick.rotation.y = p.carry ? 0.15 : 0.45 + Math.sin(r.phase * 0.5) * 0.05;
      r.ring.material = p.me ? this.mat.me : this.mat[`r${p.t}`];
      (r.ring.scale as THREE.Vector3).setScalar(p.me ? 1.25 : 1);
    }
    for (const [id, r] of this.rigs) if (!seen.has(id)) { this.scene.remove(r.root); this.rigs.delete(id); }
    // puck + trail
    const pk = f.puck;
    this.puck.position.set(pk.x, 0.04, pk.y);
    const ps = Math.hypot(pk.vx, pk.vy);
    const fast = ps > 6 && !pk.c;
    const lastPt = this.trailPts[0];
    if (!fast || (lastPt && Math.hypot(lastPt.x - pk.x, lastPt.z - pk.y) > 3)) this.trailPts.length = 0; // slow, carried or reset: no streak
    if (fast) { this.trailPts.unshift(new THREE.Vector3(pk.x, 0.05, pk.y)); if (this.trailPts.length > 14) this.trailPts.pop(); }
    if (fast && this.trailPts.length > 2) {
      const pts = this.trailPts, verts: number[] = [], cols: number[] = [], idx: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
        const w = PUCK_R * (1 - i / pts.length) * 1.4, nx = -dz / d * w, nz = dx / d * w, k = 1 - i / pts.length;
        verts.push(a.x + nx, 0.05, a.z + nz, a.x - nx, 0.05, a.z - nz); cols.push(k * 0.7, k * 0.9, k, k * 0.7, k * 0.9, k);
        if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
      const g = this.trail.geometry; g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.setIndex(idx);
      this.trail.visible = true;
    } else this.trail.visible = false;
    // goal lights + burst
    this.goalLitT = Math.max(0, this.goalLitT - dt);
    this.goalLights.forEach((l, i) => { const on = i === this.goalLit && this.goalLitT > 0; (l.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2.5 + Math.sin(this.goalLitT * 18) * 1.5 : 0; this.goalLamps[i].intensity = on ? 30 + Math.sin(this.goalLitT * 18) * 15 : 0; });
    if (this.burstT > 0) {
      this.burstT -= dt;
      const pos = this.burst.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        this.burstV[i * 3 + 1] -= 9.8 * dt;
        let y = pos.getY(i) + this.burstV[i * 3 + 1] * dt; if (y < 0.05) { y = 0.05; this.burstV[i * 3 + 1] *= -0.3; }
        pos.setXYZ(i, pos.getX(i) + this.burstV[i * 3] * dt, y, pos.getZ(i) + this.burstV[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true; (this.burst.material as THREE.PointsMaterial).opacity = Math.min(1, this.burstT);
      if (this.burstT <= 0) this.burst.visible = false;
    }
    // broadcast camera: side view that follows the play (closer + steeper on phones)
    const fx = f.focus?.x ?? pk.x, fy = f.focus?.y ?? pk.y;
    const tx = THREE.MathUtils.clamp(fx, -RINK_HALF_L + (this.phone ? 6 : 12), RINK_HALF_L - (this.phone ? 6 : 12));
    const want = this.phone ? new THREE.Vector3(tx, 34, fy * 0.3 + 15) : new THREE.Vector3(tx, 25, fy * 0.25 + 21);
    const k = 1 - Math.exp(-dt * 4);
    this.camPos.lerp(want, k);
    this.camLook.lerp(new THREE.Vector3(tx, 0, fy * 0.5 - (this.phone ? 1 : 0)), k);
    this.shake = Math.max(0, this.shake - dt);
    const sh = this.shake * 0.4;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * sh, this.camPos.y + (Math.random() - 0.5) * sh, this.camPos.z);
    this.camera.lookAt(this.camLook);
    for (const o of this.overhead) o.visible = this.camera.position.y < o.position.y - 2;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mm)) mm.forEach((x) => x.dispose()); else mm?.dispose?.(); });
    this.renderer.dispose();
  }
}
