/**
 * three.js renderer for PvP Hockey. Rink coords (x, y) on the ice with z up map to three (x, z, y).
 * Everything is procedural (no assets). Geometry + materials are built once and shared (skaters reuse one set of
 * geometries per part and one material per team), the crowd is a single InstancedMesh, so it stays light on phones.
 */
import * as THREE from 'three';
import { BLUE_X, CORNER_R, CREASE_R, GOAL_HALF, GOAL_X, HK_TEAM_COLORS, NET_DEPTH, PUCK_R, RINK_HALF_L, RINK_HALF_W, type HkRole, type HkTeam } from '../../../shared/hockey';
import { cityLabel, fitLabel, labelMaterial } from './labelSprite';
import { disposeRigCache, makeRig, poseRig, type PlayerRig, type Slot } from './hockeyRig';

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
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!; g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(0, 16); g.lineTo(16, 0); g.lineTo(32, 16); g.lineTo(16, 32); g.closePath(); g.stroke(); // diamond mesh
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/** Goalie cage: thin vertical + horizontal bars (alpha-tested). */
function cageTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; for (let i = 0; i < 64; i += 9) g.fillRect(i, 0, 2, 64); for (let j = 4; j < 64; j += 16) g.fillRect(0, j, 64, 2);
  return new THREE.CanvasTexture(c);
}

