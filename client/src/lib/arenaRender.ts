/** HD canvas renderer for the arena: gritty raycast walls (concrete, rusted metal, containers, sandbags), fog, soldier sprites, viewmodels. */
import { type ArenaMap, type WeaponId } from '../../../shared/fps';

export const BASE_FOV = Math.PI / 3;
const TEX = 64;
const FOG: [number, number, number] = [62, 60, 54];
const FOG_DIST = 13;

export interface Cam { x: number; y: number; a: number; eye: number; zoom: number }
export interface SpriteP { id: string; name: string; x: number; y: number; a: number; hp: number; z: number; color: string; flash: boolean; dead?: number; moving?: boolean; t?: number }

function makeTex(draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TEX;
  c.height = TEX;
  draw(c.getContext('2d')!);
  return c;
}

function noise(g: CanvasRenderingContext2D, amt: number, seed: number) {
  let s = seed;
  const img = g.getImageData(0, 0, TEX, TEX);
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s / 0x7fffffff) - 0.5) * amt;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function brick(base: string, mortar: string, seed: number) {
  return makeTex((g) => {
    g.fillStyle = mortar;
    g.fillRect(0, 0, TEX, TEX);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 8 : 0;
      for (let col = -1; col < 4; col++) {
        g.fillStyle = base;
        g.fillRect(col * 16 + off + 1, row * 8 + 1, 14, 6);
        g.fillStyle = 'rgba(255,255,255,.12)';
        g.fillRect(col * 16 + off + 1, row * 8 + 1, 14, 1);
      }
    }
    noise(g, 26, seed);
  });
}

function panel(base: string, seed: number) {
  return makeTex((g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, TEX, TEX);
    g.strokeStyle = 'rgba(0,0,0,.35)';
    g.lineWidth = 2;
    g.strokeRect(3, 3, 58, 58);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillRect(4, 4, 56, 2);
    for (const [x, y] of [[8, 8], [56, 8], [8, 56], [56, 56]]) { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fillStyle = 'rgba(0,0,0,.4)'; g.fill(); }
    g.fillStyle = 'rgba(232,194,106,.5)';
    g.fillRect(4, 30, 56, 4);
    noise(g, 18, seed);
  });
}

function shade(src: HTMLCanvasElement, k: number) {
  return makeTex((g) => { g.drawImage(src, 0, 0); g.fillStyle = `rgba(0,0,0,${k})`; g.fillRect(0, 0, TEX, TEX); });
}

function concrete(base: string, seed: number) {
  return makeTex((g) => {
    g.fillStyle = base; g.fillRect(0, 0, TEX, TEX);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(0, 31, TEX, 2); g.fillRect(31, 0, 1, 31); g.fillRect(12, 33, 1, 31); g.fillRect(48, 33, 1, 31);
    for (const [x, y] of [[8, 10], [40, 18], [20, 46], [54, 50]]) { g.beginPath(); g.arc(x, y, 1.5, 0, 7); g.fillStyle = 'rgba(0,0,0,.35)'; g.fill(); }
    const sg = g.createLinearGradient(0, 40, 0, 64); sg.addColorStop(0, 'rgba(40,30,20,0)'); sg.addColorStop(1, 'rgba(40,30,20,.35)');
    g.fillStyle = sg; g.fillRect(0, 40, TEX, 24);
    noise(g, 30, seed);
  });
}
function corrugated(base: string, rust: string, seed: number, ribs = 8) {
  return makeTex((g) => {
    g.fillStyle = base; g.fillRect(0, 0, TEX, TEX);
    const w = TEX / ribs;
    for (let i = 0; i < ribs; i++) {
      const gr = g.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,.1)'); gr.addColorStop(1, 'rgba(0,0,0,.35)');
      g.fillStyle = gr; g.fillRect(i * w, 0, w, TEX);
    }
    let s = seed;
    for (let i = 0; i < 26; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff; const x = s % TEX;
      s = (s * 1103515245 + 12345) & 0x7fffffff; const y = s % TEX;
      g.fillStyle = rust; g.globalAlpha = 0.25 + (i % 3) * 0.15;
      g.fillRect(x, y, 2 + (i % 4), 6 + (i % 9));
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, TEX, 3); g.fillRect(0, TEX - 3, TEX, 3);
    noise(g, 22, seed);
  });
}
function sandbags(seed: number) {
  return makeTex((g) => {
    g.fillStyle = '#4a4232'; g.fillRect(0, 0, TEX, TEX);
    for (let row = 0; row < 6; row++) {
      const off = row % 2 ? 10 : 0;
      for (let col = -1; col < 4; col++) {
        const x = col * 21 + off, y = row * 10.7;
        const gr = g.createLinearGradient(0, y, 0, y + 10);
        gr.addColorStop(0, '#a39572'); gr.addColorStop(1, '#6f6447');
        g.fillStyle = gr; g.beginPath(); g.roundRect(x + 1, y + 1, 19, 9, 4); g.fill();
      }
    }
    noise(g, 26, seed);
  });
}
let textures: HTMLCanvasElement[][] | null = null;
function tex() {
  if (!textures) {
    const set = [concrete('#7d7a72', 7), corrugated('#5d3b2a', '#8a4a22', 3), corrugated('#2f4a5a', '#7a4a2a', 11, 10), corrugated('#4a5236', '#6e4a22', 19, 10), sandbags(23)];
    textures = set.map((t) => [t, shade(t, 0.32)]);
  }
  return textures;
}

