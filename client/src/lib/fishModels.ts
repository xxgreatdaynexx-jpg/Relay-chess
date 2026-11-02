/**
 * Fish models for the 3D fishing game (pt1257u): every species gets its own spline body profile (side + top view), a
 * species-accurate procedural skin (bars, spots, saddles, koi patches, scales, gill plate), real fin outlines with rays,
 * eyes, mouths and barbels, and a swim motion (the body bends in a travelling wave, the tail and fins follow).
 * Pure view code: nothing here touches catch rolls, prices or XP. 'low' tier gets fewer segments and cheaper materials.
 */
import * as THREE from 'three';

export type FishTier = 'low' | 'mid' | 'high';
type Tail = 'fork' | 'deep' | 'square' | 'round' | 'shark' | 'flow';
type Fin = { z0: number; z1: number; h: number; sweep?: number; spiny?: boolean };
interface Spec {
  len: number; h: number[]; w: number[]; y?: number[]; tail: Tail; tailH: number;
  dorsal: Fin[]; anal: Fin; pect: number; pelv: number; eye: { t: number; y: number; r: number; iris: string };
  back: string; side: string; belly: string; fin: string; finTip?: string; mouth?: 'big' | 'duck' | 'small' | 'under'; barbels?: number;
  swim: number; paint: (p: Painter) => void; glow?: number; metal?: number;
}

