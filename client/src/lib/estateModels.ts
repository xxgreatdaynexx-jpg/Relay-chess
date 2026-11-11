/**
 * Staged 3D models for private construction sites, Goldwood mansions, wineries,
 * the plastics plant, the shoreline dock, offshore rigs and the international
 * terminal. Silhouettes follow real typologies — hyperscale data halls, container
 * bitcoin mines, Bel-Air modern houses, Venlo glasshouses, jack-up rigs, steam
 * crackers — and unfinished stages follow a real site: excavation, rebar and
 * footings, a steel or concrete frame under a tower crane, cladding, then finish.
 * Shared geometries and materials keep the draw cost in line with the city.
 */
import * as THREE from 'three';
import type { EstateBuildId } from '../../../shared/estateProjects';

const mats = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: number, rough = 0.8, metal = 0, emissive = 0, ei = 0, opacity = 1) => {
  const k = `${color}|${rough}|${metal}|${emissive}|${ei}|${opacity}`;
  let m = mats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei,
      transparent: opacity < 1, opacity, side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (ei > 0) m.userData.ei = ei;
    mats.set(k, m);
  }
  return m;
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const SPH = new THREE.SphereGeometry(1, 16, 12);
const CONE = new THREE.ConeGeometry(1, 1, 10);
for (const g of [BOX, CYL, CYL8, SPH, CONE]) (g as THREE.BufferGeometry).userData.shared = true;

type Add = {
  g: THREE.Group;
  B: (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry?: number) => THREE.Mesh;
  C: (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, segs?: 8 | 12) => THREE.Mesh;
  S: (r: number, m: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;
  K: (r: number, h: number, m: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;
};

function tools(name: string): Add {
  const g = new THREE.Group(); g.name = name;
  const B = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y + h / 2, z); o.rotation.y = ry; g.add(o); return o;
  };
  const C = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, segs: 8 | 12 = 12) => {
    const o = new THREE.Mesh(segs === 8 ? CYL8 : CYL, m); o.scale.set(r, h, r); o.position.set(x, y + h / 2, z); g.add(o); return o;
  };
  const S = (r: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(SPH, m); o.scale.setScalar(r); o.position.set(x, y + r, z); g.add(o); return o;
  };
  const K = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(CONE, m); o.scale.set(r, h, r); o.position.set(x, y + h / 2, z); g.add(o); return o;
  };
  return { g, B, C, S, K };
}

const texCache = new Map<string, THREE.CanvasTexture | null>();
function canvasTex(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture | null {
  if (texCache.has(key)) return texCache.get(key)!;
  if (typeof document === 'undefined') { texCache.set(key, null); return null; }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); if (!x) { texCache.set(key, null); return null; }
  draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  (t as THREE.Texture).userData.shared = true;
  texCache.set(key, t); return t;
}
function facadeMat(key: string, wall: string, glass: string, frame: string, cols: number, rows: number, glow = '') {
  const t = canvasTex(key, 512, 512, (x, w, h) => {
    x.fillStyle = wall; x.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const px = i * cw + cw * 0.18, py = j * ch + ch * 0.22, pw = cw * 0.64, ph = ch * 0.56;
      x.fillStyle = frame; x.fillRect(px - 2, py - 2, pw + 4, ph + 4);
      x.fillStyle = glass; x.fillRect(px, py, pw, ph);
      if (glow) { x.fillStyle = glow; x.globalAlpha = 0.35; x.fillRect(px, py + ph * 0.45, pw, ph * 0.55); x.globalAlpha = 1; }
    }
  });
  if (!t) return M(0x9aa3b0, 0.35, 0.25);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.25 });
  mats.set(key, m); return m;
}
function corrugatedMat(color: string, key: string) {
  const t = canvasTex(key, 256, 256, (x, w, h) => {
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 32; i++) {
      x.fillStyle = i % 2 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
      x.fillRect(i * (w / 32), 0, w / 64, h);
    }
  });
  if (!t) return M(0x6a7080, 0.6, 0.3);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.65, metalness: 0.25 });
}

const dirt = () => M(0x6b4a2b, 1);
const conc = () => M(0xb9b3a8, 0.95);
const darkCon = () => M(0x8d877d, 0.95);
const steel = () => M(0x5f6f7f, 0.4, 0.7);
const rust = () => M(0x8a5a3a, 0.8, 0.2);
const yellow = () => M(0xf5c518, 0.5, 0.35);
const hoard = () => M(0xf59e0b, 0.6);
const asphalt = () => M(0x3a3d47, 0.95);
const gravel = () => M(0x8a8680, 1);
const lawn = () => M(0x3f8a4a, 1);
const glass = () => M(0x9fd6e8, 0.12, 0.35, 0x6fb6d8, 0.45, 0.55);
const aqua = () => M(0x4fc3d9, 0.15, 0.1, 0x3aa8c8, 0.35, 0.7);
const bronze = () => M(0xb5803a, 0.4, 0.7);
const gold = () => M(0xd4af37, 0.3, 0.75, 0xd4af37, 0.35);
const whiteStucco = () => M(0xf3efe6, 0.9);
const stone = () => M(0xddd6c8, 0.92);
const terra = () => M(0x9a4a32, 0.85);

function towerCrane(a: Add, x: number, z: number, mast = 22) {
  const y = yellow(), s = steel(), ballast = darkCon();
  a.B(7, 0.45, 1.3, y, x, 0, z); a.B(1.3, 0.45, 7, y, x, 0, z);
  a.B(2.6, 1.1, 1.6, ballast, x + 2.4, 0.45, z);
  a.B(0.7, mast, 0.7, y, x, 0.45, z);
  for (let i = 0; i < 7; i++) a.B(0.95, 0.12, 0.95, s, x, 0.8 + i * (mast / 7), z);
  a.B(2.4, 0.7, 2.2, y, x, 0.45 + mast, z);
  a.B(1.3, 1.1, 1.7, M(0xeee8d8, 0.55), x, 1.15 + mast, z + 1.15);
  a.B(20, 0.38, 0.38, y, x - 7, 1.55 + mast, z);
  a.B(8, 0.38, 0.38, y, x + 6.5, 1.55 + mast, z);
  a.B(2.6, 1.3, 1.5, ballast, x + 9, 0.7 + mast, z);
  a.C(0.06, 7, s, x - 12, mast - 5, z);
  a.B(0.55, 0.7, 0.4, s, x - 12, mast - 5.2, z);
}

function siteFence(a: Add, w: number, d: number) {
  const post = M(0x4a4a44, 0.5, 0.4), mesh = M(0x6a7a6a, 0.5, 0.2, 0, 0, 0.35);
  const hw = w / 2, hd = d / 2;
  for (const [ww, dd, x, z, alongX] of [
    [w, 0.06, 0, -hd, true], [w, 0.06, 0, hd, true], [0.06, d, -hw, 0, false], [0.06, d, hw, 0, false],
  ] as const) {
    a.B(alongX ? ww : 0.06, 2.1, alongX ? 0.06 : dd, mesh, x, 0.15, z);
  }
  const step = 4;
  for (let x = -hw; x <= hw + 0.01; x += step) { a.C(0.08, 2.4, post, x, 0, -hd); a.C(0.08, 2.4, post, x, 0, hd); }
  for (let z = -hd; z <= hd + 0.01; z += step) { a.C(0.08, 2.4, post, -hw, 0, z); a.C(0.08, 2.4, post, hw, 0, z); }
  // street-side hoarding
  a.B(w + 0.4, 1.6, 0.12, hoard(), 0, 0, hd + 0.2);
}

