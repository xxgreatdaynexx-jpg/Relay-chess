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

const TW = 1536;
const TH = 768;
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

function biome(elev: number, lat: number, moist: number, slope: number): [number, number, number] {
  const absLat = Math.abs(lat) * 180 / Math.PI;
  // Ice caps and high alpine snow.
  const snowLine = 0.55 + 0.35 * (1 - absLat / 90);
  if (elev > 0 && (absLat > 62 + moist * 6 + elev * 8 || (elev > snowLine && absLat > 28))) {
    const k = 228 + (elev * 20) | 0;
    return rgb(k, k + 4, k + 10);
  }
  if (elev <= 0) {
    // Ocean: depth from elev (more negative = deeper).
    const d = clamp(-elev / 0.55);
    const shallow = rgb(28, 118, 138);
    const mid = rgb(12, 62, 108);
    const deep = rgb(4, 22, 56);
    const trench = rgb(2, 10, 32);
    const t = d;
    const a = t < 0.35 ? lerpC(shallow, mid, t / 0.35) : t < 0.7 ? lerpC(mid, deep, (t - 0.35) / 0.35) : lerpC(deep, trench, (t - 0.7) / 0.3);
    // A little sun-facing baked sparkle is added at draw time; here a faint teal in shallows.
    return a;
  }
  // Beach
  if (elev < 0.035) return rgb(194, 178, 122);
  // Desert vs grassland vs forest by moisture and latitude.
  const trop = smooth(18, 8, absLat);
  const midl = smooth(12, 22, absLat) * smooth(52, 42, absLat);
  const dry = moist < 0.32 + (absLat > 18 && absLat < 36 ? 0.12 : 0);
  if (dry && absLat < 48 && elev < 0.42) {
    const sand = rgb(196, 164, 92);
    const red = rgb(168, 110, 62);
    return lerpC(sand, red, clamp(elev * 1.4));
  }
  if (slope > 0.45 && elev > 0.28) {
    // Bare rock / mountains
    const rock = rgb(98, 96, 92);
    const dark = rgb(72, 70, 68);
    return lerpC(rock, dark, clamp(slope));
  }
  if (trop > 0.4 && moist > 0.4) {
    const jungle = rgb(22, 92, 42);
    const lush = rgb(36, 122, 52);
    return lerpC(lush, jungle, clamp(moist));
  }
  if (moist > 0.45) {
    const forest = rgb(28, 86, 38);
    const pine = rgb(24, 64, 40);
    return lerpC(forest, pine, midl * 0.6 + elev);
  }
  const grass = rgb(62, 122, 52);
  const prairie = rgb(110, 136, 58);
  const tundra = rgb(132, 140, 108);
  const g = lerpC(grass, prairie, clamp(0.55 - moist));
  return absLat > 50 ? lerpC(g, tundra, smooth(50, 62, absLat)) : g;
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
      let [r, g, b] = biome(e, lat, moistA[idx]!, slope);
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
  const stars = makeCanvas(1024, 768);
  const st = stars.getContext('2d');
  if (st) {
    st.fillStyle = '#050814';
    st.fillRect(0, 0, 1024, 768);
    // Faint milky band.
    const milky = st.createLinearGradient(0, 200, 1024, 560);
    milky.addColorStop(0, 'rgba(0,0,0,0)');
    milky.addColorStop(0.4, 'rgba(160,180,230,0.07)');
    milky.addColorStop(0.55, 'rgba(200,210,255,0.11)');
    milky.addColorStop(0.7, 'rgba(160,180,230,0.06)');
    milky.addColorStop(1, 'rgba(0,0,0,0)');
    st.save();
    st.translate(512, 384);
    st.rotate(-0.35);
    st.translate(-512, -384);
    st.fillStyle = milky;
    st.fillRect(0, 250, 1024, 280);
    st.restore();
    let s = 91_117;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < 900; i++) {
      const x = rnd() * 1024, y = rnd() * 768, a = 0.15 + rnd() * 0.85, r = rnd() * (rnd() > 0.96 ? 1.8 : 1.05);
      const col = rnd() > 0.85 ? `rgba(180,210,255,${a})` : rnd() > 0.7 ? `rgba(255,230,200,${a})` : `rgba(240,245,255,${a})`;
      st.fillStyle = col;
      st.beginPath(); st.arc(x, y, r, 0, Math.PI * 2); st.fill();
    }
  }
  return { surface, clouds, lights, ocean, elev, moist: moistA, stars };
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
function maps() {
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

function sample(px: Uint8ClampedArray, u: number, v: number, w: number, h: number): [number, number, number, number] {
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

function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 1) {
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
  // Outer glow
  const g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R + atm * 1.8);
  g.addColorStop(0, 'rgba(80,160,255,0)');
  g.addColorStop(R / (R + atm * 1.8) * 0.98, 'rgba(80,160,255,0)');
  g.addColorStop(R / (R + atm * 1.8), 'rgba(140,200,255,0.55)');
  g.addColorStop(Math.min(0.99, (R + atm * 0.55) / (R + atm * 1.8)), 'rgba(90,160,255,0.18)');
  g.addColorStop(1, 'rgba(40,80,180,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R + atm * 1.8, 0, Math.PI * 2);
  ctx.fill();
  // Tight inner limb
  const g2 = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R + atm * 0.35);
  g2.addColorStop(0, 'rgba(200,230,255,0)');
  g2.addColorStop(0.7, 'rgba(200,230,255,0)');
  g2.addColorStop(0.92, 'rgba(210,235,255,0.65)');
  g2.addColorStop(1, 'rgba(150,200,255,0)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(cx, cy, R + atm * 0.35, 0, Math.PI * 2);
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
  opts: { w: number; h: number; trail?: Array<[number, number]>; wallT?: number },
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
  ctx.strokeStyle = 'rgba(140,200,255,0.28)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
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

/** Low / mid-ascent: curved horizon, textured ground, atmosphere-gradient sky. */
export function drawAscentHorizon(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; tFlame?: number; wallT?: number; drawRocket?: (ctx: CanvasRenderingContext2D, baseX: number, baseY: number, horizonY: number) => void },
) {
  const { w, h } = opts;
  const alt = Math.max(0, altitudeOf(s));
  const skyT = clamp(alt / 52_000);
  ensurePlanetAssets();

  // Sky: blue fading to black with altitude. Zenith darker than the horizon.
  const zenith = lerpC3([110, 170, 225], [5, 8, 18], Math.pow(skyT, 0.72));
  const horiz = lerpC3([168, 208, 238], [28, 48, 90], Math.pow(skyT, 0.85));
  // A warm horizon when the sun is low (after some MET the launch-noon sun sinks in the west).
  const sunAlt = Math.cos(PLANET.omega * s.t); // 1 at t=0
  const glow = lerpC3([255, 200, 130], [120, 80, 90], clamp(sunAlt * 0.5 + 0.5));
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, `rgb(${zenith[0]},${zenith[1]},${zenith[2]})`);
  sky.addColorStop(0.55, `rgb(${lerp(zenith[0], horiz[0], 0.6)|0},${lerp(zenith[1], horiz[1], 0.6)|0},${lerp(zenith[2], horiz[2], 0.6)|0})`);
  sky.addColorStop(0.88, `rgb(${horiz[0]},${horiz[1]},${horiz[2]})`);
  sky.addColorStop(1, `rgb(${glow[0]},${glow[1]},${glow[2]})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  if (skyT > 0.15) {
    drawStars(ctx, w, h, clamp((skyT - 0.15) / 0.55));
    // Redraw a translucent sky over stars so they fade in, not punch through at low alt.
    if (skyT < 0.7) {
      ctx.fillStyle = `rgba(${zenith[0]},${zenith[1]},${zenith[2]},${1 - (skyT - 0.15) / 0.55})`;
      ctx.fillRect(0, 0, w, h * 0.75);
    }
  }

  // Curvature: almost flat near the pad, clearly bowed by 20–40 km.
  const dip = Math.acos(PLANET.radius / (PLANET.radius + alt + 1));
  const Rpix = Math.max(w * 0.9, (w * 0.55) / Math.max(0.07, Math.sin(Math.max(dip, 0.04))));
  const horizonY = h * (0.58 + 0.14 * (1 - clamp(alt / 40_000)));
  const pcx = w / 2;
  const pcy = horizonY + Rpix;

  paintHorizonGround(ctx, s, pcx, pcy, Rpix, w, h, alt);

  // Atmospheric limb / haze along the horizon.
  const hazeH = 18 + 70 * (1 - skyT);
  const hg = ctx.createLinearGradient(0, horizonY - hazeH * 2, 0, horizonY + 8);
  hg.addColorStop(0, 'rgba(180,210,255,0)');
  hg.addColorStop(0.55, `rgba(170,210,255,${0.22 * (1 - skyT)})`);
  hg.addColorStop(0.82, `rgba(220,235,255,${0.45 * (1 - skyT * 0.6)})`);
  hg.addColorStop(1, 'rgba(180,210,255,0)');
  ctx.save();
  ctx.beginPath();
  ctx.arc(pcx, pcy, Rpix + hazeH * 0.6, 0, Math.PI * 2);
  ctx.arc(pcx, pcy, Math.max(0, Rpix - 4), 0, Math.PI * 2, true);
  ctx.clip();
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // Tight white-blue limb
  ctx.strokeStyle = `rgba(210,235,255,${0.45 + 0.35 * skyT})`;
  ctx.lineWidth = 2 + 3 * skyT;
  ctx.beginPath();
  ctx.arc(pcx, pcy, Rpix, Math.PI, 0, true); // upper arc
  ctx.stroke();

  if (alt < 900) {
    ctx.fillStyle = '#4a4e56';
    ctx.fillRect(w / 2 - 50, horizonY - 6, 100, 8);
    ctx.fillStyle = '#888';
    ctx.fillRect(w / 2 + 36, horizonY - 90, 6, 90);
  }
  opts.drawRocket?.(ctx, w / 2, horizonY - 8 - Math.min(alt / 80, 40), horizonY);

  ctx.fillStyle = skyT > 0.45 ? '#cde' : '#123';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(fmtAlt(alt), 10, 18);
}

function lerpC3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = clamp(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}


function paintHorizonGround(ctx: CanvasRenderingContext2D, s: FlightState, pcx: number, pcy: number, Rpix: number, w: number, h: number, alt: number) {
  const m = maps();
  if (!m) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(pcx, pcy, Rpix, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createLinearGradient(0, pcy - Rpix, 0, h);
    g.addColorStop(0, alt < 3000 ? '#2d6a3a' : '#1a3a28');
    g.addColorStop(1, '#0c1c14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  const mobile = w < 700;
  const bufW = mobile ? 320 : 560;
  const bufH = mobile ? 200 : 340;
  const buf = horizonBuf(bufW, bufH);
  const img = buf.img;
  const out = img.data;
  const { surfacePx: sp, cloudPx: cp } = m;
  const [suX, suY, suZ] = SUN;
  const r = Math.hypot(s.x, s.y) || 1;
  const ux = s.x / r, uy = s.y / r;
  const ex = -uy, ey = ux;
  // Look a little north-of-east so a coastline sits in frame (launch is on the equator).
  const lookYaw = 0.55;
  const cyE = Math.cos(lookYaw), syE = Math.sin(lookYaw);
  // Camera looks just below the geometric horizon so the limb sits mid-lower frame.
  const dip = Math.acos(PLANET.radius / (PLANET.radius + alt + 1));
  const lookPitch = -dip * 0.15;
  const fov = 1.05;
  const aspect = bufW / bufH;
  const tanH = Math.tan(fov / 2);
  for (let j = 0; j < bufH; j++) {
    for (let i = 0; i < bufW; i++) {
      const ndcX = ((i + 0.5) / bufW) * 2 - 1;
      const ndcY = 1 - ((j + 0.5) / bufH) * 2;
      const camF = 1;
      const camR = ndcX * tanH * aspect;
      const camU = ndcY * tanH;
      // Rotate look by pitch (in the east/up plane) then yaw toward north.
      const fp = Math.cos(lookPitch), up = Math.sin(lookPitch);
      const f2 = camF * fp + camU * (-Math.sin(lookPitch));
      const u2 = camF * Math.sin(lookPitch) + camU * fp;
      // yaw around up: mix east and north
      const east = f2 * cyE;
      const north = f2 * syE + camR;
      const upC = u2;
      const inv = 1 / (Math.hypot(east, north, upC) || 1);
      const rdE = east * inv, rdN = north * inv, rdU = upC * inv;
      const rx = rdE * ex + rdU * ux;
      const ry = rdE * ey + rdU * uy;
      const rz = rdN;
      const ox = s.x, oy = s.y, oz = 0;
      const bdot = 2 * (ox * rx + oy * ry + oz * rz);
      const cc = ox * ox + oy * oy + oz * oz - PLANET.radius * PLANET.radius;
      const disc = bdot * bdot - 4 * cc;
      const o = (j * bufW + i) * 4;
      if (disc < 0) { out[o + 3] = 0; continue; }
      const tHit = (-bdot - Math.sqrt(disc)) / 2;
      if (!(tHit > 20)) { out[o + 3] = 0; continue; }
      const hx = ox + rx * tHit, hy = oy + ry * tHit, hz = oz + rz * tHit;
      const nlen = Math.hypot(hx, hy, hz) || 1;
      const nx = hx / nlen, ny = hy / nlen, nz = hz / nlen;
      const lat = Math.asin(clamp(nz, -1, 1));
      const lon = Math.atan2(ny, nx) - PLANET.omega * s.t;
      const u = lon / (2 * Math.PI) + 0.5;
      const v = 0.5 - lat / Math.PI;
      const [sr, sg, sb] = sample(sp, u, v, TW, TH);
      const ndotl = nx * suX + ny * suY + nz * suZ;
      const day = smooth(-0.05, 0.18, ndotl);
      const lambert = 0.18 + 0.9 * Math.max(0, ndotl);
      let rC = sr * lerp(0.08, lambert, day);
      let gC = sg * lerp(0.09, lambert, day);
      let bC = sb * lerp(0.16, lambert, day);
      const [, , , ca] = sample(cp, u + optsWall(s), v, TW, TH);
      const cA = (ca / 255) * 0.5;
      if (cA > 0) {
        const cl = 0.22 + 0.85 * Math.max(0, ndotl);
        rC = rC * (1 - cA) + 230 * cl * cA;
        gC = gC * (1 - cA) + 235 * cl * cA;
        bC = bC * (1 - cA) + 245 * cl * cA;
      }
      const haze = clamp(tHit / (PLANET.radius * 0.85 + alt * 4));
      const hzC = lerp(0.55, 1, day);
      rC = lerp(rC, 140 * hzC + 30, haze * 0.5);
      gC = lerp(gC, 170 * hzC + 25, haze * 0.5);
      bC = lerp(bC, 205 * hzC, haze * 0.55);
      out[o] = clamp(rC, 0, 255) | 0;
      out[o + 1] = clamp(gC, 0, 255) | 0;
      out[o + 2] = clamp(bC, 0, 255) | 0;
      out[o + 3] = 255;
    }
  }
  buf.ctx.putImageData(img, 0, 0);
  // Draw over the whole viewport — transparent sky pixels leave the gradient sky.
  ctx.drawImage(buf.canvas, 0, 0, bufW, bufH, 0, 0, w, h);
}

function optsWall(_s: FlightState): number {
  return (Date.now() / 1000) * 0.002;
}

let hzCanvas: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData; w: number; h: number } | null = null;
function horizonBuf(w: number, h: number) {
  if (hzCanvas && hzCanvas.w === w && hzCanvas.h === h) return hzCanvas;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  hzCanvas = { canvas, ctx, img: ctx.createImageData(w, h), w, h };
  return hzCanvas;
}

let trackCacheKey = '';
let trackShade: HTMLCanvasElement | null = null;

/** Equirectangular ground-track map, same surface texture as the globe. */
export function drawGroundTrack(
  ctx: CanvasRenderingContext2D,
  s: FlightState,
  opts: { w: number; h: number; trail?: Array<[number, number]>; wallT?: number },
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
  const here = toMap(s.x, s.y);
  ctx.fillStyle = s.deployed ? '#f0d060' : '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(here[0], here[1], 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Launch site (λ = 0)
  const ls = ((((0 / (2 * Math.PI) + 0.5 - rot / (2 * Math.PI)) % 1) + 1) % 1) * w;
  ctx.fillStyle = '#7ad0ff';
  ctx.beginPath();
  ctx.moveTo(ls, h / 2 - 6); ctx.lineTo(ls + 4, h / 2 + 4); ctx.lineTo(ls - 4, h / 2 + 4);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = 'rgba(200,230,255,0.75)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('GROUND TRACK  ·  equator', 6, 12);
}

function paintMapNight(ctx: CanvasRenderingContext2D, w: number, h: number, planetRot: number) {
  // Sun in planet-fixed frame: rotate SUN around Z by -planetRot.
  const c = Math.cos(-planetRot), si = Math.sin(-planetRot);
  const sx = SUN[0] * c - SUN[1] * si;
  const sy = SUN[0] * si + SUN[1] * c;
  const sz = SUN[2];
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lights = maps()?.lightPx;
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
      const nx = cl * Math.cos(lon), ny = cl * Math.sin(lon), nz = sl;
      const nd = nx * sx + ny * sy + nz * sz;
      const night = 1 - smooth(-0.05, 0.18, nd);
      if (night < 0.05) continue;
      const o = (j * w + i) * 4;
      const dim = 1 - 0.78 * night;
      d[o] = (d[o]! * dim) | 0;
      d[o + 1] = (d[o + 1]! * dim) | 0;
      d[o + 2] = (d[o + 2]! * (dim * 0.95 + 0.05)) | 0;
      if (lights && night > 0.3) {
        const u = (i + 0.5) / w, v = (j + 0.5) / h;
        const [, , , la] = sample(lights, u, v, TW, TH);
        if (la > 6) {
          const g = (la / 255) * night * night;
          d[o] = clamp(d[o]! + 255 * g, 0, 255) | 0;
          d[o + 1] = clamp(d[o + 1]! + 190 * g, 0, 255) | 0;
          d[o + 2] = clamp(d[o + 2]! + 90 * g, 0, 255) | 0;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
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
export function surveyLayer(kind: SurveyLayer, w = 720, h = 360): HTMLCanvasElement | null {
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
export function drawSurveyMap(
  ctx: CanvasRenderingContext2D,
  kind: SurveyLayer,
  opts: { w: number; h: number; lonCells: number; latCells: number; isCovered: (i: number, j: number) => boolean; track?: Array<[number, number]> },
) {
  const { w, h } = opts;
  ctx.fillStyle = '#05090e';
  ctx.fillRect(0, 0, w, h);
  const layer = surveyLayer(kind);
  const cw = w / opts.lonCells, ch = h / opts.latCells;
  if (layer) {
    ctx.save();
    ctx.beginPath();
    for (let j = 0; j < opts.latCells; j++) {
      for (let i = 0; i < opts.lonCells; i++) {
        // grid row 0 = south pole; canvas row 0 = north
        if (opts.isCovered(i, j)) ctx.rect(i * cw - 0.5, (opts.latCells - 1 - j) * ch - 0.5, cw + 1, ch + 1);
      }
    }
    ctx.clip();
    ctx.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, w, h);
    ctx.restore();
  }
  // Unscanned hatch
  ctx.save();
  ctx.strokeStyle = 'rgba(80,120,150,0.12)';
  ctx.lineWidth = 1;
  for (let j = 0; j < opts.latCells; j++) {
    for (let i = 0; i < opts.lonCells; i++) {
      if (opts.isCovered(i, j)) continue;
      const x = i * cw, y = (opts.latCells - 1 - j) * ch;
      ctx.beginPath(); ctx.moveTo(x, y + ch); ctx.lineTo(x + cw, y); ctx.stroke();
    }
  }
  ctx.restore();
  // Graticule
  ctx.strokeStyle = 'rgba(200,230,255,0.14)';
  for (let k = 1; k < 12; k++) { const x = (k / 12) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let k = 1; k < 6; k++) { const y = (k / 6) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,220,120,0.3)';
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}