// Profiles are sampled at 11 stations from the tail peduncle (t=0) to the snout (t=1), as fractions of body length.
const S: Record<string, Spec> = {
  bluegill: { len: 0.9, h: [.06, .08, .15, .25, .31, .33, .32, .28, .22, .14, .02], w: [.02, .03, .05, .07, .08, .085, .085, .08, .07, .05, .01], tail: 'fork', tailH: .32,
    dorsal: [{ z0: .25, z1: .62, h: .2, spiny: true }, { z0: .14, z1: .3, h: .17 }], anal: { z0: .14, z1: .38, h: .14 }, pect: .17, pelv: .12, eye: { t: .86, y: .07, r: .045, iris: '#c9a23a' },
    back: '#2d4a52', side: '#5d7e7c', belly: '#f2b23e', fin: '#5a6e66', mouth: 'small', swim: 1.1,
    paint: (p) => { p.base(); p.bars(7, .2, .78, 'rgba(25,35,45,.35)', .05); p.flush(.45, .8, .55, '#d97a2a', .5); p.gill(.74); p.earFlap(.74, '#10161c'); p.scales(.12); } },
  perch: { len: 1, h: [.05, .07, .11, .16, .2, .21, .2, .18, .14, .09, .02], w: [.02, .03, .05, .07, .08, .085, .085, .08, .07, .05, .01], tail: 'fork', tailH: .28,
    dorsal: [{ z0: .45, z1: .75, h: .17, spiny: true }, { z0: .2, z1: .4, h: .13 }], anal: { z0: .18, z1: .32, h: .11 }, pect: .14, pelv: .12, eye: { t: .87, y: .05, r: .04, iris: '#e3c04a' },
    back: '#4c5a1c', side: '#c9bd3c', belly: '#f6efc8', fin: '#b9a04a', finTip: '#e8742a', mouth: 'small', swim: 1.2,
    paint: (p) => { p.base(); p.bars(7, .12, .8, 'rgba(30,40,12,.75)', .055, .62); p.gill(.76); p.scales(.12); } },
  sunfish: { len: .8, h: [.06, .09, .17, .27, .33, .35, .34, .3, .23, .15, .02], w: [.02, .03, .05, .07, .085, .09, .09, .085, .075, .05, .01], tail: 'fork', tailH: .33,
    dorsal: [{ z0: .27, z1: .62, h: .19, spiny: true }, { z0: .15, z1: .3, h: .17 }], anal: { z0: .15, z1: .38, h: .14 }, pect: .17, pelv: .12, eye: { t: .86, y: .07, r: .045, iris: '#c23a2a' },
    back: '#3c6a5a', side: '#7aa07a', belly: '#ff9a2c', fin: '#6e8a6a', mouth: 'small', swim: 1.1,
    paint: (p) => { p.base(); p.spots(70, 0, .8, .15, .7, '#ff9a3c', .012, .02); p.spots(30, 0, .7, .1, .6, '#3cb4c8', .008, .014); p.squiggles(.75, 1, '#33c2e0'); p.gill(.74); p.earFlap(.74, '#10161c', '#ff3a2a'); p.scales(.1); } },
  bass: { len: 1.2, h: [.06, .07, .1, .14, .17, .19, .19, .18, .15, .11, .04], w: [.025, .03, .05, .07, .085, .09, .09, .09, .08, .065, .03], y: [0, 0, 0, 0, 0, 0, 0, 0, -.005, -.01, -.015], tail: 'square', tailH: .25,
    dorsal: [{ z0: .45, z1: .72, h: .14, spiny: true }, { z0: .2, z1: .43, h: .14 }], anal: { z0: .18, z1: .33, h: .11 }, pect: .14, pelv: .12, eye: { t: .86, y: .04, r: .036, iris: '#c9a03a' },
    back: '#2c3e1c', side: '#6d8a3a', belly: '#e9ecc8', fin: '#55683a', mouth: 'big', swim: 1,
    paint: (p) => { p.base(); p.stripe(.52, .07, 'rgba(22,32,14,.85)', true); p.mottle(40, .05, .45, 'rgba(25,40,15,.35)'); p.gill(.74); p.scales(.12); } },
  trout: { len: 1.15, h: [.05, .06, .08, .11, .13, .14, .14, .13, .11, .08, .02], w: [.02, .03, .045, .06, .07, .075, .075, .07, .065, .05, .015], tail: 'square', tailH: .22,
    dorsal: [{ z0: .48, z1: .65, h: .1 }, { z0: .15, z1: .2, h: .045 }], anal: { z0: .18, z1: .3, h: .08 }, pect: .11, pelv: .09, eye: { t: .87, y: .035, r: .03, iris: '#d8c8a0' },
    back: '#4a5a3a', side: '#c6ccc8', belly: '#f4f2ee', fin: '#7c8670', mouth: 'small', swim: 1.2,
    paint: (p) => { p.base(); p.stripe(.5, .12, 'rgba(232,90,130,.75)'); p.spots(160, 0, .98, .02, .58, '#1a1a1a', .006, .012); p.gill(.78, 'rgba(232,90,130,.6)'); p.scales(.06); }, metal: .3 },
  catfish: { len: 1.4, h: [.04, .05, .07, .1, .12, .13, .13, .12, .1, .07, .03], w: [.02, .03, .05, .07, .085, .095, .1, .105, .1, .085, .045], y: [0, 0, 0, 0, 0, 0, 0, 0, -.005, -.01, -.015], tail: 'deep', tailH: .22,
    dorsal: [{ z0: .6, z1: .72, h: .13, spiny: true }, { z0: .2, z1: .26, h: .05 }], anal: { z0: .1, z1: .38, h: .07 }, pect: .12, pelv: .09, eye: { t: .9, y: .04, r: .022, iris: '#8a8a70' },
    back: '#3a4450', side: '#7b8796', belly: '#e8e4da', fin: '#4e5864', mouth: 'small', barbels: 8, swim: .8,
    paint: (p) => { p.base(); p.spots(26, .05, .85, .25, .55, '#1c2228', .007, .012); }, metal: .1 },
  walleye: { len: 1.25, h: [.05, .06, .08, .11, .13, .14, .14, .13, .11, .08, .03], w: [.02, .03, .045, .06, .07, .075, .075, .07, .065, .05, .02], tail: 'fork', tailH: .25,
    dorsal: [{ z0: .45, z1: .72, h: .13, spiny: true }, { z0: .18, z1: .4, h: .11 }], anal: { z0: .17, z1: .3, h: .09 }, pect: .12, pelv: .1, eye: { t: .87, y: .045, r: .042, iris: '#e8f0c8' },
    back: '#4a3e18', side: '#c4a245', belly: '#f2ecd6', fin: '#9c8a4a', mouth: 'big', swim: 1,
    paint: (p) => { p.base(); p.saddles(6, .12, .82, 'rgba(40,30,8,.6)'); p.mottle(60, .05, .55, 'rgba(70,55,15,.3)'); p.gill(.76); p.scales(.12); }, metal: .2 },
  pike: { len: 1.7, h: [.04, .05, .065, .08, .09, .095, .095, .09, .075, .05, .02], w: [.02, .03, .04, .05, .06, .065, .065, .06, .055, .045, .02], y: [0, 0, 0, 0, 0, 0, 0, 0, 0, -.005, -.012], tail: 'fork', tailH: .2,
    dorsal: [{ z0: .1, z1: .26, h: .11 }], anal: { z0: .09, z1: .24, h: .09 }, pect: .09, pelv: .08, eye: { t: .84, y: .03, r: .024, iris: '#e0c040' },
    back: '#22381c', side: '#4e7a3a', belly: '#f0f2d8', fin: '#5a6e34', finTip: '#b0541c', mouth: 'duck', swim: .9,
    paint: (p) => { p.base(); p.beans(110, .05, .85, .2, .7, 'rgba(225,235,165,.85)'); p.gill(.82); }, metal: .1 },
  salmon: { len: 1.5, h: [.05, .06, .085, .11, .13, .14, .14, .13, .11, .08, .02], w: [.02, .03, .045, .06, .07, .075, .075, .07, .065, .05, .015], tail: 'fork', tailH: .24,
    dorsal: [{ z0: .48, z1: .64, h: .1 }, { z0: .15, z1: .2, h: .045 }], anal: { z0: .18, z1: .3, h: .08 }, pect: .11, pelv: .09, eye: { t: .87, y: .035, r: .028, iris: '#d8dce0' },
    back: '#2c4a5a', side: '#c8d2da', belly: '#f6f6f6', fin: '#6a7a86', mouth: 'small', swim: 1.1,
    paint: (p) => { p.base(); p.spots(90, 0, .9, .02, .35, '#141a20', .006, .011); p.gill(.78); p.scales(.08); }, metal: .5 },
  sturgeon: { len: 2.2, h: [.035, .04, .05, .065, .075, .08, .08, .075, .065, .045, .01], w: [.02, .03, .045, .06, .07, .075, .075, .07, .06, .04, .01], y: [.01, .008, .005, 0, 0, 0, 0, 0, -.005, -.01, -.008], tail: 'shark', tailH: .15,
    dorsal: [{ z0: .1, z1: .2, h: .08 }], anal: { z0: .1, z1: .18, h: .06 }, pect: .1, pelv: .07, eye: { t: .82, y: .03, r: .016, iris: '#b0a890' },
    back: '#4a4f56', side: '#7a7f86', belly: '#dcd6c8', fin: '#5a5f66', mouth: 'under', barbels: 4, swim: .7,
    paint: (p) => { p.base(); p.scutes(); } },
  goldcarp: { len: 1.3, h: [.06, .07, .1, .15, .19, .21, .21, .19, .15, .1, .03], w: [.025, .035, .055, .075, .09, .095, .095, .09, .08, .06, .02], tail: 'fork', tailH: .3,
    dorsal: [{ z0: .22, z1: .68, h: .11 }], anal: { z0: .15, z1: .28, h: .1 }, pect: .14, pelv: .12, eye: { t: .87, y: .04, r: .034, iris: '#ffd860' },
    back: '#a85e00', side: '#ffb21e', belly: '#ffe9a0', fin: '#ff9a14', mouth: 'small', barbels: 2, swim: .9,
    paint: (p) => { p.base(); p.bigScales('rgba(120,60,0,.45)', 'rgba(255,250,200,.35)'); p.gill(.78); }, glow: 0x553300, metal: .6 },
  koi: { len: 1.4, h: [.06, .07, .1, .14, .17, .18, .18, .17, .14, .1, .03], w: [.025, .035, .055, .075, .09, .095, .095, .09, .08, .06, .02], tail: 'flow', tailH: .36,
    dorsal: [{ z0: .22, z1: .66, h: .12 }], anal: { z0: .15, z1: .28, h: .11 }, pect: .22, pelv: .14, eye: { t: .87, y: .04, r: .03, iris: '#202830' },
    back: '#ffffff', side: '#fbfbff', belly: '#f4f6ff', fin: '#f4f8ff', finTip: '#ff6a2a', mouth: 'small', barbels: 2, swim: .8,
    paint: (p) => { p.base(); p.koi(); p.bigScales('rgba(150,180,220,.22)', 'rgba(255,255,255,.4)'); }, glow: 0x2a5a80, metal: .35 },
};

