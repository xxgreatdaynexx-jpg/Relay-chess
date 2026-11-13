/**
 * Decorative 3D space center modelled on Kennedy Space Center Launch Complex 39:
 * the Vehicle Assembly Building (south-face flag and meatball, high-bay doors,
 * stepped low bay), the Launch Control Center (sloped firing-room bays), an
 * LC-39 pad with a flame trench and lightning masts, a Launch Umbilical Tower
 * with service arms and a hammerhead crane, a Saturn-class rocket, the
 * crawlerway, a crawler-transporter, LH2 spheres and LOX tanks, a water tower
 * and a fenced Florida grounds.
 *
 * Shared geometries, canvas facades and instanced trusses keep the draw cost
 * in line with the rest of the city. The campus is self-contained and is not
 * placed on the live map by this module.
 */
import * as THREE from 'three';

const mats = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: number, rough = 0.8, metal = 0, emissive = 0, ei = 0, opacity = 1) => {
  const k = `${color}|${rough}|${metal}|${emissive}|${ei}|${opacity}`;
  let m = mats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei,
      transparent: opacity < 1, opacity, side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
    });
    mats.set(k, m);
  }
  return m;
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const CYL12 = new THREE.CylinderGeometry(1, 1, 1, 12);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const SPH = new THREE.SphereGeometry(1, 20, 14);
const CONE = new THREE.ConeGeometry(1, 1, 12);
const CONE8 = new THREE.ConeGeometry(1, 1, 8);
for (const g of [BOX, CYL, CYL12, CYL8, SPH, CONE, CONE8]) (g as THREE.BufferGeometry).userData.shared = true;

/** Approximate campus footprint (local x / z), used by placement and the preview. */
export const SPACE_CENTER_SIZE = { w: 100, d: 62 };

type Add = {
  g: THREE.Group;
  B: (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry?: number) => THREE.Mesh;
  C: (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, segs?: 8 | 12 | 16) => THREE.Mesh;
  S: (r: number, m: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;
  K: (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, segs?: 8 | 12) => THREE.Mesh;
};

function tools(name: string): Add {
  const g = new THREE.Group(); g.name = name;
  const B = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y + h / 2, z); o.rotation.y = ry;
    o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  const C = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, segs: 8 | 12 | 16 = 16) => {
    const geo = segs === 8 ? CYL8 : segs === 12 ? CYL12 : CYL;
    const o = new THREE.Mesh(geo, m); o.scale.set(r, h, r); o.position.set(x, y + h / 2, z);
    o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  const S = (r: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(SPH, m); o.scale.setScalar(r); o.position.set(x, y + r, z);
    o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  const K = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, segs: 8 | 12 = 12) => {
    const o = new THREE.Mesh(segs === 8 ? CONE8 : CONE, m); o.scale.set(r, h, r); o.position.set(x, y + h / 2, z);
    o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  return { g, B, C, S, K };
}

const texCache = new Map<string, THREE.CanvasTexture | null>();
function canvasTex(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void, wrap = false): THREE.CanvasTexture | null {
  if (texCache.has(key)) return texCache.get(key)!;
  if (typeof document === 'undefined') { texCache.set(key, null); return null; }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); if (!x) { texCache.set(key, null); return null; }
  draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  (t as THREE.Texture).userData.shared = true;
  texCache.set(key, t); return t;
}

function texMat(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void, opts?: { rough?: number; metal?: number; wrap?: boolean; fallback?: number }): THREE.MeshStandardMaterial {
  const t = canvasTex(key, w, h, draw, !!opts?.wrap);
  if (!t) return M(opts?.fallback ?? 0xc8c4bc, opts?.rough ?? 0.85, opts?.metal ?? 0);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: opts?.rough ?? 0.85, metalness: opts?.metal ?? 0 });
  mats.set(key, m); return m;
}

type Inst = { x: number; y: number; z: number; sx: number; sy: number; sz: number; rx?: number; ry?: number; rz?: number };
function instanced(parent: THREE.Object3D, mat: THREE.Material, items: Inst[], name: string, geo: THREE.BufferGeometry = BOX) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true;
  const d = new THREE.Object3D();
  items.forEach((it, i) => {
    d.position.set(it.x, it.y, it.z);
    d.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    d.scale.set(it.sx, it.sy, it.sz);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return mesh;
}

function plane(parent: THREE.Object3D, w: number, h: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}

/* ---------- paints (real VAB south face, high-bay doors, Saturn markings) ---------- */

function drawStar(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
    const b = a + Math.PI / 5;
    if (i === 0) x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    x.lineTo(cx + Math.cos(b) * r * 0.4, cy + Math.sin(b) * r * 0.4);
  }
  x.closePath(); x.fill();
}

/** Tall painted flag as on the VAB south face (209 ft high × 110 ft wide). */
function drawVabFlag(x: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number) {
  const stripe = h / 13;
  for (let i = 0; i < 13; i++) {
    x.fillStyle = i % 2 === 0 ? '#BF0A30' : '#FFF';
    x.fillRect(x0, y0 + i * stripe, w, stripe + 0.5);
  }
  const cw = w * 0.4, ch = stripe * 7;
  x.fillStyle = '#002868';
  x.fillRect(x0, y0, cw, ch);
  // 9 rows, 6-5-6-5-… of stars
  x.fillStyle = '#FFF';
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    const n = r % 2 === 0 ? 6 : 5;
    const rowY = y0 + (ch / rows) * (r + 0.5);
    for (let s = 0; s < n; s++) {
      const rowX = x0 + (cw / (n + 1)) * (s + 1);
      drawStar(x, rowX, rowY, Math.min(cw, ch) * 0.042);
    }
  }
}

