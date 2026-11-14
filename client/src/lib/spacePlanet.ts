/**
 * Cached, procedurally generated planet for Mission Control.
 *
 * One equirectangular surface (continents, biomes, oceans, ice, mountains), a
 * cloud layer and a night-lights map are built once, then a lit globe is
 * re-projected only when the camera or rotation moves enough to notice.
 * Physics are untouched; this is display only. The 6-hour sidereal day drives
 * planet rotation: λ = atan2(y, x) − ω t.
 */
import { PLANET, orbitalElements, orbitPoints, altitudeOf, fmtAlt, type FlightState } from '../../../shared/spaceFlight';
import { clamp, lerp, smooth, perlin3, fbm, terrainAt, biomeFromTerrain, oreAt, type BiomeId } from '../../../shared/spaceTerrain';

export const TW = 1536;
export const TH = 768;
const GLOBE_HI = 560;
const GLOBE_LO = 384;

// Inertial sun: at T=0 the launch site (R, 0) is just after local noon.
export const SUN = norm(1, 0.12, 0.28);

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
export function planetLon(x: number, y: number, t: number): number {
  return Math.atan2(y, x) - PLANET.omega * t;
}

interface PlanetAssets {
  surface: HTMLCanvasElement; // RGB albedo
  clouds: HTMLCanvasElement;
  lights: HTMLCanvasElement;
  ocean: Uint8Array; // 1 = ocean
  elev: Float32Array;
  moist: Float32Array;
  stars: HTMLCanvasElement;
}
let assets: PlanetAssets | null = null;
let generating = false;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    // Node / tests: a stub with getContext that returns null — callers must guard.
    return { width: w, height: h, getContext: () => null } as unknown as HTMLCanvasElement;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rgb(r: number, g: number, b: number): [number, number, number] {
  return [clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0];
}

/** Fine colour variation inside a biome (planet-fixed, seamless). */
export function landVary(lat: number, lon: number): number {
  const cl = Math.cos(lat);
  const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = Math.sin(lat);
  return fbm(x * 7.5 + 31, y * 7.5 - 5, z * 7.5 + 17, 3) * 1.6;
}

/**
 * Surface colour. Continuous blends (no hard latitude or moisture cut-offs) so
 * biome borders read as natural transitions at every zoom; the dominant colour
 * still matches `biomeFromTerrain`.
 */
export function biome(elev: number, lat: number, moist: number, slope: number, vary = 0): [number, number, number] {
  const absLat = Math.abs(lat) * 180 / Math.PI;
  if (elev <= 0) {
    // Ocean: depth from elev (more negative = deeper).
    const d = clamp(-elev / 0.55);
    const shallow = rgb(28, 118, 138);
    const mid = rgb(12, 62, 108);
    const deep = rgb(4, 22, 56);
    const trench = rgb(2, 10, 32);
    const t = d;
    return t < 0.35 ? lerpC(shallow, mid, t / 0.35) : t < 0.7 ? lerpC(mid, deep, (t - 0.35) / 0.35) : lerpC(deep, trench, (t - 0.7) / 0.3);
  }
  const midl = smooth(12, 22, absLat) * smooth(52, 42, absLat);
  // Grass / prairie base.
  let c = lerpC(rgb(62, 122, 52), rgb(112, 136, 60), clamp(0.55 - moist + vary * 0.12));
  // Forest where it is wet.
  const forest = lerpC(rgb(30, 88, 40), rgb(24, 64, 40), clamp(midl * 0.6 + (elev - 0.3) * 0.8));
  c = lerpC(c, forest, smooth(0.41, 0.49, moist + vary * 0.03));
  // Tropics (same warped edge as biomeFromTerrain), feathered.
  const trop = smooth(18, 8, absLat - (moist - 0.5) * 30 - elev * 10 + vary * 7);
  const jungle = lerpC(rgb(36, 118, 50), rgb(20, 86, 40), clamp(moist + vary * 0.25));
  c = lerpC(c, jungle, smooth(0.2, 0.6, trop) * smooth(0.36, 0.44, moist) * 0.9);
  // Tundra toward the poles.
  c = lerpC(c, rgb(132, 140, 108), smooth(50, 62, absLat) * 0.85);
  // Highland plateaus turn olive / brown.
  c = lerpC(c, rgb(104, 108, 70), smooth(0.6, 1.1, elev) * 0.35 * (0.7 + 0.3 * vary));
  // Deserts.
  const dryT = 0.32 + 0.12 * smooth(15, 20, absLat) * smooth(39, 34, absLat);
  const wDry = smooth(dryT + 0.035, dryT - 0.035, moist) * smooth(50, 46, absLat) * smooth(0.45, 0.39, elev);
  c = lerpC(c, lerpC(rgb(198, 166, 94), rgb(168, 110, 62), clamp(elev * 1.4 + vary * 0.2)), wDry);
  // Bare rock on steep high ground.
  c = lerpC(c, lerpC(rgb(98, 96, 92), rgb(72, 70, 68), clamp(slope)), smooth(0.38, 0.52, slope) * smooth(0.24, 0.3, elev));
  // Beaches.
  c = lerpC(c, rgb(194, 178, 122), smooth(0.045, 0.02, elev));
  // Snow: polar caps and high peaks, feathered.
  const snowLine = 0.55 + 0.35 * (1 - absLat / 90);
  const polar = smooth(-2.5, 2.5, absLat - (62 + moist * 6 + elev * 8) + vary * 3);
  const alpine = smooth(snowLine - 0.03, snowLine + 0.06, elev) * smooth(-4, 4, absLat - 28 + (elev - snowLine) * 25 + vary * 6);
  const k = 228 + (elev * 20) | 0;
  c = lerpC(c, rgb(k, k + 4, k + 10), Math.max(polar, alpine));
  // Small tonal variation.
  const m = 1 + vary * 0.09;
  return rgb(c[0] * m, c[1] * m, c[2] * m);
}