/** Jersey texture for a team + number, wrapped around the torso cylinder (u = .25 is the chest, .75 the back). */
function jerseyTexture(color: string, num: number, goalie: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!; const dark = new THREE.Color(color).multiplyScalar(0.45).getStyle();
  g.fillStyle = color; g.fillRect(0, 0, 512, 256);
  // waist + arm stripes (white with dark edges)
  for (const [y, h] of [[196, 22], [176, 8]] as const) { g.fillStyle = dark; g.fillRect(0, y - 3, 512, h + 6); g.fillStyle = '#f4f4f0'; g.fillRect(0, y, 512, h); }
  g.fillStyle = dark; g.fillRect(0, 0, 512, 14); // collar
  g.fillStyle = '#f4f4f0'; g.beginPath(); g.moveTo(108, 0); g.lineTo(128, 34); g.lineTo(148, 0); g.fill(); // V-neck
  const n = String(num); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const draw = (x: number, y: number, px: number) => { g.font = `900 ${px}px Impact, 'Arial Black', system-ui, sans-serif`; g.lineWidth = px * 0.14; g.strokeStyle = dark; g.strokeText(n, x, y); g.fillStyle = '#f4f4f0'; g.fillText(n, x, y); };
  if (goalie) { g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(128, 92, 34, 0, Math.PI * 2); g.fill(); g.fillStyle = dark; g.font = '900 30px system-ui'; g.fillText('C', 128, 94); }
  else draw(128, 92, 58); // chest number (small, under the crest line)
  draw(384, 96, 120); // big back number
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

interface Rig { rig: PlayerRig; root: THREE.Group; label: THREE.Sprite; ring: THREE.Mesh; name: string; role: HkRole; team: HkTeam; lift: number; alpha: number }

/** Stable jersey number from a player id (goalies wear 1/30/31/35). */
export function jerseyNumber(id: string, goalie: boolean): number {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return goalie ? [1, 30, 31, 35][h % 4] : 2 + (h % 97);
}
const LABEL_Y = 2.45;

export class Hockey3D {
  /** Debug-only fixed camera (set via `?hkdebug` → window.__hk). */
  camOverride: { pos: [number, number, number]; look: [number, number, number] } | null = null;
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
  private low = false;
  private puckShadow: THREE.Mesh;
  private lp = new THREE.Vector3();
  /** Debug: force the goalie butterfly blend (0..1). */
  bfOverride: number | null = null;

  constructor(canvas: HTMLCanvasElement, opts: { low?: boolean } = {}) {
    this.low = !!opts.low;
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
    const glass = new THREE.Mesh(ring(RINK_HALF_L + 0.14, RINK_HALF_W + 0.14, CORNER_R + 0.14, RINK_HALF_L + 0.1, RINK_HALF_W + 0.1, CORNER_R + 0.1, GLASS_H), new THREE.MeshPhysicalMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, depthWrite: false }));
    glass.position.y = BOARD_H + 0.08; s.add(glass);
    // ad panels on the boards (canvas strip around the long sides)
    const ad = document.createElement('canvas'); ad.width = 1024; ad.height = 64; const ag = ad.getContext('2d')!;
    const ads = ['CHUD CITY BANK', 'FORT McCHUD OIL', 'CHUD RESORT', 'FURNITURE STORE', 'CHUD SPEEDWAY', 'THE MINE'];
    ads.forEach((t, i) => { ag.fillStyle = ['#0b3d91', '#b3121f', '#127a5a', '#7a4b12', '#222', '#5a2a8a'][i]; ag.fillRect(i * 171, 0, 171, 64); ag.fillStyle = '#fff'; ag.font = '800 20px system-ui'; ag.textAlign = 'center'; ag.fillText(t, i * 171 + 85, 40); });
    const adTex = new THREE.CanvasTexture(ad); adTex.colorSpace = THREE.SRGBColorSpace; adTex.wrapS = THREE.RepeatWrapping; adTex.repeat.set(3, 1);
    const adMat = new THREE.MeshStandardMaterial({ map: adTex, roughness: 0.55 });
    for (const sy of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry((RINK_HALF_L - CORNER_R) * 2, 0.55), adMat); p.position.set(0, 0.6, sy * (RINK_HALF_W - 0.005)); if (sy < 0) p.rotation.y = 0; else p.rotation.y = Math.PI; s.add(p); }
    // ---- glass stanchions + top rail, protective netting behind the nets
    const lowG = !!opts.low;
    const glassPath = roundRect(RINK_HALF_L + 0.12, RINK_HALF_W + 0.12, CORNER_R + 0.12);
    const stPts = glassPath.getSpacedPoints(lowG ? 40 : 72);
    const stan = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, GLASS_H, 0.06), new THREE.MeshStandardMaterial({ color: '#d9dde2', metalness: 0.6, roughness: 0.35 }), stPts.length - 1);
    const sm4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < stPts.length - 1; i++) { const a0 = stPts[i], a1 = stPts[i + 1]; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(a1.y - a0.y, a1.x - a0.x)); sm4.compose(new THREE.Vector3(a0.x, BOARD_H + 0.08 + GLASS_H / 2, -a0.y), q, new THREE.Vector3(1, 1, 1)); stan.setMatrixAt(i, sm4); }
    stan.instanceMatrix.needsUpdate = true; s.add(stan);
    const railPts = glassPath.getSpacedPoints(lowG ? 80 : 200).map((v) => new THREE.Vector3(v.x, BOARD_H + 0.08 + GLASS_H, -v.y));
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts, true), lowG ? 80 : 200, 0.035, lowG ? 4 : 6, true), new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.7, roughness: 0.3 }));
    s.add(rail);
    // ---- nets: red posts + crossbar, curved white base frame, diamond-mesh netting lofted from the base to the top shelf
    const netTex = netTexture();
    const netMat = new THREE.MeshStandardMaterial({ map: netTex, alphaMap: netTex, transparent: true, side: THREE.DoubleSide, color: '#ffffff', roughness: 0.9, depthWrite: false });
    const postMat = new THREE.MeshStandardMaterial({ color: '#d0101c', roughness: 0.3, metalness: 0.4 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 });
    const NSEG = lowG ? 12 : 28;
    // base frame in plan view: from the left post straight back, around the rounded back, to the right post
    const base = new THREE.CatmullRomCurve3([[0, -GOAL_HALF], [NET_DEPTH * 0.45, -GOAL_HALF - 0.02], [NET_DEPTH * 0.92, -GOAL_HALF * 0.72], [NET_DEPTH, 0], [NET_DEPTH * 0.92, GOAL_HALF * 0.72], [NET_DEPTH * 0.45, GOAL_HALF + 0.02], [0, GOAL_HALF]].map(([x, z]) => new THREE.Vector3(x, 0.02, z)), false, 'centripetal');
    const netGeo = (() => {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [], rows = 6, CB = 1.22;
      const bp = base.getSpacedPoints(NSEG); let arc = 0;
      for (let i = 0; i <= NSEG; i++) {
        const b0 = bp[i]; if (i) arc += b0.distanceTo(bp[i - 1]);
        const topBack = new THREE.Vector3(b0.x * 0.42, 1.12, b0.z * 0.985), cross = new THREE.Vector3(0, CB, THREE.MathUtils.clamp(b0.z, -GOAL_HALF, GOAL_HALF));
        // rows: base → top-back (wall, slight inward sag), then top-back → crossbar (shelf)
        for (let j = 0; j <= rows; j++) {
          const v = j / rows; let pt: THREE.Vector3, vv: number;
          if (v <= 0.66) { const k = v / 0.66; pt = b0.clone().lerp(topBack, k); pt.x -= Math.sin(k * Math.PI) * 0.05 * (b0.x / NET_DEPTH); vv = k * 1.15; }
          else { const k = (v - 0.66) / 0.34; pt = topBack.clone().lerp(cross, k); pt.y -= Math.sin(k * Math.PI) * 0.03; vv = 1.15 + k * topBack.distanceTo(cross); }
          pos.push(pt.x, pt.y, pt.z); uv.push(arc / 0.11, vv / 0.11);
        }
      }
      for (let i = 0; i < NSEG; i++) for (let j = 0; j < rows; j++) { const a0 = i * (rows + 1) + j, b1 = a0 + rows + 1; idx.push(a0, b1, a0 + 1, b1, b1 + 1, a0 + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    })();
    const postGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.22, lowG ? 6 : 12);
    const barGeo = new THREE.CylinderGeometry(0.03, 0.03, GOAL_HALF * 2, lowG ? 6 : 12);
    const baseGeo = new THREE.TubeGeometry(base, NSEG, 0.045, lowG ? 4 : 8, false);
    const topCurve = new THREE.CatmullRomCurve3(base.getSpacedPoints(10).map((v) => new THREE.Vector3(v.x * 0.42, 1.12, v.z * 0.985)));
    const topGeo = new THREE.TubeGeometry(topCurve, lowG ? 8 : 20, 0.018, 4, false);
    for (const sx of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sx * GOAL_X, 0, 0); if (sx < 0) g.rotation.y = Math.PI;
      for (const py of [-GOAL_HALF, GOAL_HALF]) { const p = new THREE.Mesh(postGeo, postMat); p.position.set(0, 0.61, py); p.castShadow = true; g.add(p); }
      const bar = new THREE.Mesh(barGeo, postMat); bar.rotation.x = Math.PI / 2; bar.position.set(0, 1.22, 0); bar.castShadow = true; g.add(bar);
      g.add(new THREE.Mesh(baseGeo, frameMat)); if (!lowG) g.add(new THREE.Mesh(topGeo, frameMat));
      const net = new THREE.Mesh(netGeo, netMat); net.renderOrder = 2; g.add(net);
      // goal light behind the glass
      const lampMat = new THREE.MeshStandardMaterial({ color: '#550000', emissive: '#ff1a1a', emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), lampMat);
      lamp.position.set(RINK_HALF_L - GOAL_X + 0.4, BOARD_H + GLASS_H + 0.1, 0); g.add(lamp); this.goalLights.push(lamp);
      const pl = new THREE.PointLight('#ff2a1a', 0, 18); pl.position.copy(lamp.position); g.add(pl); this.goalLamps.push(pl);
      // protective netting above the end glass (skipped on ?lowgfx: big transparent overdraw)
      if (!lowG) {
      const pn = new THREE.Mesh(new THREE.PlaneGeometry((RINK_HALF_W - CORNER_R) * 2 + 6, 3.2), new THREE.MeshBasicMaterial({ map: netTex.clone(), color: '#bbbbbb', transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
      ((pn.material as THREE.MeshBasicMaterial).map as THREE.Texture).repeat.set(80, 14);
      pn.rotation.y = Math.PI / 2; pn.position.set(RINK_HALF_L - GOAL_X + 0.15, BOARD_H + GLASS_H + 1.7, 0); g.add(pn);
      }
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
    // ---- shared player materials (geometry is merged + cached per role/LOD in hockeyRig)
    this.geo.ring = new THREE.RingGeometry(0.55, 0.7, 28);
    const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
    Object.assign(this.mat, {
      skin: std('#e9bf98', { roughness: 0.7 }), black: std('#141518', { roughness: 0.45 }), steel: std('#d5dae0', { metalness: 0.95, roughness: 0.2 }),
      holder: std('#efefea', { roughness: 0.4 }), stick: std('#1c1d21', { roughness: 0.35, metalness: 0.15 }), tape: std('#f4f4f0', { roughness: 0.9 }),
      visor: new THREE.MeshPhysicalMaterial({ color: '#b9dcff', transparent: true, opacity: 0.4, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
      cage: new THREE.MeshStandardMaterial({ map: cageTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, color: '#e8e8e8', metalness: 0.6, roughness: 0.3 }),
      me: new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    });
    for (const t of [0, 1]) {
      const c = HK_TEAM_COLORS[t], dark = new THREE.Color(c).multiplyScalar(0.42);
      this.mat[`sleeve${t}`] = std(c, { roughness: 0.75 });
      this.mat[`pants${t}`] = std(new THREE.Color(c).multiplyScalar(0.16).getStyle(), { roughness: 0.7 });
      this.mat[`sock${t}`] = std(c, { roughness: 0.8 });
      this.mat[`helmet${t}`] = std(dark.getStyle(), { roughness: 0.25, metalness: 0.25 });
      this.mat[`glove${t}`] = std(dark.clone().lerp(new THREE.Color(c), 0.5).getStyle(), { roughness: 0.65 });
      this.mat[`trim${t}`] = std('#f4f4f0', { roughness: 0.7 });
      this.mat[`gtrim${t}`] = std(c, { roughness: 0.55 });
      this.mat[`pad${t}`] = std('#f3f3ef', { roughness: 0.55 });
      this.mat[`mask${t}`] = std(c, { roughness: 0.25, metalness: 0.2 });
      this.mat[`r${t}`] = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    }
    // ---- puck + trail + goal burst
    const pr = PUCK_R, ph = 0.03, e = 0.006;
    const prof = [new THREE.Vector2(0, -ph), new THREE.Vector2(pr - e, -ph), new THREE.Vector2(pr, -ph + e), new THREE.Vector2(pr, ph - e), new THREE.Vector2(pr - e, ph), new THREE.Vector2(0, ph)];
    const puckMat = std('#101114', { roughness: 0.35 });
    const faceTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; g.fillStyle = '#101114'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#5a5e66'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#8a8f99'; g.font = '900 30px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CHC', 64, 66); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    this.puck = new THREE.Mesh(new THREE.LatheGeometry(prof, this.low ? 12 : 28), puckMat);
    const face = new THREE.Mesh(new THREE.CircleGeometry(pr - e, this.low ? 12 : 28), std('#ffffff', { map: faceTex, roughness: 0.4 })); face.rotation.x = -Math.PI / 2; face.position.y = ph + 0.0005; this.puck.add(face);
    this.puckShadow = new THREE.Mesh(new THREE.CircleGeometry(pr * 1.6, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
    this.puckShadow.rotation.x = -Math.PI / 2; this.puckShadow.visible = !this.low; s.add(this.puckShadow);
    this.puck.castShadow = true; s.add(this.puck);
    this.trail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#9fe0ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, vertexColors: true }));
    this.trail.frustumCulled = false; s.add(this.trail);
    const BN = 220; this.burstV = new Float32Array(BN * 3);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BN * 3), 3)); bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(BN * 3), 3));
    this.burst = new THREE.Points(bg, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false })); this.burst.visible = false; this.burst.frustumCulled = false; s.add(this.burst);
  }

  private jerseyMat(t: HkTeam, num: number, goalie: boolean): THREE.Material {
    const k = `jersey${t}-${num}${goalie ? 'G' : ''}`;
    return (this.mat[k] ??= new THREE.MeshStandardMaterial({ map: jerseyTexture(HK_TEAM_COLORS[t], num, goalie), roughness: 0.75 }));
  }

  private rig(p: HkDrawPlayer): Rig {
    let r = this.rigs.get(p.id);
    if (r && (r.role !== p.r || r.team !== p.t || r.name !== p.n)) { this.scene.remove(r.root); this.scene.remove(r.label); this.rigs.delete(p.id); r = undefined; }
    if (r) return r;
    const goalie = p.r === 'G', t = p.t;
    const jm = this.jerseyMat(t, jerseyNumber(p.id, goalie), goalie);
    const slotMat = (sl: Slot): THREE.Material => {
      switch (sl) {
        case 'jersey': return jm;
        case 'helmet': return this.mat[goalie ? `mask${t}` : `helmet${t}`];
        case 'trim': return this.mat[goalie ? `gtrim${t}` : `trim${t}`];
        case 'pad': return this.mat[`pad${t}`];
        case 'sleeve': case 'pants': case 'sock': case 'glove': return this.mat[`${sl}${t}`];
        default: return this.mat[sl];
      }
    };
    const pr = makeRig(goalie, this.low, slotMat, !this.low);
    const root = pr.root;
    const rmesh = new THREE.Mesh(this.geo.ring, this.mat[`r${t}`]); rmesh.rotation.x = -Math.PI / 2; rmesh.position.y = 0.02; root.add(rmesh);
    const label = new THREE.Sprite(labelMaterial(cityLabel(p.n, HK_TEAM_COLORS[t], goalie ? 'G' : undefined, this.renderer))); label.position.y = LABEL_Y; fitLabel(label, 3); label.renderOrder = 10;
    this.scene.add(label); // labels live in world space so they don't yaw with the player and can be decluttered
    this.scene.add(root);
    r = { rig: pr, root, label, ring: rmesh, name: p.n, role: p.r, team: t, lift: 0, alpha: 1 };
    this.rigs.set(p.id, r);
    return r;
  }

  /**
   * Name-label declutter: labels are placed nearest-first in screen space; one that overlaps an already placed label
   * is lifted (up to 3 rows); if it still collides it fades out, and labels in dense clusters are dimmed. Far labels fade a little too.
   * Your own label is always placed first and stays opaque.
   */
  private declutter(f: HkFrame, dt: number): void {
    const H = this.renderer.domElement.height / this.renderer.getPixelRatio(), W = this.renderer.domElement.width / this.renderer.getPixelRatio();
    const camP = this.camera.position, tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const items: { r: Rig; me: boolean; d: number; x: number; y: number; w: number; h: number }[] = [];
    for (const p of f.players) {
      const r = this.rigs.get(p.id); if (!r) continue;
      this.lp.set(r.root.position.x, LABEL_Y, r.root.position.z);
      const d = this.lp.distanceTo(camP); this.lp.project(this.camera);
      const pxPerM = H / (2 * d * tanH);
      items.push({ r, me: !!p.me, d, x: (this.lp.x * 0.5 + 0.5) * W, y: (0.5 - this.lp.y * 0.5) * H, w: r.label.scale.x * pxPerM, h: r.label.scale.y * pxPerM });
    }
    items.sort((a, b) => (a.me === b.me ? a.d - b.d : a.me ? -1 : 1));
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const hit = (x: number, y: number, w: number, h: number) => placed.filter((q) => Math.abs(q.x - x) < (q.w + w) / 2 - 2 && Math.abs(q.y - y) < (q.h + h) / 2 - 1).length;
    const k = 1 - Math.exp(-dt * 10);
    for (const it of items) {
      let lift = 0, y = it.y;
      while (lift < 3 && hit(it.x, y, it.w, it.h)) { lift++; y = it.y - lift * it.h * 1.05; }
      const crowded = hit(it.x, y, it.w, it.h) > 0;
      if (!crowded) placed.push({ x: it.x, y, w: it.w, h: it.h });
      const near = items.filter((o) => o !== it && Math.hypot(o.x - it.x, o.y - it.y) < it.w * 0.9).length;
      const want = it.me ? 1 : crowded ? 0 : Math.max(0.35, Math.min(1, 1.25 - near * 0.18) * THREE.MathUtils.clamp(1.4 - it.d / 70, 0.55, 1));
      const liftM = (lift * it.h * 1.05) / (H / (2 * it.d * tanH));
      it.r.lift += (liftM - it.r.lift) * k; it.r.alpha += (want - it.r.alpha) * k;
      it.r.label.position.set(it.r.root.position.x, LABEL_Y + it.r.lift, it.r.root.position.z);
      (it.r.label.material as THREE.SpriteMaterial).opacity = it.r.alpha; it.r.label.visible = it.r.alpha > 0.02;
      it.r.label.renderOrder = it.me ? 12 : 10;
    }
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
    const pk0 = f.puck;
    for (const p of f.players) {
      seen.add(p.id);
      const r = this.rig(p);
      r.root.position.set(p.x, 0, p.y);
      r.root.rotation.y = -p.a;
      const sp = Math.hypot(p.vx, p.vy);
      // goalies drop into the butterfly when a shot is coming at them from close range
      let bf = 0;
      if (p.r === 'G') {
        const dx = p.x - pk0.x, dy = p.y - pk0.y, d = Math.hypot(dx, dy), ps = Math.hypot(pk0.vx, pk0.vy);
        const toward = ps > 0.1 ? (pk0.vx * dx + pk0.vy * dy) / (ps * (d || 1)) : 0;
        bf = this.bfOverride ?? (!pk0.c && ps > 7 && d < 9 && toward > 0.6 ? 1 : 0);
      }
      poseRig(r.rig, dt, sp, !!p.carry, bf);
      r.ring.material = p.me ? this.mat.me : this.mat[`r${p.t}`];
      (r.ring.scale as THREE.Vector3).setScalar(p.me ? 1.25 : 1);
    }
    for (const [id, r] of this.rigs) if (!seen.has(id)) { this.scene.remove(r.root); this.scene.remove(r.label); this.rigs.delete(id); }
    // puck + trail
    const pk = f.puck;
    this.puck.position.set(pk.x, 0.031, pk.y); this.puckShadow.position.set(pk.x, 0.004, pk.y); this.puck.rotation.y += dt * Math.min(20, Math.hypot(pk.vx, pk.vy) * 1.5);
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
    const co = this.camOverride; if (co) { this.camera.position.set(co.pos[0], co.pos[1], co.pos[2]); this.camera.lookAt(co.look[0], co.look[1], co.look[2]); }
    for (const o of this.overhead) o.visible = this.camera.position.y < o.position.y - 2;
    this.camera.updateMatrixWorld(); this.declutter(f, dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mm)) mm.forEach((x) => x.dispose()); else mm?.dispose?.(); });
    disposeRigCache();
    this.renderer.dispose();
  }
}