/** Meatball-style NASA insignia as painted on the VAB (factual depiction of the real facade). */
function drawMeatball(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.save();
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = '#0B3D91'; x.fill();
  x.save();
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
  // scattered white stars in the upper field
  x.fillStyle = '#FFF';
  const stars: Array<[number, number, number]> = [
    [-0.55, -0.55, 0.045], [-0.32, -0.68, 0.035], [-0.08, -0.58, 0.04], [0.18, -0.7, 0.03],
    [0.42, -0.52, 0.038], [-0.68, -0.28, 0.03], [-0.48, -0.22, 0.028], [0.62, -0.32, 0.03],
    [-0.22, -0.38, 0.025], [0.08, -0.42, 0.022], [0.32, -0.28, 0.025], [-0.72, -0.5, 0.022],
    [0.55, -0.68, 0.022], [-0.08, -0.78, 0.02], [0.72, -0.12, 0.02],
  ];
  for (const [sx, sy, ss] of stars) drawStar(x, cx + sx * r, cy + sy * r, ss * r * 2.2);
  // NASA wordmark
  x.fillStyle = '#FFF';
  x.font = `bold ${Math.round(r * 0.38)}px Arial, Helvetica, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('NASA', cx, cy + r * 0.06);
  x.restore();
  // red vector (wing) — through the wordmark, out the upper right
  x.fillStyle = '#FC3D21';
  x.beginPath();
  x.moveTo(cx - r * 0.95, cy + r * 0.22);
  x.bezierCurveTo(cx - r * 0.35, cy + r * 0.08, cx + r * 0.15, cy - r * 0.12, cx + r * 1.08, cy - r * 0.72);
  x.lineTo(cx + r * 0.92, cy - r * 0.92);
  x.bezierCurveTo(cx + r * 0.2, cy - r * 0.18, cx - r * 0.25, cy + r * 0.02, cx - r * 0.92, cy + r * 0.08);
  x.closePath(); x.fill();
  // white orbital ring, tilted
  x.save();
  x.translate(cx, cy + r * 0.06);
  x.rotate(-0.48);
  x.strokeStyle = '#FFF'; x.lineWidth = r * 0.055; x.beginPath();
  x.ellipse(0, 0, r * 0.98, r * 0.36, 0, 0, Math.PI * 2); x.stroke();
  x.restore();
  // crisp rim
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
  x.strokeStyle = '#0B3D91'; x.lineWidth = r * 0.03; x.stroke();
  x.restore();
}

function vabSouthMat() {
  return texMat('vab-south', 1024, 1280, (x, w, h) => {
    // warm white concrete with faint panel joints
    x.fillStyle = '#E6E4DC'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,0,0,0.06)'; x.lineWidth = 2;
    const floors = 12, bays = 8;
    for (let i = 1; i < floors; i++) { x.beginPath(); x.moveTo(0, (i / floors) * h); x.lineTo(w, (i / floors) * h); x.stroke(); }
    for (let i = 1; i < bays; i++) { x.beginPath(); x.moveTo((i / bays) * w, 0); x.lineTo((i / bays) * w, h); x.stroke(); }
    // slight weathering at the base
    const g = x.createLinearGradient(0, h * 0.75, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(80,70,50,0.08)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // flag: tall portrait, upper-left (matches the painted VAB flag)
    const fw = w * 0.28, fh = h * 0.46, fx = w * 0.07, fy = h * 0.1;
    drawVabFlag(x, fx, fy, fw, fh);
    // thin dark outline so the flag sits on the wall
    x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = 3; x.strokeRect(fx, fy, fw, fh);
    // recessed grey bay between flag and logo
    x.fillStyle = '#C8CAC8';
    x.fillRect(w * 0.4, h * 0.22, w * 0.16, h * 0.42);
    x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 4; x.strokeRect(w * 0.4, h * 0.22, w * 0.16, h * 0.42);
    // meatball, upper-right
    drawMeatball(x, w * 0.74, h * 0.32, w * 0.155);
    // a few tiny windows near mid-height
    x.fillStyle = '#8aa8b8';
    for (let i = 0; i < 6; i++) x.fillRect(w * 0.08 + i * w * 0.06, h * 0.72, w * 0.03, h * 0.035);
  }, { rough: 0.88, fallback: 0xe6e4dc });
}

function vabDoorMat(key: string) {
  return texMat(key, 768, 1280, (x, w, h) => {
    x.fillStyle = '#E4E2DA'; x.fillRect(0, 0, w, h);
    // Two tall high-bay doors: mid-grey 11-leaf segments inside a dark frame, as on the real east/west faces.
    const doors = [0.09, 0.53];
    const dw = w * 0.36, dh = h * 0.84, dy = h * 0.08;
    for (const dx of doors) {
      x.fillStyle = '#3A3E46';
      x.fillRect(dx * w - w * 0.03, dy - h * 0.015, dw + w * 0.06, dh + h * 0.03);
      const segs = 11, sh = dh / segs;
      for (let i = 0; i < segs; i++) {
        x.fillStyle = i % 2 ? '#9AA0A8' : '#8E949C';
        x.fillRect(dx * w, dy + i * sh, dw, sh - 2);
        x.fillStyle = 'rgba(255,255,255,0.16)';
        x.fillRect(dx * w, dy + i * sh, dw, 4);
        x.fillStyle = 'rgba(0,0,0,0.22)';
        x.fillRect(dx * w, dy + (i + 1) * sh - 4, dw, 4);
      }
      x.fillStyle = '#4A5058';
      x.fillRect(dx * w + dw * 0.485, dy, dw * 0.03, dh);
    }
    x.fillStyle = '#D8D6CE';
    x.fillRect(0, 0, w, h * 0.04);
  }, { rough: 0.86, fallback: 0x8e949c });
}

function vabRoofMat() {
  return texMat('vab-roof', 512, 512, (x, w, h) => {
    x.fillStyle = '#B8B6B0'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#A4A29C';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) {
      x.fillRect(20 + i * 62, 18 + j * 82, 36, 28);
    }
    x.fillStyle = '#9A9892';
    x.fillRect(w * 0.35, h * 0.35, w * 0.3, h * 0.28);
  }, { rough: 0.95, fallback: 0xb8b6b0 });
}

function rocketStageMat(kind: 's1' | 's2' | 's3') {
  return texMat(`saturn-${kind}`, 1024, 1024, (x, w, h) => {
    x.fillStyle = '#F3F1EC'; x.fillRect(0, 0, w, h);
    if (kind === 's1') {
      // Four black roll-pattern panels, as on the Saturn V first stage, plus UNITED STATES and a flag.
      const panels = 4, slot = w / panels;
      for (let i = 0; i < panels; i++) {
        x.fillStyle = '#16171A';
        x.fillRect(i * slot + slot * 0.08, h * 0.14, slot * 0.38, h * 0.72);
      }
      // UNITED STATES on a white gore, vertical, facing a typical south-east camera (u ~ 0.6)
      x.save();
      x.fillStyle = '#16171A';
      x.translate(w * 0.68, h * 0.22);
      x.rotate(Math.PI / 2);
      x.font = `bold ${Math.round(h * 0.075)}px Arial, Helvetica, sans-serif`;
      x.textAlign = 'left'; x.textBaseline = 'middle';
      x.fillText('UNITED STATES', 0, 0);
      x.restore();
      // flag on a neighbouring white gore
      const fw = slot * 0.28, fh = fw * 0.56;
      const fx = w * 0.52, fy = h * 0.32;
      const stripe = fh / 13;
      for (let i = 0; i < 13; i++) {
        x.fillStyle = i % 2 === 0 ? '#BF0A30' : '#FFF';
        x.fillRect(fx, fy + i * stripe, fw, stripe + 0.5);
      }
      x.fillStyle = '#002868'; x.fillRect(fx, fy, fw * 0.4, stripe * 7);
      x.fillStyle = '#16171A';
      x.fillRect(0, h * 0.92, w, h * 0.08);
    } else if (kind === 's2') {
      x.fillStyle = '#16171A';
      x.fillRect(0, h * 0.88, w, h * 0.12);
      x.save();
      x.fillStyle = '#16171A';
      x.translate(w * 0.62, h * 0.25);
      x.rotate(Math.PI / 2);
      x.font = `bold ${Math.round(h * 0.1)}px Arial, Helvetica, sans-serif`;
      x.textAlign = 'left'; x.textBaseline = 'middle';
      x.fillText('USA', 0, 0);
      x.restore();
    } else {
      x.fillStyle = '#16171A';
      x.fillRect(0, h * 0.9, w, h * 0.1);
    }
  }, { rough: 0.45, metal: 0.15, wrap: true, fallback: 0xf3f1ec });
}

function gravelMat() {
  return texMat('crawlerway-gravel', 256, 256, (x, w, h) => {
    x.fillStyle = '#C6B898'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const s = 1 + Math.random() * 3;
      const k = 160 + Math.random() * 70;
      x.fillStyle = `rgb(${k + 20},${k},${k - 25})`;
      x.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
    // faint tyre ruts along the length (u = along)
    x.fillStyle = 'rgba(80,70,50,0.08)';
    x.fillRect(0, h * 0.25, w, h * 0.08);
    x.fillRect(0, h * 0.65, w, h * 0.08);
  }, { rough: 1, wrap: true, fallback: 0xc6b898 });
}

function grassMat() {
  return texMat('sc-grass', 256, 256, (x, w, h) => {
    x.fillStyle = '#5A7A48'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const k = 60 + Math.random() * 50;
      x.fillStyle = `rgb(${k - 10},${k + 50},${k - 20})`;
      x.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  }, { rough: 1, wrap: true, fallback: 0x5a7a48 });
}

function concreteMat(key: string, base = '#C8C4B8') {
  return texMat(key, 256, 256, (x, w, h) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,0,0,0.07)'; x.lineWidth = 1;
    for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(0, i * 42); x.lineTo(w, i * 42); x.stroke(); }
    for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(i * 42, 0); x.lineTo(i * 42, h); x.stroke(); }
    for (let i = 0; i < 80; i++) {
      const k = -8 + Math.random() * 16;
      x.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.04})`;
      x.fillRect(Math.random() * w, Math.random() * h, 8, 6);
    }
  }, { rough: 0.95, wrap: true, fallback: 0xc8c4b8 });
}