function excavation(a: Add, w: number, d: number, depth = 1.4) {
  a.B(w + 6, 0.16, d + 6, dirt(), 0, 0, 0);
  a.B(w, depth, d, M(0x4a3018, 1), 0, -depth + 0.16, 0);
  // spoil heaps
  a.C(2.4, 1.4, dirt(), w / 2 + 1.5, 0.16, d / 2 - 1);
  a.C(1.8, 1.0, dirt(), -w / 2, 0.16, -d / 2 + 1);
}

function rebarGrid(a: Add, w: number, d: number, y: number) {
  const r = M(0x8a9098, 0.35, 0.8);
  for (let i = -w / 2 + 1; i < w / 2; i += 2) a.B(0.06, 0.9, d - 1, r, i, y, 0);
  for (let j = -d / 2 + 1; j < d / 2; j += 2) a.B(w - 1, 0.06, 0.06, r, 0, y + 0.5, j);
}

function siteCabin(a: Add, x: number, z: number) {
  const body = corrugatedMat('#c8b44a', 'cabin');
  a.B(4.2, 2.5, 2.4, body, x, 0.3, z);
  a.B(4.3, 0.12, 2.5, M(0x3a3a38, 0.6), x, 2.8, z);
  a.B(0.9, 1.0, 0.08, glass(), x - 1, 1.1, z + 1.22);
  a.B(4.2, 0.3, 2.4, darkCon(), x, 0, z);
}

function siteKit(a: Add, w: number, d: number, opts: { crane?: boolean; pit?: boolean; rebar?: boolean; cabin?: boolean } = {}) {
  const crane = opts.crane !== false, pit = !!opts.pit, rebar = !!opts.rebar, cabin = opts.cabin !== false;
  if (pit) excavation(a, w, d); else a.B(w + 6, 0.16, d + 6, dirt(), 0, 0, 0);
  siteFence(a, w + 6, d + 6);
  if (rebar) rebarGrid(a, w * 0.9, d * 0.9, pit ? 0.1 : 0.16);
  if (cabin) siteCabin(a, -w / 2 - 1, d / 2 + 1.6);
  // porta and lumber
  a.B(1.1, 2.2, 1.1, M(0x3a7a4a, 0.7), w / 2 + 1.6, 0, d / 2 + 1.2);
  a.B(2.4, 0.7, 0.9, M(0xb08a50, 0.9), w / 2, 0, -d / 2 - 1.2);
  if (crane) towerCrane(a, w / 2 - 1.5, -d / 2 + 1.5);
}

function palm(a: Add, x: number, z: number, h = 6) {
  const trunk = M(0x8a6440, 0.9), leaf = M(0x2e8b45, 0.7);
  a.C(0.16, h, trunk, x, 0, z);
  a.C(0.22, 0.3, trunk, x, 0, z);
  for (let i = 0; i < 6; i++) {
    const th = (i / 6) * Math.PI * 2;
    const f = a.B(0.22, 0.08, 1.5, leaf, x + Math.cos(th) * 0.7, h - 0.15, z + Math.sin(th) * 0.7, -th + Math.PI / 2);
    f.rotation.x = 0.45;
  }
}

function cypress(a: Add, x: number, z: number, h = 5) {
  a.C(0.12, 0.8, M(0x5a4030, 0.95), x, 0, z);
  a.K(0.7, h, M(0x1f5a2e, 0.85), x, 0.7, z);
}

let coolingGeo: THREE.LatheGeometry | null = null;
function coolingTower(a: Add, r: number, h: number, x: number, z: number) {
  if (!coolingGeo) {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16; const k = t - 0.42; const rr = 0.72 + 1.6 * k * k;
      pts.push(new THREE.Vector2(rr, t));
    }
    coolingGeo = new THREE.LatheGeometry(pts, 20);
    coolingGeo.userData.shared = true;
  }
  const o = new THREE.Mesh(coolingGeo, M(0xc8c4bc, 0.9));
  o.scale.set(r, h, r); o.position.set(x, 0, z); a.g.add(o);
  a.C(r * 0.85, 0.5, darkCon(), x, 0, z);
  a.C(r * 0.78, 0.35, M(0xb0aaa0, 0.9), x, h - 0.4, z);
}

function stackedBands(a: Add, r: number, h: number, x: number, z: number, bands = 6) {
  const white = M(0xe8e4dc, 0.7), red = M(0xc8102e, 0.6);
  const bh = h / bands;
  for (let i = 0; i < bands; i++) a.C(r, bh, i % 2 ? red : white, x, i * bh, z);
}

function container(a: Add, x: number, y: number, z: number, color: string, ry = 0) {
  const body = corrugatedMat(color, `ctr-${color}`);
  const frame = M(0x2a2a28, 0.5, 0.4);
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; a.g.add(g);
  const box = (w: number, h: number, d: number, m: THREE.Material, lx: number, ly: number, lz: number) => {
    const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(lx, ly + h / 2, lz); g.add(o);
  };
  box(6.1, 2.5, 2.45, body, 0, 0, 0);
  box(6.15, 0.08, 2.5, frame, 0, 2.5, 0);
  box(6.15, 0.08, 2.5, frame, 0, 0, 0);
  // end doors
  box(0.06, 2.2, 1.05, frame, 3.08, 0.15, -0.55);
  box(0.06, 2.2, 1.05, frame, 3.08, 0.15, 0.55);
  // exhaust fan on the other end
  const fan = new THREE.Mesh(CYL, M(0x1a1d22, 0.4, 0.3)); fan.scale.set(0.7, 0.12, 0.7); fan.rotation.z = Math.PI / 2; fan.position.set(-3.12, 1.25, 0); g.add(fan);
  const hub = new THREE.Mesh(CYL, M(0x8899aa, 0.4, 0.5)); hub.scale.set(0.15, 0.16, 0.15); hub.rotation.z = Math.PI / 2; hub.position.set(-3.2, 1.25, 0); g.add(hub);
}

function hedge(a: Add, w: number, h: number, d: number, x: number, z: number) {
  a.B(w, h, d, M(0x2e7a3a, 0.95), x, 0, z);
}

export function buildEstateModel(type: EstateBuildId, done: number, frac = 0): THREE.Group {
  const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0);
  if (type === 'data_center') return dataCenter(stage, done);
  if (type === 'bitcoin_farm') return bitcoinFarm(stage, done);
  if (type === 'monument') return monument(stage, done);
  if (type === 'mansion') return mansion(stage, done);
  if (type === 'highrise') return highrise(stage, done);
  return powerPlant(stage, done);
}

