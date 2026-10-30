/** HD canvas renderer for the arena: gritty raycast walls (concrete, rusted metal, containers, sandbags), fog, soldier sprites, viewmodels. */
import { castRay, MAP, MAX_HP, type WeaponId } from '../../../shared/fps';

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

  world(ctx: CanvasRenderingContext2D, cam: Cam, light = 0) {
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
      const edge = hit.cellX === 0 || hit.cellY === 0 || hit.cellX === MAP[0].length - 1 || hit.cellY === MAP.length - 1;
      const kind = edge ? 0 : [1, 2, 3, 4, 0][(hit.cellX * 7 + hit.cellY * 3) % 5];
      ctx.drawImage(t[kind][hit.side], Math.min(TEX - 1, (u * TEX) | 0), 0, 1, TEX, col, top, 1, lineH);
      const fog = Math.min(0.88, (d / FOG_DIST) ** 1.4);
      if (fog > 0.02) {
        ctx.fillStyle = `rgba(${FOG[0]},${FOG[1]},${FOG[2]},${fog.toFixed(2)})`;
        ctx.fillRect(col, top, 1, lineH);
      }
      if (light > 0 && d < 4) {
        ctx.fillStyle = `rgba(255,180,90,${(light * 0.3 * (1 - d / 4)).toFixed(3)})`;
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
          const h = ((Math.floor(wx * 4) * 73856093) ^ (Math.floor(wy * 4) * 19349663)) & 15;
          const seam = tx < 0.025 || ty < 0.025;
          const base = seam ? 46 : 70 + h;
          r = base + 6; g = base + 2; b = base - 6;
        } else {
          void tx; void ty;
          const k = Math.min(1, dy / hz);
          r = 92 - 40 * k; g = 90 - 38 * k; b = 86 - 30 * k;
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

  /** Soldier billboard: helmet, vest, rifle, camo tone. Facing picks front/side/back; hits flinch; deaths fall over. */
  soldier(ctx: CanvasRenderingContext2D, cam: Cam, p: SpriteP) {
    const pr = this.project(cam, p.x, p.y);
    if (!pr) return;
    const f = this.focal(cam);
    const unit = f / pr.depth;
    const h = unit * 0.9, w = h;
    const bottom = this.H / 2 + unit * (cam.eye - p.z);
    if (pr.sx + w < 0 || pr.sx - w > this.W) return;
    let rel = p.a - Math.atan2(cam.y - p.y, cam.x - p.x);
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const view = Math.abs(rel) < 0.7 ? 'front' : Math.abs(rel) > 2.4 ? 'back' : 'side';
    const dir = rel > 0 ? -1 : 1; // which way the rifle points in side view
    const g = this.spriteCanvas.getContext('2d')!;
    const S = 160;
    g.clearRect(0, 0, S, S);
    const dead = p.dead ?? -1;
    const fall = dead >= 0 ? Math.min(1, dead / 0.55) : 0;
    const fade = dead > 0.8 ? Math.max(0, 1 - (dead - 0.8) / 0.4) : 1;
    g.save();
    g.globalAlpha = fade;
    // shadow
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(80, 154, 26 + fall * 30, 5, 0, 0, 7); g.fill();
    // Fall: rotate around the feet, easing in.
    g.translate(80, 154);
    g.rotate((fall * fall) * (Math.PI / 2) * dir);
    if (p.flash && dead < 0) g.rotate(-0.08 * dir);
    g.translate(-80, -154);
    const step = p.moving && dead < 0 ? Math.sin((p.t ?? 0) / 90) * 5 : 0;
    const camo = p.color;
    const dark = '#1d1f1a';
    const vest = '#3b3e33';
    // legs
    g.fillStyle = camo;
    g.fillRect(64 + step * 0.5, 104, 13, 46); g.fillRect(83 - step * 0.5, 104, 13, 46);
    g.fillStyle = dark; g.fillRect(62 + step * 0.5, 146, 17, 8); g.fillRect(81 - step * 0.5, 146, 17, 8);
    // torso + vest
    g.fillStyle = camo; g.beginPath(); g.roundRect(56, 52, 48, 56, 8); g.fill();
    if (view !== 'back') { g.fillStyle = vest; g.beginPath(); g.roundRect(60, 56, 40, 40, 5); g.fill(); g.fillStyle = 'rgba(0,0,0,.35)'; for (const x of [64, 76, 88]) g.fillRect(x, 78, 9, 12); }
    else { g.fillStyle = '#4a4636'; g.beginPath(); g.roundRect(62, 56, 36, 42, 6); g.fill(); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(62, 70, 36, 3); }
    // camo blotches
    g.fillStyle = 'rgba(0,0,0,.18)';
    for (const [x, y, r] of [[60, 100, 6], [94, 64, 5], [70, 124, 5], [90, 136, 6]] as const) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    // head + helmet
    g.fillStyle = '#b08d6e'; g.beginPath(); g.arc(80, 40, 12, 0, 7); g.fill();
    g.fillStyle = camo; g.beginPath(); g.ellipse(80, 33, 17, 13, 0, Math.PI, 0); g.fill(); g.fillRect(63, 32, 34, 4);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(63, 34, 34, 2);
    if (view === 'front') { g.fillStyle = '#16181a'; g.fillRect(70, 38, 20, 6); }
    if (view === 'side') { g.fillStyle = '#16181a'; g.fillRect(80 + dir * 3, 38, 9 * dir, 5); }
    // arms + rifle
    g.fillStyle = camo;
    if (view === 'side') {
      g.fillRect(76, 60, 12, 26);
      g.fillStyle = dark; g.fillRect(dir > 0 ? 70 : 34, 70, 56, 7); g.fillRect(dir > 0 ? 120 : 30, 71, 12 * 1, 4);
      g.fillStyle = '#2a2b27'; g.fillRect(dir > 0 ? 78 : 66, 76, 8, 12);
    } else if (view === 'front') {
      g.fillRect(50, 58, 11, 30); g.fillRect(99, 58, 11, 30);
      g.fillStyle = dark; g.save(); g.translate(80, 80); g.rotate(-0.5); g.fillRect(-34, -4, 68, 8); g.fillRect(14, 2, 7, 12); g.restore();
    } else {
      g.fillRect(50, 58, 11, 30); g.fillRect(99, 58, 11, 30);
      g.fillStyle = dark; g.fillRect(100, 40, 6, 30);
    }
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.4)';
    g.restore();
    if (p.flash && dead < 0) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(255,90,70,.35)';
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.imageSmoothingEnabled = true;
    this.billboard(ctx, this.spriteCanvas, pr.sx, bottom, w, h, pr.depth);
    const col = Math.max(0, Math.min(this.W - 1, Math.round(pr.sx)));
    if (dead < 0 && this.zbuf[col] >= pr.depth) {
      const top = bottom - h * 0.96;
      const fs = Math.max(9, Math.min(13, (this.H / 300) * 11));
      ctx.font = `600 ${fs | 0}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      const label = p.name.toUpperCase();
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillText(label, pr.sx + 1, top - 5);
      ctx.fillStyle = '#e6e9df';
      ctx.fillText(label, pr.sx, top - 6);
      const bw = Math.max(20, w * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(pr.sx - bw / 2, top - 2, bw, 2);
      ctx.fillStyle = p.hp > 34 ? '#d8dccd' : '#d9473a';
      ctx.fillRect(pr.sx - bw / 2, top - 2, (bw * p.hp) / MAX_HP, 2);
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

  minimap(ctx: CanvasRenderingContext2D, me: { x: number; y: number; a: number }, enemies: Array<{ x: number; y: number }>, marks: Array<{ x: number; y: number }>) {
    const cell = Math.max(3, Math.round(this.H / 70));
    const n = MAP.length;
    const ox = 8, oy = 8;
    ctx.fillStyle = 'rgba(10,16,10,.75)';
    ctx.fillRect(ox - 3, oy - 3, n * cell + 6, n * cell + 6);
    for (let y = 0; y < n; y++) for (let x = 0; x < MAP[y].length; x++) if (MAP[y][x] === '#') { ctx.fillStyle = '#5c6b52'; ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell); }
    for (const m of marks) { ctx.strokeStyle = '#ff9d5c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox + m.x * cell, oy + m.y * cell, cell * 3, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#ff4d4d';
    for (const e of enemies) { ctx.beginPath(); ctx.arc(ox + e.x * cell, oy + e.y * cell, cell * 0.6, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#9dffa0';
    ctx.save();
    ctx.translate(ox + me.x * cell, oy + me.y * cell);
    ctx.rotate(me.a);
    ctx.beginPath(); ctx.moveTo(cell * 1.2, 0); ctx.lineTo(-cell * 0.7, -cell * 0.7); ctx.lineTo(-cell * 0.7, cell * 0.7); ctx.fill();
    ctx.restore();
  }
}