export class ArenaRenderer {
  W = 0;
  H = 0;
  private zbuf = new Float32Array(1);
  private floorCanvas = document.createElement('canvas');
  private floorImg: ImageData | null = null;
  private spriteCanvas = document.createElement('canvas');

  resize(w: number, h: number) {
    if (w === this.W && h === this.H) return;
    this.W = w;
    this.H = h;
    this.zbuf = new Float32Array(w);
    const fw = Math.max(80, Math.min(240, Math.round(w / 3)));
    const fh = Math.round(fw * (h / w));
    this.floorCanvas.width = fw;
    this.floorCanvas.height = fh;
    this.floorImg = new ImageData(fw, fh);
    this.spriteCanvas.width = 160;
    this.spriteCanvas.height = 160;
  }

  focal(cam: Cam) {
    return (this.W / 2 / Math.tan(BASE_FOV / 2)) * cam.zoom;
  }

  /** Screen x and perpendicular depth for a world point, or null if behind. */
  project(cam: Cam, x: number, y: number): { sx: number; depth: number } | null {
    const dx = x - cam.x, dy = y - cam.y;
    const c = Math.cos(cam.a), s = Math.sin(cam.a);
    const depth = dx * c + dy * s;
    if (depth < 0.15) return null;
    const lat = -dx * s + dy * c;
    return { sx: this.W / 2 + (lat / depth) * this.focal(cam), depth };
  }