/** Hyperscale campus in the spirit of Ashburn / Quincy: long low metal halls, rooftop chillers, generator yard, fence. */
function dataCenter(stage: (i: number) => number, done: number) {
  const a = tools(`data-center-${done}`);
  const complete = done >= 4;
  if (!complete) siteKit(a, 32, 24, { pit: done === 0, rebar: done === 0, crane: done < 3 });
  const s0 = stage(0), s1 = stage(1), s2 = stage(2), s3 = stage(3);
  if (s0 > 0) {
    a.B(30 * Math.max(0.25, s0), 0.7, 22, conc(), 0, complete ? 0 : 0.1, 0);
    if (!complete && s0 > 0.4) for (const z of [-8, 0, 8]) a.B(28, 0.5, 1.2, darkCon(), 0, 0.7, z);
  }
  if (s1 > 0 && !complete) {
    // steel portal frames for three halls
    const h = 5.4 * s1;
    for (let i = 0; i < 3; i++) {
      const z = -8 + i * 8;
      for (let k = 0; k < 8; k++) {
        const x = -13.5 + k * 3.8;
        a.B(0.28, h, 0.28, steel(), x, 0.8, z - 3);
        a.B(0.28, h, 0.28, steel(), x, 0.8, z + 3);
        if (s1 > 0.5) a.B(0.22, 0.22, 6.2, steel(), x, 0.8 + h, z);
      }
    }
  }
  if (s2 > 0 || complete) {
    if (!complete) a.B(34, 0.1, 28, asphalt(), 0, 0, 0);
    const hall = facadeMat('dc-hall', '#d8dce2', '#3a4650', '#8a9098', 14, 3);
    const metal = M(0xd0d5dc, 0.55, 0.25);
    const h = complete ? 5.4 : 5.4 * Math.max(0.35, s2);
    for (let i = 0; i < 3; i++) {
      const z = -8 + i * 8;
      a.B(28, h, 7.2, hall, 0, 0.7, z);
      a.B(28.4, 0.25, 7.5, metal, 0, 0.7 + h, z);
      if (complete || s3 > 0) {
        const nCh = complete ? 8 : Math.max(1, Math.round(8 * s3));
        for (let k = 0; k < nCh; k++) {
          a.B(1.5, 1.15, 2.0, M(0x6a7078, 0.45, 0.4), -12 + k * 3.4, 0.95 + h, z);
          a.C(0.5, 0.14, M(0x2a3038, 0.4), -12 + k * 3.4, 2.1 + h, z);
        }
      }
    }
    // office end + glass entry
    a.B(6, 4.2, 7.2, M(0xc8ccd2, 0.5, 0.2), 17, 0.7, -8);
    a.B(0.2, 3.4, 5.4, glass(), 20.1, 1, -8);
    // loading docks
    for (let i = 0; i < 4; i++) a.B(3.2, 3.2, 0.2, M(0x2a2a28, 0.7), -10 + i * 5, 0.7, 12.2);
  }
  if (s3 > 0 || complete) {
    if (complete) { a.B(40, 0.1, 32, asphalt(), 0, 0, 0); siteFence(a, 40, 32); }
    // generator yard
    const gen = M(0x3a4a3a, 0.6, 0.3);
    for (let i = 0; i < (complete ? 6 : Math.max(1, Math.round(6 * s3))); i++) {
      a.B(2.2, 2.2, 1.4, gen, -16, 0.1, -10 + i * 3.4);
      a.B(0.8, 0.9, 1.4, M(0x4a4a44, 0.5), -17.3, 1.4, -10 + i * 3.4);
    }
    a.C(1.3, 3.2, M(0x8890a0, 0.4, 0.5), -16, 0.1, 11);
    a.C(1.3, 3.2, M(0x8890a0, 0.4, 0.5), -13, 0.1, 11);
    // gatehouse
    a.B(3.2, 2.6, 2.6, M(0xd8dce2, 0.6), 0, 0.1, 16.5);
    a.B(1.2, 1.2, 0.1, glass(), 0, 1, 17.85);
    a.B(6, 0.9, 0.2, M(0x2a6a4a, 0.4, 0, 0x2a6a4a, 0.55), 0, 6.4, 12.4);
  }
  return a.g;
}

/** Container bitcoin mine: rows of ISO containers with end fans, gravel yard, transformers — like a Texas or prairie mine. */
function bitcoinFarm(stage: (i: number) => number, done: number) {
  const a = tools(`bitcoin-${done}`);
  const complete = done >= 4;
  if (!complete) siteKit(a, 28, 22, { pit: done === 0, rebar: done === 0, crane: done < 2 });
  const s0 = stage(0), s1 = stage(1), s2 = stage(2), s3 = stage(3);
  if (s0 > 0) a.B(28 * Math.max(0.3, s0), 0.25, 22, complete ? gravel() : conc(), 0, complete ? 0 : 0.1, 0);
  const colors = ['#2c5a8a', '#c8c4bc', '#8a4030', '#3a6a4a', '#4a5560', '#6a3a2a'];
  const rows = 3, cols = 6;
  const show = complete ? rows * cols : s1 > 0 ? Math.max(2, Math.round(rows * cols * (0.35 + 0.65 * (s1 * 0.5 + s2 * 0.5)))) : 0;
  if (show) {
    if (complete || s1 > 0.2) a.B(32, 0.1, 26, gravel(), 0, 0, 0);
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (n++ >= show) break;
      container(a, -12.5 + c * 5.0, 0.1, -7 + r * 7, colors[(r * cols + c) % colors.length]!);
    }
  }
  if (s2 > 0 || complete) {
    const xf = M(0x5a5a50, 0.5, 0.5);
    for (const z of [-3.5, 3.5]) {
      a.B(2.2, 2.0, 1.6, xf, 16, 0.1, z);
      a.B(1.2, 1.5, 0.8, rust(), 17.4, 0.1, z);
    }
    // cable trays between rows
    for (const z of [-3.5, 3.5]) a.B(26, 0.12, 0.4, steel(), 0, 2.7, z);
  }
  if (s3 > 0 || complete) {
    if (complete) siteFence(a, 34, 28);
    siteCabin(a, 16, -10);
    for (const x of [-12, 0, 12]) { a.C(0.12, 7, steel(), x, 0, 12); a.B(0.6, 0.4, 0.6, M(0xffe9a8, 0.4, 0, 0xffe9a8, 1.2), x, 7, 12); }
    a.B(5, 1.0, 0.2, gold(), 0, 3.2, 13);
  }
  return a.g;
}

/** Civic statue plaza: stepped stone podium, bronze figure, flags and uplights. */
function monument(stage: (i: number) => number, done: number) {
  const a = tools(`monument-${done}`);
  const complete = done >= 4;
  if (!complete) siteKit(a, 20, 20, { pit: done === 0, rebar: done === 0, crane: done < 2, cabin: true });
  const s0 = stage(0), s1 = stage(1), s2 = stage(2), s3 = stage(3);
  if (s0 > 0) a.C(7 * Math.max(0.4, s0), 0.6, stone(), 0, complete ? 0 : 0.1, 0);
  if (s1 > 0) {
    const h = 1.2 * s1;
    a.B(14, h, 14, stone(), 0, 0.6, 0);
    a.B(11, h, 11, M(0xcfc8b8, 0.9), 0, 0.6 + h, 0);
    a.B(8, h, 8, stone(), 0, 0.6 + h * 2, 0);
  }
  if (s2 > 0) {
    const ph = 4.4 * s2;
    a.B(3.6, ph, 3.6, stone(), 0, 4.2, 0);
    a.B(4.0, 0.35, 4.0, darkCon(), 0, 4.2 + ph, 0);
    // bronze figure
    const br = bronze();
    const fh = Math.max(0.3, s2);
    a.B(0.45, 1.8 * fh, 0.4, br, -0.28, 4.55 + ph, 0);
    a.B(0.45, 1.8 * fh, 0.4, br, 0.28, 4.55 + ph, 0);
    a.B(1.15, 1.9 * fh, 0.7, br, 0, 6.3 + ph, 0);
    a.C(0.32, 0.7 * fh, br, 0, 8.15 + ph, 0);
    a.S(0.38 * fh, br, 0, 8.7 + ph, 0);
    // raised arm + orb
    a.B(0.28, 0.28, 1.3 * fh, br, 0.7, 7.6 + ph, 0);
    a.S(0.28 * fh, gold(), 0.7, 7.7 + ph, 0.7 * fh);
  }
  if (s3 > 0 || complete) {
    if (complete) a.B(24, 0.08, 24, lawn(), 0, 0, 0);
    a.B(16, 0.12, 16, stone(), 0, 0.08, 0);
    const flag = M(0xc8102e, 0.6);
    for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as const) {
      a.C(0.1, 7 * (complete ? 1 : s3), steel(), x, 0.2, z);
      a.B(1.4, 0.8, 0.06, flag, x + 0.7, 6.2 * (complete ? 1 : s3), z);
    }
    const lamp = M(0xffe9a8, 0.4, 0, 0xffe9a8, 1.1);
    for (const [x, z] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]] as const) a.B(0.35, 0.2, 0.35, lamp, x, 4.2, z);
    hedge(a, 16, 0.7, 0.5, 0, -8.4); hedge(a, 16, 0.7, 0.5, 0, 8.4);
  }
  return a.g;
}