const W = 256, H = 128;
/** Canvas painter for the skin: x = position along the body (tail left → snout right), y = top of back → bottom of belly. */
class Painter {
  g: CanvasRenderingContext2D; private sd = 7; constructor(public c: HTMLCanvasElement, public s: Spec) { this.g = c.getContext('2d')!; }
  r() { this.sd = (this.sd * 16807) % 2147483647; return this.sd / 2147483647; }
  base() { const gr = this.g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, this.s.back); gr.addColorStop(.38, this.s.side); gr.addColorStop(.62, this.s.side); gr.addColorStop(.82, this.s.belly); gr.addColorStop(1, this.s.belly); this.g.fillStyle = gr; this.g.fillRect(0, 0, W, H); }
  bars(n: number, a: number, b: number, col: string, wid: number, depth = .7) { for (let i = 0; i < n; i++) { const x = (a + (b - a) * (i + .5) / n) * W; const gr = this.g.createLinearGradient(0, 0, 0, H * depth); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); this.g.fillStyle = gr; this.g.beginPath(); this.g.ellipse(x, 0, wid * W * .5, H * depth, 0, 0, 7); this.g.fill(); } }
  flush(x0: number, x1: number, y: number, col: string, a: number) { this.g.globalAlpha = a; const gr = this.g.createRadialGradient((x0 + x1) / 2 * W, y * H + 20, 4, (x0 + x1) / 2 * W, y * H + 20, (x1 - x0) * W * .6); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); this.g.fillStyle = gr; this.g.fillRect(0, 0, W, H); this.g.globalAlpha = 1; }
  spots(n: number, x0: number, x1: number, y0: number, y1: number, col: string, r0: number, r1: number) { this.g.fillStyle = col; for (let i = 0; i < n; i++) { this.g.globalAlpha = .6 + this.r() * .4; this.g.beginPath(); this.g.arc((x0 + this.r() * (x1 - x0)) * W, (y0 + this.r() * (y1 - y0)) * H, (r0 + this.r() * (r1 - r0)) * W, 0, 7); this.g.fill(); } this.g.globalAlpha = 1; }
  beans(n: number, x0: number, x1: number, y0: number, y1: number, col: string) { this.g.fillStyle = col; for (let i = 0; i < n; i++) { this.g.beginPath(); this.g.ellipse((x0 + this.r() * (x1 - x0)) * W, (y0 + this.r() * (y1 - y0)) * H, 3.5 + this.r() * 2, 1.6 + this.r(), 0, 0, 7); this.g.fill(); } }
  mottle(n: number, y0: number, y1: number, col: string) { this.g.fillStyle = col; for (let i = 0; i < n; i++) { this.g.beginPath(); this.g.ellipse(this.r() * W, (y0 + this.r() * (y1 - y0)) * H, 4 + this.r() * 9, 3 + this.r() * 5, this.r() * 3, 0, 7); this.g.fill(); } }
  stripe(y: number, h: number, col: string, blotchy = false) { this.g.fillStyle = col; if (!blotchy) { const gr = this.g.createLinearGradient(0, (y - h) * H, 0, (y + h) * H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.5, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); this.g.fillStyle = gr; this.g.fillRect(0, (y - h) * H, W * .97, 2 * h * H); return; }
    for (let x = 4; x < W * .82; x += 7) { this.g.beginPath(); this.g.ellipse(x, y * H + (this.r() - .5) * 6, 6 + this.r() * 5, h * H * (.6 + this.r() * .5), 0, 0, 7); this.g.fill(); } }
  saddles(n: number, a: number, b: number, col: string) { this.g.fillStyle = col; for (let i = 0; i < n; i++) { const x = (a + (b - a) * (i + .5) / n) * W; this.g.beginPath(); this.g.ellipse(x, 6, 9, 30, 0, 0, 7); this.g.fill(); } }
  gill(t: number, col = 'rgba(20,20,20,.35)') { this.g.strokeStyle = col; this.g.lineWidth = 2; this.g.beginPath(); this.g.moveTo(t * W, H * .2); this.g.quadraticCurveTo(t * W - 12, H * .5, t * W, H * .82); this.g.stroke(); }
  earFlap(t: number, col: string, tip?: string) { this.g.fillStyle = col; this.g.beginPath(); this.g.ellipse(t * W - 6, H * .4, 9, 6, 0, 0, 7); this.g.fill(); if (tip) { this.g.fillStyle = tip; this.g.beginPath(); this.g.arc(t * W - 13, H * .4, 3.5, 0, 7); this.g.fill(); } }
  squiggles(x0: number, x1: number, col: string) { this.g.strokeStyle = col; this.g.lineWidth = 1.6; for (let i = 0; i < 5; i++) { this.g.beginPath(); const y = H * (.35 + i * .09); this.g.moveTo(x0 * W, y); for (let x = x0 * W; x < x1 * W; x += 4) this.g.lineTo(x, y + Math.sin(x * .4 + i) * 2); this.g.stroke(); } }
  scales(a: number) { this.g.strokeStyle = `rgba(0,0,0,${a})`; this.g.lineWidth = 1; for (let y = 0; y < H; y += 5) for (let x = (y / 5) % 2 ? 0 : 3; x < W * .78; x += 6) { this.g.beginPath(); this.g.arc(x, y, 3.2, -1.2, 1.2); this.g.stroke(); } }
  bigScales(dark: string, lite: string) { for (let y = -4; y < H; y += 10) for (let x = (y / 10) % 2 ? 0 : 6; x < W * .78; x += 12) { this.g.strokeStyle = dark; this.g.lineWidth = 1.4; this.g.beginPath(); this.g.arc(x, y, 7, -1.3, 1.3); this.g.stroke(); this.g.strokeStyle = lite; this.g.lineWidth = 1; this.g.beginPath(); this.g.arc(x - 2, y, 5, -1, 1); this.g.stroke(); } }
  scutes() { this.g.fillStyle = 'rgba(225,215,190,.9)'; for (const y of [.03, .45, .78]) for (let x = 10; x < W * .82; x += 14) { this.g.beginPath(); this.g.moveTo(x - 5, y * H); this.g.lineTo(x, y * H - 4); this.g.lineTo(x + 5, y * H); this.g.lineTo(x, y * H + 4); this.g.fill(); } }
  koi() { // kohaku: big red-orange patches on the back, clean white belly, a red crown on the head
    const blobs: Array<[number, number, number, number]> = [[.16, .12, 30, 40], [.4, .08, 38, 46], [.62, .14, 28, 38], [.9, .1, 22, 30]];
    this.g.fillStyle = '#ff4a1c'; for (const [x, y, rx, ry] of blobs) { this.g.beginPath(); for (let k = 0; k <= 20; k++) { const a = k / 20 * Math.PI * 2; const rr = 1 + Math.sin(a * 3 + x * 9) * .18; this.g.lineTo(x * W + Math.cos(a) * rx * rr, y * H + Math.sin(a) * ry * rr); } this.g.fill(); }
    this.g.fillStyle = 'rgba(255,140,60,.5)'; this.g.beginPath(); this.g.ellipse(.3 * W, .35 * H, 14, 8, 0, 0, 7); this.g.fill(); }
}
function skinTex(s: Spec, low: boolean): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = W; c.height = H; s.paint(new Painter(c, s));
  if (low) { const d = document.createElement('canvas'); d.width = 128; d.height = 64; d.getContext('2d')!.drawImage(c, 0, 0, 128, 64); return tex(d); } return tex(c);
}
function tex(c: HTMLCanvasElement) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
/** Fin membrane: fine rays and a translucent edge, coloured by the material. */
let finTexCache: THREE.Texture | null | undefined;
function finTex(): THREE.Texture | null {
  if (finTexCache !== undefined) return finTexCache; if (typeof document === 'undefined') return (finTexCache = null);
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!; const gr = g.createLinearGradient(0, 64, 0, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(.75, '#ddd'); gr.addColorStop(1, '#777'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1.2; for (let x = 2; x < 64; x += 4.5) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 2, 0); g.stroke(); }
  return (finTexCache = tex(c));
}