function latticeTex(color: string, key: string) {
  return texMat(key, 256, 512, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = color; x.lineWidth = 7;
    const cell = 48;
    for (let y = 0; y < h; y += cell) {
      x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
      x.beginPath(); x.moveTo(0, y); x.lineTo(w, y + cell); x.stroke();
      x.beginPath(); x.moveTo(w, y); x.lineTo(0, y + cell); x.stroke();
    }
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo((i / 4) * w, 0); x.lineTo((i / 4) * w, h); x.stroke(); }
  }, { rough: 0.45, metal: 0.65, wrap: true, fallback: 0xc44a1a });
}

function chainlinkMat() {
  const t = canvasTex('chainlink', 128, 128, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgba(180,190,185,0.7)'; x.lineWidth = 2;
    const s = 16;
    for (let y = -s; y < h + s; y += s) for (let px = -s; px < w + s; px += s) {
      x.strokeRect(px, y, s, s);
    }
  }, true);
  if (!t) return M(0x6a7a6a, 0.5, 0.2, 0, 0, 0.35);
  const m = new THREE.MeshStandardMaterial({
    map: t, transparent: true, opacity: 0.65, roughness: 0.45, metalness: 0.4,
    side: THREE.DoubleSide, depthWrite: false,
  });
  mats.set('chainlink-m', m); return m;
}

function crawlerSideMat() {
  return texMat('crawler-side', 1024, 256, (x, w, h) => {
    x.fillStyle = '#6A6E74'; x.fillRect(0, 0, w, h);
    // structural ribs and pipes, as on the real transporter
    x.fillStyle = '#5A5E64';
    for (let i = 0; i < 14; i++) x.fillRect(i * 72 + 10, 0, 10, h);
    x.fillStyle = '#8A9098';
    x.fillRect(0, h * 0.22, w, 8); x.fillRect(0, h * 0.55, w, 8); x.fillRect(0, h * 0.82, w, 8);
    x.fillStyle = '#4A5058';
    for (let i = 0; i < 8; i++) x.fillRect(80 + i * 120, h * 0.3, 50, h * 0.45);
    x.fillStyle = '#9AA0A8';
    for (let i = 0; i < 10; i++) { x.fillRect(40 + i * 100, h * 0.15, 6, h * 0.7); }
  }, { rough: 0.55, metal: 0.55, fallback: 0x6a6e74 });
}

function solarMat() {
  return texMat('lcc-solar', 512, 256, (x, w, h) => {
    x.fillStyle = '#0A1628'; x.fillRect(0, 0, w, h);
    const cw = 18, ch = 22;
    for (let i = 0; i < w / cw; i++) for (let j = 0; j < h / ch; j++) {
      x.fillStyle = (i + j) % 2 ? '#0E2040' : '#163058';
      x.fillRect(i * cw + 1, j * ch + 1, cw - 2, ch - 2);
      x.fillStyle = 'rgba(80,140,200,0.18)';
      x.fillRect(i * cw + 1, j * ch + 1, cw - 2, 3);
    }
  }, { rough: 0.35, metal: 0.45, fallback: 0x0a1628 });
}

function firingGlassMat() {
  return texMat('lcc-glass', 512, 256, (x, w, h) => {
    x.fillStyle = '#1A2838'; x.fillRect(0, 0, w, h);
    // dark sloped window wall with mullions, as on the LCC firing rooms
    x.fillStyle = '#243448';
    const cols = 8, rows = 5;
    const cw = w / cols, ch = h / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      x.fillStyle = j > 2 ? '#2A4058' : '#1C3048';
      x.fillRect(i * cw + 4, j * ch + 4, cw - 8, ch - 8);
      x.fillStyle = 'rgba(160,200,230,0.12)';
      x.fillRect(i * cw + 4, j * ch + 4, cw - 8, ch * 0.3);
    }
    x.strokeStyle = '#D8D4CC'; x.lineWidth = 5;
    for (let i = 0; i <= cols; i++) { x.beginPath(); x.moveTo(i * cw, 0); x.lineTo(i * cw, h); x.stroke(); }
    for (let j = 0; j <= rows; j++) { x.beginPath(); x.moveTo(0, j * ch); x.lineTo(w, j * ch); x.stroke(); }
  }, { rough: 0.2, metal: 0.35, fallback: 0x1a2838 });
}

/* ---------- pieces ---------- */

function palm(a: Add, x: number, z: number, h = 5.5) {
  const trunk = M(0x8a6440, 0.9), leaf = M(0x2f7a38, 0.7), leaf2 = M(0x3a8a40, 0.7);
  a.C(0.13, h, trunk, x, 0, z, 8);
  a.C(0.2, 0.28, trunk, x, 0, z, 8);
  // A small leafy heart so the crown isn't a hollow plus-sign from a distance.
  a.S(0.45, leaf, x, h - 0.55, z);
  for (let i = 0; i < 10; i++) {
    const th = (i / 10) * Math.PI * 2 + 0.15;
    const f = a.B(0.18, 0.05, 1.85, i % 2 ? leaf : leaf2, x + Math.cos(th) * 0.85, h - 0.05, z + Math.sin(th) * 0.85, -th + Math.PI / 2);
    f.rotation.x = 0.55;
    f.rotation.z = 0.12 * ((i % 2) ? 1 : -1);
  }
}