/** Modern Bel-Air / Palm Springs house: white stucco volumes, dark-framed glass, circular drive, pool and palms. */
function mansion(stage: (i: number) => number, done: number, floors = 2, tint = 0xf3efe6) {
  const a = tools(`mansion-${done}`);
  const complete = done >= 4;
  if (!complete) siteKit(a, 32, 26, { pit: done === 0, rebar: done === 0, crane: done < 3 });
  const s0 = stage(0), s1 = stage(1), s2 = stage(2), s3 = stage(3);
  const stucco = M(tint, 0.9);
  const roof = M(0x3a3a38, 0.6, 0.25);
  const frame = M(0x2a2a28, 0.5, 0.3);
  if (s0 > 0) {
    a.B(30 * Math.max(0.3, s0), 0.6, 20, conc(), 0, complete ? 0 : 0.1, -1);
    if (s0 > 0.5 || complete) a.B(9, 1.2, 5, M(0x4a3018, 1), 6, complete ? 0 : 0.1, 10); // pool excavation
  }
  const storey = 3.3;
  const h1 = (complete ? 1 : s1) * storey * Math.max(1, Math.min(floors, 3));
  const h0 = (complete ? 1 : s1) * storey;
  if (s1 > 0) {
    if (!complete) {
      // frame: slabs + columns
      const colH = h1;
      for (const [x, z] of [[-8, -6], [8, -6], [-8, 4], [8, 4], [-2, -8], [2, -8]] as const) a.B(0.35, colH, 0.35, conc(), x, 0.7, z);
      a.B(18, 0.25, 14, conc(), 0, 0.7 + colH * 0.5, -1);
      if (floors >= 2) a.B(18, 0.25, 14, conc(), 0, 0.7 + colH, -1);
    } else {
      a.B(18, h1, 14, stucco, 0, 0.2, -2);
      a.B(12, h0, 10, stucco, -11, 0.2, 1);
    }
  }
  if (s2 > 0 || complete) {
    if (!complete) {
      a.B(18, h1 * Math.max(0.4, s2), 14, stucco, 0, 0.7, -2);
      a.B(12, h0 * Math.max(0.4, s2), 10, stucco, -11, 0.7, 1);
    }
    a.B(19.2, 0.35, 15.2, roof, 0, 0.2 + h1, -2);
    a.B(13, 0.3, 11, roof, -11, 0.2 + h0, 1);
    // overhangs
    a.B(20, 0.16, 2.2, roof, 0, 0.2 + h1 - 0.1, 6.2);
  }
  if (s3 > 0 || complete) {
    if (complete) a.B(36, 0.08, 30, lawn(), 0, 0, 0);
    // dark-framed window wall on the south facade
    a.B(14, h1 * 0.7, 0.12, frame, 0, 0.6, 5.05);
    a.B(13.2, h1 * 0.64, 0.08, glass(), 0, 0.8, 5.14);
    a.B(0.2, h1 * 0.64, 0.1, frame, -3.3, 0.8, 5.16);
    a.B(0.2, h1 * 0.64, 0.1, frame, 3.3, 0.8, 5.16);
    a.B(13.2, 0.12, 0.1, frame, 0, 0.8 + h1 * 0.32, 5.16);
    // door + canopy
    a.B(1.6, 2.4, 0.14, M(0x3a2a1a, 0.8), -11, 0.2, 6.1);
    a.B(4, 0.16, 2.4, roof, -11, 2.7, 6.4);
    // balcony
    if (floors >= 2) {
      a.B(8, 0.16, 1.6, stucco, 0, 0.2 + storey, 5.6);
      a.B(8, 0.7, 0.08, glass(), 0, 0.36 + storey, 6.4);
    }
    // U drive
    const drive = M(0xc8c4bc, 0.95);
    a.B(4, 0.1, 14, drive, -4, 0.08, 10);
    a.C(6, 0.1, drive, 2, 0.08, 14);
    a.C(3.4, 0.12, lawn(), 2, 0.1, 14);
    // pool + deck
    a.B(11, 0.2, 7, M(0xd8d4cc, 0.9), 6, 0.08, 11);
    a.B(8.5, 0.35, 4.6, aqua(), 6, 0.12, 11);
    a.B(0.4, 0.08, 1.6, M(0xe8e4dc, 0.5), 6, 0.5, 8.5);
    for (const [x, z] of [[-16, 6], [-16, 12], [16, -8], [14, 12], [18, 4]] as const) palm(a, x, z, 5.5 + (x % 3));
    hedge(a, 20, 0.8, 0.5, 0, 15);
    hedge(a, 0.5, 0.8, 12, -17.5, 6);
  }
  return a.g;
}