  viewmodel(ctx: CanvasRenderingContext2D, w: WeaponId, bob: number, kick: number, lower: number, muzzle: boolean) {
    const u = this.H / 200;
    const cx = this.W / 2 + 34 * u + Math.sin(bob) * 4 * u;
    const by = this.H + 4 * u + Math.abs(Math.cos(bob)) * 3 * u + kick * 8 * u + lower * 60 * u;
    ctx.save();
    ctx.translate(cx, by);
    ctx.scale(u, u);
    const metal = (x: number, y: number, ww: number, hh: number, c1: string, c2: string) => {
      const g = ctx.createLinearGradient(x, y, x + ww, y);
      g.addColorStop(0, c1); g.addColorStop(0.5, c2); g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x, y, ww, hh, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
    };
    let tip = -70;
    const gm = '#1c1e20', gm2 = '#3a3e42', poly = '#25262a', wood = '#4a3626';
    // gloved hand
    ctx.fillStyle = '#2d2f2a';
    ctx.beginPath(); ctx.ellipse(6, -8, 17, 13, -0.3, 0, 7); ctx.fill();
    if (w === 'pistol') { metal(-8, -56, 16, 44, gm, gm2); metal(-7, -72, 14, 20, poly, '#4a4d52'); ctx.fillStyle = '#0c0c0c'; ctx.fillRect(-2, -74, 4, 4); tip = -74; }
    if (w === 'smg') { metal(-12, -62, 24, 52, poly, gm2); metal(-5, -90, 10, 30, gm, gm2); metal(-4, -46, 8, 34, '#151617', '#2a2c2f'); metal(-9, -76, 18, 6, '#101112', '#2b2d30'); tip = -92; }
    if (w === 'shotgun') { metal(-14, -56, 28, 48, wood, '#6a4e36'); metal(-7, -104, 14, 50, gm, gm2); metal(-10, -78, 20, 18, '#3a2a1e', '#5a4230'); tip = -106; }
    if (w === 'sniper') { metal(-10, -60, 20, 52, '#3b3d33', '#5a5d4e'); metal(-3, -116, 6, 58, gm, gm2); metal(-12, -86, 24, 14, '#0f1011', '#33363a'); ctx.fillStyle = '#4b7a9a55'; ctx.fillRect(-9, -84, 18, 3); tip = -118; }
    if (w === 'rocket') { metal(-17, -96, 34, 90, '#3f4630', '#5d6646'); metal(-8, -60, 16, 22, gm, gm2); ctx.fillStyle = '#2c3022'; ctx.beginPath(); ctx.moveTo(-13, -96); ctx.lineTo(0, -122); ctx.lineTo(13, -96); ctx.fill(); tip = -100; }
    if (muzzle) {
      const r = w === 'rocket' || w === 'shotgun' ? 26 : w === 'smg' ? 14 : 18;
      const g = ctx.createRadialGradient(0, tip, 1, 0, tip, r);
      g.addColorStop(0, '#fffbe0'); g.addColorStop(0.4, '#ffd34acc'); g.addColorStop(1, '#ff7a0000');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, tip, r, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  /** Top-down radar of the map's solids (tinted by height), strike rings, UAV contacts and you. */
  minimap(ctx: CanvasRenderingContext2D, map: ArenaMap, me: { x: number; y: number; a: number }, enemies: Array<{ x: number; y: number }>, marks: Array<{ x: number; y: number; r?: number }>) {
    const size = minimapSize(this.W, this.H);
    const cell = size / Math.max(map.w, map.d);
    const ox = 8, oy = 8;
    ctx.fillStyle = 'rgba(30,26,18,.75)';
    ctx.fillRect(ox - 3, oy - 3, map.w * cell + 6, map.d * cell + 6);
    for (const s of map.solids) {
      if (s.z1 < 0.3) continue;
      const k = Math.min(1, s.z1 / 5);
      ctx.fillStyle = `rgba(${150 + 70 * k | 0},${130 + 60 * k | 0},${90 + 40 * k | 0},.9)`;
      ctx.fillRect(ox + s.x0 * cell, oy + s.y0 * cell, Math.max(1, (s.x1 - s.x0) * cell), Math.max(1, (s.y1 - s.y0) * cell));
    }
    ctx.fillStyle = 'rgba(190,170,120,.6)';
    for (const r of map.ramps) ctx.fillRect(ox + r.x0 * cell, oy + r.y0 * cell, (r.x1 - r.x0) * cell, (r.y1 - r.y0) * cell);
    for (const m of marks) { ctx.strokeStyle = '#ff6a3c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox + m.x * cell, oy + m.y * cell, (m.r ?? 3) * cell, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#ff4d4d';
    for (const e of enemies) { ctx.beginPath(); ctx.arc(ox + e.x * cell, oy + e.y * cell, Math.max(2, cell * 0.6), 0, 7); ctx.fill(); }
    ctx.fillStyle = '#9dffa0';
    ctx.save();
    ctx.translate(ox + me.x * cell, oy + me.y * cell);
    ctx.rotate(me.a);
    const c = Math.max(3, cell);
    ctx.beginPath(); ctx.moveTo(c * 1.4, 0); ctx.lineTo(-c * 0.8, -c * 0.8); ctx.lineTo(-c * 0.8, c * 0.8); ctx.fill();
    ctx.restore();
  }
}

/** Radar size in px: a quarter of the height, but never more than ~28% of the width so it can't reach the top-right scoreboard. */
export function minimapSize(W: number, H: number): number {
  return Math.max(60, Math.min(Math.round(H / 4), Math.round(W * 0.28)));
}
