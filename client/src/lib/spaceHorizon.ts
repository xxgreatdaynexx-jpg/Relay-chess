/**
 * Ascent view: one ray-traced frame for ground, sky, limb and haze, so the
 * horizon is continuous from the pad up to the hand-off to the orbital globe.
 *
 * Ground colour comes from the same terrain / biome pipeline as the globe. A
 * finer regional texture covers the launch corridor (built in small slices
 * during the countdown) and procedural micro-detail fades in close to the
 * ground. Display only; physics are untouched.
 */
import { PLANET, altitudeOf, orbitalElements, type FlightState } from '../../../shared/spaceFlight';
import { clamp, lerp, smooth, terrainAt } from '../../../shared/spaceTerrain';
import { SUN, TW, TH, maps, sample, drawStars, biome, landVary } from './spacePlanet';

// ───────────────────────── regional texture ─────────────────────────

const PATCH = { lon0: -25 * Math.PI / 180, lon1: 45 * Math.PI / 180, lat0: -22 * Math.PI / 180, lat1: 22 * Math.PI / 180, w: 600, h: 378 };
interface Patch { rgb: Float32Array; ocean: Uint8Array; elev: Float32Array; moist: Float32Array; row: number; ready: boolean }
let patch: Patch | null = null;

/** Advance regional texture generation within a time budget. Returns true once ready. */
export function stepRegionalTexture(budgetMs = 10): boolean {
  if (typeof document === 'undefined') return false;
  if (!patch) {
    const n = PATCH.w * PATCH.h;
    patch = { rgb: new Float32Array(n * 3), ocean: new Uint8Array(n), elev: new Float32Array(n), moist: new Float32Array(n), row: 0, ready: false };
  }
  if (patch.ready) return true;
  const t0 = performance.now();
  const P = patch;
  while (P.row < PATCH.h && performance.now() - t0 < budgetMs) {
    const j = P.row;
    const lat = lerp(PATCH.lat1, PATCH.lat0, (j + 0.5) / PATCH.h);
    for (let i = 0; i < PATCH.w; i++) {
      const lon = lerp(PATCH.lon0, PATCH.lon1, (i + 0.5) / PATCH.w);
      const t = terrainAt(lat, lon);
      const k = j * PATCH.w + i;
      P.elev[k] = t.elev; P.moist[k] = t.moist; P.ocean[k] = t.elev <= 0 ? 1 : 0;
    }
    P.row++;
  }
  if (P.row < PATCH.h) return false;
  const M = maps();
  if (!M) return false;
  // Colour pass: same biome palette and baked relief as the globe, scaled for the finer grid.
  const W = PATCH.w, H = PATCH.h;
  const texelRatio = ((PATCH.lon1 - PATCH.lon0) / W) / ((2 * Math.PI) / TW); // < 1: finer than the globe texture
  const gain = 1 / Math.max(0.25, texelRatio);
  for (let j = 0; j < H; j++) {
    const lat = lerp(PATCH.lat1, PATCH.lat0, (j + 0.5) / H);
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const e = P.elev[k]!;
      const eR = P.elev[j * W + Math.min(W - 1, i + 1)]!;
      const eD = P.elev[Math.min(H - 1, j + 1) * W + i]!;
      const eU = P.elev[Math.max(0, j - 1) * W + i]!;
      const slope = Math.hypot(eR - e, eD - e) * 9 * gain;
      const shade = clamp(0.8 + ((e - eR) * 2.4 + (e - eU) * 1.6) * gain * 0.8, 0.5, 1.22);
      const [r, g, b] = biome(e, lat, P.moist[k]!, slope, landVary(lat, lerp(PATCH.lon0, PATCH.lon1, (i + 0.5) / W)));
      const o = k * 3;
      // Store the difference from the globe texture at the same spot.
      const lon = lerp(PATCH.lon0, PATCH.lon1, (i + 0.5) / W);
      const [gr, gg, gb] = sample(M.surfacePx, lon / (2 * Math.PI) + 0.5, 0.5 - lat / Math.PI, TW, TH);
      P.rgb[o] = clamp(r * shade, 0, 255) - gr; P.rgb[o + 1] = clamp(g * shade, 0, 255) - gg; P.rgb[o + 2] = clamp(b * shade, 0, 255) - gb;
    }
  }
  // Keep only the detail the globe texture cannot show: subtract a blurred copy
  // (box blur ~ two globe texels), so large-scale colour always matches the globe.
  const rad = Math.max(2, Math.round(2 / texelRatio));
  const blur = boxBlur3(P.rgb, W, H, rad);
  for (let k = 0; k < P.rgb.length; k++) P.rgb[k] = P.rgb[k]! - blur[k]!;
  P.ready = true;
  return true;
}