/** Modern glass tower with a stone podium, mid-height setback and a lit crown — in the spirit of a downtown curtain-wall highrise. */
function highrise(stage: (i: number) => number, done: number) {
  const a = tools(`highrise-${done}`);
  const complete = done >= 4;
  if (!complete) siteKit(a, 22, 22, { pit: done === 0, rebar: done === 0, crane: done < 3 });
  const s0 = stage(0), s1 = stage(1), s2 = stage(2), s3 = stage(3);
  if (s0 > 0) {
    a.B(18 * Math.max(0.3, s0), 1.2, 18, conc(), 0, complete ? 0 : 0.1, 0);
    if (!complete) a.B(16, 2.2, 16, M(0x4a3018, 1), 0, -1.6, 0);
  }
  const floors = complete ? 16 : Math.max(0, Math.round(16 * s1));
  const fh = 2.15;
  if (floors && !complete) {
    // core + floor plates + corner columns — a tower going up
    a.B(4.2, floors * fh, 4.2, darkCon(), 0, 1.3, 0);
    for (let i = 1; i <= floors; i++) a.B(12, 0.22, 12, conc(), 0, 1.3 + i * fh, 0);
    for (const [x, z] of [[-5.6, -5.6], [5.6, -5.6], [-5.6, 5.6], [5.6, 5.6]] as const)
      a.B(0.45, floors * fh, 0.45, steel(), x, 1.3, z);
  }
  if ((s2 > 0 || complete) && (floors || complete)) {
    const n = complete ? 16 : floors;
    const shaft = facadeMat('hr-glass', '#2a3640', '#8ec8dc', '#1a2228', 6, Math.max(4, Math.round(n * 0.7)), 'rgba(255,230,160,0.5)');
    const podiumH = 7.2;
    a.B(16, podiumH, 16, stone(), 0, 0.2, 0);
    a.B(12, podiumH * 0.75, 0.2, glass(), 0, 0.6, 8.1);
    const low = Math.min(10, n);
    a.B(12.4, low * fh, 12.4, shaft, 0, podiumH, 0);
    if (n > 10) a.B(9.6, (n - 10) * fh, 9.6, shaft, 0, podiumH + 10 * fh, 0);
  }
  if (s3 > 0 || complete) {
    if (complete) a.B(24, 0.1, 24, stone(), 0, 0, 0);
    const top = 7.2 + 16 * fh;
    a.B(8.4, 2.4 * (complete ? 1 : s3), 8.4, M(0x1a1d24, 0.5, 0.3), 0, top, 0);
    a.B(6.2, 2.8 * (complete ? 1 : s3), 6.2, M(0x9fd6e8, 0.2, 0.3, 0xd4af37, 0.55, 0.7), 0, top + 2.4, 0);
    a.C(0.18, 8 * (complete ? 1 : s3), gold(), 0, top + 5.2, 0);
    a.C(0.4, 0.4, M(0xff6060, 0.4, 0, 0xff4040, 1.4), 0, top + 13, 0);
    for (const [x, z] of [[-8, 10], [8, 10], [-8, -10], [8, -10]] as const) { a.C(0.5, 1.6, lawn(), x, 0.1, z); a.C(0.15, 1.8, M(0x5a4030), x, 1.6, z); }
  }
  return a.g;
}

/** Thermal plant: turbine hall, hyperbolic cooling towers, banded stacks and a switchyard. */
function powerPlant(stage: (i: number) => number, done: number) {
  const a = tools(`power-plant-${done}`);
  const complete = done >= 4;
  if (!complete) siteKit(a, 38, 28, { pit: done === 0, rebar: done === 0, crane: done < 3 });
  const s0 = stage(0), s1 = stage(1), s2 = stage(2), s3 = stage(3);
  if (s0 > 0) {
    a.B(36 * Math.max(0.3, s0), 0.7, 26, conc(), 0, complete ? 0 : 0.1, 0);
    if (s0 > 0.5) { a.C(5, 0.8, conc(), 14, 0.7, -6); a.C(5, 0.8, conc(), 14, 0.7, 6); a.C(1.4, 1, conc(), -4, 0.7, -8); }
  }
  const hallM = corrugatedMat('#6a7380', 'pp-hall');
  if (s1 > 0) {
    const h = 10 * s1;
    if (!complete) {
      for (const x of [-14, -6, 2]) for (const z of [-6, 6]) a.B(0.4, h, 0.4, steel(), x, 0.8, z);
      a.B(20, 0.3, 14, steel(), -6, 0.8 + h, 0);
    } else {
      a.B(20, 10, 14, hallM, -6, 0.2, 0);
      a.B(21, 0.4, 8, hallM, -6, 10.2, 0);
    }
    stackedBands(a, 1.15, 16 * s1, -4, -9, 7);
    stackedBands(a, 0.95, 13 * s1, 0, -9, 6);
  }
  if (s2 > 0 || complete) {
    if (!complete) a.B(20, 10 * Math.max(0.4, s2), 14, hallM, -6, 0.8, 0);
    if (complete) a.B(42, 0.1, 32, asphalt(), 0, 0, 0);
    coolingTower(a, 5.2, 14 * (complete ? 1 : Math.max(0.4, s2)), 14, -6);
    coolingTower(a, 5.2, 14 * (complete ? 1 : Math.max(0.4, s2)), 14, 6);
  }
  if (s3 > 0 || complete) {
    // switchyard
    const xf = M(0x5a5a50, 0.5, 0.5);
    for (let i = 0; i < (complete ? 5 : Math.max(1, Math.round(5 * s3))); i++) {
      a.B(2.4, 2.2, 1.6, xf, -16 + i * 4.2, 0.2, 11);
      a.B(0.2, 6, 0.2, steel(), -16 + i * 4.2, 0.2, 13);
    }
    for (const z of [-4, 0, 4]) a.B(16, 0.25, 0.25, rust(), 4, 4.5, z);
    a.B(8, 4, 6, M(0x4a5058, 0.6), -16, 0.2, -8);
    if (complete) siteFence(a, 42, 32);
  }
  return a.g;
}

/** Dutch Venlo glasshouse: repeating pitched glass bays, aluminium gutters, crop rows, packing shed. */
export function buildHyperFarm(done: number, frac = 0, w = 20, d = 16): THREE.Group {
  const a = tools(`hyper-${done}`);
  const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0);
  const complete = done >= 4;
  const s0 = stage(0), s1 = stage(1), s2 = stage(2), s3 = stage(3);
  const alu = M(0xc8ced4, 0.35, 0.65);
  const soil = M(0x5a3a20, 1);
  a.B(w + 2, 0.25, d + 2, conc(), 0, 0, 0);
  a.B(w, 0.2, d, soil, 0, 0.25, 0);
  if (s0 > 0) {
    const rows = 5;
    for (let i = 0; i < rows; i++) a.B(w - 2, 0.35, 1.1, M(0x4a2a14, 1), 0, 0.4, -d / 2 + 1.6 + i * ((d - 3.2) / (rows - 1)));
  }
  const bays = Math.max(4, Math.round(w / 3.2));
  const rise = 2.2;
  const wallH = 4.4;
  if (s1 > 0) {
    const h = wallH * s1;
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + i * (w / bays);
      a.B(0.12, h, 0.12, alu, x, 0.4, -d / 2);
      a.B(0.12, h, 0.12, alu, x, 0.4, d / 2);
    }
    for (const z of [-d / 2, d / 2]) a.B(w, 0.1, 0.1, alu, 0, 0.4 + h, z);
    a.B(w, 0.1, d, alu, 0, 0.4 + h, 0);
  }
  if (s2 > 0 || complete) {
    const gh = complete ? 1 : Math.max(0.3, s2);
    a.B(w, wallH * gh, 0.06, glass(), 0, 0.4, d / 2);
    a.B(w, wallH * gh, 0.06, glass(), 0, 0.4, -d / 2);
    a.B(0.06, wallH * gh, d, glass(), w / 2, 0.4, 0);
    a.B(0.06, wallH * gh, d, glass(), -w / 2, 0.4, 0);
    // Venlo gables
    const roof = venloRoofGeo(w, d, bays, rise);
    const mesh = new THREE.Mesh(roof, glass());
    mesh.position.y = 0.4 + wallH * gh;
    if (!complete) mesh.scale.y = gh;
    a.g.add(mesh);
    // gutters between bays
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + i * (w / bays);
      a.B(0.14, 0.12, d, alu, x, 0.4 + wallH * gh, 0);
    }
  }
  if (s3 > 0 || complete) {
    const crop = M(0x3aaa4a, 0.8);
    for (let i = 0; i < 5; i++) a.B(w - 3, 0.5 * (complete ? 1 : s3), 0.7, crop, 0, 0.7, -d / 2 + 1.6 + i * ((d - 3.2) / 4));
    a.B(4, 3.2, 5, corrugatedMat('#c8c4bc', 'pack-shed'), w / 2 + 3, 0.2, 0);
    a.C(0.7, 1.6, M(0x8899aa, 0.4, 0.4), w / 2 - 0.8, wallH + 0.4, 0);
    a.B(2.2, 2.2, 0.12, M(0x3a6a8a, 0.4), -w / 2, 1, 0);
  }
  return a.g;
}