function lerpC(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = clamp(t);
  return rgb(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
}

function buildTextures(): PlanetAssets | null {
  if (typeof document === 'undefined') return null;
  const surface = makeCanvas(TW, TH);
  const clouds = makeCanvas(TW, TH);
  const lights = makeCanvas(TW, TH);
  const sctx = surface.getContext('2d', { willReadFrequently: true });
  const cctx = clouds.getContext('2d');
  const lctx = lights.getContext('2d');
  if (!sctx || !cctx || !lctx) return null;
  const sImg = sctx.createImageData(TW, TH);
  const cImg = cctx.createImageData(TW, TH);
  const lImg = lctx.createImageData(TW, TH);
  const sd = sImg.data, cd = cImg.data, ld = lImg.data;
  const ocean = new Uint8Array(TW * TH);
  const elev = new Float32Array(TW * TH);
  const moistA = new Float32Array(TW * TH);

  for (let j = 0; j < TH; j++) {
    const lat = (0.5 - (j + 0.5) / TH) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < TW; i++) {
      const lon = ((i + 0.5) / TW) * 2 * Math.PI - Math.PI;
      const x = cl * Math.cos(lon), y = cl * Math.sin(lon), z = sl;
      void x; void y; void z;
      const { elev: e, moist: m } = terrainAt(lat, lon);
      const idx = j * TW + i;
      elev[idx] = e;
      moistA[idx] = m;
      ocean[idx] = e <= 0 ? 1 : 0;
    }
  }
  // Color pass with slope from elevation neighbours (baked relief).
  for (let j = 0; j < TH; j++) {
    const lat = (0.5 - (j + 0.5) / TH) * Math.PI;
    for (let i = 0; i < TW; i++) {
      const idx = j * TW + i;
      const e = elev[idx]!;
      const eR = elev[j * TW + ((i + 1) % TW)]!;
      const eD = elev[Math.min(TH - 1, j + 1) * TW + i]!;
      const slope = Math.hypot(eR - e, eD - e) * 9;
      // Relief: light from the northwest.
      const shade = clamp(0.78 + (e - eR) * 2.4 + (e - (elev[Math.max(0, j - 1) * TW + i] ?? e)) * 1.6, 0.55, 1.18);
      let [r, g, b] = biome(e, lat, moistA[idx]!, slope, landVary(lat, ((i + 0.5) / TW) * 2 * Math.PI - Math.PI));
      // Slight colour noise so large biomes aren't flat.
      const jitter = perlin3(i * 0.08, j * 0.08, 4) * 8;
      r = clamp(r * shade + jitter, 0, 255) | 0;
      g = clamp(g * shade + jitter * 0.7, 0, 255) | 0;
      b = clamp(b * shade + jitter * 0.4, 0, 255) | 0;
      const o = idx * 4;
      sd[o] = r; sd[o + 1] = g; sd[o + 2] = b; sd[o + 3] = 255;

      // Clouds: banded fbm, denser in mid-lat tropics, thinner at poles.
      const cl = Math.cos(lat);
      const cx = cl * Math.cos(((i + 0.5) / TW) * 2 * Math.PI);
      const cy = cl * Math.sin(((i + 0.5) / TW) * 2 * Math.PI);
      const cz = Math.sin(lat);
      const c1 = fbm(cx * 2.8 + 3, cy * 2.8, cz * 2.8, 6, 2.1, 0.52);
      const c2 = fbm(cx * 5.5 - 4, cy * 5.5, cz * 5.5, 4);
      const band = 0.55 + 0.45 * Math.cos(lat * 2.2);
      const cover = smooth(0.08, 0.42, c1 * 0.75 + c2 * 0.25 + 0.12 * band);
      const alpha = Math.pow(cover, 1.15) * (0.35 + 0.65 * cover) * (0.55 + 0.45 * band);
      const cw = 230 + (c2 * 20) | 0;
      cd[o] = cw; cd[o + 1] = cw + 2; cd[o + 2] = cw + 6; cd[o + 3] = clamp(alpha * 255, 0, 210) | 0;

      // City lights: coasts and a few inland clusters, not on ice or high mountains.
      let light = 0;
      if (e > 0.01 && e < 0.42 && Math.abs(lat) * 180 / Math.PI < 64) {
        let nearCoast = e < 0.08;
        if (!nearCoast) {
          for (let k = 1; k <= 4 && !nearCoast; k++) {
            if (ocean[j * TW + ((i + k) % TW)] || ocean[j * TW + ((i - k + TW) % TW)]) nearCoast = true;
            const jj = clamp(j + k, 0, TH - 1) | 0;
            if (ocean[jj * TW + i]) nearCoast = true;
          }
        }
        const city = fbm(cx * 18 + 9, cy * 18, cz * 18, 4);
        const cluster = fbm(cx * 7 - 2, cy * 7, cz * 7, 3);
        if ((nearCoast && city > 0.28 && cluster > 0.08) || (city > 0.46 && cluster > 0.22)) {
          light = clamp((city - 0.2) * 1.6) * (nearCoast ? 1 : 0.75);
        }
      }
      // Warm sodium / cool white mix.
      ld[o] = 255; ld[o + 1] = 200; ld[o + 2] = 120; ld[o + 3] = clamp(light * 255, 0, 230) | 0;
    }
  }
  sctx.putImageData(sImg, 0, 0);
  cctx.putImageData(cImg, 0, 0);
  lctx.putImageData(lImg, 0, 0);

  // Stars (cached, large).
  const stars = buildStarfield(2048, 1152);
  return { surface, clouds, lights, ocean, elev, moist: moistA, stars };
}

/**
 * Starfield with a soft, irregular Milky Way: a Gaussian band of faint dust and
 * dense small stars (no hard-edged gradient strip).
 */