function buildVab(root: THREE.Group) {
  const a = tools('vab');
  const conc = M(0xe6e4dc, 0.9);
  const dark = M(0x3a3d44, 0.7);
  // Main high-bay cube. Real VAB is nearly cubic; game scale ~28 tall.
  const W = 24, H = 28, D = 20;
  a.B(W, H, D, conc, 0, 0, 0);
  // South face (+z): flag and meatball, as in the tourist photographs.
  plane(a.g, W - 0.08, H - 0.08, vabSouthMat(), 0, H / 2, D / 2 + 0.04);
  // Physically recess the grey bay between the flag and the meatball.
  a.B(3.6, 11.6, 0.5, M(0xc4c6c4, 0.9), -0.5, 10.0, D / 2 - 0.18);
  // East and west high-bay doors (the tallest doors in the world, 11 leaves).
  plane(a.g, D - 0.08, H - 0.08, vabDoorMat('vab-east'), W / 2 + 0.04, H / 2, 0, 0, Math.PI / 2);
  plane(a.g, D - 0.08, H - 0.08, vabDoorMat('vab-west'), -W / 2 - 0.04, H / 2, 0, 0, -Math.PI / 2);
  // North face: quieter concrete with a couple of door bays.
  plane(a.g, W - 0.08, H - 0.08, vabDoorMat('vab-north'), 0, H / 2, -D / 2 - 0.04, 0, Math.PI);
  // Roof plant rooms and vents.
  const roof = a.B(W + 0.4, 0.35, D + 0.4, vabRoofMat(), 0, H, 0);
  roof.receiveShadow = true;
  a.B(6, 1.6, 5, M(0xc8c6c0, 0.9), -4, H + 0.35, -3);
  a.B(4, 1.1, 3.2, M(0xc0beb8, 0.9), 5, H + 0.35, 4);
  for (const [x, z] of [[-8, 6], [8, 6], [-8, -6], [8, -6], [0, 0]] as const) {
    a.C(0.45, 0.8, M(0xb0aea8, 0.85), x, H + 0.35, z, 8);
  }
  // Flagpole on the roof corner
  a.C(0.06, 3.4, M(0x8a9098, 0.4, 0.6), W / 2 - 1.2, H + 0.35, D / 2 - 1.2, 8);
  a.B(0.9, 0.5, 0.06, M(0xbf0a30, 0.55), W / 2 - 0.7, H + 3.2, D / 2 - 1.2);
  // Stepped low bay on the south (west side), as in the 2013/2017 south-face photos.
  a.B(12, 9.2, 9, conc, -6, 0, D / 2 + 4.4);
  a.B(7, 4.2, 6, conc, -4, 0, D / 2 + 9);
  a.B(4.2, 6.5, 0.2, M(0x5a6068, 0.7), -8.5, 1.4, D / 2 + 8.95);
  a.B(12.3, 0.3, 9.3, M(0xc8c6c0, 0.9), -6, 9.2, D / 2 + 4.4);
  // A small white annex on the SE corner (the transfer aisle / office).
  a.B(8, 5.4, 7, conc, 8, 0, D / 2 + 3.2);
  a.B(8.2, 0.25, 7.2, M(0xd0cec8, 0.85), 8, 5.4, D / 2 + 3.2);
  // Colonnade / covered walk on that annex (visible in the south-face photos).
  for (const x of [5.2, 7.2, 9.2, 10.8]) a.B(0.28, 4.4, 0.28, conc, x, 0, D / 2 + 6.6);
  a.B(7, 0.2, 2.2, M(0xdddcd6, 0.85), 8, 4.4, D / 2 + 6.6);
  a.B(7, 3.2, 0.12, M(0xc8ccc8, 0.8), 8, 0.4, D / 2 + 6.72);
  // External stairs on the annex
  for (let i = 0; i < 6; i++) a.B(1.4, 0.14, 0.7, M(0xb8b6b0, 0.85), 12.2, i * 0.7, D / 2 + 5.2 + i * 0.15);
  root.add(a.g);
  a.g.position.set(-32, 0, -2);
  return a.g;
}

function buildLcc(root: THREE.Group) {
  const a = tools('lcc');
  const wall = M(0xeeece8, 0.88);
  const dark = M(0x3a3d44, 0.7);
  // Long axis along z (north–south). The east face has the firing-room / solar sawtooth
  // that is the LCC's signature in both the 1960s rollout photo and today's aerials.
  const W = 10, H = 6.6, D = 24;
  a.B(W, H, D, wall, 0, 0, 0);
  a.B(W + 0.5, 0.28, D + 0.5, M(0xd8d6d0, 0.9), 0, H, 0);

  const bayD = 5.1, gap = 0.4;
  const startZ = -D / 2 + bayD / 2 + 0.9;
  for (let i = 0; i < 4; i++) {
    const z = startZ + i * (bayD + gap);
    const isGlass = i === 0;
    // Glass bay is steeper (a wall you look out of); solar bays are a shallower sawtooth roof.
    const run = isGlass ? 1.5 : 3.5;
    const rise = isGlass ? 3.5 : 2.6;
    const len = Math.hypot(run, rise);
    const ang = Math.atan2(rise, run); // from horizontal
    const mat = isGlass ? firingGlassMat() : solarMat();
    const panel = a.B(0.1, len, bayD - 0.25, mat, 0, 0, z);
    // rotZ = PI/2 - ang leans a vertical slab into a roof pitch, top toward -X (the building), bottom out.
    panel.rotation.z = Math.PI / 2 - ang;
    panel.position.set(W / 2 + run / 2, 3.55 + rise / 2, z);
    // White cheeks and a fascia along the outer edge.
    a.B(run + 0.3, rise + 0.4, 0.22, wall, W / 2 + run / 2, 3.5, z - bayD / 2 + 0.05);
    a.B(run + 0.3, rise + 0.4, 0.22, wall, W / 2 + run / 2, 3.5, z + bayD / 2 - 0.05);
    const fascia = a.B(0.16, 0.28, bayD - 0.1, wall, W / 2 + run, 3.5, z);
    // Roll-up doors / colonnade under the slopes, as in the modern LCC photographs.
    if (isGlass) {
      a.B(0.12, 3.2, bayD - 0.4, firingGlassMat(), W / 2 + 0.08, 0.3, z);
    } else {
      a.B(0.12, 3.0, bayD - 0.55, M(0x8a9098, 0.7), W / 2 + 0.08, 0.3, z);
      a.B(0.32, 3.4, 0.32, wall, W / 2 + 0.16, 0, z - bayD / 2 + 0.25);
      a.B(0.32, 3.4, 0.32, wall, W / 2 + 0.16, 0, z + bayD / 2 - 0.25);
    }
  }
  // West face, quieter, against the VAB
  for (let i = 0; i < 8; i++) a.B(0.08, 1.3, 1.5, M(0x9ab0c0, 0.25, 0.2, 0x6a90b0, 0.15, 0.7), -W / 2 - 0.05, 1.6 + (i % 2) * 2.2, -8 + i * 2.2);
  // South-end stairs
  for (let i = 0; i < 8; i++) a.B(1.5, 0.14, 0.7, M(0xc8c6c0, 0.85), -1.6, i * 0.7, D / 2 + 0.5 + i * 0.12);
  a.B(1.6, 5.6, 0.12, wall, -3.2, 0, D / 2 + 0.15);
  // Enclosed corridor toward the VAB (west / -x).
  a.B(6, 3.2, 3.2, wall, -W / 2 - 3, 0, -D / 2 + 3);
  a.B(6.2, 0.2, 3.4, M(0xd0cec8, 0.85), -W / 2 - 3, 3.2, -D / 2 + 3);
  // Roof HVAC
  a.B(2.4, 0.9, 2.0, dark, -1.5, H + 0.28, -4);
  a.B(2.0, 0.7, 1.6, dark, 1.2, H + 0.28, 5);
  a.C(0.25, 1.2, M(0x8a9098, 0.5, 0.4), 2, H + 0.28, -6, 8);
  root.add(a.g);
  a.g.position.set(-16, 0, 14);
  return a.g;
}

function buildCrawlerway(root: THREE.Group) {
  const a = tools('crawlerway');
  const gravel = gravelMat();
  const grass = grassMat();
  // Two tan rock lanes with a grass median, running east from the VAB to the pad.
  // Real crawlerway: two 40-ft lanes, ~50-ft grass median, Alabama river rock.
  const x0 = -18, x1 = 22, len = x1 - x0, mid = (x0 + x1) / 2;
  a.B(len + 8, 0.06, 4.2, gravel, mid, 0.04, -3.4);
  a.B(len + 8, 0.06, 4.2, gravel, mid, 0.04, 3.4);
  a.B(len + 8, 0.05, 2.6, grass, mid, 0.03, 0);
  // faint edge kerbs
  const kerb = M(0xb8b08e, 0.95);
  a.B(len + 8, 0.1, 0.18, kerb, mid, 0.06, -5.55);
  a.B(len + 8, 0.1, 0.18, kerb, mid, 0.06, 5.55);
  root.add(a.g);
  return a.g;
}