function venloRoofGeo(w: number, d: number, bays: number, rise: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const bw = w / bays;
  for (let i = 0; i < bays; i++) {
    const x0 = -w / 2 + i * bw, x1 = x0 + bw, xm = (x0 + x1) / 2;
    const z0 = -d / 2, z1 = d / 2, b = pos.length / 3;
    pos.push(x0, 0, z0, xm, rise, z0, x0, 0, z1, xm, rise, z1, xm, rise, z0, x1, 0, z0, xm, rise, z1, x1, 0, z1);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 4, b + 5, b + 6, b + 5, b + 7, b + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function latticeLeg(a: Add, x: number, y: number, z: number, h: number, spread = 0.7) {
  const s = steel();
  for (const [dx, dz] of [[-spread, -spread], [spread, -spread], [-spread, spread], [spread, spread]] as const)
    a.B(0.16, h, 0.16, s, x + dx, y, z + dz);
  for (let i = 0; i < 5; i++) a.B(spread * 2 + 0.16, 0.1, spread * 2 + 0.16, s, x, y + i * (h / 5), z);
}

function derrick(a: Add, x: number, y: number, z: number, h: number) {
  const s = steel();
  const top = 0.5, bot = 1.4;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const o = a.B(0.18, h, 0.18, s, x + dx * bot, y, z + dz * bot);
    // lean inward slightly by scaling is enough at this size; shift top with a second post cap
    void o;
  }
  for (let i = 0; i < 6; i++) {
    const t = i / 5, r = bot + (top - bot) * t;
    a.B(r * 2, 0.12, r * 2, s, x, y + t * h, z);
  }
  a.B(1.6, 0.5, 1.6, s, x, y + h, z);
  a.B(0.3, 1.2, 0.3, s, x, y + h + 0.5, z);
}

/** Jack-up style offshore rig: lattice legs, derrick, helideck, crane, flare boom and quarters. */
export function buildRig(done: number, frac = 0, launched = false): THREE.Group {
  const a = tools(`rig-${done}`);
  const stage = (i: number) => (done > i ? 1 : done === i ? frac : 0);
  const complete = done >= 4;
  if (!launched && !complete) siteKit(a, 24, 18, { pit: done === 0, rebar: done === 0, crane: done < 3 });
  const s0 = stage(0), s1 = stage(1), s2 = stage(2), s3 = stage(3);
  const deckY = launched ? 8 : 4;
  const legH = launched ? deckY + 2 : deckY;
  if (s0 > 0) {
    for (const [x, z] of [[-7, -5], [7, -5], [-7, 5], [7, 5]] as const)
      latticeLeg(a, x, launched ? -2 : 0, z, legH * Math.max(0.4, s0));
    a.B(18 * Math.max(0.4, s0), 0.8, 12, steel(), 0, deckY - 0.8, 0);
  }
  if (s1 > 0) derrick(a, -3, deckY, 0, 16 * s1);
  if (s2 > 0 || complete) {
    a.B(18, 1.2 * (complete ? 1 : Math.max(0.4, s2)), 12, M(0xc4b49a, 0.8), 0, deckY, 0);
    // quarters
    a.B(7, 5 * (complete ? 1 : s2), 6, M(0xe9e4d8, 0.8), 5, deckY + 1.2, 0);
    a.B(6.4, 1.6, 0.1, glass(), 5, deckY + 2.2, 3.05);
    // helideck
    const heli = a.C(4.2, 0.28, yellow(), 9, deckY + 6.2, 0, 8);
    void heli;
    const ht = canvasTex('heli-h', 256, 256, (x, w, h) => {
      x.fillStyle = '#f5c518'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#fff'; x.lineWidth = 14; x.strokeRect(18, 18, w - 36, h - 36);
      x.fillStyle = '#fff'; x.font = 'bold 140px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', w / 2, h / 2);
    });
    if (ht) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), new THREE.MeshStandardMaterial({ map: ht, roughness: 0.6 }));
      p.rotation.x = -Math.PI / 2; p.position.set(9, deckY + 6.52, 0); a.g.add(p);
    }
    a.B(2, 6, 0.3, steel(), 6.2, deckY + 1.2, 0);
    // pedestal crane
    a.C(0.5, 5, yellow(), -7, deckY + 1.2, 4);
    a.B(8, 0.28, 0.28, yellow(), -10, deckY + 6.2, 4);
  }
  if (s3 > 0 || complete) {
    // flare boom
    const boom = a.B(10, 0.28, 0.28, steel(), -10, deckY + 6, -4);
    boom.rotation.z = 0.4;
    a.C(0.45, 1.4, M(0xff7a1a, 0.4, 0, 0xff7a1a, 1.4), -15, deckY + 10, -4);
    // lifeboats
    a.C(0.7, 2.2, M(0xe86020, 0.6), 2, deckY + 1.2, 6.4, 8);
    a.C(0.7, 2.2, M(0xe86020, 0.6), 4.2, deckY + 1.2, 6.4, 8);
  }
  if (launched) a.B(36, 0.25, 24, M(0x1a4a6a, 0.25, 0, 0x1a4a6a, 0.15, 0.45), 0, 0, 0);
  return a.g;
}

/** Shore construction dock: concrete quay, gantry crane, warehouse, skid beams and fenders. */
export function buildRigDock(): THREE.Group {
  const a = tools('rig-dock');
  const wood = M(0x8a6440, 0.9);
  a.B(36, 0.16, 28, M(0x6a6860, 1), 0, 0, -2);
  a.B(32, 1.1, 16, conc(), 0, 0, 0);
  // fenders
  for (let i = 0; i < 7; i++) a.C(0.35, 1.4, M(0x2a2a28, 0.8), -14 + i * 4.6, 0, 8.2, 8);
  // bollards
  for (const x of [-12, -4, 4, 12]) a.C(0.28, 0.7, steel(), x, 1.1, 6.5);
  // skid beams
  for (const z of [-3, 0, 3]) a.B(24, 0.25, 0.4, steel(), 0, 1.1, z);
  // warehouse
  a.B(10, 7, 10, corrugatedMat('#6a7380', 'dock-shed'), -10, 1.1, -2);
  a.B(10.4, 0.4, 10.4, M(0x3a4048, 0.6), -10, 8.1, -2);
  a.B(3.2, 4, 0.15, M(0x3a3a38, 0.7), -10, 1.1, 3.1);
  // gantry crane
  a.B(0.7, 16, 0.7, yellow(), 8, 1.1, -6);
  a.B(0.7, 16, 0.7, yellow(), 8, 1.1, 6);
  a.B(0.6, 0.6, 14, yellow(), 8, 17.1, 0);
  a.B(10, 0.5, 0.5, yellow(), 3.5, 17.1, 0);
  a.C(0.1, 6, steel(), 3, 11.1, 0);
  a.B(1.4, 0.8, 1.4, steel(), 3, 11.1, 0);
  // approach pier
  a.B(10, 0.5, 6, wood, 10, 1.1, 10);
  for (const x of [6, 14]) a.C(0.25, 2.4, steel(), x, -0.6, 12);
  for (const x of [-14, 0, 14]) { a.C(0.14, 8, steel(), x, 1.1, -10); a.B(0.6, 0.4, 0.6, M(0xffe9a8, 0.4, 0, 0xffe9a8, 1.1), x, 9.1, -10); }
  return a.g;
}