const smooth = (a: number[], t: number) => { const n = a.length - 1, f = Math.min(n - 1e-6, Math.max(0, t * n)), i = Math.floor(f), u = f - i; const p0 = a[Math.max(0, i - 1)]!, p1 = a[i]!, p2 = a[i + 1]!, p3 = a[Math.min(n, i + 2)]!;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u); };

/** Body: elliptical rings swept along z from tail (-L/2) to snout (+L/2); the belly is fuller than the back. */
function bodyGeo(s: Spec, segL: number, segR: number) {
  const L = s.len, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segL; i++) { const t = i / segL, tt = 1 - Math.pow(1 - t, 1.0); const h = Math.max(.004, smooth(s.h, tt)) * L, w = Math.max(.003, smooth(s.w, tt)) * L, yo = (s.y ? smooth(s.y, tt) : 0) * L; const z = (t - .5) * L;
    for (let j = 0; j <= segR; j++) { const a = j / segR * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); const hy = ca > 0 ? h : h * 1.08;
      pos.push(sa * w * (1 - .12 * ca * ca * 0), yo + ca * hy, z); const v = a <= Math.PI ? a / Math.PI : (2 * Math.PI - a) / Math.PI; uv.push(t, 1 - v); } }
  for (let i = 0; i < segL; i++) for (let j = 0; j < segR; j++) { const a = i * (segR + 1) + j, b = a + segR + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const n = g.getAttribute('normal') as THREE.BufferAttribute; for (let i = 0; i <= segL; i++) { const a = i * (segR + 1), b = a + segR; const x = (n.getX(a) + n.getX(b)) / 2, y = (n.getY(a) + n.getY(b)) / 2, z = (n.getZ(a) + n.getZ(b)) / 2; n.setXYZ(a, x, y, z); n.setXYZ(b, x, y, z); }
  return g;
}
/** Swim wave: lateral offset of the spine at normalised position zn (-.5 tail … .5 head). */
const bend = (zn: number, t: number, sp: number) => Math.sin(t * 6 * sp - zn * 7) * 0.09 * Math.pow(0.5 - zn, 2);
function swimShader(m: THREE.Material, u: { uT: { value: number }; uL: { value: number }; uS: { value: number } }) {
  m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, u); sh.vertexShader = 'uniform float uT; uniform float uL; uniform float uS;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float zn = position.z / uL; float k = (0.5 - zn) * (0.5 - zn); transformed.x += sin(uT * 6.0 * uS - zn * 7.0) * 0.09 * k * uL;`); };
}