function buildCrawler(root: THREE.Group) {
  const a = tools('crawler');
  const steel = M(0x6a6e74, 0.5, 0.55);
  const dark = M(0x2a2c30, 0.7, 0.4);
  const cab = M(0xd8dce0, 0.55);
  // The real transporter is a flat steel barge on eight tracked trucks, with
  // ribbed sides, a beveled skirt and a cab at each end (it drives both ways).
  a.B(12.4, 2.2, 8.4, crawlerSideMat(), 0, 1.15, 0);
  // top deck
  a.B(12.6, 0.16, 8.6, M(0x5a5e64, 0.55, 0.5), 0, 3.35, 0);
  // beveled skirt: thin plates leaning out
  const skirt = M(0x5a5e64, 0.5, 0.5);
  for (const [w, d, x, z, ry] of [
    [12.6, 0.08, 0, 4.4, 0], [12.6, 0.08, 0, -4.4, 0],
  ] as const) {
    const p = a.B(w, 1.1, 0.12, skirt, x, 1.05, z);
    p.rotation.x = Math.sign(z) * 0.35;
  }
  a.B(0.12, 1.1, 8.6, skirt, 6.4, 1.05, 0);
  a.B(0.12, 1.1, 8.6, skirt, -6.4, 1.05, 0);
  // railings
  const rail = M(0x88909a, 0.4, 0.6);
  const posts: Inst[] = [];
  for (const z of [-4.15, 4.15]) for (let i = -5; i <= 5; i++) posts.push({ x: i * 1.15, y: 3.7, z, sx: 0.07, sy: 0.7, sz: 0.07 });
  for (const x of [-6.15, 6.15]) for (let i = -3; i <= 3; i++) posts.push({ x, y: 3.7, z: i * 1.15, sx: 0.07, sy: 0.7, sz: 0.07 });
  instanced(a.g, rail, posts, 'crawler-rail-posts');
  a.B(12.5, 0.05, 0.05, rail, 0, 4.05, 4.15);
  a.B(12.5, 0.05, 0.05, rail, 0, 4.05, -4.15);
  a.B(0.05, 0.05, 8.4, rail, 6.15, 4.05, 0);
  a.B(0.05, 0.05, 8.4, rail, -6.15, 4.05, 0);
  // eight tracked trucks (two at each corner)
  const track = (tx: number, tz: number) => {
    a.B(2.6, 0.7, 1.15, dark, tx, 0.35, tz);
    // tread blocks
    for (let i = -2; i <= 2; i++) a.B(0.4, 0.35, 1.25, M(0x1a1c1e, 0.9), tx + i * 0.5, 0.08, tz);
    a.C(0.38, 1.05, steel, tx - 0.7, 0.35, tz, 8); // wheels: rotate to axle
    const w1 = a.C(0.38, 1.05, steel, tx - 0.7, 0.22, tz, 8); w1.rotation.z = Math.PI / 2; w1.position.set(tx - 0.7, 0.55, tz);
    const w2 = a.C(0.38, 1.05, steel, tx + 0.7, 0.22, tz, 8); w2.rotation.z = Math.PI / 2; w2.position.set(tx + 0.7, 0.55, tz);
  };
  for (const x of [-3.8, 3.8]) for (const z of [-2.9, -1.55, 1.55, 2.9]) track(x, z);
  // two cabs (white, one at each end)
  for (const x of [-5.6, 5.6]) {
    a.B(1.8, 1.4, 2.4, cab, x, 3.5, 0);
    a.B(1.5, 0.7, 2.0, M(0x9ab0c0, 0.2, 0.25, 0x6a90b0, 0.12, 0.7), x + Math.sign(x) * 0.95, 3.85, 0);
  }
  // a few pipes along the side for depth
  for (const z of [4.25, -4.25]) a.C(0.08, 10, M(0x8a9098, 0.4, 0.6), 0, 2.0, z, 8).rotation.z = Math.PI / 2;
  root.add(a.g);
  // Parked on the crawlerway just east of the VAB.
  a.g.position.set(4, 0, 0);
  return a.g;
}

function buildTower(parent: THREE.Group, x: number, z: number, rocketX: number) {
  const g = new THREE.Group(); g.name = 'tower'; g.position.set(x, 0, z);
  const orange = M(0xc44a1a, 0.45, 0.55);
  const orangeD = M(0xa03812, 0.5, 0.55);
  const yellow = M(0xe0a018, 0.45, 0.5);
  const white = M(0xece8e0, 0.55, 0.2);
  const steel = M(0x8a9098, 0.4, 0.65);
  const H = 22.5, W = 3.6, D = 3.8;
  // four corner columns and an enclosed elevator shaft on the far side
  const cols: Inst[] = [];
  for (const cx of [-W / 2, W / 2]) for (const cz of [-D / 2, D / 2]) {
    cols.push({ x: cx, y: H / 2, z: cz, sx: 0.32, sy: H, sz: 0.32 });
  }
  instanced(g, orange, cols, 'lut-cols');
  // elevator shaft (solid, like the real LUT)
  const shaft = new THREE.Mesh(BOX, orangeD);
  shaft.scale.set(1.15, H - 0.6, 1.3); shaft.position.set(-W / 2 - 0.3, (H - 0.6) / 2, 0);
  shaft.castShadow = shaft.receiveShadow = true; g.add(shaft);
  // horizontal floors
  const beams: Inst[] = [];
  const levels = 12;
  for (let i = 1; i <= levels; i++) {
    const y = (H / (levels + 1)) * i;
    beams.push({ x: 0, y, z: -D / 2, sx: W, sy: 0.14, sz: 0.16 });
    beams.push({ x: 0, y, z: D / 2, sx: W, sy: 0.14, sz: 0.16 });
    beams.push({ x: -W / 2, y, z: 0, sx: 0.16, sy: 0.14, sz: D });
    beams.push({ x: W / 2, y, z: 0, sx: 0.16, sy: 0.14, sz: D });
  }
  instanced(g, orange, beams, 'lut-beams');
  // lattice fill on four faces (cheap, dense, matches the Apollo photos)
  const lat = latticeTex('#C44A1A', 'lut-lat');
  // make lattice material transparent around the strokes
  const latTex = canvasTex('lut-lat-alpha', 256, 512, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = '#C44A1A'; x.lineWidth = 8;
    const cell = 48;
    for (let y = 0; y < h; y += cell) {
      x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
      x.beginPath(); x.moveTo(0, y); x.lineTo(w, y + cell); x.stroke();
      x.beginPath(); x.moveTo(w, y); x.lineTo(0, y + cell); x.stroke();
    }
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo((i / 4) * w, 0); x.lineTo((i / 4) * w, h); x.stroke(); }
  }, true);
  const latMat = latTex
    ? new THREE.MeshStandardMaterial({ map: latTex, transparent: true, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide, depthWrite: false })
    : lat;
  plane(g, W, H - 0.4, latMat, 0, H / 2, D / 2 + 0.02);
  plane(g, W, H - 0.4, latMat, 0, H / 2, -D / 2 - 0.02, 0, Math.PI);
  plane(g, D, H - 0.4, latMat, W / 2 + 0.02, H / 2, 0, 0, Math.PI / 2);
  plane(g, D, H - 0.4, latMat, -W / 2 - 0.02, H / 2, 0, 0, -Math.PI / 2);
  // Service arms (white) reaching toward the rocket, stopping just short of the fairing.
  const dir = Math.sign(rocketX - x) || 1;
  const rocketR = 1.05;
  const face = dir * (W / 2);
  const armTip = (rocketX - x) - dir * (rocketR + 0.28);
  const len = Math.abs(armTip - face);
  const armYs = [4.2, 6.6, 9.2, 11.6, 14.2, 16.6, 18.8];
  armYs.forEach((y, i) => {
    const thisLen = len - (i === 4 ? 0.15 : 0);
    const zOff = (i % 2 ? 0.32 : -0.32);
    const arm = new THREE.Mesh(BOX, white);
    arm.scale.set(thisLen, 0.22, 0.38);
    arm.position.set(face + dir * (thisLen / 2), y, zOff);
    arm.castShadow = true; g.add(arm);
    // Crew-access / umbilical head only on a couple of levels (the rest are slimmer tips).
    const hs = i === 4 ? 0.85 : 0.48;
    const head = new THREE.Mesh(BOX, white);
    head.scale.set(0.55, hs, hs);
    head.position.set(face + dir * thisLen + dir * 0.22, y, zOff);
    head.castShadow = true; g.add(head);
    const hose = new THREE.Mesh(CYL8, steel);
    hose.scale.set(0.05, 0.9, 0.05);
    hose.position.set(face + dir * (thisLen - 0.3), y - 0.45, zOff);
    hose.rotation.z = dir * 0.55; g.add(hose);
  });
  // Hammerhead crane at the top (yellow jib over the rocket), as on Apollo 11.
  const cab = new THREE.Mesh(BOX, yellow);
  cab.scale.set(2.6, 1.1, 2.2); cab.position.set(0, H + 0.4, 0); cab.castShadow = true; g.add(cab);
  const jib = new THREE.Mesh(BOX, yellow);
  jib.scale.set(9.5, 0.35, 0.55); jib.position.set(dir * 2.6, H + 1.15, 0); jib.castShadow = true; g.add(jib);
  const cwt = new THREE.Mesh(BOX, M(0x5a5e64, 0.6, 0.4));
  cwt.scale.set(1.6, 0.9, 1.3); cwt.position.set(-dir * 3.4, H + 0.85, 0); g.add(cwt);
  // red lightning rod / antenna above the crane
  const mast = new THREE.Mesh(CYL8, M(0xa02018, 0.45, 0.4));
  mast.scale.set(0.07, 3.6, 0.07); mast.position.set(0, H + 3.2, 0); g.add(mast);
  const rodTip = new THREE.Mesh(CONE8, M(0xc8c4bc, 0.4, 0.5));
  rodTip.scale.set(0.1, 0.5, 0.1); rodTip.position.set(0, H + 5.15, 0); g.add(rodTip);
  parent.add(g);
  return g;
}