/** Petrochemical / plastics plant: cracking columns, pipe racks, spheres, bullet tanks and a flare. */
export function buildPlasticsPlant(): THREE.Group {
  const a = tools('plastics-plant');
  a.B(40, 0.12, 30, asphalt(), 0, 0, 0);
  const hall = corrugatedMat('#cfd6dc', 'plas-hall');
  a.B(14, 7, 10, hall, -10, 0.12, -6);
  a.B(14.4, 0.4, 10.4, M(0x4a5560, 0.6), -10, 7.12, -6);
  // distillation / cracker columns
  const col = M(0xb8c0c8, 0.4, 0.5);
  const specs: Array<[number, number, number, number]> = [[1.1, 16, 4, 4], [1.4, 20, 8, 4], [0.9, 13, 12, 4]];
  for (const [r, h, x, z] of specs) {
    a.C(r, h, col, x, 0.12, z);
    for (let i = 1; i < 5; i++) a.C(r + 0.25, 0.12, steel(), x, (h / 5) * i, z);
    a.C(r * 0.7, 0.8, col, x, h, z);
  }
  // pipe rack
  for (const z of [-2, 2]) for (const x of [-4, 4, 12]) a.B(0.2, 5, 0.2, steel(), x, 0.12, z);
  a.B(20, 0.2, 5, steel(), 4, 5.12, 0);
  const pipes = [0xc45a2a, 0x3a6aaa, 0xc8c4bc, 0x3a8a4a, 0x8a4aaa];
  pipes.forEach((c, i) => a.C(0.16, 20, M(c, 0.4, 0.4), 4, 5.4, -1.6 + i * 0.5));
  // rotate pipes to lie on the rack: scale cylinder as a long tube along x by rotating
  a.g.children.slice(-pipes.length).forEach((o) => { o.rotation.z = Math.PI / 2; o.position.y = 5.5; });
  // spheres
  for (const x of [-12, -6]) {
    a.S(2.4, M(0xc8d4dc, 0.3, 0.45), x, 2.2, 9);
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] as const) a.B(0.16, 2.4, 0.16, steel(), x + dx, 0.12, 9 + dz);
  }
  // bullet tanks
  for (let i = 0; i < 3; i++) {
    const t = a.C(1.1, 6, M(0x8ad0e0, 0.3, 0.4), 12, 1.3, -8 + i * 4);
    t.rotation.z = Math.PI / 2; t.position.y = 1.4;
    a.B(0.3, 1.1, 0.3, steel(), 9.4, 0.12, -8 + i * 4);
    a.B(0.3, 1.1, 0.3, steel(), 14.6, 0.12, -8 + i * 4);
  }
  // flare
  stackedBands(a, 0.45, 18, -16, 8, 8);
  a.C(0.5, 1.2, M(0xff7a1a, 0.4, 0, 0xff7a1a, 1.3), -16, 18, 8);
  coolingTower(a, 2.4, 7, 16, 8);
  a.B(7, 1.2, 0.25, M(0x8ad0e0, 0.4, 0, 0x8ad0e0, 0.7), 0, 6, 10);
  siteFence(a, 40, 30);
  return a.g;
}

/** Napa-style winery: stone hall, terracotta roof, terrace, stainless tanks and vine rows. */
export function buildWinery(): THREE.Group {
  const a = tools('winery');
  a.B(36, 0.08, 32, lawn(), 0, 0, 4);
  a.B(18, 7, 12, stone(), 0, 0.08, -2);
  // gable roof from two slabs
  const roofL = a.B(19, 0.3, 8, terra(), 0, 7.08, -2);
  roofL.rotation.x = 0.45; roofL.position.z = -2 - 3; roofL.position.y = 8.2;
  const roofR = a.B(19, 0.3, 8, terra(), 0, 7.08, -2);
  roofR.rotation.x = -0.45; roofR.position.z = -2 + 3; roofR.position.y = 8.2;
  a.B(19, 0.4, 0.4, terra(), 0, 9.4, -2);
  // cupola
  a.B(2.4, 1.6, 2.4, stone(), 0, 9.5, -2);
  a.K(1.6, 1.2, terra(), 0, 11.1, -2);
  // windows + door
  for (const x of [-5, 0, 5]) a.B(1.6, 2.2, 0.1, glass(), x, 2.2, 4.05);
  a.B(1.5, 2.6, 0.12, M(0x3a2a1a, 0.85), 0, 0.08, 4.05);
  // terrace
  a.B(12, 0.2, 6, stone(), 0, 0.08, 8);
  for (const x of [-5, 5]) a.C(0.12, 3, stone(), x, 0.28, 10);
  a.B(11, 0.12, 3.2, M(0xc4a06a, 0.85), 0, 3.28, 10);
  // barrel wing
  a.B(8, 4.2, 8, M(0xcfc8b8, 0.9), 13, 0.08, -2);
  a.B(8.4, 0.35, 8.4, terra(), 13, 4.28, -2);
  for (const z of [-3, 0, 3]) a.C(0.7, 1.2, M(0x6b3a2a, 0.8), 13, 0.2, z, 8);
  // stainless tanks
  for (const z of [-3, 1, 5]) a.C(1.1, 3.6, M(0xc8d0d8, 0.3, 0.6), -12, 0.08, z);
  // vine rows south of the hall
  const post = M(0x6b4526, 0.9), vine = M(0x3a7a3a, 0.85);
  for (let r = 0; r < 8; r++) {
    const z = 12 + r * 1.6;
    for (let i = 0; i < 8; i++) a.C(0.05, 1.3, post, -10 + i * 2.8, 0.08, z);
    a.B(20, 0.35, 0.5, vine, 0, 1.0, z);
  }
  for (const x of [-16, 16]) { cypress(a, x, 6, 5.5); cypress(a, x, 10, 6); }
  a.B(4, 0.1, 16, M(0xc8c0b0, 0.95), 0, 0.08, 6);
  return a.g;
}

export function buildGoldwoodMansion(floors = 2, seed = 0): THREE.Group {
  const tints = [0xf3efe6, 0xeee4d4, 0xe8e0d8, 0xf0ece4];
  return mansion((i) => 1, 4, floors, tints[seed % tints.length]!);
}

/** Cinematic international terminal used in teasers and the preview gallery. */
export function buildAirportTerminal(): THREE.Group {
  return airportTerminal('intl-terminal', false);
}

/** Compact terminal that fits the existing airport landmark slot without crowding the Coming Soon sign. */
export function buildAirportLandmark(): THREE.Group {
  return airportTerminal('airport-landmark', true);
}