function boxBlur3(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let j = 0; j < H; j++) for (let ch = 0; ch < 3; ch++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[(j * W + clamp(i, 0, W - 1)) * 3 + ch]!;
    for (let i = 0; i < W; i++) {
      tmp[(j * W + i) * 3 + ch] = acc / n;
      acc += src[(j * W + Math.min(W - 1, i + r + 1)) * 3 + ch]! - src[(j * W + Math.max(0, i - r)) * 3 + ch]!;
    }
  }
  for (let i = 0; i < W; i++) for (let ch = 0; ch < 3; ch++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[(clamp(j, 0, H - 1) * W + i) * 3 + ch]!;
    for (let j = 0; j < H; j++) {
      out[(j * W + i) * 3 + ch] = acc / n;
      acc += tmp[(Math.min(H - 1, j + r + 1) * W + i) * 3 + ch]! - tmp[(Math.max(0, j - r) * W + i) * 3 + ch]!;
    }
  }
  return out;
}

/** Bilinear patch sample (colour detail relative to the globe); weight is 0 outside and fades near the edges. */
function samplePatch(lat: number, lon: number, out: number[]): number {
  const P = patch;
  if (!P || !P.ready) return 0;
  const fx = (lon - PATCH.lon0) / (PATCH.lon1 - PATCH.lon0) * PATCH.w - 0.5;
  const fy = (PATCH.lat1 - lat) / (PATCH.lat1 - PATCH.lat0) * PATCH.h - 0.5;
  if (fx < 0 || fy < 0 || fx > PATCH.w - 1.001 || fy > PATCH.h - 1.001) return 0;
  const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0;
  const W = PATCH.w;
  const a = (j0 * W + i0) * 3, b = a + 3, c = a + W * 3, d = c + 3;
  const px = P.rgb;
  for (let ch = 0; ch < 3; ch++) {
    const top = px[a + ch]! + (px[b + ch]! - px[a + ch]!) * tx;
    const bot = px[c + ch]! + (px[d + ch]! - px[c + ch]!) * tx;
    out[ch] = top + (bot - top) * ty;
  }
  out[3] = P.ocean[j0 * W + i0]!;
  const edge = Math.min(fx, fy, PATCH.w - 1 - fx, PATCH.h - 1 - fy);
  return smooth(0, 24, edge);
}

// ───────────────────────── micro detail ─────────────────────────

const DN = 256;
let detail: Float32Array | null = null;
function detailNoise(): Float32Array {
  if (detail) return detail;
  const d = new Float32Array(DN * DN);
  let s = 4_242_421;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  // Sum of a few octaves of tileable value noise.
  const oct = (cells: number, amp: number) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    for (let y = 0; y < DN; y++) for (let x = 0; x < DN; x++) {
      const fx = (x / DN) * cells, fy = (y / DN) * cells;
      const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[((j % cells) * cells) + (i % cells)]!;
      const v = lerp(lerp(at(i0, j0), at(i0 + 1, j0), sx), lerp(at(i0, j0 + 1), at(i0 + 1, j0 + 1), sx), sy);
      d[y * DN + x]! += v * amp;
    }
  };
  oct(8, 0.5); oct(16, 0.25); oct(32, 0.15); oct(64, 0.1);
  detail = d;
  return d;
}
function dn(x: number, y: number): number {
  const d = detail!;
  let fx = x % DN; if (fx < 0) fx += DN;
  let fy = y % DN; if (fy < 0) fy += DN;
  const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0;
  const i1 = (i0 + 1) % DN, j1 = (j0 + 1) % DN;
  const a = d[j0 * DN + i0]!, b = d[j0 * DN + i1]!, c = d[j1 * DN + i0]!, e = d[j1 * DN + i1]!;
  return lerp(lerp(a, b, tx), lerp(c, e, tx), ty);
}

// ───────────────────────── render ─────────────────────────