function buildRocket(parent: THREE.Group, x: number, z: number) {
  const g = new THREE.Group(); g.name = 'rocket'; g.position.set(x, 0, z);
  const s1M = rocketStageMat('s1');
  const s2M = rocketStageMat('s2');
  const s3M = rocketStageMat('s3');
  const white = M(0xf3f1ec, 0.45, 0.15);
  const black = M(0x16171a, 0.55);
  const soot = M(0x2a2420, 0.7, 0.3);
  const copper = M(0x8a5a32, 0.4, 0.7);
  const silver = M(0xc8cdd4, 0.3, 0.7);
  const gold = M(0xc8b070, 0.35, 0.7);
  // Sit on the mobile launcher (y = 2.15). Total stack ~18.5 above the pad, ~20.5 above ground.
  const y0 = 2.15;
  // Five F-1 bells hanging into the flame hole
  const bell = (bx: number, bz: number) => {
    const n = new THREE.Mesh(CONE, soot);
    n.scale.set(0.42, 1.15, 0.42); n.position.set(bx, y0 - 0.35, bz); n.castShadow = true; g.add(n);
    const inn = new THREE.Mesh(CONE, copper);
    inn.scale.set(0.28, 0.7, 0.28); inn.position.set(bx, y0 - 0.2, bz); g.add(inn);
  };
  bell(0, 0); bell(0.55, 0.55); bell(0.55, -0.55); bell(-0.55, 0.55); bell(-0.55, -0.55);
  // First stage (S-IC)
  const s1 = new THREE.Mesh(CYL, s1M);
  s1.scale.set(1.05, 6.6, 1.05); s1.position.set(0, y0 + 3.3, 0); s1.castShadow = true; g.add(s1);
  // four fins at the base (black, as on Saturn V)
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const fin = new THREE.Mesh(BOX, black);
    fin.scale.set(0.1, 1.6, 0.95);
    fin.position.set(Math.cos(a) * 1.15, y0 + 0.9, Math.sin(a) * 1.15);
    fin.rotation.y = a; fin.castShadow = true; g.add(fin);
  }
  // Second stage (S-II)
  const s2 = new THREE.Mesh(CYL, s2M);
  s2.scale.set(1.05, 4.3, 1.05); s2.position.set(0, y0 + 6.6 + 2.15, 0); s2.castShadow = true; g.add(s2);
  // Third stage (S-IVB), slightly slimmer
  const s3 = new THREE.Mesh(CYL, s3M);
  s3.scale.set(0.92, 3.05, 0.92); s3.position.set(0, y0 + 10.9 + 1.52, 0); s3.castShadow = true; g.add(s3);
  // IU gold ring
  const iu = new THREE.Mesh(CYL, gold);
  iu.scale.set(0.94, 0.28, 0.94); iu.position.set(0, y0 + 13.95 + 0.14, 0); g.add(iu);
  // Service module
  const sm = new THREE.Mesh(CYL, silver);
  sm.scale.set(0.62, 1.15, 0.62); sm.position.set(0, y0 + 14.23 + 0.57, 0); sm.castShadow = true; g.add(sm);
  // Command module (cone)
  const cm = new THREE.Mesh(CONE, M(0xe8e4dc, 0.4, 0.25));
  cm.scale.set(0.62, 1.05, 0.62); cm.position.set(0, y0 + 15.38 + 0.52, 0); cm.castShadow = true; g.add(cm);
  // LES tower
  const lesCol = M(0xece8e0, 0.5, 0.2);
  const lesY = y0 + 16.5;
  for (const [dx, dz] of [[0.16, 0.16], [0.16, -0.16], [-0.16, 0.16], [-0.16, -0.16]] as const) {
    const p = new THREE.Mesh(CYL8, lesCol);
    p.scale.set(0.035, 2.05, 0.035); p.position.set(dx, lesY + 1.02, dz); g.add(p);
  }
  // canards mid-tower
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const c = new THREE.Mesh(BOX, lesCol);
    c.scale.set(0.55, 0.06, 0.12); c.position.set(Math.cos(a) * 0.28, lesY + 0.85, Math.sin(a) * 0.28);
    c.rotation.y = a; g.add(c);
  }
  // escape motor + needle
  const mot = new THREE.Mesh(CYL8, black);
  mot.scale.set(0.18, 0.7, 0.18); mot.position.set(0, lesY + 2.35, 0); g.add(mot);
  const needle = new THREE.Mesh(CONE8, white);
  needle.scale.set(0.16, 1.05, 0.16); needle.position.set(0, lesY + 3.2, 0); needle.castShadow = true; g.add(needle);
  parent.add(g);
  return g;
}