function finShape(pts: Array<[number, number]>): THREE.ShapeGeometry { const sh = new THREE.Shape(); sh.moveTo(pts[0]![0], pts[0]![1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i]![0], pts[i]![1]); const g = new THREE.ShapeGeometry(sh, 4);
  g.computeBoundingBox(); const bb = g.boundingBox!, p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / Math.max(1e-4, bb.max.x - bb.min.x), (Math.abs(p.getY(i)) - 0) / Math.max(1e-4, Math.max(Math.abs(bb.max.y), Math.abs(bb.min.y)))); return g; }
const curve = (x0: number, x1: number, h: number, sweep: number, spiny: boolean, n = 9): Array<[number, number]> => { const out: Array<[number, number]> = [[x1, 0]];
  for (let i = 0; i <= n; i++) { const u = i / n; const x = x1 + (x0 - x1) * u - sweep * Math.sin(u * Math.PI) * (x1 - x0) * .3; let y = h * Math.sin(Math.pow(u, .6) * Math.PI) * (1 - u * .35); if (spiny && i % 2) y *= .82; out.push([x, Math.max(0, y)]); } out.push([x0, 0]); return out; };
function tailPts(k: Tail, h: number): Array<[number, number]> { // drawn pointing -x from the peduncle at 0
  const q = (a: number[][]) => a.map(([x, y]) => [x! * h, y! * h] as [number, number]);
  switch (k) { case 'square': return q([[0, .12], [-.55, .95], [-.85, .95], [-.8, 0], [-.85, -.95], [-.55, -.95], [0, -.12]]);
    case 'round': return q([[0, .15], [-.5, .8], [-.8, .6], [-.9, 0], [-.8, -.6], [-.5, -.8], [0, -.15]]);
    case 'deep': return q([[0, .12], [-.6, 1], [-.95, 1.05], [-.5, 0], [-.95, -1.05], [-.6, -1], [0, -.12]]);
    case 'shark': return q([[0, .15], [-.45, .55], [-1.3, 1.25], [-1.15, .9], [-.75, .2], [-.6, -.25], [-.7, -.55], [-.35, -.45], [0, -.12]]);
    case 'flow': return q([[0, .15], [-.4, .7], [-1, 1.1], [-1.25, 1.05], [-.95, .35], [-.8, 0], [-.95, -.35], [-1.25, -1.05], [-1, -1.1], [-.4, -.7], [0, -.15]]);
    default: return q([[0, .12], [-.5, .85], [-.95, 1.05], [-.85, .7], [-.55, 0], [-.85, -.7], [-.95, -1.05], [-.5, -.85], [0, -.12]]); }
}