const HS = 8_000; // scale height for haze, m
let buf: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData; w: number; h: number; key: string } | null = null;

function getBuf(w: number, h: number) {
  if (buf && buf.w === w && buf.h === h) return buf;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  buf = { canvas, ctx, img: ctx.createImageData(w, h), w, h, key: '' };
  return buf;
}

export interface HorizonCamera {
  /** Screen-space anchor for the vehicle base. */
  rocketX: number; rocketY: number;
  /** Screen-space y of the true horizon at the centre column. */
  horizonY: number;
  /** Pixels per metre at the vehicle (for scale). */
  camAlt: number;
}

/** Camera placement shared by the renderer and the overlays. */
export function horizonCamera(alt: number, w: number, h: number): HorizonCamera {
  const horizonY = h * lerp(0.6, 0.36, smooth(0, 55_000, alt));
  const rocketY = h * lerp(0.86, 0.6, smooth(0, 2_500, alt));
  return { rocketX: w * 0.5, rocketY, horizonY, camAlt: Math.max(0, alt) + 90 };
}

export function drawAscentHorizon(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: {
    w: number; h: number; tFlame?: number; wallT?: number;
    /** 0 = chase camera, 1 = orbital globe camera. */
    pull?: number;
    drawRocket?: (ctx: CanvasRenderingContext2D, baseX: number, baseY: number, horizonY: number) => void;
  },
) {
  const { w, h } = opts;
  const alt = Math.max(0, altitudeOf(s));
  const cam = horizonCamera(alt, w, h);
  const m = maps();
  stepRegionalTexture(alt < 60_000 ? 8 : 0);
  detailNoise();

  ctx.fillStyle = '#04060f';
  ctx.fillRect(0, 0, w, h);
  drawStars(ctx, w, h, 1);

  // Buffer matches the canvas aspect (no stretching on portrait phones).
  const bw = Math.round(clamp(w * 0.62, 240, 760));
  const bh = Math.max(120, Math.round(bw * h / w));
  const B = getBuf(bw, bh);
  const cloudRot = PLANET.omega * s.t * 0.12 + (opts.wallT ?? 0) * 0.012;
  const pull = clamp(opts.pull ?? 0);
  const key = `${(pull * 300) | 0}|${bw}x${bh}|${Math.round(alt / Math.max(15, alt * 0.0025))}|${Math.round(s.t * 4)}|${(cloudRot * 400) | 0}|${patch?.ready ? 1 : 0}|${Math.round(Math.atan2(s.y, s.x) * 2000)}|${m ? 1 : 0}`;
  if (B.key !== key) {
    renderHorizon(B.img, bw, bh, s, alt, cam, w, h, cloudRot, pull);
    B.ctx.putImageData(B.img, 0, 0);
    B.key = key;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(B.canvas, 0, 0, bw, bh, 0, 0, w, h);
  ctx.restore();

  if (alt < 2_400) drawPadComplex(ctx, cam, alt, w, h);
  const vis = 1 - smooth(0.25, 0.7, pull);
  if (vis > 0 && opts.drawRocket) {
    ctx.save();
    ctx.globalAlpha = vis;
    // Vehicle recedes as the camera pulls back.
    const sc = 1 - 0.6 * smooth(0, 0.7, pull);
    ctx.translate(cam.rocketX, cam.rocketY);
    ctx.scale(sc, sc);
    opts.drawRocket(ctx, 0, 0, cam.horizonY);
    ctx.restore();
  }
}

type V3 = [number, number, number];
interface Pose { C: V3; F: V3; Rt: V3; Up: V3; fl: number; cx: number; cy: number }
const nrm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Chase camera near the vehicle. */
function chasePose(s: FlightState, cam: HorizonCamera, w: number, h: number): Pose {
  const R = PLANET.radius;
  const r0 = Math.hypot(s.x, s.y) || 1;
  const U0: V3 = [s.x / r0, s.y / r0, 0];
  const E: V3 = [-U0[1], U0[0], 0];
  const camR = R + cam.camAlt;
  const aspect = w / h;
  let tanV = Math.tan((26 * Math.PI) / 180);
  if (aspect < 1.05) tanV = Math.tan((34 * Math.PI) / 180) / aspect;
  const dip = Math.acos(R / camR);
  const off = ((h / 2 - cam.horizonY) / (h / 2)) * tanV;
  const pitch = -dip - Math.atan(off);
  const yaw = 0.42;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const F: V3 = nrm([cp * cy * E[0] + sp * U0[0], cp * cy * E[1] + sp * U0[1], cp * sy]);
  const Rt = nrm(crs(F, U0));
  const Up = crs(Rt, F);
  return { C: [U0[0] * camR, U0[1] * camR, 0], F, Rt, Up, fl: (h / 2) / tanV, cx: w / 2, cy: h / 2 };
}

/** Exactly the orbital globe view's camera (see drawSpaceGlobe). */
function globePose(s: FlightState, w: number, h: number): Pose {
  const el = orbitalElements(s.x, s.y, s.vx, s.vy);
  const maxR = PLANET.radius + Math.max(200_000, el.apAltitude === Infinity ? 200_000 : Math.min(Number.isFinite(el.apAltitude) ? el.apAltitude + 50_000 : 200_000, 900_000));
  const camEl = 0.42, camAz = Math.atan2(s.y, s.x) - 0.62;
  const dist = maxR * 3.35;
  const C: V3 = [Math.cos(camEl) * Math.cos(camAz) * dist, Math.cos(camEl) * Math.sin(camAz) * dist, Math.sin(camEl) * dist];
  const F = nrm([-C[0], -C[1], -C[2]]);
  let Rt = nrm([-Math.sin(camAz), Math.cos(camAz), 0]);
  const Up = nrm(crs(F, Rt));
  Rt = nrm(crs(Up, F));
  return { C, F, Rt, Up, fl: Math.min(w, h) * 0.78, cx: w * 0.5, cy: h * 0.52 };
}

function blendPose(a: Pose, b: Pose, k: number): Pose {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const ra = Math.hypot(...a.C), rb = Math.hypot(...b.C);
  const r = Math.exp(lerp(Math.log(ra), Math.log(rb), k));
  const dir = nrm(mix3(nrm(a.C), nrm(b.C), k));
  // Aim: keep looking where the chase camera looked, then swing toward the planet centre.
  const F = nrm(mix3(a.F, b.F, smooth(0, 0.8, k)));
  const upHint = nrm(mix3(a.Up, b.Up, k));
  const Rt = nrm(crs(F, upHint));
  const Up = crs(Rt, F);
  return {
    C: [dir[0] * r, dir[1] * r, dir[2] * r], F, Rt, Up,
    fl: Math.exp(lerp(Math.log(a.fl), Math.log(b.fl), k)), cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k),
  };
}