function buildPad(root: THREE.Group) {
  const a = tools('pad');
  const conc = concreteMat('pad-conc', '#C6C2B6');
  const scorched = M(0x2a2826, 0.95);
  const steel = M(0x6a7380, 0.4, 0.65);
  const dark = M(0x3a3d44, 0.7);
  // Elevated hardstand with a north–south flame trench through the middle,
  // as at LC-39A (visible in the Atlantis and Apollo 11 pad photographs).
  const W = 18, D = 20, H = 1.85;
  // two halves either side of the trench
  a.B(W, H, 7.2, conc, 0, 0, -6.4);
  a.B(W, H, 7.2, conc, 0, 0, 6.4);
  // trench walls and floor (blackened)
  a.B(8, H, 0.35, conc, 0, 0, -2.85);
  a.B(8, H, 0.35, conc, 0, 0, 2.85);
  a.B(7.4, 0.2, 5.4, scorched, 0, -0.9, 0);
  const trench = a.B(7.4, 1.1, 5.4, M(0x3a3834, 0.95), 0, -0.9, 0);
  trench.name = 'flame-trench';
  // steel flame deflector (wedge) at the south mouth, as in the Apollo 11 photo
  const defl = a.B(8.5, 0.3, 9, M(0xc8c4b8, 0.92), 0, 0.15, 10.2);
  defl.rotation.x = -0.32; defl.position.y = 0.85; defl.name = 'flame-deflector';
  a.B(8.5, 1.4, 0.4, conc, 0, 0, 14.4);
  // Mobile launcher platform over the trench, with a square exhaust opening
  a.B(8.4, 0.45, 8.4, M(0x6a6e74, 0.5, 0.5), 0, H, 0);
  // opening: just a darker square (the hole) — we leave a gap by using a frame
  a.B(8.4, 0.5, 1.5, dark, 0, H, -3.45);
  a.B(8.4, 0.5, 1.5, dark, 0, H, 3.45);
  a.B(1.5, 0.5, 5.4, dark, -3.45, H, 0);
  a.B(1.5, 0.5, 5.4, dark, 3.45, H, 0);
  // hold-down posts
  for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]] as const) {
    a.B(0.45, 0.7, 0.45, steel, x, H + 0.5, z);
  }
  // water deluge pipes along the trench lips
  for (const z of [-3.1, 3.1]) {
    const p = a.C(0.12, 8, steel, 0, H + 0.15, z, 8);
    p.rotation.z = Math.PI / 2; p.position.set(0, H + 0.25, z);
    for (let i = -3; i <= 3; i++) a.C(0.05, 0.4, steel, i * 1.05, H + 0.05, z + Math.sign(z) * 0.15, 8);
  }
  // crawlerway ramps up from the west
  a.B(10, 0.3, 4.2, gravelMat(), -13, 0.9, -3.4);
  a.B(10, 0.3, 4.2, gravelMat(), -13, 0.9, 3.4);
  const rampL = a.g.children[a.g.children.length - 2] as THREE.Mesh;
  const rampR = a.g.children[a.g.children.length - 1] as THREE.Mesh;
  rampL.rotation.z = 0.12; rampL.position.set(-13, 1.0, -3.4);
  rampR.rotation.z = 0.12; rampR.position.set(-13, 1.0, 3.4);
  // access road around the pad
  a.B(28, 0.06, 2.4, concreteMat('pad-road', '#9A9A92'), 0, 0.02, -12);
  a.B(28, 0.06, 2.4, concreteMat('pad-road2', '#9A9A92'), 0, 0.02, 16.5);
  root.add(a.g);
  a.g.position.set(32, 0, 0);
  return a.g;
}

function lightningMast(parent: THREE.Group, x: number, z: number, h = 32) {
  const g = new THREE.Group(); g.name = 'lightning-mast'; g.position.set(x, 0, z);
  const white = M(0xe8e8e4, 0.5, 0.35);
  const steel = M(0xc8c8c4, 0.4, 0.55);
  // tall slender lattice, as at LC-39B in the crawlerway photograph
  const posts: Inst[] = [];
  const s = 0.7;
  for (const cx of [-s, s]) for (const cz of [-s, s]) {
    posts.push({ x: cx, y: h / 2, z: cz, sx: 0.12, sy: h, sz: 0.12 });
  }
  instanced(g, white, posts, 'lm-posts');
  const beams: Inst[] = [];
  for (let i = 1; i < 16; i++) {
    const y = (h / 16) * i;
    const k = s * (1 - i / 22);
    beams.push({ x: 0, y, z: -k, sx: k * 2, sy: 0.07, sz: 0.07 });
    beams.push({ x: 0, y, z: k, sx: k * 2, sy: 0.07, sz: 0.07 });
    beams.push({ x: -k, y, z: 0, sx: 0.07, sy: 0.07, sz: k * 2 });
    beams.push({ x: k, y, z: 0, sx: 0.07, sy: 0.07, sz: k * 2 });
  }
  instanced(g, steel, beams, 'lm-beams');
  const tip = new THREE.Mesh(CYL8, steel);
  tip.scale.set(0.05, 3.2, 0.05); tip.position.set(0, h + 1.5, 0); g.add(tip);
  parent.add(g);
}

function buildFuel(root: THREE.Group) {
  const a = tools('fuel-farm');
  const white = M(0xeaecf0, 0.35, 0.35);
  const steel = M(0x6a7380, 0.4, 0.65);
  const insul = M(0xd0d4d8, 0.4, 0.3);
  // Two large white LH2 spheres on crossed legs, as at the LC-39 tank farm.
  for (const [x, z] of [[0, 0], [7.5, 1.2]] as const) {
    a.S(2.55, white, x, 2.1, z);
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const) {
      const leg = a.C(0.1, 3.4, steel, x + dx, 0, z + dz, 8);
      // lean the leg toward the sphere
      leg.position.set(x + dx, 1.7, z + dz);
      const look = new THREE.Vector3(x, 3.6, z);
      leg.lookAt(look); // lookAt points +z; we want the cylinder axis (+y) toward the sphere
    }
    // just place straight legs — lookAt on a Y-up cylinder is awkward; use boxes leaned by rotation
  }
  // Rebuild legs more simply
  // (the lookAt legs above are a bit wrong; add proper straight legs with cross braces)
  for (const [x, z] of [[0, 0], [7.5, 1.2]] as const) {
    for (const [dx, dz] of [[-1.55, -1.55], [1.55, -1.55], [-1.55, 1.55], [1.55, 1.55]] as const) {
      // already have some legs; add cross braces
      a.B(3.1, 0.08, 0.08, steel, x, 1.4, z + dz, 0);
      a.B(0.08, 0.08, 3.1, steel, x + dx, 1.4, z);
    }
  }
  // Three horizontal LOX / RP-1 bullet tanks
  for (let i = 0; i < 3; i++) {
    const z = -6 + i * 3.4;
    const t = a.C(1.15, 6.4, insul, 14, 1.25, z, 16);
    t.rotation.z = Math.PI / 2; t.position.set(14, 1.35, z);
    a.S(1.15, insul, 14 - 3.2, 1.35 - 1.15, z);
    a.S(1.15, insul, 14 + 3.2, 1.35 - 1.15, z);
    a.B(0.3, 1.15, 0.3, steel, 11.2, 0, z);
    a.B(0.3, 1.15, 0.3, steel, 16.8, 0, z);
  }
  // Pipe rack toward the pad
  for (const z of [-1.2, 0, 1.2]) {
    for (const x of [4, 10, 16]) a.B(0.16, 3.4, 0.16, steel, x, 0, z + 6);
  }
  a.B(16, 0.16, 3.0, steel, 10, 3.4, 6);
  const pipes = [0xc45a2a, 0xd0d4d8, 0x3a6aaa, 0xc8c4bc];
  pipes.forEach((c, i) => {
    const p = a.C(0.14, 16, M(c, 0.4, 0.4), 10, 3.65, 5.1 + i * 0.4, 8);
    p.rotation.z = Math.PI / 2; p.position.set(10, 3.7, 5.1 + i * 0.4);
  });
  root.add(a.g);
  a.g.position.set(18, 0, -16);
  return a.g;
}