function buildStarfield(W: number, H: number): HTMLCanvasElement {
  const c = makeCanvas(W, H);
  const st = c.getContext('2d');
  if (!st) return c;
  st.fillStyle = '#04060f';
  st.fillRect(0, 0, W, H);
  let seed = 91_117;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  // Milky Way: computed per pixel at low resolution (Gaussian band x fbm, with
  // dark dust lanes), then upscaled smoothly so it has no hard edges or blocks.
  const bw = 384, bh = Math.round((384 * H) / W);
  const band = makeCanvas(bw, bh);
  const bc = band.getContext('2d');
  const ang = -0.32, ca = Math.cos(ang), sa = Math.sin(ang);
  if (bc) {
    const img = bc.createImageData(bw, bh);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const x = (i / bw - 0.5) * (W / H), y = j / bh - 0.5;
      const along = x * ca + y * sa, across = -x * sa + y * ca;
      const wob = 0.035 * Math.sin(along * 7.1) + 0.015 * Math.sin(along * 19.3);
      const d = (across - wob) / 0.095;
      const prof = Math.exp(-d * d * 0.5);
      if (prof < 0.004) continue;
      const n = fbm(along * 6, across * 6, 3.7, 5) * 0.5 + 0.5;
      const lane = smooth(0.35, 0.9, Math.abs(d + 0.25 * fbm(along * 9, 1.3, across * 9, 3))) * 0.6 + 0.4;
      const v = prof * clamp(n * 1.25 - 0.15) * lane;
      const o = (j * bw + i) * 4;
      const warm = clamp(0.5 + fbm(along * 3, across * 3, 9.1, 3));
      img.data[o] = 175 + 45 * warm; img.data[o + 1] = 185 + 25 * warm; img.data[o + 2] = 235 - 20 * warm;
      img.data[o + 3] = clamp(v * 0.42) * 255;
    }
    bc.putImageData(img, 0, 0);
    st.save();
    st.imageSmoothingEnabled = true;
    st.imageSmoothingQuality = 'high';
    st.drawImage(band, 0, 0, W, H);
    st.restore();
  }
  const bandAt = (x: number, y: number) => {
    const xx = (x / W - 0.5) * (W / H), yy = y / H - 0.5;
    const across = -xx * sa + yy * ca;
    return Math.exp(-((across / 0.1) ** 2) * 0.5);
  };
  const dot = (x: number, y: number, r: number, col: string) => { st.fillStyle = col; st.beginPath(); st.arc(x, y, r, 0, Math.PI * 2); st.fill(); };
  // Dense faint stars concentrated in the band, a sparse field elsewhere.
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * W, y = rnd() * H;
    if (rnd() > bandAt(x, y) * 0.9 + 0.1) continue;
    dot(x, y, 0.4 + rnd() * 0.4, `rgba(225,232,255,${0.15 + rnd() * 0.4})`);
  }
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * W, y = rnd() * H, a = 0.2 + rnd() * 0.8;
    const big = rnd() > 0.975;
    const r = big ? 1.1 + rnd() * 0.8 : 0.45 + rnd() * 0.6;
    const k = rnd();
    const col = k > 0.85 ? `rgba(175,205,255,${a})` : k > 0.72 ? `rgba(255,228,195,${a})` : `rgba(242,246,255,${a})`;
    if (big) {
      const g = st.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(200,220,255,0)');
      st.fillStyle = g; st.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
    }
    dot(x, y, r, col);
  }
  return c;
}

export function ensurePlanetAssets(): PlanetAssets | null {
  if (assets) return assets;
  if (generating) return null;
  generating = true;
  try { assets = buildTextures(); }
  finally { generating = false; }
  return assets;
}

/** Packed RGBA of a canvas, cached. */
function pixelsOf(c: HTMLCanvasElement): Uint8ClampedArray | null {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  return ctx.getImageData(0, 0, c.width, c.height).data;
}
let surfacePx: Uint8ClampedArray | null = null;
let cloudPx: Uint8ClampedArray | null = null;
let lightPx: Uint8ClampedArray | null = null;
export function maps() {
  const a = ensurePlanetAssets();
  if (!a) return null;
  if (!surfacePx) surfacePx = pixelsOf(a.surface);
  if (!cloudPx) cloudPx = pixelsOf(a.clouds);
  if (!lightPx) lightPx = pixelsOf(a.lights);
  if (!surfacePx || !cloudPx || !lightPx) return null;
  return { a, surfacePx, cloudPx, lightPx, ocean: a.ocean };
}

interface GlobeCache { canvas: HTMLCanvasElement; key: string; size: number }
let globeCache: GlobeCache | null = null;

export function sample(px: Uint8ClampedArray, u: number, v: number, w: number, h: number): [number, number, number, number] {
  let x = u % 1; if (x < 0) x += 1;
  const y = clamp(v, 0, 0.99999);
  const fx = x * w, fy = y * (h - 1);
  const i0 = Math.floor(fx) % w, i1 = (i0 + 1) % w;
  const j0 = Math.floor(fy), j1 = Math.min(h - 1, j0 + 1);
  const tx = fx - Math.floor(fx), ty = fy - j0;
  const at = (i: number, j: number) => {
    const o = (j * w + i) * 4;
    return [px[o]!, px[o + 1]!, px[o + 2]!, px[o + 3]!] as [number, number, number, number];
  };
  const a = at(i0, j0), b = at(i1, j0), c = at(i0, j1), d = at(i1, j1);
  const L = (p: number, q: number, r: number, s: number) => p + (q - p) * tx + (r - p) * ty + (p - q - r + s) * tx * ty;
  return [L(a[0], b[0], c[0], d[0]), L(a[1], b[1], c[1], d[1]), L(a[2], b[2], c[2], d[2]), L(a[3], b[3], c[3], d[3])];
}