/** A finished fish model, head toward +z, centred; userData.swim drives animateFish. */
export function buildFishModel(id: string, tier: FishTier = 'mid'): THREE.Group | null {
  const s = S[id]; if (!s) return null; const low = tier === 'low', L = s.len;
  const g = new THREE.Group(); const u = { uT: { value: 0 }, uL: { value: L }, uS: { value: s.swim } };
  const map = skinTex(s, low); const glow = s.glow ?? 0;
  const mat: THREE.MeshStandardMaterial = low ? new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : s.side, roughness: .45, metalness: s.metal ?? .1, emissive: glow, emissiveIntensity: glow ? .4 : 0 })
    : new THREE.MeshPhysicalMaterial({ map, color: map ? 0xffffff : s.side, roughness: .35, metalness: s.metal ?? .12, clearcoat: 1, clearcoatRoughness: .18, sheen: .5, sheenColor: new THREE.Color(id === 'koi' ? 0xbfe8ff : 0xcfe0e8), emissive: glow, emissiveIntensity: glow ? .4 : 0, iridescence: id === 'koi' || id === 'trout' || id === 'salmon' ? .6 : 0 });
  swimShader(mat, u); const body = new THREE.Mesh(bodyGeo(s, low ? 22 : 40, low ? 12 : 24), mat); g.add(body);
  const fm = (tip?: string) => new THREE.MeshStandardMaterial({ map: finTex(), color: tip ?? s.fin, roughness: .5, transparent: true, opacity: id === 'koi' ? .7 : .85, side: THREE.DoubleSide, depthWrite: false, emissive: glow, emissiveIntensity: glow ? .6 : 0 });
  const finM = fm(), tipM = s.finTip ? fm(s.finTip) : finM;
  const H0 = (t: number) => smooth(s.h, t) * L, W0 = (t: number) => smooth(s.w, t) * L, Y0 = (t: number) => (s.y ? smooth(s.y, t) : 0) * L, Z = (t: number) => (t - .5) * L;
  const parts: THREE.Object3D[] = []; const attach = (o: THREE.Object3D, t: number) => { o.userData.zn = t - .5; o.userData.x0 = o.position.x; parts.push(o); g.add(o); };
  // tail fin (in the body's mid plane, pivoting at the peduncle)
  const tg = finShape(tailPts(s.tail, s.tailH * L * (s.tail === 'shark' ? 0.55 : 0.8))); tg.rotateY(-Math.PI / 2); const tail = new THREE.Mesh(tg, id === 'perch' || id === 'pike' ? tipM : finM); tail.position.set(0, Y0(0), Z(0) + .01 * L); attach(tail, 0); tail.userData.tail = true;
  for (const d of s.dorsal) { const fg = finShape(curve(Z(d.z0), Z(d.z1), d.h * L, d.sweep ?? .6, !!d.spiny)); fg.rotateY(-Math.PI / 2); const f = new THREE.Mesh(fg, finM); const tm = (d.z0 + d.z1) / 2; f.position.y = Y0(tm) + H0(tm) * .93; attach(f, tm); f.position.z = 0; }
  { const a = s.anal; const fg = finShape(curve(Z(a.z0), Z(a.z1), a.h * L, .6, false).map(([x, y]) => [x, -y] as [number, number])); fg.rotateY(-Math.PI / 2); const f = new THREE.Mesh(fg, tipM); const tm = (a.z0 + a.z1) / 2; f.position.y = Y0(tm) - H0(tm) * 1.0; attach(f, tm); }
  // paired fins: pectorals behind the gill, pelvics under the belly
  const pecT = s.eye.t - .17, pelT = id === 'pike' || id === 'trout' || id === 'salmon' || id === 'catfish' || id === 'sturgeon' ? .42 : pecT - .04;
  const pg = finShape([[0, 0], [-.4, .55], [-1, .5], [-.85, .2], [-.6, -.05]].map(([x, y]) => [x! * s.pect * L, y! * s.pect * L] as [number, number])); pg.rotateY(-Math.PI / 2);
  const vg = finShape([[0, 0], [-.6, .5], [-1, .35], [-.7, 0]].map(([x, y]) => [x! * s.pelv * L, y! * s.pelv * L] as [number, number])); vg.rotateY(-Math.PI / 2);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(pg, tipM); p.position.set(sx * W0(pecT) * .95, Y0(pecT) - H0(pecT) * .35, Z(pecT)); p.rotation.set(0, sx * .5, sx * -1.1); p.userData.flap = sx; attach(p, pecT); p.position.z = Z(pecT);
    const v = new THREE.Mesh(vg, tipM); v.position.set(sx * W0(pelT) * .5, Y0(pelT) - H0(pelT) * .95, Z(pelT)); v.rotation.set(0, sx * .25, sx * -2.4); attach(v, pelT); v.position.z = Z(pelT); }
  // eyes: gold/silver iris ring, glossy black pupil
  const er = s.eye.r * L * (id === 'walleye' ? 1.1 : 1), ey = Y0(s.eye.t) + s.eye.y * L, ex = W0(s.eye.t) * .92, ez = Z(s.eye.t);
  const irisM = new THREE.MeshStandardMaterial({ color: s.eye.iris, roughness: .3, metalness: .4, emissive: id === 'walleye' ? 0x445533 : 0 }); const pupM = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: .05, clearcoat: 1 });
  const seg = low ? 8 : 14; for (const sx of [-1, 1]) { const ir = new THREE.Mesh(new THREE.SphereGeometry(er, seg, seg), irisM); ir.scale.set(.5, 1, 1); ir.position.set(sx * ex, ey, ez); const pu = new THREE.Mesh(new THREE.SphereGeometry(er * .58, seg, seg), pupM); pu.scale.set(.5, 1, 1); pu.position.set(sx * (ex + er * .22), ey, ez + er * .05); g.add(ir, pu); }
  // mouth
  const mouthM = new THREE.MeshStandardMaterial({ color: 0x2a1a1a, roughness: .7 }); const tipZ = L / 2;
  if (s.mouth === 'big') { const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2), mouthM); m.scale.set(W0(.95) * 1.1, .006 * L, .1 * L); m.position.set(0, Y0(.97) - .005 * L, tipZ - .07 * L); g.add(m);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, seg, 8), mat); jaw.scale.set(W0(.92) * .9, .022 * L, .09 * L); jaw.position.set(0, Y0(.95) - .03 * L, tipZ - .07 * L); g.add(jaw); }
  else if (s.mouth === 'duck') { const m = new THREE.Mesh(new THREE.BoxGeometry(W0(.96) * 2.1, .004 * L, .14 * L), mouthM); m.position.set(0, Y0(.95), tipZ - .07 * L); g.add(m); }
  else if (s.mouth === 'under') { const m = new THREE.Mesh(new THREE.TorusGeometry(.012 * L, .004 * L, 6, 12), mouthM); m.rotation.x = Math.PI / 2; m.position.set(0, Y0(.85) - H0(.85) * 1.02, Z(.86)); g.add(m); }
  else { const m = new THREE.Mesh(new THREE.TorusGeometry(W0(.97) * .9, .004 * L, 6, 12), mouthM); m.position.set(0, Y0(.985), tipZ - .012 * L); g.add(m); }
  // barbels: whiskers that droop and curl back
  if (s.barbels) { const bm = new THREE.MeshStandardMaterial({ color: id === 'catfish' ? 0x2a2e34 : id === 'koi' ? 0xffd8c8 : s.side, roughness: .6 }); const n = s.barbels;
    for (let i = 0; i < n; i++) { const sx = i % 2 ? 1 : -1, row = Math.floor(i / 2); const big = id === 'catfish' && row === 0; const len = (big ? .24 : id === 'catfish' ? .09 : .06) * L;
      const st = id === 'sturgeon' ? new THREE.Vector3(sx * (.006 + row * .01) * L, Y0(.9) - H0(.9), Z(.92)) : new THREE.Vector3(sx * W0(.96) * (row === 0 ? 1 : .6), Y0(.96) + (row === 0 ? .01 : -.02 - row * .01) * L, tipZ - .03 * L);
      const c = new THREE.CatmullRomCurve3([st, st.clone().add(new THREE.Vector3(sx * len * .35, -len * .25, -len * .1)), st.clone().add(new THREE.Vector3(sx * len * .6, -len * .55, -len * .5)), st.clone().add(new THREE.Vector3(sx * len * .7, -len * .6, -len))]);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(c, low ? 6 : 12, (big ? .005 : .003) * L, low ? 3 : 5, false), bm)); } }
  if (id === 'sturgeon') { const sm = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: .6 }); for (let i = 0; i < 9; i++) { const t = .22 + i * .065; const sc = new THREE.Mesh(new THREE.ConeGeometry(.012 * L, .03 * L, 4), sm); sc.position.set(0, Y0(t) + H0(t) * .98, Z(t)); attach(sc, t); } }
  g.userData.swim = { u, parts, L, sp: s.swim };
  return g;
}
/** Swim motion: call each frame with seconds. */
export function animateFish(g: THREE.Object3D, t: number) {
  let sw = g.userData.swim as { u: { uT: { value: number } }; parts: THREE.Object3D[]; L: number; sp: number } | undefined;
  if (!sw) { g.traverse((o) => { if (!sw && o.userData.swim) sw = o.userData.swim; }); if (!sw) return; }
  sw.u.uT.value = t; for (const p of sw.parts) { const zn = p.userData.zn as number; const x = bend(zn, t, sw.sp) * sw.L, d = (bend(zn + .01, t, sw.sp) - bend(zn - .01, t, sw.sp)) / .02;
    p.position.x = (p.userData.x0 as number) + x; if (p.userData.tail) p.rotation.y = Math.atan(d) * 1.6; else if (p.userData.flap) p.rotation.y = (p.userData.flap as number) * (.5 + Math.sin(t * 4 * sw.sp) * .25); }
}