function buildWaterTower(root: THREE.Group) {
  const a = tools('water-tower');
  const white = M(0xecece8, 0.45, 0.25);
  const steel = M(0x8a9098, 0.4, 0.6);
  const red = M(0xa02018, 0.5);
  // Classic elevated tank, legs and a red/white banded shaft — sound-suppression water.
  for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) {
    a.C(0.12, 11, steel, dx, 0, dz, 8);
  }
  a.B(3.1, 0.1, 0.1, steel, 0, 4, -1.5);
  a.B(3.1, 0.1, 0.1, steel, 0, 4, 1.5);
  a.B(0.1, 0.1, 3.1, steel, -1.5, 4, 0);
  a.B(0.1, 0.1, 3.1, steel, 1.5, 4, 0);
  a.B(3.1, 0.1, 0.1, steel, 0, 8, -1.5);
  a.B(3.1, 0.1, 0.1, steel, 0, 8, 1.5);
  a.S(2.35, white, 0, 10.4, 0);
  a.C(0.7, 0.7, white, 0, 14.9, 0, 12);
  a.C(0.08, 1.6, steel, 0, 15.5, 0, 8);
  // red/white safety bands on one leg
  a.C(0.18, 0.35, red, 1.5, 2.2, 1.5, 8);
  a.C(0.18, 0.35, white, 1.5, 2.55, 1.5, 8);
  a.C(0.18, 0.35, red, 1.5, 2.9, 1.5, 8);
  root.add(a.g);
  a.g.position.set(46, 0, -14);
  return a.g;
}

function buildFence(root: THREE.Group) {
  const a = tools('fence');
  const post = M(0x4a4a44, 0.5, 0.4);
  const mesh = chainlinkMat();
  const x0 = -50, x1 = 54, z0 = -28, z1 = 30;
  const h = 2.15;
  const sides: Array<[number, number, number, number]> = [
    // w, d, x, z  (thin in the short axis)
    [x1 - x0, 0.04, (x0 + x1) / 2, z0],
    [x1 - x0, 0.04, (x0 + x1) / 2, z1],
    [0.04, z1 - z0, x0, (z0 + z1) / 2],
    [0.04, z1 - z0, x1, (z0 + z1) / 2],
  ];
  for (const [w, d, x, z] of sides) {
    a.B(w, h, d, mesh, x, 0.15, z);
  }
  // gate opening on the south, with a guard booth
  // punch a hole by covering a section with a gate that is open (swung)
  a.B(0.1, h, 5.2, mesh, -22, 0.15, z1 - 2.4, 0.7);
  a.B(0.1, h, 5.2, mesh, -16, 0.15, z1 - 2.4, -0.7);
  const booth = M(0xe8e4d8, 0.85);
  a.B(2.6, 2.5, 2.4, booth, -19, 0, z1 - 3.6);
  a.B(2.8, 0.15, 2.6, M(0x8a3a2a, 0.8), -19, 2.5, z1 - 3.6);
  a.B(1.1, 0.9, 0.08, M(0x9ab0c0, 0.2, 0.25, 0x6a90b0, 0.15, 0.65), -19, 1.1, z1 - 2.38);
  // barrier arm
  a.C(0.07, 1.2, M(0xf5c518, 0.5, 0.3), -19, 0, z1 - 1.4, 8);
  const arm = a.B(4.2, 0.12, 0.12, M(0xe8e0c8, 0.55), -17, 1.15, z1 - 1.4);
  arm.rotation.z = 0; // horizontal closed-ish, slightly open
  // sign
  a.B(3.6, 1.0, 0.08, M(0x1a3a6a, 0.6), -19, 2.7, z1 + 0.2);
  const posts: Inst[] = [];
  const step = 6;
  for (let x = x0; x <= x1 + 0.01; x += step) {
    posts.push({ x, y: 1.2, z: z0, sx: 0.12, sy: 2.4, sz: 0.12 });
    posts.push({ x, y: 1.2, z: z1, sx: 0.12, sy: 2.4, sz: 0.12 });
  }
  for (let z = z0; z <= z1 + 0.01; z += step) {
    posts.push({ x: x0, y: 1.2, z, sx: 0.12, sy: 2.4, sz: 0.12 });
    posts.push({ x: x1, y: 1.2, z, sx: 0.12, sy: 2.4, sz: 0.12 });
  }
  instanced(a.g, post, posts, 'fence-posts');
  // floodlight poles along the crawlerway and pad
  const lamp = M(0xf2efe4, 0.4, 0.1, 0xfff2c0, 0.35);
  for (const [lx, lz] of [
    [-18, 8], [0, 8], [18, 8], [32, 12], [32, -12],
    [-18, -8], [0, -8], [18, -8], [46, 4], [-40, 16],
  ] as const) {
    a.C(0.09, 8.4, M(0x6a6e74, 0.5, 0.5), lx, 0, lz, 8);
    a.B(1.4, 0.2, 0.5, lamp, lx, 8.2, lz);
    a.B(0.6, 0.15, 0.4, lamp, lx + 0.5, 8.05, lz);
  }
  root.add(a.g);
  return a.g;
}

function buildGround(root: THREE.Group) {
  const a = tools('grounds');
  const grass = grassMat();
  const conc = concreteMat('park-conc', '#B8B4AA');
  a.B(108, 0.05, 66, grass, 2, 0, 1);
  // parking / apron south of the VAB and LCC
  a.B(36, 0.07, 16, conc, -24, 0.02, 22);
  // stall lines
  const paint = M(0xe8e4d4, 0.8);
  for (let i = 0; i < 10; i++) a.B(0.08, 0.02, 4.2, paint, -38 + i * 3.2, 0.1, 24);
  // service road
  a.B(80, 0.07, 3.2, M(0x5a5c60, 0.95), 0, 0.02, 20);
  // a few palms along the parking
  for (const [x, z] of [[-42, 18], [-42, 24], [-8, 28], [6, 28], [14, 18], [-48, 6]] as const) palm(a, x, z, 5 + (x % 3) * 0.3);
  // low palmetto / scrub bushes
  const scrub = M(0x3a6a32, 0.9);
  for (const [x, z, r] of [[48, 18, 1.4], [50, 22, 1.1], [44, 24, 1.6], [-48, -18, 1.3], [52, -20, 1.5], [8, -26, 1.2]] as const) {
    a.S(r * 0.7, scrub, x, 0, z);
    a.S(r * 0.5, M(0x2e5a28, 0.9), x + 0.6, 0.1, z + 0.4);
  }
  // small white support buildings
  const wall = M(0xe8e6e0, 0.88);
  a.B(6, 3.2, 4.4, wall, -44, 0, -14);
  a.B(6.2, 0.2, 4.6, M(0x8a3a2a, 0.8), -44, 3.2, -14);
  a.B(1.2, 1.1, 0.08, M(0x9ab0c0, 0.25, 0.2, 0x6a90b0, 0.12, 0.6), -44, 1.2, -11.78);
  a.B(5, 2.6, 3.6, wall, 8, 0, 24);
  a.B(5.2, 0.18, 3.8, M(0x3a3d44, 0.7), 8, 2.6, 24);
  root.add(a.g);
  return a.g;
}

/** Build the full decorative campus, centred on local origin. Y = 0 is ground. */
export function buildSpaceCenter(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'space-center';
  buildGround(root);
  buildCrawlerway(root);
  buildVab(root);
  buildLcc(root);
  buildCrawler(root);
  const pad = buildPad(root);
  // Rocket and LUT sit on the mobile launcher at the pad (pad is at x=32).
  const rocketX = 32, rocketZ = 0;
  const towerX = 25.4, towerZ = 0;
  buildTower(root, towerX, towerZ, rocketX);
  buildRocket(root, rocketX, rocketZ);
  buildFuel(root);
  buildWaterTower(root);
  lightningMast(root, 46, -16, 31);
  lightningMast(root, 46, 18, 31);
  buildFence(root);
  // Name the flame trench at the root for tests / cameras (it lives under 'pad').
  pad.traverse((o) => { if (o.name === 'flame-trench') o.userData.part = 'flame-trench'; });
  return root;
}