function renderHorizon(img: ImageData, bw: number, bh: number, s: FlightState, alt: number, cam: HorizonCamera, w: number, h: number, cloudRot: number, pull: number) {
  const out = img.data;
  const R = PLANET.radius;
  const M = maps();
  const pose = blendPose(chasePose(s, cam, w, h), pull > 0 ? globePose(s, w, h) : chasePose(s, cam, w, h), pull);
  const [Cx, Cy, Cz] = pose.C;
  const [Fx, Fy, Fz] = pose.F;
  const [Rx, Ry, Rz] = pose.Rt;
  const [Ux, Uy, Uz] = pose.Up;
  const C2 = Cx * Cx + Cy * Cy + Cz * Cz;
  const camAltNow = Math.sqrt(C2) - R;
  const ux = Cx / Math.sqrt(C2), uy = Cy / Math.sqrt(C2), uz = Cz / Math.sqrt(C2);
  const sxk = w / bw, syk = h / bh;
  const [sX, sY, sZ] = SUN;
  const omegaT = PLANET.omega * s.t;
  const pixAng = sxk / pose.fl;
  const colAtmo = 1 - Math.exp(-camAltNow / HS); // fraction of the air column below the camera
  const G = Math.sqrt((2 * Math.PI * R) / HS);    // grazing path factor
  const tmp = [0, 0, 0, 0];

  for (let j = 0; j < bh; j++) {
    const yc = -((j + 0.5) * syk - pose.cy) / pose.fl;
    for (let i = 0; i < bw; i++) {
      const xc = ((i + 0.5) * sxk - pose.cx) / pose.fl;
      let dx = Fx + Rx * xc + Ux * yc;
      let dy = Fy + Ry * xc + Uy * yc;
      let dz = Fz + Rz * xc + Uz * yc;
      const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
      const b = Cx * dx + Cy * dy + Cz * dz;
      const disc = b * b - (C2 - R * R);
      const o = (j * bw + i) * 4;
      const sunCos = dx * sX + dy * sY + dz * sZ;
      if (disc > 0 && -b - Math.sqrt(disc) > 0) {
        // ── Ground ──
        const t = -b - Math.sqrt(disc);
        const hx = Cx + dx * t, hy = Cy + dy * t, hz = Cz + dz * t;
        const nx = hx / R, ny = hy / R, nz = hz / R;
        const lat = Math.asin(clamp(nz, -1, 1));
        let lon = Math.atan2(ny, nx) - omegaT;
        lon = ((lon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        const u = lon / (2 * Math.PI) + 0.5, v = 0.5 - lat / Math.PI;
        let r = 40, g = 90, bl = 50, isOcean = 0;
        const foot = t * pixAng / Math.max(0.05, -(dx * nx + dy * ny + dz * nz));
        if (M) {
          const [gr, gg, gb] = sample(M.surfacePx, u, v, TW, TH);
          // Regional texture only where it adds detail (near the camera).
          const wP = samplePatch(lat, lon, tmp) * (1 - smooth(3_000, 12_000, foot));
          r = gr + tmp[0]! * wP; g = gg + tmp[1]! * wP; bl = gb + tmp[2]! * wP;
          if (wP > 0.5) isOcean = tmp[3]!;
          else { let uu = u % 1; if (uu < 0) uu += 1; isOcean = M.ocean[((clamp(v, 0, 0.9999) * TH) | 0) * TW + ((uu * TW) | 0)]!; }
        }
        // Micro detail fades in where a pixel covers less ground than the noise cell.
        const xm = lon * R, ym = lat * R;
        const a1 = 1 - smooth(1_500, 6_000, foot), a2 = 1 - smooth(120, 900, foot), a3 = 1 - smooth(25, 160, foot);
        if (a1 > 0) {
          const n1 = dn(xm / 2_600, ym / 2_600) - 0.5, n2 = a2 > 0 ? dn(xm / 380 + 91, ym / 380 + 37) - 0.5 : 0;
          const k = 1 + (isOcean ? 0.3 : 1) * (n1 * 0.7 * a1 + n2 * 0.55 * a2);
          r *= k; g *= k; bl *= k;
          if (!isOcean) {
            // Biome-aware variation: drier patches go tan, wetter go deep green.
            const n3 = dn(xm / 1_100 + 13, ym / 1_100 + 71) - 0.5;
            r += n3 * 46 * a1; g += n3 * 22 * a1; bl -= n3 * 10 * a1;
            const veg = g > r * 1.05 && g > bl;
            if (veg && a2 > 0) {
              // Field patchwork with a little domain warp, and darker woodland clumps.
              const wx = xm + (dn(xm / 700, ym / 700 + 5) - 0.5) * 260, wy = ym + (dn(xm / 700 + 9, ym / 700) - 0.5) * 260;
              const fi = Math.floor(wx / 340), fj = Math.floor(wy / 230);
              const hsh = Math.sin(fi * 127.1 + fj * 311.7) * 43758.5453;
              const f = hsh - Math.floor(hsh);
              const fa = a2 * (f < 0.25 ? 0.9 : f < 0.5 ? 0.55 : 0.25);
              if (f < 0.25) { r += 34 * fa; g += 22 * fa; bl -= 4 * fa; }       // ripe / dry field
              else if (f < 0.5) { r -= 10 * fa; g += 14 * fa; }                 // young crop
              else if (f < 0.62) { r += 22 * fa; g += 6 * fa; bl += 2 * fa; }   // fallow
              const wood = dn(xm / 520 + 51, ym / 520 + 3);
              if (wood > 0.56) { const kW = smooth(0.56, 0.62, wood) * a2; r *= 1 - 0.38 * kW; g *= 1 - 0.22 * kW; bl *= 1 - 0.35 * kW; }
              // Field edges / tracks when close.
              if (a3 > 0) {
                const ex = Math.abs(wx / 340 - fi - 0.5), ey = Math.abs(wy / 230 - fj - 0.5);
                if (Math.max(ex, ey) > 0.47) { r = lerp(r, 150, 0.35 * a3); g = lerp(g, 140, 0.35 * a3); bl = lerp(bl, 110, 0.35 * a3); }
              }
            }
          }
        }
        // Lighting (matches the globe).
        const ndotl = nx * sX + ny * sY + nz * sZ;
        const day = smooth(-0.08, 0.16, ndotl);
        const lam = 0.14 + 0.92 * Math.max(0, ndotl);
        let cA = 0;
        if (M) cA = (sample(M.cloudPx, u + cloudRot / (2 * Math.PI), v, TW, TH)[3] / 255) * smooth(0, 900, camAltNow) * 0.85;
        const shade = 1 - cA * 0.4 * day;
        r *= shade * lerp(0.07, lam, day); g *= shade * lerp(0.08, lam, day); bl *= shade * lerp(0.14, lam, day);
        if (isOcean && ndotl > 0) {
          const two = 2 * ndotl;
          const rdv = -((two * nx - sX) * dx + (two * ny - sY) * dy + (two * nz - sZ) * dz);
          if (rdv > 0) { const sp2 = Math.pow(rdv, 60) * 1.2 + Math.pow(rdv, 8) * 0.12; r += 255 * sp2; g += 240 * sp2; bl += 215 * sp2; }
        }
        if (cA > 0.02) {
          const cl = 0.15 + 0.95 * Math.max(0, ndotl);
          const kc = cA * (day * 0.92 + 0.08);
          r = r * (1 - kc) + 238 * cl * kc; g = g * (1 - kc) + 240 * cl * kc; bl = bl * (1 - kc) + 246 * cl * kc;
        }
        // Aerial perspective toward the limb colour of the same air.
        const sinT = Math.max(0.012, -(dx * nx + dy * ny + dz * nz));
        const tau = Math.max((0.1 / sinT) * colAtmo, 2.6e-5 * Math.min(t, 300_000) * Math.exp(-camAltNow / (2 * HS)));
        const haze = 1 - Math.exp(-tau);
        const [lr, lg, lb] = limbColor(ndotl);
        r = r + (lr - r) * haze; g = g + (lg - g) * haze; bl = bl + (lb - bl) * haze;
        out[o] = clamp(r, 0, 255); out[o + 1] = clamp(g, 0, 255); out[o + 2] = clamp(bl, 0, 255); out[o + 3] = 255;
      } else {
        // ── Sky / limb ──
        const tStar = -b;
        let hmin: number, tau: number, px: number, py: number, pz: number;
        if (tStar <= 0) {
          hmin = camAltNow; px = Cx; py = Cy; pz = Cz;
          const sinE = Math.max(1 / G, dx * ux + dy * uy + dz * uz);
          tau = 1.05 * Math.exp(-camAltNow / HS) / sinE;
        } else {
          px = Cx + dx * tStar; py = Cy + dy * tStar; pz = Cz + dz * tStar;
          hmin = Math.max(0, Math.hypot(px, py, pz) - R);
          // Path below the camera is long (grazing); above it, only the far half counts.
          tau = 1.05 * G * Math.exp(-hmin / HS) * (0.5 + 0.5 * smooth(0, HS * 2, camAltNow - hmin + HS));
        }
        const pl = Math.hypot(px, py, pz) || 1;
        const dS = (px * sX + py * sY + pz * sZ) / pl;
        const alpha = 1 - Math.exp(-tau);
        const bright = lerp(0.04, 1, smooth(-0.18, 0.22, dS));
        const white = smooth(2.5, 24, tau);
        let r = lerp(58, 182, white), g = lerp(118, 210, white), bl = lerp(214, 242, white);
        const warm = smooth(0.32, 0.02, dS) * smooth(-0.2, 0.02, dS) * smooth(0.5, 6, tau);
        r = lerp(r, 255, warm * 0.75); g = lerp(g, 150, warm * 0.6); bl = lerp(bl, 96, warm * 0.7);
        r *= bright; g *= bright; bl *= bright;
        let a = alpha;
        // Sun: glare scattered by the air, and a disc in vacuum or air.
        if (sunCos > 0.9) {
          const glare = Math.pow(sunCos, 120) * (0.35 + alpha * 0.9) + Math.pow(sunCos, 4000) * 3;
          r += 255 * glare; g += 245 * glare; bl += 220 * glare; a = Math.min(1, a + glare);
        }
        if (a <= 0.003) { out[o + 3] = 0; continue; }
        // Store un-premultiplied colour scaled so dark sky still hides stars at low altitude.
        out[o] = clamp(r, 0, 255); out[o + 1] = clamp(g, 0, 255); out[o + 2] = clamp(bl, 0, 255);
        out[o + 3] = clamp(a * 255, 0, 255);
      }
    }
  }
}

function limbColor(ndotl: number): [number, number, number] {
  const bright = lerp(0.05, 1, smooth(-0.18, 0.22, ndotl));
  const warm = smooth(0.32, 0.02, ndotl) * smooth(-0.2, 0.02, ndotl);
  return [lerp(176, 250, warm * 0.7) * bright, lerp(204, 160, warm * 0.6) * bright, lerp(236, 110, warm * 0.7) * bright];
}

/** Launch complex near the pad: hard stand, flame trench, lattice tower and lightning masts. */
function drawPadComplex(ctx: CanvasRenderingContext2D, cam: HorizonCamera, alt: number, w: number, h: number) {
  const fade = 1 - smooth(900, 2_400, alt);
  if (fade <= 0) return;
  const sc = (Math.min(w, h * 1.3) / 900) / (1 + alt / 260);
  const baseX = cam.rocketX;
  const baseY = h * 0.86 + (alt / 900) * h * 0.55;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(baseX, baseY);
  ctx.scale(sc, sc);
  // Hard stand (perspective trapezoid) with soft shadow.
  const sh = ctx.createRadialGradient(0, 8, 10, 0, 8, 260);
  sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh; ctx.fillRect(-280, -40, 560, 120);
  const pad = ctx.createLinearGradient(0, -8, 0, 40);
  pad.addColorStop(0, '#b9b6ac'); pad.addColorStop(1, '#8a877e');
  ctx.fillStyle = pad;
  ctx.beginPath(); ctx.moveTo(-150, -6); ctx.lineTo(150, -6); ctx.lineTo(230, 34); ctx.lineTo(-230, 34); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(60,60,55,0.35)'; ctx.lineWidth = 1.2;
  for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(k * 46, -6); ctx.lineTo(k * 70, 34); ctx.stroke(); }
  // Flame trench.
  ctx.fillStyle = '#2a2724';
  ctx.beginPath(); ctx.moveTo(-26, -2); ctx.lineTo(26, -2); ctx.lineTo(40, 30); ctx.lineTo(-40, 30); ctx.closePath(); ctx.fill();
  // Mount plinth.
  ctx.fillStyle = '#6d6a64'; ctx.fillRect(-46, -16, 92, 12);
  ctx.fillStyle = '#55524d'; ctx.fillRect(-46, -6, 92, 3);
  // Lattice tower (left of the vehicle, out of the plume path).
  const tx = -112, top = -460;
  ctx.fillStyle = '#7e2a1e'; ctx.fillRect(tx - 16, top, 32, -top - 10);
  ctx.strokeStyle = '#c0442c'; ctx.lineWidth = 3;
  ctx.strokeRect(tx - 16, top, 32, -top - 10);
  ctx.lineWidth = 1.6;
  for (let y = top; y < -14; y += 26) {
    ctx.beginPath(); ctx.moveTo(tx - 16, y); ctx.lineTo(tx + 16, y + 26); ctx.moveTo(tx + 16, y); ctx.lineTo(tx - 16, y + 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx - 16, y); ctx.lineTo(tx + 16, y); ctx.stroke();
  }
  // Service arms.
  ctx.fillStyle = '#9a9a96';
  for (const y of [top + 70, top + 180, top + 300]) ctx.fillRect(tx + 16, y, 70, 7);
  ctx.fillStyle = '#d8b030'; ctx.fillRect(tx - 18, top - 10, 36, 10);
  // Lightning masts.
  ctx.strokeStyle = '#8b8e94'; ctx.lineWidth = 3;
  for (const x of [-210, 205]) { ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, -380); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(140,145,150,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-210, -380); ctx.quadraticCurveTo(0, -300, 205, -380); ctx.stroke();
  // Water tower.
  ctx.fillStyle = '#c8ccd0';
  ctx.beginPath(); ctx.ellipse(250, -160, 34, 26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 3;
  for (const x of [228, 272]) { ctx.beginPath(); ctx.moveTo(x, -140); ctx.lineTo(x + (x < 250 ? -8 : 8), 30); ctx.stroke(); }
  ctx.restore();
}