function airportTerminal(name: string, compact: boolean): THREE.Group {
  const a = tools(name);
  const sx = compact ? 0.62 : 1, sz = compact ? 0.7 : 1;
  const hallW = 36 * sx, hallD = 14 * sz, hallH = compact ? 6.2 : 8;
  const roof = M(0xe8ecf2, 0.45, 0.2);
  const dark = M(0x1a1d24, 0.5);
  const steelM = M(0xb8bcc4, 0.4, 0.5);
  a.B(hallW + 16, 0.08, hallD + 28, asphalt(), 0, 0, -4);
  a.B(hallW, hallH, hallD, facadeMat('term-glass', '#d8dee8', '#8ec8e0', '#2a3038', 16, 4, 'rgba(200,230,255,0.35)'), 0, 0.08, 2);
  // barrel vault
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(hallD * 0.55, hallD * 0.55, hallW + 1.2, 20, 1, false, 0, Math.PI), roof);
  vault.rotation.z = Math.PI / 2; vault.position.set(0, hallH + 0.2, 2); a.g.add(vault);
  a.B(hallW + 1.6, 0.3, 0.4, dark, 0, hallH + hallD * 0.55, 2);
  // arrivals canopy (south / +z, street side)
  a.B(hallW * 0.55, 0.25, 8, roof, 0, 4.2, 2 + hallD / 2 + 3);
  for (const x of [-hallW * 0.2, hallW * 0.2]) a.C(0.16, 4.2, steelM, x, 0.08, 2 + hallD / 2 + 5);
  // piers toward the airside (west / -x in compact=false we use -z for preview cameras; in landmark, west is -x)
  const pierLen = compact ? 16 : 22;
  if (compact) {
    // piers west toward the runways
    for (const z of [-5, 8]) {
      a.B(pierLen, 4.2, 5.5, roof, -hallW / 2 - pierLen / 2, 0.08, z);
      a.B(pierLen, 0.3, 5.8, dark, -hallW / 2 - pierLen / 2, 4.28, z);
      jetBridge(a, -hallW / 2 - pierLen, 1.4, z, -1);
    }
  } else {
    for (const x of [-14, 14]) {
      a.B(7, 4.6, pierLen, roof, x, 0.08, 2 - hallD / 2 - pierLen / 2);
      a.B(7.3, 0.3, pierLen, dark, x, 4.68, 2 - hallD / 2 - pierLen / 2);
      jetBridge(a, x, 1.6, 2 - hallD / 2 - pierLen, 0);
    }
  }
  // control tower (east of hall, away from the Coming Soon sign west/north of the slot)
  const tx = compact ? hallW / 2 - 2 : -12, tz = compact ? -hallD / 2 + 1 : 6;
  a.B(2.4, compact ? 16 : 22, 2.4, dark, tx, 0.08, tz);
  a.B(5.2, 2.8, 5.2, glass(), tx, compact ? 16 : 22, tz);
  a.B(5.6, 0.3, 5.6, M(0xd4af37, 0.4, 0.4, 0xd4af37, 0.7), tx, compact ? 18.8 : 24.8, tz);
  a.C(0.12, 3, steelM, tx, compact ? 19.1 : 25.1, tz);
  // stand markings
  const paint = M(0xf2f2f2, 0.8);
  for (let i = 0; i < 4; i++) a.B(0.25, 0.04, compact ? 8 : 10, paint, (compact ? -hallW / 2 - pierLen - 4 : -10 + i * 8), 0.08, compact ? -8 + i * 6 : 2 - hallD / 2 - pierLen - 6);
  return a.g;
}

function jetBridge(a: Add, x: number, y: number, z: number, dir: 0 | -1) {
  const steelM = M(0xb8bcc4, 0.4, 0.5);
  const cab = M(0x3a4048, 0.5);
  if (dir === -1) {
    a.B(6, 1.6, 1.5, steelM, x - 3, y, z);
    a.B(5, 1.6, 1.5, steelM, x - 7.5, y - 0.2, z + 1.2, -0.3);
    a.B(2.2, 2.0, 2.2, cab, x - 11, y - 0.4, z + 2);
  } else {
    a.B(1.5, 1.6, 6, steelM, x, y, z - 3);
    a.B(1.5, 1.6, 5, steelM, x + 1.2, y - 0.2, z - 7.5, 0.3);
    a.B(2.2, 2.0, 2.2, cab, x + 2, y - 0.4, z - 11);
  }
}

/** Okanagan / Washington-style orchard pad: dirt rows, drip irrigation, packing shed and bins. */
export function buildOrchardSite(w = 24, d = 18): THREE.Group {
  const a = tools('orchard-site');
  a.B(w, 0.08, d, lawn(), 0, 0, 0);
  const rows = Math.max(4, Math.round((d - 6) / 2));
  const rowZ0 = -d / 2 + 2, span = d - 8;
  for (let i = 0; i < rows; i++) {
    const z = rowZ0 + (span * i) / Math.max(1, rows - 1);
    a.B(w - 8, 0.1, 1.4, M(0x5a3e28, 1), -1, 0.08, z);
    a.B(w - 9, 0.08, 0.08, steel(), -1, 0.22, z);
    for (const x of [-w / 2 + 5, 0, w / 2 - 6]) a.C(0.07, 0.5, M(0x4a6a8a, 0.4, 0.5), x, 0.22, z);
  }
  // packing shed on the south / street edge
  const sx = w / 2 - 3, sz = d / 2 - 2.5;
  a.B(7, 5, 6, corrugatedMat('#c8102e', 'orch-shed'), sx, 0.08, sz);
  a.B(7.4, 0.35, 6.4, M(0x3a3a40, 0.7), sx, 5.08, sz);
  a.B(2.4, 3.2, 0.12, M(0x2a2a28, 0.7), sx - 1.4, 0.08, sz + 3.1);
  a.B(1.4, 1.2, 0.1, glass(), sx + 1.6, 2.2, sz + 3.1);
  a.C(0.9, 3.4, M(0xb8bcc4, 0.4, 0.4), sx - 4.2, 0.08, sz);
  // harvest bins
  for (const x of [-4, -1, 2]) a.B(1.4, 1.1, 1.2, M(0xc8a050, 0.8), x, 0.08, d / 2 - 2);
  a.B(3.5, 0.1, d, M(0xc8c0b0, 0.95), -w / 2 + 2, 0.08, 0);
  return a.g;
}

/** One fruit tree at a growth stage (sapling → young → canopy → fruiting). */
export function buildOrchardTree(color = 0xc83030, progress = 100, ready = false, matured = false): THREE.Group {
  const a = tools('orchard-tree');
  const trunk = M(0x6b4526, 0.9);
  const leaf = M(0x2e8b45, 0.75);
  const p = Math.max(0, Math.min(1, progress / 100));
  const young = !matured && p < 0.55;
  const h = young ? 0.8 + p * 1.4 : 2.2 + p * 1.4;
  const r = young ? 0.25 + p * 0.4 : 0.7 + p * 0.55;
  a.C(young ? 0.07 : 0.14, h * 0.7, trunk, 0, 0, 0);
  a.S(r, leaf, 0, h * 0.45, 0);
  if (!young) a.S(r * 0.7, leaf, 0.35, h * 0.55, 0.15);
  if (ready) {
    const fruit = M(color, 0.5, 0, color, 0.15);
    for (const [x, y, z] of [[0.4, 0.1, 0.2], [-0.3, 0.2, 0.25], [0.1, -0.15, -0.35], [-0.25, 0.05, -0.2], [0.3, 0.25, -0.15]] as const)
      a.S(0.12, fruit, x, h * 0.55 + y, z);
  }
  return a.g;
}