function renderGlobe(size: number, planetRot: number, cloudRot: number, camAz: number, camEl: number): HTMLCanvasElement | null {
  const m = maps();
  if (!m) return null;
  const key = `${size}|${(planetRot * 80) | 0}|${(cloudRot * 60) | 0}|${(camAz * 40) | 0}|${(camEl * 80) | 0}`;
  if (globeCache && globeCache.key === key && globeCache.size === size) return globeCache.canvas;
  const canvas = (globeCache && globeCache.size === size) ? globeCache.canvas : makeCanvas(size, size);
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  const out = img.data;
  const { surfacePx: sp, cloudPx: cp, lightPx: lp, ocean } = m;

  const el = camEl, az = camAz;
  const cosE = Math.cos(el), sinE = Math.sin(el);
  const cosA = Math.cos(az), sinA = Math.sin(az);
  // Camera on a sphere looking at the origin: eye = (cosE cosA, cosE sinA, sinE)
  const eyeX = cosE * cosA, eyeY = cosE * sinA, eyeZ = sinE;
  // camZ (toward camera / visible hemisphere centre)
  const zX = eyeX, zY = eyeY, zZ = eyeZ;
  // right = normalize(upHint × camZ), upHint = (0,0,1) unless near poles
  let xX = -sinA, xY = cosA, xZ = 0; // upHint × eye, already unit when el is modest
  const xLen = Math.hypot(xX, xY, xZ) || 1;
  xX /= xLen; xY /= xLen; xZ /= xLen;
  // up = camZ × right
  const yX = zY * xZ - zZ * xY, yY = zZ * xX - zX * xZ, yZ = zX * xY - zY * xX;

  const [sX, sY, sZ] = SUN;
  const viewX = eyeX, viewY = eyeY, viewZ = eyeZ;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = ((px + 0.5) / size) * 2 - 1;
      const ny = 1 - ((py + 0.5) / size) * 2;
      const r2 = nx * nx + ny * ny;
      const o = (py * size + px) * 4;
      if (r2 > 1) { out[o + 3] = 0; continue; }
      const nz = Math.sqrt(1 - r2);
      const wx = xX * nx + yX * ny + zX * nz;
      const wy = xY * nx + yY * ny + zY * nz;
      const wz = xZ * nx + yZ * ny + zZ * nz;
      const lat = Math.asin(clamp(wz, -1, 1));
      const lon = Math.atan2(wy, wx) - planetRot;
      const u = lon / (2 * Math.PI) + 0.5;
      const v = 0.5 - lat / Math.PI;
      const [sr, sg, sb] = sample(sp, u, v, TW, TH);
      let uu = u % 1; if (uu < 0) uu += 1;
      const ui = (uu * TW) | 0, vj = (clamp(v, 0, 0.9999) * TH) | 0;
      const isOcean = ocean[vj * TW + (ui % TW)] === 1;
      // Clouds (drifted).
      const [cr, cg, cb, ca] = sample(cp, u + cloudRot / (2 * Math.PI), v, TW, TH);
      const cloudA = ca / 255;
      // Lighting.
      const ndotl = wx * sX + wy * sY + wz * sZ;
      const day = smooth(-0.08, 0.16, ndotl);
      const night = 1 - day;
      // Cloud shadow on the ground.
      const shade = 1 - cloudA * 0.45 * day;
      let r = sr * shade, g = sg * shade, b = sb * shade;
      // Lambert + a little wrap, ambient on the night side (earthshine).
      const lambert = 0.12 + 0.95 * Math.max(0, ndotl);
      r *= lerp(0.07, lambert, day);
      g *= lerp(0.08, lambert, day);
      b *= lerp(0.14, lambert, day);
      // Specular sun glint on the ocean.
      if (isOcean && ndotl > 0) {
        // reflect sun about normal, dot with view
        const two = 2 * ndotl;
        const rx = two * wx - sX, ry = two * wy - sY, rz = two * wz - sZ;
        const rdotv = rx * viewX + ry * viewY + rz * viewZ;
        if (rdotv > 0) {
          const spec = Math.pow(rdotv, 48) * 1.35 * (1 - cloudA * 0.7);
          r += 255 * spec;
          g += 245 * spec;
          b += 220 * spec;
        }
        // A broader, weaker glint
        if (rdotv > 0) {
          const soft = Math.pow(rdotv, 8) * 0.18 * (1 - cloudA);
          r += 80 * soft; g += 130 * soft; b += 160 * soft;
        }
      }
      // Lit clouds over the surface.
      if (cloudA > 0.02) {
        const cLit = 0.15 + 0.95 * Math.max(0, ndotl);
        const k = cloudA * (day * 0.92 + 0.08);
        r = r * (1 - k) + cr * cLit * k;
        g = g * (1 - k) + cg * cLit * k;
        b = b * (1 - k) + cb * cLit * k;
      }
      // City lights on the night side (and twilight).
      if (night > 0.15 && !isOcean) {
        const [, , , la] = sample(lp, u, v, TW, TH);
        if (la > 4) {
          const glow = (la / 255) * night * night;
          r += 255 * glow;
          g += 190 * glow;
          b += 90 * glow;
        }
      }
      // Atmospheric limb (Fresnel): more blue at the edge, orange near the terminator.
      const fres = Math.pow(1 - nz, 2.15);
      if (fres > 0.02) {
        const term = smooth(0.15, -0.05, ndotl) * smooth(-0.25, 0.05, ndotl); // near terminator
        const dayEdge = clamp(ndotl * 2);
        const ar = lerp(70, 255, term) * 0.55 + 40 * dayEdge;
        const ag = lerp(130, 150, term) * 0.55 + 90 * dayEdge;
        const ab = lerp(220, 90, term) * 0.7 + 140 * dayEdge;
        const fk = fres * 0.72;
        r = r * (1 - fk) + ar * fk;
        g = g * (1 - fk) + ag * fk;
        b = b * (1 - fk) + ab * fk;
      }
      out[o] = clamp(r, 0, 255) | 0;
      out[o + 1] = clamp(g, 0, 255) | 0;
      out[o + 2] = clamp(b, 0, 255) | 0;
      out[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  globeCache = { canvas, key, size };
  return canvas;
}

export function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 1) {
  const a = ensurePlanetAssets();
  ctx.save();
  ctx.globalAlpha = alpha;
  if (a?.stars) {
    // Cover the viewport, a little parallax-free tile.
    const img = a.stars;
    const scale = Math.max(w / img.width, h / img.height);
    const iw = img.width * scale, ih = img.height * scale;
    ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = '#050814';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function drawAtmosphereHalo(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, sunX: number, sunY: number) {
  const atm = R * (PLANET.atmHeight / PLANET.radius) * 1.35; // slightly exaggerated so 70 km is visible
  // One continuous falloff from the limb outward (no dark gap between rings).
  const outer = R + atm * 1.6;
  const at = (r: number) => clamp(r / outer, 0, 1);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
  g.addColorStop(0, 'rgba(150,205,255,0)');
  g.addColorStop(at(R * 0.985), 'rgba(170,215,255,0.55)');
  g.addColorStop(at(R + atm * 0.12), 'rgba(185,222,255,0.6)');
  g.addColorStop(at(R + atm * 0.4), 'rgba(110,175,255,0.26)');
  g.addColorStop(at(R + atm * 0.9), 'rgba(70,130,230,0.07)');
  g.addColorStop(1, 'rgba(40,80,180,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();
  // Sunset wedge on the terminator side of the limb.
  const ang = Math.atan2(sunY - cy, sunX - cx);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  const sg = ctx.createRadialGradient(R, 0, 0, R, 0, atm * 2.4);
  sg.addColorStop(0, 'rgba(255,200,120,0.0)');
  sg.addColorStop(0.35, 'rgba(255,170,80,0.28)');
  sg.addColorStop(0.7, 'rgba(255,100,60,0.08)');
  sg.addColorStop(1, 'rgba(255,80,40,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(R, 0, atm * 2.4, 0, Math.PI * 2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fill();
  ctx.restore();
}

function project(wx: number, wy: number, wz: number, eye: [number, number, number], right: [number, number, number], up: [number, number, number], fwd: [number, number, number], fl: number, cx: number, cy: number): [number, number, number] | null {
  const dx = wx - eye[0], dy = wy - eye[1], dz = wz - eye[2];
  const zc = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
  if (zc <= 1) return null;
  const xc = dx * right[0] + dy * right[1] + dz * right[2];
  const yc = dx * up[0] + dy * up[1] + dz * up[2];
  return [cx + (xc / zc) * fl, cy - (yc / zc) * fl, zc];
}

export function drawSpaceGlobe(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]>; wallT?: number; fleet?: FleetMarker[] },
) {
  const { w, h } = opts;
  const el = orbitalElements(s.x, s.y, s.vx, s.vy);
  const alt = el.altitude;
  ensurePlanetAssets();
  const starA = clamp((alt - 8_000) / 30_000, 0.25, 1);
  ctx.fillStyle = '#050814';
  ctx.fillRect(0, 0, w, h);
  drawStars(ctx, w, h, starA);

  const maxR = PLANET.radius + Math.max(200_000, el.apAltitude === Infinity ? 200_000 : Math.min(Number.isFinite(el.apAltitude) ? el.apAltitude + 50_000 : 200_000, 900_000));
  const camEl = 0.42; // ~24° — a proper globe, not a polar map
  const camAz = Math.atan2(s.y, s.x) - 0.62;
  const cosE = Math.cos(camEl), sinE = Math.sin(camEl);
  const cosA = Math.cos(camAz), sinA = Math.sin(camAz);
  const dist = maxR * 3.35;
  const eye: [number, number, number] = [cosE * cosA * dist, cosE * sinA * dist, sinE * dist];
  const fwd = norm(-eye[0], -eye[1], -eye[2]);
  let right = norm(-sinA, cosA, 0);
  // Re-orthogonalise up
  const up = norm(
    fwd[1] * right[2] - fwd[2] * right[1],
    fwd[2] * right[0] - fwd[0] * right[2],
    fwd[0] * right[1] - fwd[1] * right[0],
  );
  right = norm(
    up[1] * fwd[2] - up[2] * fwd[1],
    up[2] * fwd[0] - up[0] * fwd[2],
    up[0] * fwd[1] - up[1] * fwd[0],
  );
  const fl = Math.min(w, h) * 0.78;
  const cx = w * 0.5, cy = h * 0.52;

  // Project planet centre and a surface limb point to get on-screen radius.
  const c0 = project(0, 0, 0, eye, right, up, fwd, fl, cx, cy);
  const limb = project(PLANET.radius * right[0], PLANET.radius * right[1], PLANET.radius * right[2], eye, right, up, fwd, fl, cx, cy);
  if (!c0 || !limb) return;
  const Rpix = Math.hypot(limb[0] - c0[0], limb[1] - c0[1]);

  const planetRot = PLANET.omega * s.t;
  const cloudRot = PLANET.omega * s.t * 0.12 + (opts.wallT ?? 0) * 0.012;
  const mobile = w < 700 || (typeof window !== 'undefined' && window.innerWidth < 700);
  const globe = renderGlobe(mobile ? GLOBE_LO : GLOBE_HI, planetRot, cloudRot, camAz, camEl);

  // Sun in screen space (far away along SUN).
  const sunFar = 8_000_000;
  const sunP = project(SUN[0] * sunFar, SUN[1] * sunFar, SUN[2] * sunFar, eye, right, up, fwd, fl, cx, cy);
  if (sunP) {
    const sg = ctx.createRadialGradient(sunP[0], sunP[1], 0, sunP[0], sunP[1], 90);
    sg.addColorStop(0, 'rgba(255,255,230,0.95)');
    sg.addColorStop(0.15, 'rgba(255,240,180,0.55)');
    sg.addColorStop(0.45, 'rgba(255,200,100,0.12)');
    sg.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sunP[0], sunP[1], 90, 0, Math.PI * 2); ctx.fill();
  }

  drawAtmosphereHalo(ctx, c0[0], c0[1], Rpix, sunP ? sunP[0] : c0[0] + Rpix, sunP ? sunP[1] : c0[1]);
  if (globe) {
    ctx.drawImage(globe, c0[0] - Rpix, c0[1] - Rpix, Rpix * 2, Rpix * 2);
  } else {
    ctx.fillStyle = '#1e5a3a';
    ctx.beginPath(); ctx.arc(c0[0], c0[1], Rpix, 0, Math.PI * 2); ctx.fill();
  }

  // Atmosphere cutoff ring (thin, dashed).
  ctx.save();
  ctx.strokeStyle = 'rgba(140,200,255,0.16)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  const atmR = Rpix * (1 + PLANET.atmHeight / PLANET.radius);
  ctx.beginPath(); ctx.arc(c0[0], c0[1], atmR, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const plot = (x: number, y: number) => project(x, y, 0, eye, right, up, fwd, fl, cx, cy);

  if (el.bound && el.apAltitude > 0) {
    const pts = orbitPoints(el, s.x, s.y, 160);
    ctx.save();
    ctx.strokeStyle = 'rgba(90, 230, 170, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    let started = false;
    let prevZ = 0;
    for (const [px, py] of pts) {
      const p = plot(px, py);
      if (!p) { started = false; continue; }
      // Hide the far side slightly (behind the planet).
      const behind = p[2] > (c0[2] ?? 0) && Math.hypot(p[0] - c0[0], p[1] - c0[1]) < Rpix * 0.98;
      if (behind) { started = false; continue; }
      if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
      else ctx.lineTo(p[0], p[1]);
      prevZ = p[2];
    }
    void prevZ;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  if (opts.fleet?.length) {
    // Faint shared orbit rings (deduplicated by altitude) and a dot per satellite.
    const rings = new Set<number>();
    ctx.save();
    for (const m of opts.fleet) {
      const rr = PLANET.radius + m.altM;
      const key = Math.round(m.altM / 5_000);
      if (!rings.has(key) && rings.size < 6) {
        rings.add(key);
        ctx.strokeStyle = 'rgba(111,227,255,0.13)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * Math.PI * 2;
          const p = plot(rr * Math.cos(a), rr * Math.sin(a));
          if (!p) { started = false; continue; }
          const behind = p[2] > (c0[2] ?? 0) && Math.hypot(p[0] - c0[0], p[1] - c0[1]) < Rpix * 0.98;
          if (behind) { started = false; continue; }
          if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
      }
      const th = fleetAngle(m, opts.wallT ?? 0);
      const p = plot(rr * Math.cos(th), rr * Math.sin(th));
      if (!p) continue;
      if (p[2] > (c0[2] ?? 0) && Math.hypot(p[0] - c0[0], p[1] - c0[1]) < Rpix * 0.98) continue;
      ctx.fillStyle = m.mine ? FLEET_MINE : FLEET_OTHER;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(m.label, p[0] + 6, p[1] - 3);
      ctx.fillStyle = m.mine ? FLEET_MINE : 'rgba(189,239,255,0.9)';
      ctx.fillText(m.label, p[0] + 5, p[1] - 4);
    }
    ctx.restore();
  }
  if (opts.trail && opts.trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const [px, py] of opts.trail) {
      const p = plot(px, py);
      if (!p) { started = false; continue; }
      const behind = p[2] > (c0[2] ?? 0) && Math.hypot(p[0] - c0[0], p[1] - c0[1]) < Rpix * 0.98;
      if (behind) { started = false; continue; }
      if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.restore();
  }
  const craft = plot(s.x, s.y);
  if (craft) {
    const behind = craft[2] > (c0[2] ?? 0) && Math.hypot(craft[0] - c0[0], craft[1] - c0[1]) < Rpix * 0.95;
    if (!behind) {
      ctx.fillStyle = s.deployed ? '#f0d060' : '#f4f6fa';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(craft[0], craft[1], s.deployed ? 5.5 : 4.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (!s.deployed && s.throttle > 0.05) {
        ctx.strokeStyle = '#ff9020';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(craft[0], craft[1]);
        ctx.lineTo(craft[0] + 7, craft[1] + 9);
        ctx.stroke();
      }
    }
  }
  ctx.fillStyle = '#b8e8d8';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`ApA ${fmtAlt(el.apAltitude)}   PeA ${fmtAlt(el.peAltitude)}`, 10, h - 12);
}

/** Another player's satellite (or one of yours) shown on the maps. */
export interface FleetMarker { id: string; label: string; altM: number; periodS: number; seed: number; mine?: boolean }
/** Display-only orbital angle (inertial) from wall-clock time; positions are illustrative. */
export function fleetAngle(m: FleetMarker, wallS: number): number {
  return m.seed * 2 * Math.PI + (2 * Math.PI * wallS) / Math.max(600, m.periodS);
}
const FLEET_OTHER = '#6fe3ff', FLEET_MINE = '#f0d060';

let trackCacheKey = '';
let trackShade: HTMLCanvasElement | null = null;

/** Equirectangular ground-track map, same surface texture as the globe. */
export function drawGroundTrack(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]>; wallT?: number; fleet?: FleetMarker[] },
) {
  const { w, h } = opts;
  ctx.fillStyle = '#071016';
  ctx.fillRect(0, 0, w, h);
  const a = ensurePlanetAssets();
  const rot = PLANET.omega * s.t;
  const cloud = rot * 0.12 + (opts.wallT ?? 0) * 0.012;
  if (a) {
    // Day/night shade is a cached overlay, rebuilt when rotation steps.
    const key = `${w}x${h}|${(rot * 40) | 0}|${(cloud * 30) | 0}`;
    ctx.drawImage(a.surface, 0, 0, TW, TH, 0, 0, w, h);
    // Night overlay: darken the west/east according to sun in planet frame.
    paintMapNight(ctx, w, h, rot);
    // Clouds
    ctx.save();
    ctx.globalAlpha = 0.55;
    const shift = ((cloud / (2 * Math.PI)) % 1) * w;
    ctx.drawImage(a.clouds, 0, 0, TW, TH, -shift, 0, w, h);
    ctx.drawImage(a.clouds, 0, 0, TW, TH, w - shift, 0, w, h);
    ctx.restore();
    void key; void trackCacheKey; void trackShade;
  }
  // Graticule
  ctx.strokeStyle = 'rgba(220,230,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const y = (i / 6) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  for (let i = 1; i < 8; i++) {
    const x = (i / 8) * w;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  // Equator emphasis
  ctx.strokeStyle = 'rgba(255,220,120,0.28)';
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

  const toMap = (x: number, y: number): [number, number] => {
    const lon = planetLon(x, y, s.t);
    let u = lon / (2 * Math.PI) + 0.5;
    u = ((u % 1) + 1) % 1;
    return [u * w, h / 2]; // equatorial flight
  };
  if (opts.trail && opts.trail.length > 1) {
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let prev: [number, number] | null = null;
    for (const [px, py] of opts.trail) {
      const p = toMap(px, py);
      if (!prev) { ctx.moveTo(p[0], p[1]); prev = p; continue; }
      // Don't draw a wrap-around spike.
      if (Math.abs(p[0] - prev[0]) > w * 0.5) { ctx.moveTo(p[0], p[1]); }
      else ctx.lineTo(p[0], p[1]);
      prev = p;
    }
    ctx.stroke();
  }
  // Fleet: everyone's satellites on the equatorial track (labels only when roomy).
  if (opts.fleet?.length) {
    const wallS = opts.wallT ?? 0;
    const placed: number[] = [];
    for (const m of opts.fleet) {
      const th = fleetAngle(m, wallS);
      let u = (th - PLANET.omega * s.t) / (2 * Math.PI) + 0.5;
      u = ((u % 1) + 1) % 1;
      const x = u * w, y = h / 2;
      ctx.fillStyle = m.mine ? FLEET_MINE : FLEET_OTHER;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (w > 260 && placed.every((px) => Math.abs(px - x) > 70)) {
        placed.push(x);
        ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        const row = placed.length % 2 ? -9 : 15;
        const half = ctx.measureText(m.label).width / 2 + 3;
        const lx = Math.min(w - half, Math.max(half, x)); // keep edge labels on the map
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(m.label, lx + 1, y + row + 1);
        ctx.fillStyle = m.mine ? FLEET_MINE : '#bdefff';
        ctx.fillText(m.label, lx, y + row);
      }
    }
  }
  const here = toMap(s.x, s.y);
  ctx.fillStyle = s.deployed ? '#f0d060' : '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(here[0], here[1], 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Launch site: planet-fixed λ = 0, so always mid-map.
  const ls = 0.5 * w;
  ctx.fillStyle = '#7ad0ff';
  ctx.beginPath();
  ctx.moveTo(ls, h / 2 - 6); ctx.lineTo(ls + 4, h / 2 + 4); ctx.lineTo(ls - 4, h / 2 + 4);
  ctx.closePath(); ctx.fill();

  // Label bottom-left (the HUD owns the top-left corner).
  ctx.font = '600 9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText('GROUND TRACK · EQUATOR', 7, h - 7);
  ctx.fillStyle = 'rgba(210,232,255,0.85)';
  ctx.fillText('GROUND TRACK · EQUATOR', 6, h - 8);
}

let nightCache: { key: string; shade: HTMLCanvasElement; lights: HTMLCanvasElement } | null = null;
/**
 * Day/night for the flat map: a cached low-res overlay (darkness + city
 * lights) drawn scaled, so it is resolution-independent (HiDPI-safe) and
 * cheap per frame.
 */
function paintMapNight(ctx: CanvasRenderingContext2D, w: number, h: number, planetRot: number) {
  const NW = 512, NH = 256;
  const key = `${Math.round(planetRot * 300)}`;
  if (!nightCache || nightCache.key !== key) {
    const shade = nightCache?.shade ?? makeCanvas(NW, NH);
    const lightsC = nightCache?.lights ?? makeCanvas(NW, NH);
    const sc = shade.getContext('2d'), lc = lightsC.getContext('2d');
    if (!sc || !lc) return;
    const si = sc.createImageData(NW, NH), li = lc.createImageData(NW, NH);
    const c = Math.cos(-planetRot), sn = Math.sin(-planetRot);
    const sx = SUN[0] * c - SUN[1] * sn, sy = SUN[0] * sn + SUN[1] * c, sz = SUN[2];
    const lights = maps()?.lightPx;
    for (let j = 0; j < NH; j++) {
      const lat = (0.5 - (j + 0.5) / NH) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i < NW; i++) {
        const lon = ((i + 0.5) / NW) * 2 * Math.PI - Math.PI;
        const nd = cl * Math.cos(lon) * sx + cl * Math.sin(lon) * sy + sl * sz;
        const night = 1 - smooth(-0.05, 0.18, nd);
        const o = (j * NW + i) * 4;
        si.data[o] = 2; si.data[o + 1] = 6; si.data[o + 2] = 18; si.data[o + 3] = night * 0.78 * 255;
        if (lights && night > 0.3) {
          const la = sample(lights, (i + 0.5) / NW, (j + 0.5) / NH, TW, TH)[3];
          if (la > 6) {
            const g = clamp((la / 255) * night * night * 1.4);
            li.data[o] = 255; li.data[o + 1] = 190; li.data[o + 2] = 90; li.data[o + 3] = g * 255;
          }
        }
      }
    }
    sc.putImageData(si, 0, 0);
    lc.putImageData(li, 0, 0);
    nightCache = { key, shade, lights: lightsC };
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(nightCache.shade, 0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(nightCache.lights, 0, 0, w, h);
  ctx.restore();
}

/** Force a fresh globe on the next frame (e.g. after a resize). */
export function invalidatePlanetCache(): void { globeCache = null; }


/* ── Survey layers (equirectangular, same terrain) ── */
export type SurveyLayer = 'altimetry' | 'biome' | 'resource' | 'visual' | 'weather';
const layerCache = new Map<string, HTMLCanvasElement>();

function hexRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const ELEV_RAMP: Array<[number, [number, number, number]]> = [
  [-0.6, [8, 16, 64]], [-0.25, [20, 60, 150]], [0, [60, 150, 210]],
  [0.02, [40, 140, 70]], [0.18, [150, 190, 70]], [0.35, [220, 190, 80]],
  [0.5, [170, 110, 60]], [0.7, [235, 235, 240]],
];
function elevColor(e: number): [number, number, number] {
  if (e <= ELEV_RAMP[0]![0]) return ELEV_RAMP[0]![1];
  for (let i = 1; i < ELEV_RAMP.length; i++) {
    const [a, ca] = ELEV_RAMP[i - 1]!, [b, cb] = ELEV_RAMP[i]!;
    if (e <= b) {
      const t = (e - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return ELEV_RAMP[ELEV_RAMP.length - 1]![1];
}
function heat(v: number): [number, number, number] {
  // black → purple → red → orange → yellow
  const stops: Array<[number, [number, number, number]]> = [
    [0, [10, 8, 20]], [0.35, [70, 20, 110]], [0.6, [200, 40, 50]], [0.8, [250, 150, 30]], [1, [255, 250, 160]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1]!, [b, cb] = stops[i]!;
    if (v <= b) {
      const t = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return stops[stops.length - 1]![1];
}

/** A full (unmasked) survey layer at w×h, cached. */
export function surveyLayer(kind: SurveyLayer, w = 1024, h = 512): HTMLCanvasElement | null {
  const key = `${kind}|${w}x${h}`;
  const hit = layerCache.get(key);
  if (hit) return hit;
  const a = ensurePlanetAssets();
  if (!a) return null;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  if (kind === 'visual') {
    ctx.drawImage(a.surface, 0, 0, TW, TH, 0, 0, w, h);
  } else if (kind === 'weather') {
    ctx.fillStyle = '#0d2238';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.25;
    ctx.drawImage(a.surface, 0, 0, TW, TH, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.drawImage(a.clouds, 0, 0, TW, TH, 0, 0, w, h);
    ctx.drawImage(a.clouds, 0, 0, TW, TH, 0, 0, w, h);
  } else {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let j = 0; j < h; j++) {
      const tj = Math.min(TH - 1, Math.floor((j + 0.5) / h * TH));
      const lat = (0.5 - (j + 0.5) / h) * Math.PI;
      for (let i = 0; i < w; i++) {
        const ti = Math.min(TW - 1, Math.floor((i + 0.5) / w * TW));
        const idx = tj * TW + ti;
        const e = a.elev[idx]!;
        let col: [number, number, number];
        if (kind === 'altimetry') {
          const eR = a.elev[tj * TW + ((ti + 2) % TW)]!;
          const shade = clamp(1 + (e - eR) * 3.5, 0.7, 1.25);
          const c0 = elevColor(e);
          col = [c0[0] * shade, c0[1] * shade, c0[2] * shade];
        } else if (kind === 'biome') {
          const eR = a.elev[tj * TW + ((ti + 1) % TW)]!;
          const eD = a.elev[Math.min(TH - 1, tj + 1) * TW + ti]!;
          const slope = Math.hypot(eR - e, eD - e) * 9;
          const b: BiomeId = biomeFromTerrain(e, lat, a.moist[idx]!, slope);
          col = hexRgb(BIOME_COLORS[b]);
        } else {
          const lon = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
          const ore = oreAt(lat, lon);
          col = heat(e <= 0 ? ore * 0.55 : ore);
        }
        const o = (j * w + i) * 4;
        d[o] = clamp(col[0], 0, 255) | 0;
        d[o + 1] = clamp(col[1], 0, 255) | 0;
        d[o + 2] = clamp(col[2], 0, 255) | 0;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  layerCache.set(key, c);
  return c;
}

const BIOME_COLORS: Record<BiomeId, string> = {
  'launch-site': '#d0d4dc', 'deep-ocean': '#0b2a5c', ocean: '#1d6a9a', shores: '#d8c890',
  desert: '#d39a4a', mountains: '#7c746c', jungle: '#1f8a3a', forest: '#2d5e2a',
  grassland: '#8cc05a', tundra: '#a8b4a0', 'ice-caps': '#eef4fa',
};

/**
 * Draw a survey map: the layer where `isCovered(lon, lat)` is true, and a dark
 * unscanned grid elsewhere. Cells are SURVEY_LON × SURVEY_LAT.
 */
let coverMask: { key: string; canvas: HTMLCanvasElement } | null = null;
let surveyScratch: HTMLCanvasElement | null = null;

/**
 * Soft coverage mask: the same per-cell coverage data, sampled bilinearly
 * between cell centres (longitude wraps) and eased, so scanned regions read as
 * smooth swaths instead of 5° blocks.
 */
function coverageMask(lonCells: number, latCells: number, isCovered: (i: number, j: number) => boolean): HTMLCanvasElement {
  const bits: number[] = [];
  for (let j = 0; j < latCells; j++) for (let i = 0; i < lonCells; i++) bits.push(isCovered(i, j) ? 1 : 0);
  const key = `${lonCells}x${latCells}|${bits.join('')}`;
  if (coverMask && coverMask.key === key) return coverMask.canvas;
  const MW = lonCells * 8, MH = latCells * 8;
  const c = coverMask?.canvas.width === MW && coverMask.canvas.height === MH ? coverMask.canvas : makeCanvas(MW, MH);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(MW, MH);
  const at = (i: number, j: number) => bits[clamp(j, 0, latCells - 1) * lonCells + (((i % lonCells) + lonCells) % lonCells)]!;
  for (let y = 0; y < MH; y++) {
    // grid row 0 = south; canvas row 0 = north
    const gy = latCells - (y + 0.5) / 8 - 0.5;
    const j0 = Math.floor(gy), ty = gy - j0;
    for (let x = 0; x < MW; x++) {
      const gx = (x + 0.5) / 8 - 0.5;
      const i0 = Math.floor(gx), tx = gx - i0;
      const v = lerp(lerp(at(i0, j0), at(i0 + 1, j0), tx), lerp(at(i0, j0 + 1), at(i0 + 1, j0 + 1), tx), ty);
      img.data[(y * MW + x) * 4 + 3] = smooth(0.18, 0.62, v) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  coverMask = { key, canvas: c };
  return c;
}

export function drawSurveyMap(
  ctx: CanvasRenderingContext2D,
  kind: SurveyLayer,
  opts: { w: number; h: number; lonCells: number; latCells: number; isCovered: (i: number, j: number) => boolean; track?: Array<[number, number]> },
) {
  const { w, h } = opts;
  ctx.fillStyle = '#05090e';
  ctx.fillRect(0, 0, w, h);
  // Unscanned: a faint continuous hatch under everything.
  ctx.save();
  ctx.strokeStyle = 'rgba(80,120,150,0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -h; x < w; x += 9) { ctx.moveTo(x, h); ctx.lineTo(x + h, 0); }
  ctx.stroke();
  ctx.restore();
  const layer = surveyLayer(kind);
  if (layer && typeof document !== 'undefined') {
    // Composite at device resolution: layer, then keep it only where scanned.
    const tr = ctx.getTransform();
    const pw = Math.max(1, Math.round(w * tr.a)), ph = Math.max(1, Math.round(h * tr.d));
    if (!surveyScratch) surveyScratch = document.createElement('canvas');
    if (surveyScratch.width !== pw || surveyScratch.height !== ph) { surveyScratch.width = pw; surveyScratch.height = ph; }
    const sc = surveyScratch.getContext('2d');
    if (sc) {
      sc.globalCompositeOperation = 'source-over';
      sc.clearRect(0, 0, pw, ph);
      sc.imageSmoothingEnabled = true;
      sc.imageSmoothingQuality = 'high';
      sc.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, pw, ph);
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(coverageMask(opts.lonCells, opts.latCells, opts.isCovered), 0, 0, pw, ph);
      sc.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(surveyScratch, tr.e, tr.f);
      ctx.restore();
    }
  }
  // Graticule
  ctx.strokeStyle = 'rgba(200,230,255,0.14)';
  ctx.lineWidth = 1;
  for (let k = 1; k < 12; k++) { const x = Math.round((k / 12) * w) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let k = 1; k < 6; k++) { const y = Math.round((k / 6) * h) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,220,120,0.3)';
  ctx.beginPath(); ctx.moveTo(0, Math.round(h / 2) + 0.5); ctx.lineTo(w, Math.round(h / 2) + 0.5); ctx.stroke();
}
