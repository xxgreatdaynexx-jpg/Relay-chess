/** HD canvas renderer for the arena: textured raycast walls, floor/ceiling casting, fog, blob sprites, viewmodels. */
import { castRay, MAP, MAX_HP, type WeaponId } from '../../../shared/fps';

export const BASE_FOV = Math.PI / 3;
const TEX = 64;
const FOG: [number, number, number] = [26, 30, 52];
const FOG_DIST = 13;

export interface Cam { x: number; y: number; a: number; eye: number; zoom: number }
export interface SpriteP { id: string; name: string; x: number; y: number; a: number; hp: number; z: number; color: string; flash: boolean }

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

let textures: HTMLCanvasElement[][] | null = null;
function tex() {
  if (!textures) {
    const a = brick('#b46a52', '#5d3a30', 7);
    const b = panel('#7a5aa8', 11);
    textures = [[a, shade(a, 0.3)], [b, shade(b, 0.3)]];
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

  world(ctx: CanvasRenderingContext2D, cam: Cam) {
    const { W, H } = this;
    const f = this.focal(cam);
    const hz = H / 2;
    this.floor(ctx, cam, f);
    ctx.imageSmoothingEnabled = false;
    const t = tex();
    const c = Math.cos(cam.a), s = Math.sin(cam.a);
    for (let col = 0; col < W; col++) {
      const lat = (col + 0.5 - W / 2) / f;
      const ra = cam.a + Math.atan(lat);
      const hit = castRay(cam.x, cam.y, ra);
      const d = hit.dist * (Math.cos(ra) * c + Math.sin(ra) * s);
      this.zbuf[col] = d;
      const lineH = f / Math.max(d, 0.05);
      const top = hz - lineH * (1 - cam.eye);
      const hx = cam.x + Math.cos(ra) * hit.dist, hy = cam.y + Math.sin(ra) * hit.dist;
      let u = hit.side === 0 ? hy - Math.floor(hy) : hx - Math.floor(hx);
      if ((hit.side === 0 && Math.cos(ra) < 0) || (hit.side === 1 && Math.sin(ra) > 0)) u = 1 - u;
      const kind = (hit.cellX * 7 + hit.cellY * 3) % 3 === 0 ? 1 : 0;
      ctx.drawImage(t[kind][hit.side], Math.min(TEX - 1, (u * TEX) | 0), 0, 1, TEX, col, top, 1, lineH);
      const fog = Math.min(0.88, (d / FOG_DIST) ** 1.4);
      if (fog > 0.02) {
        ctx.fillStyle = `rgba(${FOG[0]},${FOG[1]},${FOG[2]},${fog.toFixed(2)})`;
        ctx.fillRect(col, top, 1, lineH);
      }
    }
  }

  private floor(ctx: CanvasRenderingContext2D, cam: Cam, f: number) {
    const img = this.floorImg!;
    const fw = img.width, fh = img.height;
    const scale = this.W / fw;
    const data = img.data;
    const hz = fh / 2;
    const ff = f / scale;
    const c = Math.cos(cam.a), s = Math.sin(cam.a);
    for (let y = 0; y < fh; y++) {
      const floorRow = y > hz;
      const dy = Math.abs(y + 0.5 - hz);
      const height = floorRow ? cam.eye : 1 - cam.eye;
      const dist = (height * ff) / Math.max(dy, 0.5);
      const fog = Math.min(1, (dist / FOG_DIST) ** 1.4);
      for (let x = 0; x < fw; x++) {
        const lat = (x + 0.5 - fw / 2) / ff;
        const wx = cam.x + (c - s * lat) * dist;
        const wy = cam.y + (s + c * lat) * dist;
        const tx = wx - Math.floor(wx), ty = wy - Math.floor(wy);
        let r: number, g: number, b: number;
        if (floorRow) {
          const chk = (Math.floor(wx) + Math.floor(wy)) & 1;
          const grout = tx < 0.04 || ty < 0.04;
          r = grout ? 40 : chk ? 92 : 78; g = grout ? 34 : chk ? 74 : 62; b = grout ? 30 : chk ? 54 : 46;
        } else {
          const beam = tx < 0.08 || ty < 0.08;
          r = beam ? 52 : 38; g = beam ? 48 : 42; b = beam ? 70 : 74;
        }
        const i = (y * fw + x) * 4;
        data[i] = r + (FOG[0] - r) * fog;
        data[i + 1] = g + (FOG[1] - g) * fog;
        data[i + 2] = b + (FOG[2] - b) * fog;
        data[i + 3] = 255;
      }
    }
    const fc = this.floorCanvas.getContext('2d')!;
    fc.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.floorCanvas, 0, 0, this.W, this.H);
  }

  /** Draws an offscreen image as a billboard, clipped column-wise against the wall z-buffer. */
  private billboard(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, sx: number, bottom: number, w: number, h: number, depth: number) {
    const left = Math.floor(sx - w / 2);
    const right = Math.min(this.W, Math.ceil(sx + w / 2));
    let run = -1;
    const flush = (end: number) => {
      if (run < 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(run, 0, end - run, this.H);
      ctx.clip();
      ctx.drawImage(img, sx - w / 2, bottom - h, w, h);
      ctx.restore();
      run = -1;
    };
    for (let col = Math.max(0, left); col < right; col++) {
      const vis = this.zbuf[col] >= depth;
      if (vis && run < 0) run = col;
      if (!vis) flush(col);
    }
    flush(right);
    return { left, right };
  }

  blob(ctx: CanvasRenderingContext2D, cam: Cam, p: SpriteP) {
    const pr = this.project(cam, p.x, p.y);
    if (!pr) return;
    const f = this.focal(cam);
    const unit = f / pr.depth;
    const h = unit * 0.72, w = h * 0.8;
    const bottom = this.H / 2 + unit * (cam.eye - p.z);
    if (pr.sx + w < 0 || pr.sx - w > this.W) return;
    // Facing: angle between where they look and the direction to the camera.
    let rel = p.a - Math.atan2(cam.y - p.y, cam.x - p.x);
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const g = this.spriteCanvas.getContext('2d')!;
    const S = 160;
    g.clearRect(0, 0, S, S);
    // shadow
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(80, 152 + p.z * 60, 44, 7, 0, 0, 7); g.fill();
    const grad = g.createRadialGradient(62, 60, 8, 80, 90, 80);
    grad.addColorStop(0, '#ffffffaa');
    grad.addColorStop(0.18, p.color);
    grad.addColorStop(1, '#00000088');
    g.fillStyle = p.color;
    g.beginPath(); g.ellipse(80, 90, 52, 62, 0, 0, 7); g.fill();
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
    // feet
    g.fillStyle = '#222';
    g.beginPath(); g.ellipse(58, 150, 14, 7, 0, 0, 7); g.ellipse(102, 150, 14, 7, 0, 0, 7); g.fill();
    const facing = Math.abs(rel) < 1.9;
    if (facing) {
      const shift = Math.sin(rel) * -26;
      for (const ex of [-20, 20]) {
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(80 + ex + shift, 62, 15, 0, 7); g.fill();
        g.lineWidth = 2; g.strokeStyle = '#0006'; g.stroke();
        g.fillStyle = '#111';
        g.beginPath(); g.arc(80 + ex + shift * 1.25, 64, 6.5, 0, 7); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(80 + ex + shift * 1.25 - 2, 61, 2, 0, 7); g.fill();
      }
      g.strokeStyle = '#0008'; g.lineWidth = 3;
      g.beginPath(); g.arc(80 + shift, 92, 12, 0.2, Math.PI - 0.2); g.stroke();
    } else {
      g.fillStyle = '#0003';
      g.beginPath(); g.arc(80, 40, 6, 0, 7); g.fill();
    }
    if (p.flash) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.imageSmoothingEnabled = true;
    this.billboard(ctx, this.spriteCanvas, pr.sx, bottom, w * 1.25, h * 1.25 * 1.0, pr.depth);
    const col = Math.max(0, Math.min(this.W - 1, Math.round(pr.sx)));
    if (this.zbuf[col] >= pr.depth) {
      const top = bottom - h * 1.25;
      const fs = Math.max(10, Math.min(16, h * 0.16)) * (this.H / 300);
      ctx.font = `600 ${fs | 0}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(p.name).width;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(pr.sx - tw / 2 - 4, top - fs - 6, tw + 8, fs + 4);
      ctx.fillStyle = '#fff6d8';
      ctx.fillText(p.name, pr.sx, top - 6);
      const bw = Math.max(24, w * 0.6);
      ctx.fillStyle = '#ff6060';
      ctx.fillRect(pr.sx - bw / 2, top - 2, bw, 3);
      ctx.fillStyle = '#5cd17a';
      ctx.fillRect(pr.sx - bw / 2, top - 2, (bw * p.hp) / MAX_HP, 3);
    }
  }

  /** Generic small billboard drawn with a callback (drones, strike markers, explosions). */
  thing(ctx: CanvasRenderingContext2D, cam: Cam, x: number, y: number, z: number, size: number, draw: (g: CanvasRenderingContext2D) => void) {
    const pr = this.project(cam, x, y);
    if (!pr) return;
    const unit = this.focal(cam) / pr.depth;
    const g = this.spriteCanvas.getContext('2d')!;
    g.clearRect(0, 0, 160, 160);
    draw(g);
    const h = unit * size;
    this.billboard(ctx, this.spriteCanvas, pr.sx, this.H / 2 + unit * (cam.eye - z), h, h, pr.depth);
  }

  /** First-person gun. bob/kick/lower are 0..1-ish offsets. */
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
    // hand
    ctx.fillStyle = '#f0c8a0';
    ctx.beginPath(); ctx.ellipse(4, -10, 16, 12, -0.3, 0, 7); ctx.fill();
    if (w === 'pistol') { metal(-7, -58, 14, 46, '#d9a640', '#ffe08a'); metal(-5, -70, 10, 16, '#3d7a5c', '#6fd1a0'); tip = -72; }
    if (w === 'smg') { metal(-11, -64, 22, 54, '#455066', '#8a98b8'); metal(-4, -84, 8, 24, '#2b3242', '#5e6b88'); metal(10, -40, 10, 26, '#e86a9a', '#ffa6c8'); tip = -86; }
    if (w === 'shotgun') { metal(-14, -60, 28, 52, '#8a4f2a', '#d08a52'); metal(-11, -96, 10, 40, '#555', '#bbb'); metal(1, -96, 10, 40, '#555', '#bbb'); tip = -98; }
    if (w === 'sniper') { metal(-8, -62, 16, 54, '#2f5a3c', '#5fa070'); metal(-3, -110, 6, 52, '#333', '#888'); metal(-10, -80, 20, 12, '#111', '#555'); tip = -112; }
    if (w === 'rocket') { metal(-18, -70, 36, 62, '#6a7a3a', '#b6c86a'); ctx.fillStyle = '#e8503a'; ctx.beginPath(); ctx.arc(0, -72, 12, Math.PI, 0); ctx.fill(); tip = -84; }
    if (muzzle) {
      const r = w === 'rocket' || w === 'shotgun' ? 26 : w === 'smg' ? 14 : 18;
      const g = ctx.createRadialGradient(0, tip, 1, 0, tip, r);
      g.addColorStop(0, '#fffbe0'); g.addColorStop(0.4, '#ffd34acc'); g.addColorStop(1, '#ff7a0000');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, tip, r, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  minimap(ctx: CanvasRenderingContext2D, me: { x: number; y: number; a: number }, enemies: Array<{ x: number; y: number }>, marks: Array<{ x: number; y: number }>) {
    const cell = Math.max(3, Math.round(this.H / 70));
    const n = MAP.length;
    const ox = 8, oy = 8;
    ctx.fillStyle = 'rgba(10,14,30,.72)';
    ctx.fillRect(ox - 3, oy - 3, n * cell + 6, n * cell + 6);
    for (let y = 0; y < n; y++) for (let x = 0; x < MAP[y].length; x++) if (MAP[y][x] === '#') { ctx.fillStyle = '#4b5578'; ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell); }
    for (const m of marks) { ctx.strokeStyle = '#ff9d5c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox + m.x * cell, oy + m.y * cell, cell * 3, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#ff4d4d';
    for (const e of enemies) { ctx.beginPath(); ctx.arc(ox + e.x * cell, oy + e.y * cell, cell * 0.6, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#e8c26a';
    ctx.save();
    ctx.translate(ox + me.x * cell, oy + me.y * cell);
    ctx.rotate(me.a);
    ctx.beginPath(); ctx.moveTo(cell * 1.2, 0); ctx.lineTo(-cell * 0.7, -cell * 0.7); ctx.lineTo(-cell * 0.7, cell * 0.7); ctx.fill();
    ctx.restore();
  }
}
